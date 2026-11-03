import { describe, expect, it } from 'vitest'
import { commandAsMessage, createChatSdkAdapter, isDirectConversation } from './chat-sdk-adapter'

const withSecrets =
  (secrets: Record<string, string>) =>
  async (field: string): Promise<string | null> =>
    secrets[field] ?? null

// These stop before start(), so nothing here touches the network.
describe('createChatSdkAdapter', () => {
  it('builds a Telegram adapter from a bot token', async () => {
    const adapter = await createChatSdkAdapter('telegram', withSecrets({ botToken: '1:abc' }))
    expect(adapter.maxMessageLength).toBeGreaterThan(0)
  })

  it('builds a Slack adapter from a bot token and an app token', async () => {
    const adapter = await createChatSdkAdapter(
      'slack',
      withSecrets({ botToken: 'xoxb-test', appToken: 'xapp-test' })
    )
    expect(adapter.maxMessageLength).toBeGreaterThan(0)
  })

  it('names the missing Telegram token', async () => {
    await expect(createChatSdkAdapter('telegram', withSecrets({}))).rejects.toThrow(
      'Bot token is missing'
    )
  })

  it('names the missing Slack app token', async () => {
    await expect(
      createChatSdkAdapter('slack', withSecrets({ botToken: 'xoxb-test' }))
    ).rejects.toThrow('App token is missing')
  })
})

describe('isDirectConversation', () => {
  it('accepts a private Telegram chat', () => {
    expect(isDirectConversation('telegram', true, { chat: { id: 42, type: 'private' } })).toBe(true)
  })

  it.each(['group', 'supergroup', 'channel', undefined])(
    'treats a Telegram chat of type %s as shared',
    (type) => {
      expect(isDirectConversation('telegram', true, { chat: { id: 42, type } })).toBe(false)
    }
  )

  it('treats a Telegram business chat as shared, since the account owner reads it', () => {
    const raw = { chat: { id: 42, type: 'private' }, business_connection_id: 'b1' }
    expect(isDirectConversation('telegram', true, raw)).toBe(false)
  })

  it('accepts a Slack direct message', () => {
    expect(isDirectConversation('slack', true, { channel: 'D1', channel_type: 'im' })).toBe(true)
  })

  it.each(['mpim', 'channel', 'group', undefined])(
    'treats a Slack conversation of type %s as shared',
    (channelType) => {
      const raw = { channel: 'D1', channel_type: channelType }
      expect(isDirectConversation('slack', true, raw)).toBe(false)
    }
  )

  it('treats a missing raw message as shared', () => {
    expect(isDirectConversation('telegram', true, undefined)).toBe(false)
    expect(isDirectConversation('slack', true, null)).toBe(false)
  })

  it('never upgrades a thread Chat SDK calls shared', () => {
    expect(isDirectConversation('telegram', false, { chat: { type: 'private' } })).toBe(false)
    expect(isDirectConversation('slack', false, { channel_type: 'im' })).toBe(false)
  })
})

describe('commandAsMessage', () => {
  const privateChat = { chat: { type: 'private' }, text: '/pair ABC123' }

  function command(overrides: Record<string, unknown> = {}) {
    return {
      adapter: { isDM: (threadId: string) => threadId === 'telegram:42' },
      channel: { id: 'telegram:42' },
      command: '/pair',
      text: 'ABC123',
      raw: privateChat,
      user: { userId: '7', userName: 'berk', fullName: 'Berk', isBot: false },
      ...overrides
    } as unknown as Parameters<typeof commandAsMessage>[1]
  }

  it('rebuilds the text the person typed, so "/pair CODE" pairs and "/new" starts a chat', () => {
    expect(commandAsMessage('telegram', command())).toEqual({
      threadId: 'telegram:42',
      userId: '7',
      displayName: 'Berk',
      text: '/pair ABC123',
      isDirect: true,
      isBot: false
    })
    expect(commandAsMessage('telegram', command({ command: '/new', text: '' })).text).toBe('/new')
  })

  it('treats a command in a group as shared, so a pairing code posted there is cancelled', () => {
    const groupCommand = command({
      channel: { id: 'telegram:-100' },
      raw: { chat: { type: 'supergroup' } }
    })
    expect(commandAsMessage('telegram', groupCommand).isDirect).toBe(false)
  })

  it('uses the user name when there is no full name, and flags other bots', () => {
    const fromBot = command({
      user: { userId: '9', userName: 'helper', fullName: '', isBot: true }
    })
    expect(commandAsMessage('telegram', fromBot)).toMatchObject({
      displayName: 'helper',
      isBot: true
    })
  })
})
