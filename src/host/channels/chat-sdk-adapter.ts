import { createSlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createTelegramAdapter } from '@chat-adapter/telegram'
import { Chat, type Adapter, type Message, type SlashCommandEvent, type Thread } from 'chat'
import type { ChannelKind } from '@shared/types'
import type {
  ChannelAdapter,
  ChannelAdapterFactory,
  InboundMessage,
  MessageListener,
  ReadSecret
} from './adapter'

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

/**
 * Decides whether a message comes from a one to one conversation with the bot. Chat SDK only
 * reads the thread id, which on Telegram also calls a business chat between the account owner and
 * a customer a direct message. So the raw platform message must agree as well, and a missing or
 * unexpected value counts as shared:
 * - Telegram: the chat type is "private" and the message did not arrive through a business
 *   connection. Groups, supergroups and channels have other types.
 * - Slack: the event channel type is "im". Group DMs are "mpim", channels are "channel" or
 *   "group", and app mentions carry no channel type at all.
 */
export function isDirectConversation(
  kind: ChannelKind,
  threadIsDM: boolean,
  raw: unknown
): boolean {
  if (!threadIsDM || typeof raw !== 'object' || raw === null) return false
  const fields = raw as {
    chat?: { type?: unknown }
    business_connection_id?: unknown
    channel_type?: unknown
  }
  switch (kind) {
    case 'telegram':
      return fields.chat?.type === 'private' && fields.business_connection_id === undefined
    case 'slack':
      return fields.channel_type === 'im'
  }
}

/**
 * Turns a command back into the message the person typed. Telegram marks "/pair CODE" and "/new"
 * as bot commands, and Chat SDK hands those to command handlers instead of message handlers. The
 * channel service reads them as ordinary messages, so they take the same path, with the same
 * pairing checks.
 */
export function commandAsMessage(
  kind: ChannelKind,
  event: Pick<SlashCommandEvent, 'adapter' | 'channel' | 'command' | 'text' | 'raw' | 'user'>
): Omit<InboundMessage, 'reply'> {
  const threadId = event.channel.id
  return {
    threadId,
    userId: event.user.userId,
    displayName: event.user.fullName || event.user.userName,
    text: `${event.command} ${event.text}`.trim(),
    isDirect: isDirectConversation(kind, event.adapter.isDM?.(threadId) ?? false, event.raw),
    isBot: event.user.isBot === true
  }
}

/** Connects one platform through Chat SDK. */
class ChatSdkAdapter implements ChannelAdapter {
  readonly maxMessageLength = MAX_MESSAGE_LENGTH
  private readonly chat: Chat

  constructor(
    private readonly kind: ChannelKind,
    adapter: Adapter
  ) {
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
        isDirect: isDirectConversation(this.kind, thread.isDM, message.raw),
        isBot: message.author.isBot === true,
        reply: async (text) => {
          await thread.post(text)
        }
      })
    }
    this.chat.onDirectMessage(forward)
    this.chat.onNewMention(forward)
    this.chat.onSlashCommand(async (event) => {
      listener({
        ...commandAsMessage(this.kind, event),
        reply: async (text) => {
          await event.channel.post(text)
        }
      })
    })
    await this.chat.initialize()
  }

  async stop(): Promise<void> {
    await this.chat.shutdown()
  }
}

export const createChatSdkAdapter: ChannelAdapterFactory = async (kind, readSecret) =>
  new ChatSdkAdapter(kind, await createVendorAdapter(kind, readSecret))
