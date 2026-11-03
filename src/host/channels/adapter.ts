import type { ChannelKind } from '@shared/types'
import type { ChannelCommand } from './commands'

/** A button under a reply. Pressing it arrives as a message with `command` as its text. */
export interface Choice {
  label: string
  command: string
}

/** One message from a chat platform, already reduced to what the app needs. */
export interface InboundMessage {
  /** Stable id of the conversation on the platform. */
  threadId: string
  /** Stable id of the sender. Pairing is checked against this. */
  userId: string
  displayName: string
  text: string
  /**
   * True only when the platform confirms a private conversation between the sender and the bot.
   * Anything else, including a conversation of unknown type, is false and treated as shared:
   * pairing codes are refused there and a bot does not use its memory.
   */
  isDirect: boolean
  /** True when the sender is another bot. Bots are always ignored. */
  isBot: boolean
  /** Platforms without buttons send the text alone. */
  reply(text: string, choices?: Choice[]): Promise<void>
}

export type MessageListener = (message: InboundMessage) => void

/**
 * The only contract the channel service has with a chat platform.
 * It keeps vendor libraries in one file and lets tests run without a network.
 */
export interface ChannelAdapter {
  /** Longest single reply the platform accepts. */
  readonly maxMessageLength: number
  /**
   * Connects and starts delivering messages. Rejects when the connection fails. Platforms with a
   * command menu list `commands` in it.
   */
  start(listener: MessageListener, commands: readonly ChannelCommand[]): Promise<void>
  /** The bot's user name on the platform, once `start` resolved. Null when it is not known. */
  accountName?(): string | null
  stop(): Promise<void>
}

export type ReadSecret = (field: string) => Promise<string | null>

export type ChannelAdapterFactory = (
  kind: ChannelKind,
  readSecret: ReadSecret
) => Promise<ChannelAdapter>
