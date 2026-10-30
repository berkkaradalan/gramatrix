import { expect, test, type Page } from '@playwright/test'
import { SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

async function openAppearance(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
}

test('an old saved theme falls back to matrix without errors', async () => {
  const errors: string[] = []
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    settings: { ...SHELL_SEED.settings, theme: 'phosphor' as never }
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix')
  expect(errors).toEqual([])
  await close()
})

test('the gallery splits dark and light and can be searched', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openAppearance(page)
  await expect(page.locator('.theme-card')).toHaveCount(22)
  await expect(page.getByRole('heading', { name: 'Light' })).toBeVisible()
  await page.getByPlaceholder('Search themes').fill('catppuccin')
  await expect(page.locator('.theme-card')).toHaveCount(4)
  await close()
})

test('hovering previews a theme and leaving restores it', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openAppearance(page)
  await page.getByRole('button', { name: 'Dracula' }).hover()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula')
  await page.getByRole('heading', { name: 'Choose a theme' }).hover()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix')
  await expect.poll(() => recordedParams(page, 'settings.update')).toBeUndefined()
  await close()
})

test('the accent can be overridden and reset', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openAppearance(page)
  await page.getByRole('button', { name: 'Purple' }).click()
  const accent = (): Promise<string> =>
    page.locator('html').evaluate((root) => root.style.getPropertyValue('--accent'))
  await expect.poll(accent).toBe('#bd93f9')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect.poll(accent).toBe('#00e63a')
  await close()
})

test('the code tab has a live sample', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openAppearance(page)
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(page.locator('.code-sample .code-line span[style]').first()).toBeVisible()
  await page.getByRole('switch', { name: 'Line numbers' }).click()
  await expect(page.locator('.code-sample .code-view')).toHaveClass(/code-numbered/)
  await close()
})

test('the window tab states when support is uncertain', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: {
      'app.info': {
        version: '0.0.0',
        platform: 'linux',
        secretBackend: 'keychain',
        transparency: 'unknown'
      }
    }
  })
  await openAppearance(page)
  await page.getByRole('tab', { name: 'Window' }).click()
  await expect(page.getByText('this needs a compositor')).toBeVisible()
  await close()
})
