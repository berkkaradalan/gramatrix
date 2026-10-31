import { expect, test } from '@playwright/test'
import type { AppSettings } from '../../src/shared/types'
import { launchApp } from './launch-app'

test('the app opens a window and reaches the host process', async () => {
  const { page, close } = await launchApp()
  await expect(page).toHaveTitle('Gramatrix')
  const settings = await page.evaluate<AppSettings>('window.gramatrix.invoke("settings.get")')
  expect(settings.theme).toBe('matrix')
  await close()
})

test('quitting stops the host and exits cleanly', async () => {
  const { app, page } = await launchApp()
  await expect(page).toHaveTitle('Gramatrix')
  // Taken now, because Playwright can no longer return it once the app has closed.
  const child = app.process()
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  await app.evaluate(({ app }) => app.quit())
  await exited
  expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({
    exitCode: 0,
    signalCode: null
  })
})
