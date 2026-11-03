import { expect, test } from '@playwright/test'
import { NO_PROVIDERS, SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

test('opens on Home and sends without a project or a new chat step', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Project: No project' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Permissions' })).toBeHidden()

  await page.getByLabel('Message').fill('Plan the release')
  await page.getByLabel('Message').press('Enter')

  await expect.poll(() => recordedParams(page, 'chats.create')).toMatchObject({ projectId: null })
  await expect
    .poll(() => recordedParams(page, 'agent.send'))
    .toMatchObject({ text: 'Plan the release' })
  await expect(page.locator('.chat-header')).toBeVisible()
  await close()
})

test('shows permissions once a project is chosen', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Project: No project' }).click()
  await page.getByRole('menuitem', { name: /gramatrix/ }).click()
  await expect(page.getByRole('combobox', { name: 'Permissions' })).toBeVisible()
  await close()
})

test('without a provider the composer opens the provider dialog', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, providers: NO_PROVIDERS })
  await expect(page.getByLabel('Message')).toHaveAttribute('placeholder', /Connect a provider/)
  await page.getByLabel('Message').fill('Hello')
  await page.getByLabel('Message').press('Enter')
  await expect(page.getByRole('dialog', { name: 'Connect a provider' })).toBeVisible()
  await close()
})

test('a failed send leaves no empty chat behind', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, failSend: true })
  await page.getByLabel('Message').fill('Hello')
  await page.getByLabel('Message').press('Enter')
  await expect(
    page.getByRole('status').filter({ hasText: 'The agent could not start' })
  ).toBeVisible()
  await expect.poll(() => recordedParams(page, 'chats.remove')).toBeDefined()
  await expect(page.getByLabel('Message')).toHaveValue('Hello')
  await close()
})

test('Shift Enter makes a new line instead of sending', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByLabel('Message').fill('one')
  await page.getByLabel('Message').press('Shift+Enter')
  await expect.poll(() => recordedParams(page, 'chats.create')).toBeUndefined()
  await close()
})

test('the Home heading decodes into its text and ends on a cursor', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  const heading = page.getByRole('heading', { name: 'What should we work on?' })
  await expect(heading).toHaveText('What should we work on?')
  await expect(heading.locator('.decoding-glyph')).toHaveCount(0)
  await expect(heading.locator('.decoding-cursor')).toBeVisible()
  await close()
})

test('with reduced motion the Home heading shows its text at once', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    settings: { ...SHELL_SEED.settings, reduceMotion: true }
  })
  const heading = page.getByRole('heading', { name: 'What should we work on?' })
  await expect(heading).toBeVisible()
  // Read straight away, without retrying, so a single scrambled frame would fail the test.
  expect(await heading.textContent()).toBe('What should we work on?')
  await close()
})
