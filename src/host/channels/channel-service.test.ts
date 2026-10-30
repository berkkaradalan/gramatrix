import { describe, expect, it } from 'vitest'
import { secretName, type ChannelConfigInput } from '@shared/rpc'
import type { ChannelKind } from '@shared/types'
import type { AgentRunner, HeadlessRunInput, HeadlessRunResult } from '../agent-runner'
import { createTestHost, type TestHost } from '../testing'
import type { ChannelAdapter, InboundMessage, MessageListener, ReadSecret } from './adapter'
import { ChannelService } from './channel-service'
import { MAX_FAILED_ATTEMPTS_PER_USER } from './pairing'

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
  private listener: MessageListener | null = null

  async start(listener: MessageListener): Promise<void> {
    this.listener = listener
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
      reply: async (text) => {
        replies.push(text)
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
      adapter.deliver({ userId, text: channels.createPairingCode('telegram') })
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
    const code = channels.createPairingCode('telegram')

    const pairingReplies = adapter.deliver({ text: `/pair ${code.toLowerCase()}` })
    await channels.settled()
    expect(pairingReplies).toEqual(['Paired. You can now talk to Gramatrix here.'])
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
    const code = channels.createPairingCode('telegram')
    adapter.deliver({ text: code })
    await channels.settled()

    const replies = adapter.deliver({ userId: 'mallory', text: code })
    await channels.settled()
    expect(replies).toEqual(['That code is not valid. Create a new one in Gramatrix.'])
    expect(channels.pairings('telegram')).toHaveLength(1)
    expect(runner.calls).toEqual([])
  })

  it('refuses an expired code', async () => {
    const { channels, config, adapter, clock } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram')
    clock.advance(10 * 60_000)
    adapter.deliver({ text: code })
    await channels.settled()
    expect(channels.pairings('telegram')).toEqual([])
  })

  it('does not accept a code outside a direct message', async () => {
    const { channels, config, adapter } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram')
    const replies = adapter.deliver({ text: code, isDirect: false })
    await channels.settled()
    expect(replies[0]).toMatch(/direct message/)
    expect(channels.pairings('telegram')).toEqual([])
  })

  it('cancels a code posted in a group so nobody there can use it', async () => {
    const { channels, config, adapter, runner } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram')

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
    const code = channels.createPairingCode('telegram')

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
    const code = channels.createPairingCode('telegram')
    adapter.deliver({ text: 'AAAAAAAA', isDirect: false })
    adapter.deliver({ userId: 'alice', text: code })
    await channels.settled()
    expect(channels.pairings('telegram')).toHaveLength(1)
  })

  it('stops answering a sender after too many wrong codes', async () => {
    const { channels, config, adapter } = setup()
    channels.configure(config())
    await channels.settled()
    const code = channels.createPairingCode('telegram')
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
