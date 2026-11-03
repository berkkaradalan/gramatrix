import { describe, expect, it } from 'vitest'
import { secretName, type ChannelConfigInput } from '@shared/rpc'
import type { ChannelKind } from '@shared/types'
import type { AgentRunner, HeadlessRunInput, HeadlessRunResult } from '../agent-runner'
import { createTestHost, type TestHost } from '../testing'
import type { ChannelAdapter, Choice, InboundMessage, MessageListener, ReadSecret } from './adapter'
import { ChannelService } from './channel-service'
import { CHANNEL_COMMANDS, type ChannelCommand } from './commands'
import { MAX_FAILED_ATTEMPTS_PER_USER, PAIRING_CODE_TTL_MS } from './pairing'

class FakeRunner implements AgentRunner {
  readonly calls: HeadlessRunInput[] = []
  reply = 'agent reply'
  failure: Error | null = null
  private readonly gates: (() => void)[] = []
  blocking = false
  /** Rejects like a real run when aborted while blocked. */
  failOnAbort = false

  async runHeadless(input: HeadlessRunInput): Promise<HeadlessRunResult> {
    this.calls.push(input)
    if (this.blocking) {
      await new Promise<void>((resolve, reject) => {
        this.gates.push(resolve)
        if (this.failOnAbort) {
          input.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }
      })
    }
    if (this.failure) throw this.failure
    return {
      text: this.reply,
      message: { id: 'm', chatId: input.chatId, role: 'assistant', parts: [], createdAt: 0 }
    }
  }

  release(): void {
    for (const open of this.gates.splice(0)) open()
  }
}

class FakeAdapter implements ChannelAdapter {
  maxMessageLength = 1000
  stops = 0
  account: string | null = 'gramatrix_test_bot'
  commands: readonly ChannelCommand[] = []
  /** The buttons of the last reply that had any. */
  lastChoices: Choice[] = []
  private listener: MessageListener | null = null

  accountName(): string | null {
    return this.account
  }

  async start(listener: MessageListener, commands: readonly ChannelCommand[]): Promise<void> {
    this.listener = listener
    this.commands = commands
  }

  async stop(): Promise<void> {
    this.stops += 1
    this.listener = null
  }

  /** Delivers a message and returns the list its replies land in. */
  deliver(overrides: Partial<InboundMessage> = {}): string[] {
    const replies: string[] = []
    this.listener?.({
      threadId: 'thread-1',
      userId: 'alice',
      displayName: 'Alice',
      text: 'hello',
      isDirect: true,
      isBot: false,
      reply: async (text, choices) => {
        replies.push(text)
        if (choices) this.lastChoices = choices
      },
      ...overrides
    })
    return replies
  }
}

interface Fixture extends TestHost {
  channels: ChannelService
  runner: FakeRunner
  adapter: FakeAdapter
  created: FakeAdapter[]
  projectId: string
  /** Connects Telegram and pairs `userId`. */
  connectPaired(userId?: string): Promise<void>
  config(overrides?: Partial<ChannelConfigInput>): ChannelConfigInput
}

function setup(): Fixture {
  const test = createTestHost()
  const runner = new FakeRunner()
  const adapter = new FakeAdapter()
  const created: FakeAdapter[] = []
  const channels = new ChannelService(test.context, {
    chats: test.host.services.chats,
    settings: test.host.services.settings,
    projects: test.host.services.projects,
    bots: test.host.services.bots,
    providers: test.host.services.providers,
    runner,
    createAdapter: async (_: ChannelKind, readSecret: ReadSecret) => {
      if ((await readSecret('botToken')) === null) throw new Error('Bot token is missing.')
      created.push(adapter)
      return adapter
    }
  })
  test.secrets.set(secretName.channel('telegram', 'botToken'), 'token')
  const projectId = test.host.services.projects.add('/work/demo').id
  const config = (overrides: Partial<ChannelConfigInput> = {}): ChannelConfigInput => ({
    kind: 'telegram',
    enabled: true,
    projectId,
    model: { provider: 'openai', model: 'test' },
    permissionMode: 'read-only',
    botId: null,
    ...overrides
  })
  return {
    ...test,
    channels,
    runner,
    adapter,
    created,
    projectId,
    config,
    connectPaired: async (userId = 'alice') => {
      channels.configure(config())
      await channels.settled()
      adapter.deliver({ userId, text: channels.createPairingCode('telegram').code })
      await channels.settled()
    }
  }
}

