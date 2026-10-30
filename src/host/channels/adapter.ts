import type { ChannelKind } from '@shared/types'

/** One message from a chat platform, already reduced to what the app needs. */
export interface InboundMessage {
  /** Stable id of the conversation on the platform. */
  threadId: string
  /** Stable id of the sender. Pairing is checked against this. */
  userId: string
  displayName: string
  text: string
  /** True for a private conversation between the sender and the bot. */
  isDirect: boolean
  /** True when the sender is another bot. Bots are always ignored. */
  isBot: boolean
  reply(text: string): Promise<void>
}

export type MessageListener = (message: InboundMessage) => void

/**
 * The only contract the channel service has with a chat platform.
 * It keeps vendor libraries in one file and lets tests run without a network.
 */
export interface ChannelAdapter {
  /** Longest single reply the platform accepts. */
  readonly maxMessageLength: number
  /** Connects and starts delivering messages. Rejects when the connection fails. */
  start(listener: MessageListener): Promise<void>
  stop(): Promise<void>
}

export type ReadSecret = (field: string) => Promise<string | null>

export type ChannelAdapterFactory = (
  kind: ChannelKind,
  readSecret: ReadSecret
) => Promise<ChannelAdapter>
