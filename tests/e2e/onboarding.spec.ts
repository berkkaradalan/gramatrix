import { expect, test } from '@playwright/test'
import { MODELS, NO_PROVIDERS, PROVIDERS } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'
import { launchApp } from './launch-app'

const HOME = { name: 'What should we work on?' }

test('a new user can skip setup on the real app and reach Home', async () => {
  const { page, close } = await launchApp()
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByRole('heading', { name: 'Connect a provider' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', HOME)).toBeVisible()
  await close()
})

test('connects a provider, picks a model and lands on Home', async () => {
  const { page, close } = await launchWithFakeBackend({ providers: NO_PROVIDERS, models: MODELS })
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('button', { name: /Claude/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('API key').fill('sk-test')
  await dialog.getByRole('button', { name: 'Save and verify' }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Pick a default model' })).toBeVisible()
  await page.getByRole('button', { name: 'Start using Gramatrix' }).click()
  await expect(page.getByRole('heading', HOME)).toBeVisible()
  await expect
    .poll(() => recordedParams(page, 'settings.update'))
    .toMatchObject({ onboardingCompleted: true, defaultModel: { provider: 'anthropic' } })
  await close()
})

test('warns when keys would not be protected', async () => {
  const { page, close } = await launchWithFakeBackend({
    providers: NO_PROVIDERS,
    overrides: {
      'app.info': {
        version: '0.0.0',
        platform: 'linux',
        secretBackend: 'weak',
        transparency: 'supported'
      }
    }
  })
  await page.getByRole('button', { name: 'Get started' }).click()
  await expect(page.getByText('saved keys are not really protected')).toBeVisible()
  await close()
})

test('resumes at the first unfinished step', async () => {
  const { page, close } = await launchWithFakeBackend({ providers: PROVIDERS, models: MODELS })
  await expect(page.getByRole('heading', { name: 'Pick a default model' })).toBeVisible()
  await close()
})

test('onboarding is not shown again after it is finished', async () => {
  const first = await launchApp()
  await first.page.evaluate(
    'window.gramatrix.invoke("settings.update", { onboardingCompleted: true })'
  )
  await first.page.reload()
  await expect(first.page.getByRole('heading', HOME)).toBeVisible()
  await first.close()
})
