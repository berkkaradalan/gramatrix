import type { ChatMessage, PermissionMode, UsageSource } from '@shared/types'

export interface HeadlessRunInput {
  chatId: string
  text: string
  /** Overrides the mode stored on the chat. */
  permissionMode?: PermissionMode
  signal?: AbortSignal
  /** What the model calls of this run count as in usage reports. */
  source: Exclude<UsageSource, 'chat' | 'subagent'>
}

export interface HeadlessRunResult {
  /** Final assistant text. */
  text: string
  message: ChatMessage
}

/**
 * Runs an agent with nobody watching. Used by schedules and chat channels.
 * Any action that would need an approval is denied instead of waiting.
 */
export interface AgentRunner {
  runHeadless(input: HeadlessRunInput): Promise<HeadlessRunResult>
}