describe('ChannelService security', () => {
  it('refuses unpaired senders and keeps their text from the agent', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()
    const replies = adapter.deliver({ text: 'delete everything' })
    await channels.settled()
    expect(runner.calls).toEqual([])
    expect(replies[0]).toMatch(/not paired/)
  })

  it('pairs a sender with a valid code and then forwards messages', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code

    const pairingReplies = adapter.deliver({ text: `/pair ${code.toLowerCase()}` })
    await channels.settled()
    expect(pairingReplies).toEqual([expect.stringMatching(/^Paired\./)])
    expect(channels.pairings('telegram')).toMatchObject([
      { externalUserId: 'alice', displayName: 'Alice' }
    ])

    const replies = adapter.deliver({ text: 'status?' })
    await channels.settled()
    expect(runner.calls[0]?.text).toBe('status?')
    expect(replies).toEqual(['agent reply'])
  })

  it('does not forward the pairing code to the agent', async () => {
    const { connectPaired, runner } = setup()
    await connectPaired()
    expect(runner.calls).toEqual([])
  })

  it('refuses a reused code', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code
    adapter.deliver({ text: code })
    await channels.settled()

    const replies = adapter.deliver({ userId: 'mallory', text: code })
    await channels.settled()
    expect(replies).toEqual([expect.stringMatching(/^That code is not valid\./)])
    expect(channels.pairings('telegram')).toHaveLength(1)
    expect(runner.calls).toEqual([])
  })

  it('refuses an expired code', async () => {
    const { channels, config, adapter, clock } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code
    clock.advance(10 * 60_000)
    adapter.deliver({ text: code })
    await channels.settled()
    expect(channels.pairings('telegram')).toEqual([])
  })

  it('does not accept a code outside a direct message', async () => {
    const { channels, config, adapter } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code
    const replies = adapter.deliver({ text: code, isDirect: false })
    await channels.settled()
    expect(replies[0]).toMatch(/direct message/)
    expect(channels.pairings('telegram')).toEqual([])
  })

  it('cancels a code posted in a group so nobody there can use it', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code

    const replies = adapter.deliver({ text: `@gramatrix_bot ${code}`, isDirect: false })
    await channels.settled()
    expect(replies[0]).toMatch(/cancelled/)

    adapter.deliver({ userId: 'mallory', text: code })
    await channels.settled()
    expect(channels.pairings('telegram')).toEqual([])
    expect(runner.calls).toEqual([])
  })

  it('cancels a code a paired account posts in a group and keeps it from the agent', async () => {
    const { connectPaired, channels, adapter, runner } = setup()
    await connectPaired()
    const code = channels.createPairingCode('telegram').code

    const replies = adapter.deliver({ text: code, isDirect: false })
    await channels.settled()
    expect(replies[0]).toMatch(/cancelled/)
    expect(runner.calls).toEqual([])

    adapter.deliver({ userId: 'mallory', text: code })
    await channels.settled()
    expect(channels.pairings('telegram')).toHaveLength(1)
  })

  it('keeps the code when a group message does not contain it', async () => {
    const { channels, config, adapter } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code
    adapter.deliver({ text: 'AAAAAAAA', isDirect: false })
    adapter.deliver({ userId: 'alice', text: code })
    await channels.settled()
    expect(channels.pairings('telegram')).toHaveLength(1)
  })

  it('stops answering a sender after too many wrong codes', async () => {
    const { channels, config, adapter } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram').code
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS_PER_USER; attempt++) {
      adapter.deliver({ text: 'AAAAAAAA' })
      await channels.settled()
    }
    const replies = adapter.deliver({ text: code })
    await channels.settled()
    expect(replies).toEqual([])
    expect(channels.pairings('telegram')).toEqual([])
  })

  it('ignores other bots completely', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    const replies = adapter.deliver({ isBot: true })
    await channels.settled()
    expect(replies).toEqual([])
    expect(runner.calls).toEqual([])
  })

  it('refuses a sender after their pairing is revoked', async () => {
    const { connectPaired, channels, adapter, runner } = setup()
    await connectPaired()
    channels.revokePairing('telegram', 'alice')
    adapter.deliver({ text: 'still there?' })
    await channels.settled()
    expect(runner.calls).toEqual([])
  })

  it('checks the sender, not the thread', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    adapter.deliver({ userId: 'mallory', text: 'hi', isDirect: false })
    await channels.settled()
    expect(runner.calls).toEqual([])
  })
})

