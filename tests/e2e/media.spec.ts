import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp } from './launch-app'

const VIDEO_SOURCE = 'src/renderer/src/assets/backgrounds/matrix-rain.mp4'
const CUSTOM_NAME = '12345678-1234-1234-1234-123456789abc.mp4'

/** Tests compile without DOM types, so this names the video fields they read. */
interface HTMLMediaElementLike {
  currentTime: number
  paused: boolean
  error: { code: number } | null
}

function finishOnboarding(page: Page): Promise<unknown> {
  return page.evaluate('window.gramatrix.invoke("settings.update", { onboardingCompleted: true })')
}

function playback(page: Page): Promise<{ time: number; paused: boolean; error: number | null }> {
  return page.locator('video').evaluate((video: HTMLMediaElementLike) => ({
    time: video.currentTime,
    paused: video.paused,
    error: video.error?.code ?? null
  }))
}

/** Alpha of a pixel in the empty part of the page, from what the window actually drew. */
function windowAlpha(app: ElectronApplication): Promise<number | undefined> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const image = (await window?.webContents.capturePage()) as Electron.NativeImage | undefined
    if (!image) return undefined
    const { width, height } = image.getSize()
    const offset = (Math.floor(height * 0.9) * width + Math.floor(width * 0.7)) * 4
    return image.toBitmap()[offset + 3]
  })
}

test('the default video really plays in the built app', async () => {
  const { page, close } = await launchApp()
  await finishOnboarding(page)
  await page.reload()
  await expect(page.locator('video')).toBeAttached()
  await expect.poll(async () => (await playback(page)).time).toBeGreaterThan(0.2)
  const first = await playback(page)
  expect(first.error).toBeNull()
  await expect.poll(async () => (await playback(page)).time).toBeGreaterThan(first.time)
  await close()
})

test('the video pauses while the window is hidden', async () => {
  const { app, page, close } = await launchApp()
  await finishOnboarding(page)
  await page.reload()
  await expect(page.locator('video')).toBeAttached()
  await expect.poll(async () => (await playback(page)).time).toBeGreaterThan(0.1)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide())
  await expect.poll(async () => (await playback(page)).paused).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.show())
  await expect.poll(async () => (await playback(page)).paused).toBe(false)
  await close()
})

test('reduced motion holds a still frame', async () => {
  const { page, close } = await launchApp()
  await page.evaluate(
    'window.gramatrix.invoke("settings.update", { onboardingCompleted: true, reduceMotion: true })'
  )
  await page.reload()
  await expect(page.locator('video')).toBeAttached()
  await expect.poll(async () => (await playback(page)).time).toBeGreaterThan(1)
  const { paused } = await playback(page)
  expect(paused).toBe(true)
  await close()
})

test('a custom video plays through the media protocol', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'gramatrix-e2e-'))
  mkdirSync(join(userData, 'backgrounds'))
  copyFileSync(VIDEO_SOURCE, join(userData, 'backgrounds', CUSTOM_NAME))
  const { page, close } = await launchApp({ GRAMATRIX_USER_DATA: userData })
  await page.evaluate(
    (name) =>
      (
        globalThis as unknown as {
          gramatrix: { invoke(method: string, params: unknown): Promise<unknown> }
        }
      ).gramatrix.invoke('settings.update', {
        onboardingCompleted: true,
        backgroundVideo: { enabled: true, customFile: name, opacity: 35, blur: 0 }
      }),
    CUSTOM_NAME
  )
  await page.reload()
  await expect(page.locator('video')).toHaveAttribute(
    'src',
    `gramatrix-media://backgrounds/${CUSTOM_NAME}`
  )
  await expect.poll(async () => (await playback(page)).time).toBeGreaterThan(0.2)
  await close()
})

test('highlighting runs in the built app', async () => {
  const { page, close } = await launchApp()
  await finishOnboarding(page)
  await page.reload()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(page.locator('.code-sample .code-line span[style]').first()).toBeVisible()
  await close()
})

test('a normal window stays opaque', async () => {
  const { app, page, close } = await launchApp()
  await finishOnboarding(page)
  await page.reload()
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()
  await page.waitForTimeout(300)
  expect(await windowAlpha(app)).toBe(255)
  await close()
})

test('going see through reopens the window on the same screen', async () => {
  const { app, page, close } = await launchApp()
  await finishOnboarding(page)
  await page.reload()
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()

  const reopened = app.waitForEvent('window')
  await page
    .evaluate('window.gramatrix.invoke("settings.update", { windowOpacity: 60 })')
    .catch(() => undefined)
  const next = await reopened
  await expect(next.getByRole('heading', { name: 'Usage', level: 1 })).toBeVisible()

  // The page itself must be see through. Whether the desktop shows is up to the compositor.
  await expect.poll(() => windowAlpha(app)).toBeLessThan(255)
  await close()
})
