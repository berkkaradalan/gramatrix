import { expect, test, type Page } from '@playwright/test'
import type { ChatMessage } from '../../src/shared/types'
import { CHAT, SHELL_SEED } from './fake-backend/fixtures'
import { emitRunEvent, launchWithFakeBackend } from './fake-backend/launch-fake'

const ids = { runId: 'r1', chatId: CHAT.id }

const CODE_MESSAGE: ChatMessage = {
  id: 'code',
  chatId: CHAT.id,
  role: 'assistant',
  parts: [{ type: 'text', text: '```python\ndef hello():\n    return 1\n```' }],
  createdAt: 3
}

function openChat(page: Page): Promise<void> {
  return page.getByRole('button', { name: 'Refactor the scheduler' }).click()
}

test('colors code and keeps the label and copy button', async () => {
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, messages: [CODE_MESSAGE] })
  await openChat(page)
  const block = page.locator('.code-block')
  await expect(block.getByText('python')).toBeVisible()
  await expect(block.getByRole('button', { name: 'Copy code' })).toBeVisible()
  await expect(block.locator('.code-line span[style*="color"]').first()).toBeVisible()
  await close()
})

test('an unknown language stays plain and readable', async () => {
  const message = {
    ...CODE_MESSAGE,
    parts: [{ type: 'text' as const, text: '```cobol\nDISPLAY "HI".\n```' }]
  }
  const { page, close } = await launchWithFakeBackend({ ...SHELL_SEED, messages: [message] })
  await openChat(page)
  await expect(page.getByText('DISPLAY "HI".')).toBeVisible()
  await expect(page.locator('.code-line span[style*="color"]')).toHaveCount(0)
  await close()
})

test('streaming never removes colors from finished lines', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await openChat(page)
  await emitRunEvent(page, { type: 'started', ...ids, messageId: 'live' })
  await emitRunEvent(page, { type: 'text-delta', ...ids, delta: '```ts\nconst a = 1\n' })
  const firstLine = page.locator('.message-assistant').last().locator('.code-line').first()
  await expect(firstLine.locator('span[style*="color"]').first()).toBeVisible()

  for (let index = 0; index < 20; index++) {
    await emitRunEvent(page, { type: 'text-delta', ...ids, delta: `const b${index} = 2\n` })
    await expect(firstLine.locator('span[style*="color"]').first()).toBeVisible()
  }
  await close()
})

test('code settings apply to code blocks', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    messages: [CODE_MESSAGE],
    settings: {
      ...SHELL_SEED.settings,
      code: { theme: 'nord', lineNumbers: true, wrapLines: true, ligatures: false, fontSize: 15 }
    }
  })
  await openChat(page)
  const view = page.locator('.code-block .code-view')
  await expect(view).toHaveClass(/code-numbered/)
  await expect(view).toHaveClass(/code-wrap/)
  await expect(view).toHaveCSS('font-size', '15px')
  await expect(view).toHaveCSS('font-variant-ligatures', 'no-contextual')
  await close()
})
