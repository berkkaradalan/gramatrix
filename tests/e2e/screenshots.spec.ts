import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, type Page } from '@playwright/test'
import type { Channel, Job, RunEvent } from '../../src/shared/types'
import {
  CHAT,
  MODELS,
  NO_PROVIDERS,
  PROJECT,
  PROVIDERS,
  SECOND_PROJECT,
  SHELL_SEED,
  USAGE_REPORT
} from './fake-backend/fixtures'
import { emitRunEvent, launchWithFakeBackend } from './fake-backend/launch-fake'

// Saves screenshots of the main views for design review. Skipped in normal test runs.
// Usage: SCREENSHOT_DIR=some/folder npx playwright test screenshots
const output = process.env['SCREENSHOT_DIR']

const SIZES = [
  { name: '1280', width: 1280, height: 800 },
  { name: '2558', width: 2558, height: 1373 }
]

const ids = { runId: 'r1', chatId: CHAT.id }

const JOBS: Job[] = [
  {
    id: 'j1',
    projectId: PROJECT.id,
    name: 'Nightly dependency review',
    cron: '0 9 * * 1-5',
    prompt: 'Check dependencies for updates.',
    model: CHAT.model,
    permissionMode: 'read-only',
    enabled: true,
    catchUp: false,
    lastRunAt: Date.now() - 86_400_000,
    nextRunAt: Date.now() + 43_200_000,
    createdAt: 1
  },
  {
    id: 'j2',
    projectId: SECOND_PROJECT.id,
    name: 'Weekly test coverage report',
    cron: '0 8 * * 1',
    prompt: 'Summarize coverage.',
    model: CHAT.model,
    permissionMode: 'ask',
    enabled: false,
    catchUp: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: 1
  }
]

const CHANNELS: Channel[] = [
  {
    kind: 'telegram',
    enabled: true,
    projectId: PROJECT.id,
    model: CHAT.model,
    permissionMode: 'read-only',
    state: 'connected',
    error: null
  },
  {
    kind: 'slack',
    enabled: false,
    projectId: null,
    model: null,
    permissionMode: 'read-only',
    state: 'disabled',
    error: null
  }
]

const seed = {
  ...SHELL_SEED,
  overrides: {
    'usage.report': USAGE_REPORT,
    'jobs.list': JOBS,
    'jobs.runs': [
      {
        id: 'r1',
        jobId: 'j1',
        chatId: 'c1',
        status: 'succeeded' as const,
        startedAt: Date.now() - 86_400_000,
        finishedAt: Date.now() - 86_390_000,
        error: null
      }
    ],
    'channels.list': CHANNELS,
    'channels.pairings': [
      {
        kind: 'telegram' as const,
        externalUserId: 'u1',
        displayName: 'Sam',
        pairedAt: Date.now() - 86_400_000
      }
    ],
    'secrets.has': true,
    'channels.createPairingCode': { code: 'K7Q2M9' }
  }
}

const THEME_SAMPLE = [
  'dracula',
  'nord',
  'gruvbox-dark',
  'catppuccin-latte',
  'solarized-light',
  'github-light'
] as const

const RUN_EVENTS: RunEvent[] = [
  { type: 'started', ...ids, messageId: 'live' },
  { type: 'subagent', ...ids, subagentId: 's1', name: 'test-writer', status: 'started' },
  {
    type: 'tool-call',
    ...ids,
    part: {
      type: 'tool-call',
      toolCallId: 't5',
      toolName: 'write_file',
      input: { path: 'src/host/scheduler/job-service.test.ts', content: 'test' },
      state: 'running',
      subagentId: 's1'
    }
  },
  { type: 'text-delta', ...ids, delta: 'I will update the config next.' },
  {
    type: 'approval-requested',
    ...ids,
    request: {
      id: 'a1',
      chatId: CHAT.id,
      toolCallId: 't6',
      toolName: 'edit_file',
      summary: 'Edit config',
      input: {
        path: 'src/config.ts',
        oldText: 'export const retries = 2\nexport const delay = 100',
        newText: 'export const retries = 1\nexport const delay = 100'
      }
    }
  }
]

