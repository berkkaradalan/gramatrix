import { join } from 'node:path'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  safeStorage,
  shell,
  utilityProcess,
  type UtilityProcess
} from 'electron'
import {
  isMainMethod,
  secretName,
  type HostEventName,
  type HostInbound,
  type HostOutbound,
  type MainMethod,
  type ProviderTestResult
} from '@shared/rpc'
import type { AppInfo, AppSettings, ProviderId, TransparencySupport } from '@shared/types'
import { MEDIA_SCHEME, importVideo, videoResponse } from './background-videos'
import { readOpencodeKey } from './opencode-keys'
import { SecretStore } from './secret-store'

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
}

// Lets tests and side-by-side development use a separate data directory.
if (process.env['GRAMATRIX_USER_DATA']) app.setPath('userData', process.env['GRAMATRIX_USER_DATA'])

// Registered before the app is ready, as Electron requires. `stream` lets video seek and loop.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true } }
])

const pendingRequests = new Map<number, PendingRequest>()
let nextRequestId = 1
let host: UtilityProcess | null = null
let window: BrowserWindow | null = null
let tray: Tray | null = null
let secrets: SecretStore
let isQuitting = false
let closeToTray = true
/** A window cannot switch this after it is created, so a change needs a new window. */
let windowIsTransparent = false
let shutdownTimer: NodeJS.Timeout | undefined

const SHUTDOWN_TIMEOUT_MS = 3000
const RESTORE_ROUTE_HASH = 'restore-route'

function sendToHost(message: HostInbound): void {
  host?.postMessage(message)
}

function requestHost(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pendingRequests.set(id, { resolve, reject })
    sendToHost({ kind: 'request', id, method, params })
  })
}

function backgroundsFolder(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

function needsTransparency(settings: AppSettings): boolean {
  return settings.windowOpacity < 100
}

function forwardEvent(event: HostEventName, payload: unknown): void {
  window?.webContents.send(`event:${event}`, payload)
  if (event !== 'settings.changed') return
  const settings = payload as AppSettings
  closeToTray = settings.closeToTray
  if (needsTransparency(settings) !== windowIsTransparent) reopenWindow(settings)
}

/** A secret that cannot be decrypted, for example after a keychain reset, counts as missing. */
async function readSecret(name: string): Promise<string | null> {
  try {
    return await secrets.get(name)
  } catch (error) {
    console.warn(`Could not decrypt secret ${name}:`, error)
    return null
  }
}

function startHost(): Promise<void> {
  return new Promise((resolve) => {
    const child = utilityProcess.fork(join(import.meta.dirname, 'host.js'), [], {
      serviceName: 'gramatrix-host',
      env: { ...process.env, GRAMATRIX_DATA_DIR: app.getPath('userData') }
    })
    host = child

    child.on('message', (message: HostOutbound) => {
      switch (message.kind) {
        case 'ready':
          resolve()
          break
        case 'response': {
          const pending = pendingRequests.get(message.id)
          pendingRequests.delete(message.id)
          if (!pending) break
          if (message.ok) pending.resolve(message.result)
          else pending.reject(new Error(message.error))
          break
        }
        case 'event':
          forwardEvent(message.event, message.payload)
          break
        case 'shutdown-complete':
          finishQuit()
          break
        case 'secret-request':
          void readSecret(message.name).then((value) =>
            sendToHost({ kind: 'secret-response', id: message.id, value })
          )
          break
      }
    })

    child.on('exit', (code) => {
      host = null
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error(`Host process exited with code ${code}.`))
      }
      pendingRequests.clear()
      if (!isQuitting) void startHost()
    })
  })
}

async function importOpencodeKey(provider: ProviderId): Promise<ProviderTestResult> {
  const key = readOpencodeKey(provider)
  if (!key) return { ok: false, error: 'opencode has no key for this provider.' }
  const result = (await requestHost('providers.test', { provider, key })) as ProviderTestResult
  if (result.ok) await secrets.set(secretName.provider(provider), key)
  return result
}

async function handleMainMethod(method: MainMethod, params: never): Promise<unknown> {
  switch (method) {
    case 'app.info': {
      const info: AppInfo = {
        version: app.getVersion(),
        platform: process.platform,
        secretBackend: await secrets.backend(),
        transparency: transparencySupport()
      }
      return info
    }
    case 'app.pickDirectory':
      return pickDirectory()
    case 'app.pickBackgroundVideo':
      return pickBackgroundVideo()
    case 'app.openExternal': {
      const { url } = params as { url: string }
      if (!url.startsWith('https://')) throw new Error('Only https links can be opened.')
      return shell.openExternal(url)
    }
    case 'secrets.set': {
      const { name, value } = params as { name: string; value: string }
      return secrets.set(name, value)
    }
    case 'secrets.delete':
      return secrets.delete((params as { name: string }).name)
    case 'opencode.hasKey':
      return readOpencodeKey((params as { provider: ProviderId }).provider) !== null
    case 'opencode.importKey':
      return importOpencodeKey((params as { provider: ProviderId }).provider)
    case 'secrets.has':
      return secrets.has((params as { name: string }).name)
  }
}

