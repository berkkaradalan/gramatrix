import { expect, test, type Page } from '@playwright/test'
import { SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

async function openPicker(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Model:/ }).click()
  await expect(page.getByPlaceholder('Search models')).toBeVisible()
}

test('shows favorites, recents and provider groups', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  await expect(page.getByText('Favorites')).toBeVisible()
  await expect(page.getByText('Recent', { exact: true })).toBeVisible()
  await expect(page.locator('[cmdk-group-heading]', { hasText: 'OpenRouter' })).toBeVisible()
  await close()
})

test('searches 500 models and keeps the page responsive', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  const started = Date.now()
  await page.getByPlaceholder('Search models').fill('zephyr model 497')
  await expect(page.locator('.model-row-name', { hasText: /^zephyr model 497$/ })).toBeVisible()
  expect(Date.now() - started).toBeLessThan(1500)
  await close()
})

test('shows every model on request', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  await page.getByRole('option', { name: 'Show 460 more models' }).click()
  await expect(page.locator('.model-row-name', { hasText: /^zephyr model 497$/ })).toBeAttached()
  await close()
})

test('selecting a model updates the trigger', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  await page.getByRole('option', { name: /Claude Haiku/ }).click()
  await expect(page.getByRole('button', { name: 'Model: Claude Haiku' })).toBeVisible()
  await close()
})

test('stars a model as a favorite', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  await page.getByRole('option', { name: /Claude Haiku/ }).hover()
  await page.getByRole('button', { name: 'Favorite Claude Haiku' }).click()
  await expect
    .poll(() => recordedParams(page, 'settings.update'))
    .toMatchObject({ favoriteModels: expect.arrayContaining([expect.anything()]) })
  await close()
})

test('accepts a custom model id', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  await page.getByPlaceholder('Search models').fill('my-private-model')
  await page.getByRole('option', { name: /Use my-private-model with OpenRouter/ }).click()
  await expect(page.getByRole('button', { name: 'Model: my-private-model' })).toBeVisible()
  await close()
})

test('marks a saved list and models without tools', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openPicker(page)
  await page.getByPlaceholder('Search models').fill('GLM')
  await expect(page.getByText('Saved list', { exact: false })).toBeVisible()
  await expect(page.getByLabel('No tool support').first()).toBeVisible()
  await close()
})

test('shows a loading state while models arrive', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, modelDelayMs: 1500 })
  await openPicker(page)
  await expect(page.locator('.model-list .skeleton').first()).toBeVisible()
  await close()
})
