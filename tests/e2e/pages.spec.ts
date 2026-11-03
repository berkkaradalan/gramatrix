import { expect, test } from '@playwright/test'
import type { Job } from '../../src/shared/types'
import { CHAT, PROJECT, SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

const JOB: Job = {
  id: 'j1',
  projectId: PROJECT.id,
  name: 'Nightly review',
  cron: '0 9 * * 1-5',
  prompt: 'Review.',
  model: CHAT.model,
  permissionMode: 'read-only',
  enabled: true,
  catchUp: false,
  botId: null,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: 1
}

test('lists jobs across projects in plain English', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    overrides: { 'jobs.list': [JOB] }
  })
  await page.getByRole('button', { name: 'Scheduled' }).click()
  await expect(page.getByText('Weekdays at 09:00')).toBeVisible()
  await expect(page.locator('.list-row .project-tag')).toHaveText('gramatrix')
  await close()
})

test('creates a job with the friendly schedule builder', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Scheduled' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New job' })
  await dialog.getByLabel('Name').fill('Nightly review')
  await dialog.getByLabel('What should the agent do?').fill('Review the code.')
  await dialog.getByRole('combobox', { name: 'Repeat' }).click()
  await page.getByRole('option', { name: 'Every day' }).click()
  await expect(dialog.getByText(/Next run/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Create job' }).click()
  await expect
    .poll(() => recordedParams(page, 'jobs.create'))
    .toMatchObject({ cron: '0 9 * * *', projectId: PROJECT.id, name: 'Nightly review' })
  await close()
})

test('opening the model picker does not clear the job form', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Scheduled' }).click()
  await page.getByRole('button', { name: 'New job' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New job' })
  await dialog.getByLabel('Name').fill('Keep this')
  await dialog.getByRole('button', { name: /^Model:/ }).click()
  await page.getByPlaceholder('Search models').press('Escape')
  await expect(dialog.getByLabel('Name')).toHaveValue('Keep this')
  await close()
})

test('without a project the Scheduled page offers to add one', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, projects: [], chats: [] })
  await page.getByRole('button', { name: 'Scheduled' }).click()
  await expect(page.getByRole('button', { name: 'Add a project' })).toBeVisible()
  await close()
})

test('settings is split into sections', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('Protected by your keychain')).toBeVisible()
  for (const section of ['Providers', 'Models', 'Appearance', 'About']) {
    await page.getByRole('tab', { name: section }).click()
    await expect(page.getByRole('heading', { name: section, level: 1 })).toBeVisible()
  }
  await close()
})

test('theme changes apply right away', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.getByRole('button', { name: 'GitHub Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'github-light')
  await close()
})

test('nothing in the app uses a native select', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('select:not([aria-hidden="true"])')).toHaveCount(0)
  await close()
})