describe('ChannelService runs', () => {
  it('runs with the configured permission mode', async () => {
    const { connectPaired, adapter, runner, channels, config } = setup()
    await connectPaired()
    channels.configure(config({ permissionMode: 'accept-edits' }))
    await channels.settled()
    adapter.deliver()
    await channels.settled()
    expect(runner.calls[0]?.permissionMode).toBe('accept-edits')
  })

  it('defaults to read-only for an unconfigured channel', () => {
    const { channels } = setup()
    expect(channels.list().map((channel) => channel.permissionMode)).toEqual([
      'read-only',
      'read-only'
    ])
  })

  it('keeps one chat per thread', async () => {
    const { connectPaired, adapter, runner, channels, host, projectId } = setup()
    await connectPaired()
    adapter.deliver({ text: 'one' })
    adapter.deliver({ text: 'two' })
    adapter.deliver({ text: 'three', threadId: 'thread-2' })
    await channels.settled()
    const chatOf = (text: string) => runner.calls.find((call) => call.text === text)?.chatId
    expect(chatOf('one')).toBe(chatOf('two'))
    expect(chatOf('three')).not.toBe(chatOf('one'))
    expect(host.services.chats.list(projectId)).toHaveLength(2)
  })

  it('remembers whether a thread is private, so the app keeps memory out of group chats', async () => {
    const { connectPaired, adapter, runner, channels, host } = setup()
    await connectPaired()
    adapter.deliver({ text: 'in private' })
    adapter.deliver({ text: 'in a group', threadId: 'group-thread', isDirect: false })
    await channels.settled()
    const chatOf = (text: string) => runner.calls.find((call) => call.text === text)?.chatId ?? ''
    expect(host.services.chats.isPrivate(chatOf('in private'))).toBe(true)
    expect(host.services.chats.isPrivate(chatOf('in a group'))).toBe(false)
  })

  it('handles messages in one thread in order and other threads independently', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    runner.blocking = true
    adapter.deliver({ text: 'first' })
    adapter.deliver({ text: 'second' })
    adapter.deliver({ text: 'other', threadId: 'thread-2' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(runner.calls.map((call) => call.text)).toEqual(['first', 'other'])

    runner.blocking = false
    runner.release()
    await channels.settled()
    expect(runner.calls.map((call) => call.text)).toEqual(['first', 'other', 'second'])
  })

  it('starts a new chat on /new', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    adapter.deliver({ text: 'one' })
    adapter.deliver({ text: '/new' })
    adapter.deliver({ text: 'two' })
    await channels.settled()
    expect(runner.calls.map((call) => call.text)).toEqual(['one', 'two'])
    expect(runner.calls[0]?.chatId).not.toBe(runner.calls[1]?.chatId)
  })

  it('moves to a new chat when the channel changes project', async () => {
    const { connectPaired, adapter, runner, channels, config, host } = setup()
    await connectPaired()
    adapter.deliver({ text: 'one' })
    await channels.settled()
    const other = host.services.projects.add('/work/other')
    channels.configure(config({ projectId: other.id }))
    await channels.settled()
    adapter.deliver({ text: 'two' })
    await channels.settled()
    expect(host.services.chats.get(runner.calls[1]!.chatId).projectId).toBe(other.id)
  })

  it('counts its runs as channel usage', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    adapter.deliver()
    await channels.settled()
    expect(runner.calls[0]).toMatchObject({ source: 'channel' })
  })

  it('uses a general chat when no project is configured', async () => {
    const { connectPaired, adapter, runner, channels, config, host } = setup()
    await connectPaired()
    channels.configure(config({ projectId: null }))
    await channels.settled()
    adapter.deliver()
    await channels.settled()
    expect(runner.calls).toHaveLength(1)
    expect(host.services.chats.get(runner.calls[0]!.chatId).projectId).toBeNull()
  })

  it('keeps using the same general chat for a thread', async () => {
    const { connectPaired, adapter, runner, channels, config } = setup()
    await connectPaired()
    channels.configure(config({ projectId: null }))
    await channels.settled()
    adapter.deliver()
    await channels.settled()
    adapter.deliver()
    await channels.settled()
    expect(runner.calls[1]?.chatId).toBe(runner.calls[0]?.chatId)
  })

  it('falls back to the default model and says so when there is none', async () => {
    const { connectPaired, adapter, runner, channels, config, host } = setup()
    await connectPaired()
    channels.configure(config({ model: null }))
    await channels.settled()
    const replies = adapter.deliver()
    await channels.settled()
    expect(replies[0]).toMatch(/No model/)

    host.services.settings.update({ defaultModel: { provider: 'zai', model: 'fallback' } })
    adapter.deliver()
    await channels.settled()
    expect(host.services.chats.get(runner.calls[0]!.chatId).model.model).toBe('fallback')
  })

  it('aborts the active run and drops queued messages when the channel is disabled', async () => {
    const { connectPaired, adapter, runner, channels, config } = setup()
    await connectPaired()
    runner.blocking = true
    runner.failOnAbort = true
    const replies = adapter.deliver({ text: 'first' })
    adapter.deliver({ text: 'second' })
    await new Promise((resolve) => setImmediate(resolve))
    const signal = runner.calls[0]?.signal

    channels.configure(config({ enabled: false }))
    expect(signal?.aborted).toBe(true)
    await channels.settled()

    expect(runner.calls.map((call) => call.text)).toEqual(['first'])
    expect(replies).toEqual([])
  })

  it('aborts the active run on reconfigure and runs queued work with the new settings', async () => {
    const { connectPaired, adapter, runner, channels, config } = setup()
    await connectPaired()
    runner.blocking = true
    runner.failOnAbort = true
    const replies = adapter.deliver({ text: 'first' })
    adapter.deliver({ text: 'second' })
    await new Promise((resolve) => setImmediate(resolve))
    const signal = runner.calls[0]?.signal

    runner.blocking = false
    channels.configure(config({ permissionMode: 'ask' }))
    await channels.settled()

    expect(signal?.aborted).toBe(true)
    expect(replies).toEqual(['The run was cancelled because the channel settings changed.'])
    expect(runner.calls[1]).toMatchObject({ text: 'second', permissionMode: 'ask' })
    expect(runner.calls[1]?.signal?.aborted).toBe(false)
  })

  it('splits long replies', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    adapter.maxMessageLength = 10
    runner.reply = 'x'.repeat(25)
    const replies = adapter.deliver()
    await channels.settled()
    expect(replies).toHaveLength(3)
  })

  it('reports a failed run to the sender', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    runner.failure = new Error('no credits')
    const replies = adapter.deliver()
    await channels.settled()
    expect(replies).toEqual(['The run failed: no credits'])
  })

  it('keeps working after a reply fails', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    adapter.deliver({
      reply: async () => {
        throw new Error('network down')
      }
    })
    adapter.deliver({ text: 'next' })
    await channels.settled()
    expect(runner.calls.map((call) => call.text)).toEqual(['hello', 'next'])
  })
})

