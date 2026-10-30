import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/** Actions fail quickly with a useful call log instead of using up the test timeout. */
export const ACTION_TIMEOUT_MS = 8_000

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  close(): Promise<void>
}

/** Starts the built app with an empty data directory. */
export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  // Editors built on Electron export this variable, and it makes Electron behave like plain Node.
  const env = { ...process.env }
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({
    args: ['--no-sandbox', '--password-store=basic', '.'],
    env: {
      ...(env as Record<string, string>),
      GRAMATRIX_USER_DATA: mkdtempSync(join(tmpdir(), 'gramatrix-e2e-')),
      ...extraEnv
    }
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(ACTION_TIMEOUT_MS)
  return { app, page, close: () => app.evaluate(({ app }) => app.exit(0)) }
}
