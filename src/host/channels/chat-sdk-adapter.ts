import { createSlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createTelegramAdapter } from '@chat-adapter/telegram'
import { Chat, type Adapter, type Message, type Thread } from 'chat'
import type { ChannelKind } from '@shared/types'
import type { ChannelAdapter, ChannelAdapterFactory, MessageListener, ReadSecret } from './adapter'

/** Below the 4096 and 40000 platform limits because formatting can lengthen a message. */
const MAX_MESSAGE_LENGTH = 3500

const BOT_USER_NAME = 'gramatrix'

async function requireSecret(
  readSecret: ReadSecret,
  field: string,
  label: string
): Promise<string> {
  const value = await readSecret(field)
  if (!value) throw new Error(`${label} is missing. Add it in the channel settings.`)
  return value
}

async function createVendorAdapter(kind: ChannelKind, readSecret: ReadSecret): Promise<Adapter> {
  // Both modes open outbound connections, so a desktop app needs no public URL.
  switch (kind) {
    case 'telegram':
      return createTelegramAdapter({
        botToken: await requireSecret(readSecret, 'botToken', 'Bot token'),
        mode: 'polling'
      })
    case 'slack':
      return createSlackAdapter({
        botToken: await requireSecret(readSecret, 'botToken', 'Bot token'),
        appToken: await requireSecret(readSecret, 'appToken', 'App token'),
        mode: 'socket'
      })
  }
}

/** Connects one platform through Chat SDK. */
class ChatSdkAdapter implements ChannelAdapter {
  readonly maxMessageLength = MAX_MESSAGE_LENGTH
  private readonly chat: Chat

  constructor(adapter: Adapter) {
    this.chat = new Chat({
      userName: BOT_USER_NAME,
      adapters: { [adapter.name]: adapter },
      // Only used for deduplication: no thread subscriptions, and the database holds the rest.
      state: createMemoryState(),
      // The default drops messages during a run, and agent runs can take minutes.
      // The channel service queues per thread instead.
      concurrency: 'concurrent',
      logger: 'silent'
    })
  }

  async start(listener: MessageListener): Promise<void> {
    const forward = async (thread: Thread, message: Message): Promise<void> => {
      listener({
        threadId: thread.id,
        userId: message.author.userId,
        displayName: message.author.fullName || message.author.userName,
        text: message.text,
        isDirect: thread.isDM,
        isBot: message.author.isBot === true,
        reply: async (text) => {
          await thread.post(text)
        }
      })
    }
    this.chat.onDirectMessage(forward)
    this.chat.onNewMention(forward)
    await this.chat.initialize()
  }

  async stop(): Promise<void> {
    await this.chat.shutdown()
  }
}

export const createChatSdkAdapter: ChannelAdapterFactory = async (kind, readSecret) =>
  new ChatSdkAdapter(await createVendorAdapter(kind, readSecret))