describe('ChannelService connections', () => {
  it('reports both channels as disabled at first', () => {
    const { channels } = setup()
    expect(channels.list()).toMatchObject([
      { kind: 'telegram', enabled: false, state: 'disabled' },
      { kind: 'slack', enabled: false, state: 'disabled' }
    ])
  })

  it('connects when enabled and announces the state', async () => {
    const { channels, config, events } = setup()
    channels.configure(config())
    await channels.settled()
    expect(channels.list()[0]?.state).toBe('connected')
    expect(events.some((event) => event.event === 'channels.changed')).toBe(true)
  })

  it('shows a missing token as an error', async () => {
    const { channels, config, secrets } = setup()
    secrets.clear()
    channels.configure(config())
    await channels.settled()
    expect(channels.list()[0]).toMatchObject({ state: 'error', error: 'Bot token is missing.' })
  })

  it('reconnects on every save and disconnects when disabled', async () => {
    const { channels, config, adapter, created } = setup()
    channels.configure(config())
    channels.configure(config())
    await channels.settled()
    expect(created).toHaveLength(2)
    expect(adapter.stops).toBe(1)

    channels.configure(config({ enabled: false }))
    await channels.settled()
    expect(adapter.stops).toBe(2)
    expect(channels.list()[0]?.state).toBe('disabled')
  })

  it('reconnects enabled channels on start', async () => {
    const { channels, config, created } = setup()
    channels.configure(config({ enabled: true }))
    await channels.settled()
    channels.start()
    await channels.settled()
    expect(created).toHaveLength(2)
  })

  it('disconnects and aborts runs on stop', async () => {
    const { connectPaired, adapter, runner, channels } = setup()
    await connectPaired()
    runner.blocking = true
    adapter.deliver()
    await new Promise((resolve) => setImmediate(resolve))
    const signal = runner.calls[0]?.signal
    const stopping = channels.stop()
    expect(signal?.aborted).toBe(true)
    runner.blocking = false
    runner.release()
    await stopping
    expect(adapter.stops).toBe(1)
  })

  it('serves the RPC methods', async () => {
    const { channels, host, config } = setup()
    channels.register(host.router)
    await host.router.dispatch('channels.configure', config({ enabled: false }))
    const list = (await host.router.dispatch('channels.list', undefined)) as { kind: string }[]
    expect(list).toHaveLength(2)
    const { code } = (await host.router.dispatch('channels.createPairingCode', {
      kind: 'telegram'
    })) as { code: string }
    expect(code).toHaveLength(8)
    await host.router.dispatch('channels.revokePairing', { kind: 'telegram', externalUserId: 'x' })
    expect(await host.router.dispatch('channels.pairings', { kind: 'telegram' })).toEqual([])
  })
})

