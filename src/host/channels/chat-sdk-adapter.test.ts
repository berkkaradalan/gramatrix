import { describe, expect, it } from 'vitest'
import { createChatSdkAdapter } from './chat-sdk-adapter'

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