test('save screenshots', async () => {
  test.skip(!output, 'Set SCREENSHOT_DIR to save screenshots.')
  test.setTimeout(180_000)
  if (!output) return

  for (const size of SIZES) {
    const folder = join(output, size.name)
    mkdirSync(folder, { recursive: true })
    const settle = (page: Page): Promise<void> => page.waitForTimeout(200)
    const shot = async (page: Page, name: string): Promise<void> => {
      await settle(page)
      await page.screenshot({ path: join(folder, `${name}.png`) })
    }

    const app = await launchWithFakeBackend(seed, size)
    const { page } = app
    await shot(page, 'home')

    await page.getByRole('button', { name: 'Project: No project' }).click()
    await page.getByRole('menuitem', { name: /gramatrix/ }).click()
    await shot(page, 'home-project')
    await page.getByRole('button', { name: 'New chat', exact: true }).click()

    await page.getByRole('button', { name: /^Model:/ }).click()
    await shot(page, 'model-picker')
    await page.getByPlaceholder('Search models').fill('zephyr 49')
    await shot(page, 'model-picker-search')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    await shot(page, 'palette')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: CHAT.title }).click()
    await shot(page, 'chat')
    for (const event of RUN_EVENTS) await emitRunEvent(page, event)
    await shot(page, 'chat-running')

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await shot(page, 'chat-collapsed')
    await page.getByRole('button', { name: 'Expand sidebar' }).click()

    await page.getByRole('button', { name: 'Scheduled' }).click()
    await shot(page, 'scheduled')
    await page.getByRole('button', { name: 'New job' }).first().click()
    await shot(page, 'scheduled-form')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Channels' }).click()
    await shot(page, 'channels')
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('button', { name: 'Create pairing code' }).click()
    await shot(page, 'channels-setup')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Settings' }).click()
    await shot(page, 'settings-general')
    await page.getByRole('tab', { name: 'Providers' }).click()
    await shot(page, 'settings-providers')
    await page.locator('.provider-card', { hasText: 'OpenRouter' }).click()
    await shot(page, 'provider-dialog')
    await page.getByLabel('Replace API key').fill('bad-key')
    await page.getByRole('button', { name: 'Save and verify' }).click()
    await page.getByText('Details', { exact: true }).click()
    await shot(page, 'provider-failure')
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Models' }).click()
    await shot(page, 'settings-models')
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await shot(page, 'settings-appearance')
    await page.getByRole('tab', { name: 'Code', exact: true }).click()
    await shot(page, 'settings-code')
    await page.getByRole('tab', { name: 'Background' }).click()
    await shot(page, 'settings-background')
    await page.getByRole('tab', { name: 'Window' }).click()
    await shot(page, 'settings-window')

    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await shot(page, 'usage')
    await page.locator('.chart-hit').nth(12).hover()
    await shot(page, 'usage-tooltip')

    await page.getByRole('button', { name: 'gramatrix', exact: true }).hover()
    await shot(page, 'sidebar-hover')
    await page.getByRole('button', { name: 'Actions for gramatrix' }).click()
    await page.getByRole('menuitem', { name: 'Open project' }).click()
    await shot(page, 'project')

    await page.locator('.side-chat', { hasText: CHAT.title }).click()
    await page.getByRole('button', { name: 'Chat usage' }).click()
    await shot(page, 'chat-usage')
    await page.keyboard.press('Escape')
    await app.close()

    const fresh = await launchWithFakeBackend({ providers: NO_PROVIDERS }, size)
    await shot(fresh.page, 'onboarding-welcome')
    await fresh.page.getByRole('button', { name: 'Get started' }).click()
    await shot(fresh.page, 'onboarding-provider')
    await fresh.close()

    const returning = await launchWithFakeBackend({ providers: PROVIDERS, models: MODELS }, size)
    await shot(returning.page, 'onboarding-model')
    await returning.close()

    const empty = await launchWithFakeBackend(
      { settings: { onboardingCompleted: true }, providers: NO_PROVIDERS },
      size
    )
    await shot(empty.page, 'home-empty')
    await empty.page.locator('.chip-accent').click()
    await shot(empty.page, 'provider-grid-dialog')
    await empty.close()
  }
})

test('save theme screenshots', async () => {
  test.skip(!output, 'Set SCREENSHOT_DIR to save screenshots.')
  test.setTimeout(180_000)
  if (!output) return

  const folder = join(output, 'themes')
  mkdirSync(folder, { recursive: true })
  for (const theme of THEME_SAMPLE) {
    const { page, close } = await launchWithFakeBackend({
      ...seed,
      settings: { ...seed.settings, theme }
    })
    const shot = async (name: string): Promise<void> => {
      await page.waitForTimeout(350)
      await page.screenshot({ path: join(folder, `${theme}-${name}.png`) })
    }
    await page.getByRole('button', { name: CHAT.title }).click()
    for (const event of RUN_EVENTS) await emitRunEvent(page, event)
    await shot('chat')
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await shot('usage')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await shot('appearance')
    await close()
  }
})