describe('ChannelService with a bot', () => {
  async function withBot() {
    const fixture = setup()
    const bot = fixture.host.services.bots.create({
      name: 'Ada',
      soul: '',
      model: { provider: 'openai', model: 'test' },
      learns: false
    })
    await fixture.connectPaired()
    fixture.channels.configure(fixture.config({ botId: bot.id }))
    await fixture.channels.settled()
    return { ...fixture, bot }
  }

  it('answers as plain Gramatrix by default', async () => {
    const { connectPaired, adapter, runner, channels, host } = setup()
    await connectPaired()
    adapter.deliver()
    await channels.settled()
    expect(channels.list().map((channel) => channel.botId)).toEqual([null, null])
    expect(host.services.chats.get(runner.calls[0]!.chatId).botId).toBeNull()
  })

  it('gives thread chats the bot and lets it use memory in a direct message', async () => {
    const { adapter, runner, channels, host, bot } = await withBot()
    adapter.deliver({ isDirect: true })
    await channels.settled()
    expect(channels.list()[0]?.botId).toBe(bot.id)
    expect(host.services.chats.get(runner.calls[0]!.chatId).botId).toBe(bot.id)
    expect(runner.calls[0]?.withMemory).toBe(true)
  })

  it('keeps memory out of a group, even for the paired person', async () => {
    const { adapter, runner, channels, host, bot } = await withBot()
    adapter.deliver({ isDirect: false, threadId: 'group-thread' })
    await channels.settled()
    expect(host.services.chats.get(runner.calls[0]!.chatId).botId).toBe(bot.id)
    expect(runner.calls[0]?.withMemory).toBe(false)
  })

  it('moves a thread to a new chat when the channel changes bot', async () => {
    const { adapter, runner, channels, config, host, bot } = await withBot()
    adapter.deliver({ text: 'one' })
    await channels.settled()
    channels.configure(config({ botId: null }))
    await channels.settled()
    adapter.deliver({ text: 'two' })
    await channels.settled()
    expect(runner.calls[1]?.chatId).not.toBe(runner.calls[0]?.chatId)
    expect(host.services.chats.get(runner.calls[0]!.chatId).botId).toBe(bot.id)
    expect(host.services.chats.get(runner.calls[1]!.chatId).botId).toBeNull()
  })

  it('goes back to plain Gramatrix and keeps the thread chat when the bot is deleted', async () => {
    const { adapter, runner, channels, host, bot } = await withBot()
    adapter.deliver({ text: 'one' })
    await channels.settled()
    host.services.bots.remove(bot.id)
    adapter.deliver({ text: 'two' })
    await channels.settled()
    expect(channels.list()[0]?.botId).toBeNull()
    expect(runner.calls[1]?.chatId).toBe(runner.calls[0]?.chatId)
    expect(host.services.chats.get(runner.calls[1]!.chatId).botId).toBeNull()
  })

  it('refuses a bot that does not exist and keeps the old settings', async () => {
    const { channels, config, bot } = await withBot()
    expect(() => channels.configure(config({ botId: 'gone' }))).toThrow('That bot no longer exists')
    expect(channels.list()[0]?.botId).toBe(bot.id)
  })

  it('treats a missing bot id from an older caller as plain Gramatrix', async () => {
    const { channels, config } = await withBot()
    const legacy: Partial<ChannelConfigInput> = config()
    delete legacy.botId
    expect(channels.configure(legacy as ChannelConfigInput).botId).toBeNull()
  })
})

