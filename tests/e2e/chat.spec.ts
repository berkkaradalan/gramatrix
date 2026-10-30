import { expect, test, type Page } from '@playwright/test'
import type { ApprovalRequest } from '../../src/shared/types'
import { SHELL_SEED } from './fake-backend/fixtures'
import {
  emitRunEvent as emitRun,
  launchWithFakeBackend,
  recordedParams
} from './fake-backend/launch-fake'

const ids = { runId: 'r1', chatId: 'c1' }

async function openChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Refactor the scheduler' }).click()
}

test('streams a reply and hides the message the host is saving', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await expect(page.getByText('The first call fails fast')).toBeVisible()

  await emitRun(page, { type: 'started', ...ids, messageId: 'm2' })
  await expect(page.getByText('The first call fails fast')).toBeHidden()
  await emitRun(page, { type: 'text-delta', ...ids, delta: 'Streaming ' })
  await emitRun(page, { type: 'text-delta', ...ids, delta: 'works' })
  await expect(page.getByText('Streaming works')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()

  await emitRun(page, { type: 'finished', ...ids })
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
  await expect(page.getByText('Streaming works')).toBeHidden()
  await expect(page.getByText('The first call fails fast')).toBeVisible()
  await close()
})

test('previews a command and answers the approval', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  const request: ApprovalRequest = {
    id: 'a1',
    chatId: 'c1',
    toolCallId: 't9',
    toolName: 'run_command',
    summary: 'Run npm test',
    input: { command: 'npm test' }
  }
  await emitRun(page, { type: 'approval-requested', ...ids, request })
  await expect(page.getByRole('heading', { name: 'Run this command?' })).toBeVisible()
  await expect(page.getByText('$ npm test')).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect
    .poll(() => recordedParams(page, 'agent.resolveApproval'))
    .toEqual({ requestId: 'a1', approved: true })

  await emitRun(page, { type: 'approval-resolved', ...ids, requestId: 'a1' })
  await expect(page.getByRole('heading', { name: 'Run this command?' })).toBeHidden()
  await close()
})

test('previews an edit as a diff', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await emitRun(page, {
    type: 'approval-requested',
    ...ids,
    request: {
      id: 'a2',
      chatId: 'c1',
      toolCallId: 't8',
      toolName: 'edit_file',
      summary: 'Edit a.ts',
      input: { path: 'a.ts', oldText: 'const a = 1', newText: 'const a = 2' }
    }
  })
  const card = page.getByRole('region', { name: /Approval needed/ })
  await expect(card.getByRole('heading', { name: 'Edit a.ts?' })).toBeVisible()
  await expect(card.locator('.diff-removed')).toContainText('const a = 1')
  await expect(card.locator('.diff-added')).toContainText('const a = 2')
  await close()
})

test('retries with agent.retry after a failed run', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await emitRun(page, { type: 'failed', ...ids, error: 'Rate limited' })
  await expect(page.getByText('Rate limited')).toBeVisible()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect.poll(() => recordedParams(page, 'agent.retry')).toEqual({ chatId: 'c1' })
  await close()
})

test('nests subagent work under one row', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await emitRun(page, { type: 'started', ...ids, messageId: 'live' })
  await emitRun(page, {
    type: 'subagent',
    ...ids,
    subagentId: 's1',
    name: 'test-writer',
    status: 'started'
  })
  await emitRun(page, {
    type: 'tool-call',
    ...ids,
    part: {
      type: 'tool-call',
      toolCallId: 't2',
      toolName: 'write_file',
      input: { path: 'a.test.ts' },
      state: 'running',
      subagentId: 's1'
    }
  })
  const subagent = page.locator('.subagent')
  await expect(subagent.getByText('test-writer')).toBeVisible()
  await expect(subagent.locator('.tool-hint', { hasText: 'a.test.ts' })).toBeVisible()
  await close()
})

test('shows a copy button on code blocks', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible()
  await close()
})

test('a chat without a project has no permission control', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: /^Compare queue libraries/ }).click()
  await expect(page.locator('.chat-header')).toContainText('No project')
  await expect(page.getByRole('combobox', { name: 'Permissions' })).toBeHidden()
  await close()
})
