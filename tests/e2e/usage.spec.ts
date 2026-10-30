import { expect, test } from '@playwright/test'
import { CHAT, SHELL_SEED, USAGE_REPORT } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

const WITH_USAGE = { ...SHELL_SEED, overrides: { 'usage.report': USAGE_REPORT } }

test('summarizes usage with a chart and breakdowns', async () => {
  const { page, close } = await launchWithFakeBackend(WITH_USAGE)
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(page.locator('.stat-tile').first()).toContainText('$18.42')
  await expect(page.getByText('37 runs on a plan')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Tokens per day' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'By model' })).toContainText('Claude Sonnet')
  await expect(page.getByRole('region', { name: 'By source' })).toContainText('Subagents')
  await close()
})

test('the range changes the query and the chart has a tooltip', async () => {
  const { page, close } = await launchWithFakeBackend(WITH_USAGE)
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await page.getByRole('radio', { name: 'Cost' }).click()
  await expect(page.getByRole('img', { name: 'Cost per day' })).toBeVisible()
  await page.locator('.chart-hit').nth(10).hover()
  await expect(page.locator('.chart-tooltip')).toContainText('Tokens in')
  await close()
})

test('explains an empty report', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
  await expect(page.getByText('Older chats have no data')).toBeVisible()
  await close()
})

test('the chat header shows usage with details', async () => {
  const { page, close } = await launchWithFakeBackend(WITH_USAGE)
  await page.getByRole('button', { name: CHAT.title }).click()
  await page.getByRole('button', { name: 'Chat usage' }).click()
  await expect(page.getByRole('heading', { name: 'Usage in this chat' })).toBeVisible()
  await expect.poll(() => recordedParams(page, 'usage.report')).toEqual({ chatId: CHAT.id })
  await close()
})

test('a project page shows its own usage', async () => {
  const { page, close } = await launchWithFakeBackend(WITH_USAGE)
  await page.getByRole('button', { name: 'gramatrix', exact: true }).hover()
  await page.getByRole('button', { name: 'Actions for gramatrix' }).click()
  await page.getByRole('menuitem', { name: 'Open project' }).click()
  await expect(page.getByRole('heading', { name: 'gramatrix', level: 1 })).toBeVisible()
  await expect.poll(() => recordedParams(page, 'usage.report')).toMatchObject({ projectId: 'p1' })
  await close()
})
