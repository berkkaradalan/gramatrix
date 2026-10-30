import { expect, test } from '@playwright/test'
import { SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

test('groups chats under projects and general chats', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  const projects = sidebar.getByRole('region', { name: 'Projects' })
  await expect(projects.getByRole('button', { name: 'Refactor the scheduler' })).toBeVisible()
  const chats = sidebar.getByRole('region', { name: 'Chats' })
  await expect(chats.getByRole('button', { name: /^Compare queue libraries/ })).toBeVisible()

  await projects.getByRole('button', { name: 'gramatrix', exact: true }).click()
  await expect(projects.getByRole('button', { name: 'Refactor the scheduler' })).toBeHidden()
  await close()
})

test('removing a project asks first', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'payments-service', exact: true }).hover()
  await page.getByRole('button', { name: 'Actions for payments-service' }).click()
  await page.getByRole('menuitem', { name: 'Remove project' }).click()

  const dialog = page.getByRole('dialog', { name: 'Remove payments-service?' })
  await expect(dialog.getByText('The folder on your computer is not touched')).toBeVisible()
  await dialog.getByRole('button', { name: 'Remove project' }).click()
  await expect(page.getByRole('button', { name: 'payments-service', exact: true })).toBeHidden()
  await close()
})

test('new chat from a project row preselects that project', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'payments-service', exact: true }).hover()
  await page.getByRole('button', { name: 'New chat in payments-service' }).click()
  await expect(page.getByRole('button', { name: 'Project: payments-service' })).toBeVisible()
  await close()
})

test('the sidebar collapses to icons', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('region', { name: 'Projects' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Scheduled' })).toBeVisible()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(page.getByRole('region', { name: 'Projects' })).toBeVisible()
  await close()
})

test('connected providers stay reachable near Settings', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  const strip = page.getByRole('region', { name: 'Connected providers' })
  await expect(strip.getByRole('button', { name: /connected$/ })).toHaveCount(3)
  await strip.getByRole('button', { name: 'OpenRouter, connected' }).click()
  await expect(page.getByRole('dialog')).toContainText('OpenRouter')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(strip.getByRole('button', { name: /connected$/ })).toHaveCount(3)
  await strip.getByRole('button', { name: 'Connect a provider' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect a provider' })).toBeVisible()
  await close()
})

test('the palette finds a chat and opens it', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search chats and projects').fill('queue')
  await page.getByRole('option', { name: /Compare queue libraries/ }).click()
  await expect(page.locator('.chat-header h1')).toHaveText('Compare queue libraries')
  await close()
})

test('Esc closes the palette and Ctrl N returns Home', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Refactor the scheduler' }).click()
  await page.keyboard.press('Control+k')
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search chats and projects')).toBeHidden()
  await page.keyboard.press('Control+n')
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await close()
})

test('deleting a chat asks first', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Refactor the scheduler' }).click()
  await page.getByRole('button', { name: 'Chat actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete chat' }).click()
  await page
    .getByRole('dialog', { name: 'Delete this chat?' })
    .getByRole('button', { name: 'Delete chat' })
    .click()
  await expect.poll(() => recordedParams(page, 'chats.remove')).toEqual({ id: 'c1' })
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible()
  await close()
})