describe('ChannelService pairing flow', () => {
  it('pairs with the /start message a Telegram pairing link sends', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()
    const { code } = channels.createPairingCode('telegram')

    const replies = adapter.deliver({ text: `/start ${code}` })
    await channels.settled()

    expect(replies).toEqual([expect.stringMatching(/^Paired\./)])
    expect(channels.pairings('telegram')).toHaveLength(1)
    expect(runner.calls).toEqual([])
  })

  it('gives a pairing link that opens the bot with the code, and when the code expires', async () => {
    const { channels, config, context } = setup()
    channels.configure(config())
    await channels.settled()

    const pairing = channels.createPairingCode('telegram')

    expect(pairing.link).toBe(`https://t.me/gramatrix_test_bot?start=${pairing.code}`)
    expect(pairing.expiresAt).toBe(context.now() + PAIRING_CODE_TTL_MS)
    expect(channels.list().find(({ kind }) => kind === 'telegram')?.account).toBe(
      'gramatrix_test_bot'
    )
  })

  it('gives no link before the bot is connected, or when its name is unknown', async () => {
    const { channels, config, adapter } = setup()
    expect(channels.createPairingCode('telegram').link).toBeNull()

    adapter.account = null
    channels.configure(config())
    await channels.settled()
    expect(channels.createPairingCode('telegram').link).toBeNull()
  })

  it('welcomes someone who opens the bot without a code and says how to pair', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()

    const replies = adapter.deliver({ text: '/start' })
    await channels.settled()

    expect(replies[0]).toMatch(/^Hi!/)
    expect(replies[0]).toContain('Channels, Telegram')
    expect(runner.calls).toEqual([])
  })

  it('tells an unpaired sender where to pair', async () => {
    const { channels, config, adapter } = setup()
    channels.configure(config())
    await channels.settled()

    const replies = adapter.deliver({ text: 'hello?' })
    await channels.settled()

    expect(replies[0]).toContain('not paired')
    expect(replies[0]).toContain('go to Channels, Telegram, and choose Pair')
  })

  it('keeps /start and a repeated code from a paired account away from the agent', async () => {
    const { connectPaired, adapter, channels, runner } = setup()
    await connectPaired()

    const start = adapter.deliver({ text: '/start' })
    await channels.settled()
    const again = adapter.deliver({ text: `/start ${channels.createPairingCode('telegram').code}` })
    await channels.settled()

    expect(start[0]).toMatch(/^You are paired\./)
    expect(again[0]).toMatch(/already paired/)
    expect(runner.calls).toEqual([])
  })

  it('tells the open settings at once when someone pairs or is revoked', async () => {
    const { channels, config, adapter, events } = setup()
    channels.configure(config())
    await channels.settled()
    const changes = (): number => events.filter(({ event }) => event === 'channels.changed').length

    const beforePairing = changes()
    adapter.deliver({ text: channels.createPairingCode('telegram').code })
    await channels.settled()
    const afterPairing = changes()
    channels.revokePairing('telegram', 'alice')

    expect(afterPairing).toBe(beforePairing + 1)
    expect(changes()).toBe(afterPairing + 1)
  })
})

