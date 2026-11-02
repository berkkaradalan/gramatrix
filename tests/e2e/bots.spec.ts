import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { BOT, BOT_CHAT, BOT_SEED, SHELL_SEED } from './fake-backend/fixtures'
import { launchWithFakeBackend, recordedParams } from './fake-backend/launch-fake'

async function openBot(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Bots' }).click()
  await page.getByRole('main').getByRole('button', { name: /^Ada/ }).click()
  await expect(page.getByRole('heading', { name: 'Ada', level: 1 })).toBeVisible()
}

/** The sidebar row of the chat with Ada. Its name starts with the bot. */
const BOT_ROW = new RegExp(`^Ada ${BOT_CHAT.title}`)

test('the Bots page explains what a bot is when there are none', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Bots' }).click()
  await expect(page.getByRole('heading', { name: 'No bots yet' })).toBeVisible()
  await expect(page.getByText(/a memory that lasts between chats/)).toBeVisible()
  await expect(page.getByText(/remembers who you are and how you like to work/)).toBeVisible()
  await page.getByRole('button', { name: 'New bot' }).click()
  await expect(page.getByRole('dialog', { name: 'New bot' })).toBeVisible()
  await close()
})

test('creates a bot with the default model and opens its page', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Bots' }).click()
  await page.getByRole('button', { name: 'New bot' }).click()
  const dialog = page.getByRole('dialog', { name: 'New bot' })
  await expect(dialog.getByLabel('Name')).toBeFocused()
  await dialog.getByLabel('Name').fill('Ada')
  await dialog.getByLabel('Soul').fill('You are calm and direct.')
  await expect(dialog.getByText('24 / 4,000')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Model: Claude Sonnet' })).toBeVisible()
  await dialog.getByRole('switch', { name: 'Learn from chats' }).click()
  await dialog.getByRole('button', { name: 'Create bot' }).click()
  await expect
    .poll(() => recordedParams(page, 'bots.create'))
    .toEqual({
      name: 'Ada',
      soul: 'You are calm and direct.',
      model: { provider: 'anthropic', model: 'claude-sonnet' },
      learns: true
    })
  await expect(page.getByRole('heading', { name: 'Ada', level: 1 })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Learn from chats' })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'No chats yet' })).toBeVisible()
  await close()
})

test('a soul over the limit cannot be saved', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Bots' }).click()
  await page.getByRole('button', { name: 'New bot' }).click()
  const dialog = page.getByRole('dialog', { name: 'New bot' })
  await dialog.getByLabel('Name').fill('Ada')
  await dialog.getByLabel('Soul').fill('x'.repeat(4001))
  await expect(dialog.getByText('4,001 / 4,000')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create bot' })).toBeDisabled()
  await close()
})

test('errors from the host show inside the form', async () => {
  const { page, close } = await launchWithFakeBackend({
    ...SHELL_SEED,
    botError: 'A bot name can be at most 40 characters.'
  })
  await page.getByRole('button', { name: 'Bots' }).click()
  await page.getByRole('button', { name: 'New bot' }).click()
  const dialog = page.getByRole('dialog', { name: 'New bot' })
  await dialog.getByLabel('Name').fill('Ada')
  await dialog.getByRole('button', { name: 'Create bot' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('A bot name can be at most 40 characters.')
  await expect(dialog.getByLabel('Name')).toHaveValue('Ada')
  await close()
})

test('the bot page lists its memory with usage', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await openBot(page)
  const user = page.getByRole('region', { name: 'About you' })
  await expect(user.getByText('Name is Sam. Prefers short answers')).toBeVisible()
  await expect(user.getByText('55 of 1,375 characters')).toBeVisible()
  await expect(user.getByRole('meter')).toHaveAttribute('aria-valuenow', '55')
  const notes = page.getByRole('region', { name: 'Notes' })
  await expect(notes.getByText('The gramatrix project uses npm and Vitest.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Chats with Ada' })).toContainText(BOT_CHAT.title)
  await close()
})

test('adds, edits and deletes memory entries', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await openBot(page)
  const notes = page.getByRole('region', { name: 'Notes' })

  await notes.getByRole('button', { name: 'Add to Notes' }).click()
  await notes.getByLabel('New entry in Notes').fill('Release on Fridays.')
  await notes.getByLabel('New entry in Notes').press('Enter')
  await expect(notes.getByText('Release on Fridays.')).toBeVisible()
  await expect
    .poll(() => recordedParams(page, 'bots.addMemory'))
    .toEqual({ botId: BOT.id, kind: 'notes', content: 'Release on Fridays.' })

  const entry = notes.getByRole('listitem').filter({ hasText: 'Release on Fridays.' })
  await entry.hover()
  await entry.getByRole('button', { name: 'Edit entry' }).click()
  await notes.getByLabel('Edit entry in Notes').fill('Release on Thursdays.')
  await notes.getByRole('button', { name: 'Save' }).click()
  await expect(notes.getByText('Release on Thursdays.')).toBeVisible()

  const edited = notes.getByRole('listitem').filter({ hasText: 'Release on Thursdays.' })
  await edited.hover()
  await edited.getByRole('button', { name: 'Delete entry' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete entry' }).click()
  await expect(notes.getByText('Release on Thursdays.')).toHaveCount(0)
  await close()
})

test('an entry that does not fit says so before saving', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await openBot(page)
  const user = page.getByRole('region', { name: 'About you' })
  await user.getByRole('button', { name: 'Add to About you' }).click()
  await user.getByLabel('New entry in About you').fill('x'.repeat(1330))
  await expect(user.getByText('10 characters too long.', { exact: false })).toBeVisible()
  await expect(user.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await close()
})

test('memory the bot writes during a chat shows up right away', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await openBot(page)
  // The host writes memory and announces it, just as when the bot uses its memory tool.
  await page.evaluate((botId) => {
    const api = (
      globalThis as unknown as {
        gramatrix: { invoke(method: string, params: unknown): Promise<unknown> }
      }
    ).gramatrix
    return api.invoke('bots.addMemory', { botId, kind: 'user', content: 'Lives in Izmir.' })
  }, BOT.id)
  await expect(
    page.getByRole('region', { name: 'About you' }).getByText('Lives in Izmir.')
  ).toBeVisible()
  await close()
})

test('deleting a bot says its chats stay and its memory goes', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await openBot(page)
  await page.getByRole('button', { name: 'More actions for Ada' }).click()
  await page.getByRole('menuitem', { name: 'Delete bot' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete Ada?' })
  await expect(confirm).toContainText('Its chats stay')
  await expect(confirm).toContainText('Its memory is deleted')
  await confirm.getByRole('button', { name: 'Delete bot' }).click()
  await expect(page.getByRole('heading', { name: 'No bots yet' })).toBeVisible()
  // The chat is still there, now as a plain chat.
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await expect(
    sidebar.getByRole('button', { name: new RegExp(`^${BOT_CHAT.title}`) })
  ).toBeVisible()
  await close()
})

test('New chat on the bot page starts a chat with the bot and its model', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await openBot(page)
  await page.getByRole('main').getByRole('button', { name: 'New chat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Chat with Ada' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bot: Ada' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Model: Claude Opus' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello')
  await page.getByRole('textbox', { name: 'Message' }).press('Enter')
  await expect
    .poll(() => recordedParams(page, 'chats.create'))
    .toMatchObject({ botId: BOT.id, model: BOT.model, projectId: null })
  await close()
})

test('picks a bot from the Home composer', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await page.getByRole('button', { name: 'Bot: No bot' }).click()
  await page.getByRole('menuitem', { name: /^Ada/ }).click()
  await expect(page.getByRole('button', { name: 'Model: Claude Opus' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message' }).fill('Hello')
  await page.getByRole('textbox', { name: 'Message' }).press('Enter')
  await expect
    .poll(() => recordedParams(page, 'chats.create'))
    .toMatchObject({ botId: BOT.id, model: BOT.model })
  await close()
})

test('without bots the composer chip offers to create one', async () => {
  const { page, close } = await launchWithFakeBackend(SHELL_SEED)
  await page.getByRole('button', { name: 'Bot: No bot' }).click()
  await page.getByRole('menuitem', { name: 'Create a bot' }).click()
  await expect(page.getByRole('dialog', { name: 'New bot' })).toBeVisible()
  await close()
})

test('a chat with a bot shows who you talk to and what it remembered', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await sidebar.getByRole('button', { name: BOT_ROW }).click()
  const header = page.locator('.chat-header')
  await expect(header.getByRole('button', { name: 'Bot: Ada. Open its page' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
    'placeholder',
    'Reply to Ada'
  )

  const log = page.getByRole('log')
  await expect(log.getByText('Saved to memory')).toBeVisible()
  await expect(log.getByText('Wants release notes as a short list.')).toBeVisible()
  await expect(log.getByText('Could not update memory')).toBeVisible()
  await expect(log.getByText('No entry in the "Notes" memory contains that text.')).toBeVisible()
  await expect(log.getByText('"action"')).toHaveCount(0)

  await header.getByRole('button', { name: 'Bot: Ada. Open its page' }).click()
  await expect(page.getByRole('heading', { name: 'Ada', level: 1 })).toBeVisible()
  await close()
})

test('a chat without a project gets one from its header and keeps going there', async () => {
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
  await sidebar.getByRole('button', { name: BOT_ROW }).click()
  const header = page.locator('.chat-header')

  await header.getByRole('button', { name: 'Project: No project' }).click()
  await page.getByRole('menuitem', { name: /^gramatrix/ }).click()

  await expect
    .poll(() => recordedParams(page, 'chats.update'))
    .toEqual({ id: BOT_CHAT.id, projectId: 'p1' })
  await expect(header.getByRole('button', { name: 'Project: gramatrix' })).toBeVisible()
  await expect(page.getByRole('log').getByText('Saved to memory')).toBeVisible()
  await close()
})

// Saves screenshots for design review. Skipped in normal runs, like screenshots.spec.ts.
const output = process.env['SCREENSHOT_DIR']

/** Menus and dialogs fade in, so a screenshot right after a click catches them half drawn. */
const animationsDone = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => {
    // The e2e type settings have no DOM types, so the page document is described here.
    const { document } = globalThis as unknown as {
      document: { getAnimations(): { playState: string }[] }
    }
    return document.getAnimations().every((animation) => animation.playState !== 'running')
  })

test('bots screenshots', async () => {
  test.skip(!output, 'Set SCREENSHOT_DIR to save screenshots.')
  const folder = join(output ?? '', 'bots')
  mkdirSync(folder, { recursive: true })
  const { page, close } = await launchWithFakeBackend(BOT_SEED)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Bots' }).click()
  await page.screenshot({ path: join(folder, 'bots-list.png') })
  await page.getByRole('main').getByRole('button', { name: /^Ada/ }).click()
  await page.screenshot({ path: join(folder, 'bot-page.png') })
  await page.locator('.page').evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await page.screenshot({ path: join(folder, 'bot-page-bottom.png') })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await animationsDone(page)
  await page.screenshot({ path: join(folder, 'bot-edit.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: BOT_ROW }).click()
  await page.screenshot({ path: join(folder, 'bot-chat.png') })
  await page.locator('.chat-header').getByRole('button', { name: 'Project: No project' }).click()
  await animationsDone(page)
  await page.screenshot({ path: join(folder, 'bot-chat-project.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await page.getByRole('button', { name: 'Bot: No bot' }).click()
  await animationsDone(page)
  await page.screenshot({ path: join(folder, 'home-bot-chip.png') })
  await close()

  const empty = await launchWithFakeBackend(SHELL_SEED)
  await empty.page.getByRole('button', { name: 'Bots' }).click()
  await empty.page.screenshot({ path: join(folder, 'bots-empty.png') })
  await empty.close()
})
