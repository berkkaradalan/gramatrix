import { afterEach, describe, expect, it, vi } from 'vitest'
import { secretName } from '@shared/rpc'
import type { AgentRunner } from '../agent-runner'
import { createTestHost } from '../testing'
import { ChannelService } from './channel-service'
import { CHANNEL_COMMANDS } from './commands'

// The real Chat SDK and Telegram adapter, with only the Telegram Bot API replaced. Telegram marks
// "/start CODE" and "/pair CODE" as bot commands, which take another route through Chat SDK than
// plain text, so these tests make sure that route reaches pairing.

interface TelegramUpdate {
  update_id: number
  message?: Record<string, unknown>
  callback_query?: Record<string, unknown>
}

interface InlineButton {
  text: string
  callback_data: string
}

const PRIVATE_CHAT = { id: 42, type: 'private', first_name: 'Berk' }
const BERK = { id: 42, is_bot: false, first_name: 'Berk', username: 'berk' }

class FakeTelegram {
  readonly sent: string[] = []
  /** The buttons of each sent message, empty for plain text. */
  readonly buttons: InlineButton[][] = []
  /** Request bodies by Bot API method. */
  readonly requests = new Map<string, unknown[]>()
  private readonly pending: TelegramUpdate[] = []
  private nextUpdateId = 1

  /** A message from Berk in a private chat, as Telegram reports a command or plain text. */
  send(text: string): void {
    const command = /^\/\w+/.exec(text)?.[0]
    this.pending.push({
      update_id: this.nextUpdateId++,
      message: {
        message_id: this.nextUpdateId,
        date: 1,
        chat: PRIVATE_CHAT,
        from: BERK,
        text,
        ...(command
          ? { entities: [{ type: 'bot_command', offset: 0, length: command.length }] }
          : {})
      }
    })
  }

  /** Berk taps a button under the last message that had buttons. */
  press(label: string): void {
    const button = this.buttons.flat().findLast((candidate) => candidate.text === label)
    if (!button) throw new Error(`No button called ${label}`)
    this.pending.push({
      update_id: this.nextUpdateId++,
      callback_query: {
        id: `cb${this.nextUpdateId}`,
        from: BERK,
        data: button.callback_data,
        message: { message_id: 100, date: 2, chat: PRIVATE_CHAT, text: 'menu' }
      }
    })
  }

  fetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
    const method = String(url).split('/').pop() ?? ''
    const body = init?.body
      ? (JSON.parse(String(init.body)) as {
          text?: string
          reply_markup?: { inline_keyboard?: InlineButton[][] }
        })
      : {}
    this.requests.set(method, [...(this.requests.get(method) ?? []), body])
    const ok = (result: unknown): Response =>
      new Response(JSON.stringify({ ok: true, result }), {
        headers: { 'content-type': 'application/json' }
      })
    switch (method) {
      case 'getMe':
        return ok({
          id: 999,
          is_bot: true,
          first_name: 'Gramatrix',
          username: 'gramatrix_test_bot'
        })
      case 'getUpdates': {
        if (this.pending.length === 0) await new Promise((resolve) => setTimeout(resolve, 20))
        return ok(this.pending.splice(0))
      }
      case 'sendMessage':
        this.sent.push(body.text ?? '')
        this.buttons.push(body.reply_markup?.inline_keyboard?.flat() ?? [])
        return ok({ message_id: 100, date: 2, chat: { id: 42, type: 'private' }, text: body.text })
      default:
        return ok(true)
    }
  }
}

const neverRuns: AgentRunner = {
  runHeadless: async () => {
    throw new Error('Pairing messages must never reach the agent.')
  }
}

async function connectTelegram(telegram: FakeTelegram) {
  vi.stubGlobal('fetch', telegram.fetch)
  const test = createTestHost()
  test.secrets.set(secretName.channel('telegram', 'botToken'), '123:abc')
  test.secrets.set(secretName.provider('openai'), 'key')
  const channels = new ChannelService(test.context, {
    chats: test.host.services.chats,
    settings: test.host.services.settings,
    projects: test.host.services.projects,
    bots: test.host.services.bots,
    providers: test.host.services.providers,
    runner: neverRuns
  })
  channels.configure({
    kind: 'telegram',
    enabled: true,
    projectId: null,
    model: { provider: 'openai', model: 'test' },
    permissionMode: 'read-only',
    botId: null
  })
  await channels.settled()
  return channels
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('Telegram pairing through the real adapter', () => {
  let channels: ChannelService | undefined

  afterEach(async () => {
    await channels?.stop()
    vi.unstubAllGlobals()
  })

  it('learns the bot name and pairs from the message its pairing link sends', async () => {
    const telegram = new FakeTelegram()
    channels = await connectTelegram(telegram)
    const pairing = channels.createPairingCode('telegram')
    expect(pairing.link).toBe(`https://t.me/gramatrix_test_bot?start=${pairing.code}`)

    telegram.send(`/start ${pairing.code}`)
    await waitFor(() => telegram.sent.length > 0)

    expect(telegram.sent[0]).toMatch(/^Paired\./)
    expect(channels.pairings('telegram')).toMatchObject([{ externalUserId: '42' }])
  })

  it('pairs from a typed /pair command too', async () => {
    const telegram = new FakeTelegram()
    channels = await connectTelegram(telegram)

    telegram.send(`/pair ${channels.createPairingCode('telegram').code}`)
    await waitFor(() => telegram.sent.length > 0)

    expect(telegram.sent[0]).toMatch(/^Paired\./)
  })

  it('answers someone who opens the bot without a code', async () => {
    const telegram = new FakeTelegram()
    channels = await connectTelegram(telegram)

    telegram.send('/start')
    await waitFor(() => telegram.sent.length > 0)

    expect(telegram.sent[0]).toMatch(/^Hi!/)
    expect(channels.pairings('telegram')).toEqual([])
  })

  it('fills the Telegram command menu when it connects', async () => {
    const telegram = new FakeTelegram()
    channels = await connectTelegram(telegram)
    expect(telegram.requests.get('setMyCommands')).toEqual([
      {
        commands: CHANNEL_COMMANDS.map(({ name, description }) => ({
          command: name,
          description
        }))
      }
    ])
  })

  it('shows choices as buttons and takes a tap like the typed command', async () => {
    const telegram = new FakeTelegram()
    channels = await connectTelegram(telegram)
    telegram.send(`/pair ${channels.createPairingCode('telegram').code}`)
    await waitFor(() => telegram.sent.length === 1)

    telegram.send('/mode')
    await waitFor(() => telegram.sent.length === 2)
    expect(telegram.buttons[1]?.map((button) => button.text)).toEqual(['Read only (now)'])

    telegram.send('/project')
    await waitFor(() => telegram.sent.length === 3)
    telegram.press('No project (now)')
    await waitFor(() => telegram.sent.length === 4)
    expect(telegram.sent[3]).toBe('Project for this chat: No project.')
    expect(telegram.requests.get('answerCallbackQuery')).toHaveLength(1)
  })
})
