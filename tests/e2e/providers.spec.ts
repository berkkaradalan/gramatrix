import { expect, test } from '@playwright/test'
import { NO_PROVIDERS, SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

test('connects a provider and shows a clear result', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, providers: NO_PROVIDERS })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Providers' }).click()
  await expect(page.getByRole('region', { name: 'API keys' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Coding plans' })).toBeVisible()

  await page.locator('.provider-card', { hasText: 'OpenRouter' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API key').fill('sk-test')
  await dialog.getByRole('button', { name: 'Show key' }).click()
  await expect(dialog.getByLabel('API key')).toHaveAttribute('type', 'text')
  await dialog.getByRole('button', { name: 'Save and verify' }).click()
  await expect(dialog.getByText('Key verified')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.provider-card', { hasText: 'OpenRouter' })).toContainText('Connected')
  await close()
})

test('a rejected key is not left connected', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, providers: NO_PROVIDERS })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Providers' }).click()
  await page.getByRole('button', { name: /Z.ai Coding Plan/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API key').fill('bad-key')
  await dialog.getByRole('button', { name: 'Save and verify' }).click()
  await expect(dialog.getByText('The key was rejected')).toBeVisible()
  await expect(dialog.getByText('The key was not saved')).toBeVisible()
  await dialog.getByText('Details').click()
  await expect(dialog.getByText('status: 401')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Copy details' })).toBeVisible()
  await close()
})

test('a rejected key never replaces the key that already works', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Providers' }).click()
  await page.locator('.provider-card', { hasText: 'OpenRouter' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API key').fill('bad-key')
  await dialog.getByRole('button', { name: 'Save and verify' }).click()
  await expect(dialog.getByText('Your current key is unchanged')).toBeVisible()
  expect(await recordedParams(page, 'secrets.set')).toBeUndefined()

  await dialog.getByRole('button', { name: 'Save anyway' }).click()
  await expect(dialog.getByText('is ready')).toBeVisible()
  await close()
})

test('connects with the key opencode already has', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, providers: NO_PROVIDERS })
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Providers' }).click()
  await page.getByRole('button', { name: /Z.ai Coding Plan/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Use my opencode key' }).click()
  await expect(dialog.getByText('is ready')).toBeVisible()
  await close()
})

test('disconnecting asks first', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Providers' }).click()
  await page.locator('.provider-card', { hasText: 'OpenRouter' }).click()
  await page.getByRole('button', { name: 'Disconnect' }).click()
  const confirm = page.getByRole('dialog', { name: 'Disconnect OpenRouter?' })
  await confirm.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.locator('.provider-card', { hasText: 'OpenRouter' })).toContainText(
    'Not connected'
  )
  await close()
})
