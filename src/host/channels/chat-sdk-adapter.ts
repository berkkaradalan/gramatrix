import { createSlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createTelegramAdapter } from '@chat-adapter/telegram'
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  type ActionEvent,
  type Adapter,
  type Message,
  type SlashCommandEvent,
  type Thread
} from 'chat'
import type { ChannelKind } from '@shared/types'
import type {
  ChannelAdapter,
  ChannelAdapterFactory,
  Choice,
  InboundMessage,
  MessageListener,
  ReadSecret
} from './adapter'
import type { ChannelCommand } from './commands'

/** Below the 4096 and 40000 platform limits because formatting can lengthen a message. */
const MAX_MESSAGE_LENGTH = 3500

const BOT_USER_NAME = 'gramatrix'

/** Action id of every button. The button value carries the command it stands for. */
const COMMAND_ACTION = 'command'

const TELEGRAM_API = 'https://api.telegram.org'

/** Platform work that Chat SDK has no method for. */
interface PlatformExtras {
  publishCommands?(commands: readonly ChannelCommand[]): Promise<void>
}

async function requireSecret(
  readSecret: ReadSecret,
  field: string,
  label: string
): Promise<string> {
  const value = await readSecret(field)
  if (!value) throw new Error(`${label} is missing. Add it in the channel settings.`)
  return value
}

async function createVendorAdapter(
  kind: ChannelKind,
  readSecret: ReadSecret
): Promise<{ vendor: Adapter; extras: PlatformExtras }> {
  // Both modes open outbound connections, so a desktop app needs no public URL.
  switch (kind) {
    case 'telegram': {
      const botToken = await requireSecret(readSecret, 'botToken', 'Bot token')
      return {
        vendor: createTelegramAdapter({ botToken, mode: 'polling' }),
        extras: { publishCommands: (commands) => setTelegramCommands(botToken, commands) }
      }
    }
    case 'slack':
      return {
        vendor: createSlackAdapter({
          botToken: await requireSecret(readSecret, 'botToken', 'Bot token'),
          appToken: await requireSecret(readSecret, 'appToken', 'App token'),
          mode: 'socket'
        }),
        // Slack only offers commands that are registered in the app's own settings.
        extras: {}
      }
  }
}

/** Fills the menu Telegram shows when someone types a slash in a chat with the bot. */
async function setTelegramCommands(
  botToken: string,
  commands: readonly ChannelCommand[]
): Promise<void> {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commands: commands.map(({ name, description }) => ({ command: name, description }))
    })
  })
  if (!response.ok) throw new Error(`Telegram refused the command list (${response.status}).`)
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

/**
 * Turns a button press back into the command it stands for, so it takes the same path as a typed
 * command, with the same pairing checks. On Telegram the chat type sits on the message that holds
 * the button.
 */
export function actionAsMessage(
  kind: ChannelKind,
  event: Pick<ActionEvent, 'adapter' | 'threadId' | 'value' | 'raw' | 'user'>
): Omit<InboundMessage, 'reply'> {
  const raw = kind === 'telegram' ? (event.raw as { message?: unknown } | null)?.message : event.raw
  return {
    threadId: event.threadId,
    userId: event.user.userId,
    displayName: event.user.fullName || event.user.userName,
    text: event.value ?? '',
    isDirect: isDirectConversation(kind, event.adapter.isDM?.(event.threadId) ?? false, raw),
    isBot: event.user.isBot === true
  }
}

/** A reply with buttons, one per row so long names stay readable. */
function withButtons(text: string, choices: Choice[]): ReturnType<typeof Card> {
  return Card({
    children: [
      CardText(text),
      ...choices.map((choice) =>
        Actions([Button({ id: COMMAND_ACTION, label: choice.label, value: choice.command })])
      )
    ]
  })
}

async function post(target: Pick<Thread, 'post'>, text: string, choices?: Choice[]): Promise<void> {
  await target.post(choices?.length ? withButtons(text, choices) : text)
}

/** Connects one platform through Chat SDK. */
class ChatSdkAdapter implements ChannelAdapter {
  readonly maxMessageLength = MAX_MESSAGE_LENGTH
  private readonly chat: Chat

  constructor(
    private readonly kind: ChannelKind,
    private readonly vendor: Adapter,
    private readonly extras: PlatformExtras
  ) {
    this.chat = new Chat({
      userName: BOT_USER_NAME,
      adapters: { [vendor.name]: vendor },
      // Only used for deduplication: no thread subscriptions, and the database holds the rest.
      state: createMemoryState(),
      // The default drops messages during a run, and agent runs can take minutes.
      // The channel service queues per thread instead.
      concurrency: 'concurrent',
      logger: 'silent'
    })
  }

  async start(listener: MessageListener, commands: readonly ChannelCommand[]): Promise<void> {
    const forward = async (thread: Thread, message: Message): Promise<void> => {
      listener({
        threadId: thread.id,
        userId: message.author.userId,
        displayName: message.author.fullName || message.author.userName,
        text: message.text,
        isDirect: isDirectConversation(this.kind, thread.isDM, message.raw),
        isBot: message.author.isBot === true,
        reply: (text, choices) => post(thread, text, choices)
      })
    }
    this.chat.onDirectMessage(forward)
    this.chat.onNewMention(forward)
    this.chat.onSlashCommand(async (event) => {
      listener({
        ...commandAsMessage(this.kind, event),
        reply: (text, choices) => post(event.channel, text, choices)
      })
    })
    this.chat.onAction(COMMAND_ACTION, async (event) => {
      const { thread } = event
      if (!thread) return
      listener({
        ...actionAsMessage(this.kind, event),
        reply: (text, choices) => post(thread, text, choices)
      })
    })
    await this.chat.initialize()
    // The menu is a convenience, so a failure must not keep the channel offline.
    await this.extras.publishCommands?.(commands).catch((error: unknown) => {
      console.warn(`Channel ${this.kind} could not set its command menu:`, error)
    })
  }

  /** Telegram learns its user name from getMe while it starts. Slack has no use for one here. */
  accountName(): string | null {
    if (this.kind !== 'telegram') return null
    const { userName } = this.vendor as { userName?: unknown }
    return typeof userName === 'string' && userName && userName !== 'bot' ? userName : null
  }

  async stop(): Promise<void> {
    await this.chat.shutdown()
  }
}

export const createChatSdkAdapter: ChannelAdapterFactory = async (kind, readSecret) => {
  const { vendor, extras } = await createVendorAdapter(kind, readSecret)
  return new ChatSdkAdapter(kind, vendor, extras)
}