describe('ChannelService chat commands', () => {
  const OTHER_MODEL = { provider: 'anthropic' as const, model: 'claude-test' }

  /** Connects with a paired account and two providers that have keys. */
  async function commandSetup(): Promise<Fixture> {
    const fixture = setup()
    fixture.secrets.set(secretName.provider('openai'), 'key')
    fixture.secrets.set(secretName.provider('anthropic'), 'key')
    fixture.host.services.settings.update({ favoriteModels: [OTHER_MODEL] })
    await fixture.connectPaired()
    return fixture
  }

  async function send(fixture: Fixture, text: string, threadId = 'thread-1'): Promise<string[]> {
    const replies = fixture.adapter.deliver({ text, threadId })
    await fixture.channels.settled()
    return replies
  }

  it('gives the platform its command list', async () => {
    const { adapter } = await commandSetup()
    expect(adapter.commands).toBe(CHANNEL_COMMANDS)
  })

  it('lists models as buttons and runs the next message with the one chosen', async () => {
    const fixture = await commandSetup()
    const menu = await send(fixture, '/model')
    expect(menu[0]).toMatch(/^Choose a model for this chat\. Now: test - ChatGPT \(OpenAI\)\./)
    expect(fixture.adapter.lastChoices).toEqual([
      { label: 'test - ChatGPT (OpenAI) (now)', command: '/model 1' },
      { label: 'claude-test - Claude (Anthropic)', command: '/model 2' }
    ])

    expect(await send(fixture, '/model 2')).toEqual([
      'Model for this chat: claude-test - Claude (Anthropic).'
    ])
    await send(fixture, 'hello')
    await send(fixture, 'hello', 'thread-2')

    const chats = fixture.runner.calls.map((call) => fixture.host.services.chats.get(call.chatId))
    expect(chats.map((chat) => chat.model)).toEqual([OTHER_MODEL, fixture.config().model])
    expect(fixture.runner.calls.map((call) => call.text)).toEqual(['hello', 'hello'])
  })

  it('accepts a model by name, or as provider/model when that provider has a key', async () => {
    const fixture = await commandSetup()
    expect(await send(fixture, '/model claude')).toEqual([
      'Model for this chat: claude-test - Claude (Anthropic).'
    ])
    expect(await send(fixture, '/model openai/gpt-new')).toEqual([
      'Model for this chat: gpt-new - ChatGPT (OpenAI).'
    ])
    expect((await send(fixture, '/model gemini/gemini-x'))[0]).toMatch(/has no key yet/)
    expect((await send(fixture, '/model nothing-like-it'))[0]).toMatch(/^There is no model called/)
  })

  it('goes back to the app setting with "default"', async () => {
    const fixture = await commandSetup()
    await send(fixture, '/model 2')
    await send(fixture, '/model')
    expect(fixture.adapter.lastChoices.at(-1)).toEqual({
      label: 'Use the Gramatrix setting',
      command: '/model default'
    })
    await send(fixture, '/model default')
    await send(fixture, 'hello')
    const chat = fixture.host.services.chats.get(fixture.runner.calls[0]?.chatId ?? '')
    expect(chat.model).toEqual(fixture.config().model)
  })

  it('moves a thread to another project, or to none, in a new chat', async () => {
    const fixture = await commandSetup()
    const other = fixture.host.services.projects.add('/work/other')
    await send(fixture, 'first')
    await send(fixture, '/project other')
    await send(fixture, 'second')
    await send(fixture, '/project no project')
    await send(fixture, 'third')

    const chats = fixture.runner.calls.map((call) => fixture.host.services.chats.get(call.chatId))
    expect(chats.map((chat) => chat.projectId)).toEqual([fixture.projectId, other.id, null])
    expect(new Set(chats.map((chat) => chat.id)).size).toBe(3)
  })

  it('falls back to the channel project when the chosen one is deleted', async () => {
    const fixture = await commandSetup()
    const other = fixture.host.services.projects.add('/work/other')
    await send(fixture, '/project other')
    fixture.host.services.projects.remove(other.id)
    await send(fixture, 'hello')
    const chat = fixture.host.services.chats.get(fixture.runner.calls[0]?.chatId ?? '')
    expect(chat.projectId).toBe(fixture.projectId)
  })

  it('answers as a chosen bot with its model', async () => {
    const fixture = await commandSetup()
    const bot = fixture.host.services.bots.create({
      name: 'Lord',
      soul: 'Calm.',
      model: OTHER_MODEL,
      learns: false
    })
    await send(fixture, '/bot lord')
    await send(fixture, 'hello')
    const chat = fixture.host.services.chats.get(fixture.runner.calls[0]?.chatId ?? '')
    expect(chat).toMatchObject({ botId: bot.id, model: OTHER_MODEL })
  })

  it('never lets a chat raise the permission mode above the app setting', async () => {
    const fixture = await commandSetup()
    fixture.channels.configure(fixture.config({ permissionMode: 'ask' }))
    await fixture.channels.settled()

    await send(fixture, '/mode')
    expect(fixture.adapter.lastChoices.map((choice) => choice.label)).toEqual([
      'Read only',
      'Ask first (now)'
    ])
    expect((await send(fixture, '/mode full access'))[0]).toMatch(/^There is no permission mode/)
    await send(fixture, '/mode read only')
    await send(fixture, 'hello')
    expect(fixture.runner.calls[0]?.permissionMode).toBe('read-only')
  })

  it('drops a choice when the same setting changes in the app', async () => {
    const fixture = await commandSetup()
    await send(fixture, '/model 2')
    fixture.channels.configure(fixture.config({ model: { provider: 'openai', model: 'newer' } }))
    await fixture.channels.settled()
    await send(fixture, 'hello')
    const chat = fixture.host.services.chats.get(fixture.runner.calls[0]?.chatId ?? '')
    expect(chat.model).toEqual({ provider: 'openai', model: 'newer' })
  })

  it('keeps a choice when another setting changes in the app', async () => {
    const fixture = await commandSetup()
    await send(fixture, '/model 2')
    fixture.channels.configure(fixture.config({ permissionMode: 'ask' }))
    await fixture.channels.settled()
    await send(fixture, 'hello')
    const chat = fixture.host.services.chats.get(fixture.runner.calls[0]?.chatId ?? '')
    expect(chat.model).toEqual(OTHER_MODEL)
  })

  it('shows the status, marking what this chat chose', async () => {
    const fixture = await commandSetup()
    await send(fixture, '/model 2')
    const [status] = await send(fixture, '/status')
    expect(status).toBe(
      [
        'Project: demo',
        'Model: claude-test - Claude (Anthropic) (chosen here)',
        'Answers as: Gramatrix',
        'Permissions: Read only',
        '',
        'Change these with /project, /model, /bot and /mode.'
      ].join('\n')
    )
  })

  it('lists the commands with /help', async () => {
    const fixture = await commandSetup()
    const [help] = await send(fixture, '/help')
    for (const { name } of CHANNEL_COMMANDS) expect(help).toContain(`/${name} - `)
  })

  it('stops a running answer at once and drops the messages behind it', async () => {
    const fixture = await commandSetup()
    const { adapter, runner, channels } = fixture
    runner.blocking = true
    runner.failOnAbort = true
    const replies = adapter.deliver({ text: 'long task' })
    adapter.deliver({ text: 'queued' })
    await new Promise((resolve) => setImmediate(resolve))

    const status = adapter.deliver({ text: '/status' })
    const stop = adapter.deliver({ text: '/stop' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(status.at(-1)).toMatch(/An answer is running\. Send \/stop to stop it\.$/)
    expect(stop).toEqual(['Stopped.'])
    expect(runner.calls[0]?.signal?.aborted).toBe(true)

    await channels.settled()
    runner.blocking = false
    const after = await send(fixture, 'next')
    expect(replies).toEqual([])
    expect(runner.calls.map((call) => call.text)).toEqual(['long task', 'next'])
    expect(after).toEqual(['agent reply'])
  })

  it('says so when there is nothing to stop', async () => {
    const fixture = await commandSetup()
    expect(await send(fixture, '/stop')).toEqual(['Nothing is running right now.'])
  })

  it('treats a command from an unpaired account like any unpaired message', async () => {
    const fixture = await commandSetup()
    const replies = fixture.adapter.deliver({ text: '/model 2', userId: 'mallory' })
    await fixture.channels.settled()
    expect(replies[0]).toMatch(/^This account is not paired/)
    await send(fixture, 'hello')
    const chat = fixture.host.services.chats.get(fixture.runner.calls[0]?.chatId ?? '')
    expect(chat.model).toEqual(fixture.config().model)
  })

  it('sends text that only starts with a slash to the agent', async () => {
    const fixture = await commandSetup()
    await send(fixture, '/etc/hosts looks wrong')
    expect(fixture.runner.calls.map((call) => call.text)).toEqual(['/etc/hosts looks wrong'])
  })
})
