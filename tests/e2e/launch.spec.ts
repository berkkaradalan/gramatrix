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
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  await app.evaluate(({ app }) => app.quit())
  await exited
  const { exitCode, signalCode } = app.process()
  expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null })
})
