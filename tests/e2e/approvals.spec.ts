import { expect, test, type Page } from '@playwright/test'
import type { ApprovalRequest } from '../../src/shared/types'
import type { FakeGlobals } from './fake-backend/fake-api'
import { SHELL_SEED } from './fake-backend/fixtures'
import { emitRunEvent as emitRun, launchWithFakeBackend } from './fake-backend/launch-fake'

const ids = { runId: 'r1', chatId: 'c1' }

function command(id: string, text: string): ApprovalRequest {
  return {
    id,
    chatId: 'c1',
    toolCallId: `t-${id}`,
    toolName: 'run_command',
    summary: `Run ${text}`,
    input: { command: text }
  }
}

async function openChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Refactor the scheduler' }).click()
}

async function requestApprovals(page: Page, requests: ApprovalRequest[]): Promise<void> {
  for (const request of requests)
    await emitRun(page, { type: 'approval-requested', ...ids, request })
}

/** Every `agent.resolveApproval` call the renderer made, in order. */
function resolveCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(() =>
    (globalThis as unknown as FakeGlobals).fakeBackend.calls
      .filter((call) => call.method === 'agent.resolveApproval')
      .map((call) => call.params)
  )
}

test('a single approval shows no approve all bar', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await requestApprovals(page, [command('a1', 'npm test')])
  await expect(page.getByRole('heading', { name: 'Run this command?' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Answer all approvals' })).toBeHidden()
  await expect(page.getByRole('button', { name: /Approve all/ })).toBeHidden()
  await close()
})

test('approve all answers every waiting approval once', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await requestApprovals(page, [command('a1', 'npm test'), command('a2', 'npm run lint')])

  const bar = page.getByRole('group', { name: 'Answer all approvals' })
  await expect(bar).toContainText('2 actions are waiting for approval.')
  // Each card still shows exactly what it will run, with its own buttons.
  await expect(page.getByRole('region', { name: /Approval needed/ })).toHaveCount(2)
  await expect(page.getByText('$ npm test')).toBeVisible()
  await expect(page.getByText('$ npm run lint')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(2)

  await bar.getByRole('button', { name: 'Approve all (2)' }).dblclick()
  await expect
    .poll(() => resolveCalls(page))
    .toEqual([
      { requestId: 'a1', approved: true },
      { requestId: 'a2', approved: true }
    ])
  // Answered cards wait for the host with their buttons disabled, so nothing is sent twice.
  await expect(page.getByRole('button', { name: 'Approve', exact: true }).first()).toBeDisabled()

  // An approval that arrives after the click is left for the user to answer.
  await requestApprovals(page, [command('a3', 'rm -rf build')])
  await emitRun(page, { type: 'approval-resolved', ...ids, requestId: 'a1' })
  await emitRun(page, { type: 'approval-resolved', ...ids, requestId: 'a2' })
  await expect(page.getByRole('region', { name: /Approval needed/ })).toHaveCount(1)
  await expect(page.getByText('$ rm -rf build')).toBeVisible()
  await expect(bar).toBeHidden()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled()
  expect(await resolveCalls(page)).toHaveLength(2)
  await close()
})

test('deny all refuses every waiting approval', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await requestApprovals(page, [
    command('a1', 'npm test'),
    command('a2', 'npm run lint'),
    command('a3', 'npm run build')
  ])
  await page.getByRole('button', { name: 'Deny all' }).click()
  await expect
    .poll(() => resolveCalls(page))
    .toEqual([
      { requestId: 'a1', approved: false },
      { requestId: 'a2', approved: false },
      { requestId: 'a3', approved: false }
    ])
  await close()
})

test('the bar counts only approvals not answered from their card', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await requestApprovals(page, [
    command('a1', 'npm test'),
    command('a2', 'npm run lint'),
    command('a3', 'npm run build')
  ])
  const first = page.getByRole('region', { name: /Approval needed/ }).first()
  await first.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('button', { name: 'Approve all (2)' }).click()
  await expect
    .poll(() => resolveCalls(page))
    .toEqual([
      { requestId: 'a1', approved: true },
      { requestId: 'a2', approved: true },
      { requestId: 'a3', approved: true }
    ])
  await close()
})
