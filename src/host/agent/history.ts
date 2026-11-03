import type { ModelMessage } from 'ai'
import type { ChatMessage, ProviderMetadata, ToolCallPart } from '@shared/types'

type AssistantContent = Extract<ModelMessage, { role: 'assistant' }>['content']
type AssistantPart = Exclude<AssistantContent, string>[number]
type ProviderOptions = NonNullable<Extract<AssistantPart, { type: 'text' }>['providerOptions']>

export interface HistoryOptions {
  /**
   * Sends reasoning and provider data back with each assistant turn. Some providers need it to
   * continue a conversation with tools, such as DeepSeek reasoning, Gemini thought signatures and
   * xAI encrypted reasoning. Others are left as they were, without it.
   */
  replayReasoning?: boolean
  /** Rewrites tool call ids for providers that only accept one id format, such as Mistral. */
  toolCallId?: (id: string) => string
}

const NINE_CHARACTERS = /^[A-Za-z0-9]{9}$/
const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const SIXTY_FOUR_BITS = 0xffffffffffffffffn

/**
 * Mistral rejects tool call ids that are not nine letters and digits, such as the ids of a chat
 * that started with another provider. Other ids get a hash of the original, the same every time,
 * so a call and its result still match. Ids that already fit are kept.
 */
export function nineCharacterToolCallId(id: string): string {
  if (NINE_CHARACTERS.test(id)) return id
  let hash = FNV_OFFSET
  for (const byte of new TextEncoder().encode(id)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & SIXTY_FOUR_BITS
  }
  return hash.toString(36).padStart(9, '0').slice(-9)
}

function providerOptions(
  metadata: ProviderMetadata | undefined,
  { replayReasoning }: HistoryOptions
): { providerOptions?: ProviderOptions } {
  return replayReasoning && metadata ? { providerOptions: metadata as ProviderOptions } : {}
}

function toolOutput(part: ToolCallPart): string {
  if (typeof part.output === 'string') return part.output
  if (part.output !== undefined) return JSON.stringify(part.output)
  // The run ended before this call finished, but providers require a result for every call.
  return 'This tool call did not finish.'
}

function appendAssistant(
  message: ChatMessage,
  messages: ModelMessage[],
  options: HistoryOptions
): void {
  let content: AssistantPart[] = []
  let calls: ToolCallPart[] = []

  const callId = options.toolCallId ?? ((id: string) => id)
  const flush = (): void => {
    if (content.length > 0) messages.push({ role: 'assistant', content })
    if (calls.length > 0) {
      messages.push({
        role: 'tool',
        content: calls.map((call) => ({
          type: 'tool-result',
          toolCallId: callId(call.toolCallId),
          toolName: call.toolName,
          output: { type: 'text', value: toolOutput(call) }
        }))
      })
    }
    content = []
    calls = []
  }

  for (const part of message.parts) {
    // Subagent activity is never part of this conversation's context, and reasoning only is for
    // providers that ask for it back.
    if (part.type === 'text') {
      if (calls.length > 0) flush()
      content.push({
        type: 'text',
        text: part.text,
        ...providerOptions(part.providerMetadata, options)
      })
    } else if (part.type === 'reasoning' && options.replayReasoning) {
      if (calls.length > 0) flush()
      content.push({
        type: 'reasoning',
        text: part.text,
        ...providerOptions(part.providerMetadata, options)
      })
    } else if (part.type === 'tool-call' && !part.subagentId) {
      content.push({
        type: 'tool-call',
        toolCallId: callId(part.toolCallId),
        toolName: part.toolName,
        input: part.input,
        ...providerOptions(part.providerMetadata, options)
      })
      calls.push(part)
    }
  }
  flush()
}

/** Rebuilds the model conversation from stored messages. */
export function toModelMessages(
  stored: ChatMessage[],
  options: HistoryOptions = {}
): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const message of stored) {
    if (message.role === 'assistant') {
      appendAssistant(message, messages, options)
      continue
    }
    const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    messages.push({ role: 'user', content: text })
  }
  return messages
}
