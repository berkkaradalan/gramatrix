import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import type { RunEvent } from '../../../src/shared/types'
import { ACTION_TIMEOUT_MS } from '../launch-app'
import { FAKE_DEFAULTS, installFakeBackend, type FakeGlobals, type FakeSeed } from './fake-api'

export interface FakeApp {
  app: ElectronApplication
  page: Page
  close(): Promise<void>
}

export function emitRunEvent(page: Page, event: RunEvent): Promise<void> {
  return page.evaluate((payload) => {
    ;(globalThis as unknown as FakeGlobals).fakeBackend.emit('run.event', payload)
  }, event)
}

/** Returns the params of the first recorded call to a method. */
export function recordedParams(page: Page, method: string): Promise<unknown> {
  return page.evaluate((name) => {
    const { calls } = (globalThis as unknown as FakeGlobals).fakeBackend
    return calls.find((call) => call.method === name)?.params
  }, method)
}

/** Returns the id of the newest chat the fake backend created. */
export function newestChatId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (globalThis as unknown as FakeGlobals).fakeBackend.chats[0]?.id)
}

/** Opens the built renderer against the fake backend. Run `electron-vite build` first. */
export async function launchWithFakeBackend(
  seed: Partial<FakeSeed> = {},
  size: { width: number; height: number } = { width: 1280, height: 800 }
): Promise<FakeApp> {
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({
    // A fresh profile keeps sidebar preferences from leaking between tests.
    args: [
      '--no-sandbox',
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'gramatrix-fake-'))}`,
      resolve('tests/e2e/fake-backend/main.mjs')
    ],
    env: env as Record<string, string>
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  await page.setViewportSize(size)
  await page.addInitScript(installFakeBackend, {
    seed: {
      settings: {},
      providers: [],
      projects: [],
      chats: [],
      messages: [],
      models: {},
      modelDelayMs: 0,
      failSend: false,
      overrides: {},
      ...seed
    },
    defaults: FAKE_DEFAULTS
  })
  await page.goto(pathToFileURL(resolve('out/renderer/index.html')).href)
  return { app, page, close: () => app.evaluate(({ app }) => app.exit(0)) }
}