async function pickDirectory(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

async function pickBackgroundVideo(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'webm'] }]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const [path] = result.filePaths
  if (result.canceled || !path) return null
  return importVideo(path, backgroundsFolder())
}

/**
 * Linux gives no way to ask whether a compositor is running. Wayland always composites, and on
 * X11 the answer depends on the desktop, so the interface says it may not work there.
 */
function transparencySupport(): TransparencySupport {
  if (process.platform !== 'linux') return 'supported'
  return process.env['XDG_SESSION_TYPE'] === 'wayland' ? 'supported' : 'unknown'
}

function finishQuit(): void {
  clearTimeout(shutdownTimer)
  host?.kill()
  app.exit(0)
}

/** Gives the host time to stop running commands, then quits even if it does not answer. */
function beginShutdown(): void {
  if (!host) return finishQuit()
  sendToHost({ kind: 'shutdown' })
  shutdownTimer = setTimeout(finishQuit, SHUTDOWN_TIMEOUT_MS)
}

function createWindow(options: { bounds?: Electron.Rectangle; restoreRoute?: boolean } = {}): void {
  const { bounds, restoreRoute = false } = options
  window = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 560,
    show: false,
    // Only windows that use it pay for transparency, which costs resize and text quality.
    transparent: windowIsTransparent,
    backgroundColor: windowIsTransparent ? '#00000000' : '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window?.show())
  const announceVisibility = (visible: boolean): void => {
    window?.webContents.send('event:window.visibility', { visible })
  }
  window.on('hide', () => announceVisibility(false))
  window.on('minimize', () => announceVisibility(false))
  window.on('show', () => announceVisibility(true))
  window.on('restore', () => announceVisibility(true))
  window.on('close', (event) => {
    if (closeToTray && !isQuitting) {
      event.preventDefault()
      window?.hide()
    }
  })
  const opened = window
  window.on('closed', () => {
    if (window === opened) window = null
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const hash = restoreRoute ? RESTORE_ROUTE_HASH : ''
  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
  }
}

/**
 * Replaces the window when transparency turns on or off. Runs, jobs and channels live in the host
 * process and keep going, and the new page returns to the screen the old one was showing.
 */
function reopenWindow(settings: AppSettings): void {
  windowIsTransparent = needsTransparency(settings)
  const previous = window
  if (!previous) return
  const bounds = previous.getBounds()
  window = null
  previous.removeAllListeners('close')
  previous.destroy()
  createWindow({ bounds, restoreRoute: true })
}

function showWindow(): void {
  if (window) {
    window.show()
    window.focus()
  } else {
    createWindow()
  }
}

function createTray(): void {
  // A small green square. It is generated here so the repository needs no icon asset yet.
  const size = 16
  const pixels = Buffer.alloc(size * size * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([0x41, 0xff, 0x00, 0xff], offset)
  }
  tray = new Tray(nativeImage.createFromBitmap(pixels, { width: size, height: size }))
  tray.setToolTip('Gramatrix')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Gramatrix', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('click', showWindow)
}

async function start(): Promise<void> {
  await app.whenReady()
  // Without a secret service Linux refuses to encrypt at all. Keys would then be impossible to
  // save, so accept the weak fallback. The app reports it as `weak` and warns the user.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    safeStorage.setUsePlainTextEncryption(true)
  }
  secrets = new SecretStore(join(app.getPath('userData'), 'secrets.json'), safeStorage)
  protocol.handle(MEDIA_SCHEME, (request) => videoResponse(request, backgroundsFolder()))

  ipcMain.handle('rpc', (_, method: string, params: unknown) => {
    if (isMainMethod(method)) return handleMainMethod(method, params as never)
    return requestHost(method, params)
  })

  await startHost()
  const settings = (await requestHost('settings.get', undefined)) as AppSettings
  closeToTray = settings.closeToTray
  windowIsTransparent = needsTransparency(settings)

  // Tray support varies across Linux desktops. The window still works without it.
  try {
    createTray()
  } catch (error) {
    closeToTray = false
    console.warn('Tray is not available:', error)
  }
  createWindow()

  app.on('activate', showWindow)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('before-quit', (event) => {
    if (isQuitting) return
    isQuitting = true
    event.preventDefault()
    beginShutdown()
  })
  app.on('window-all-closed', () => {
    if (!closeToTray) app.quit()
  })
  void start()
}
