import type { ModelMessage } from 'ai'
import type { ChatMessage, ToolCallPart } from '@shared/types'

type AssistantContent = Extract<ModelMessage, { role: 'assistant' }>['content']
type AssistantPart = Exclude<AssistantContent, string>[number]

function toolOutput(part: ToolCallPart): string {
  if (typeof part.output === 'string') return part.output
  if (part.output !== undefined) return JSON.stringify(part.output)
  // The run ended before this call finished, but providers require a result for every call.
  return 'This tool call did not finish.'
}

function appendAssistant(message: ChatMessage, messages: ModelMessage[]): void {
  let content: AssistantPart[] = []
  let calls: ToolCallPart[] = []

  const flush = (): void => {
    if (content.length > 0) messages.push({ role: 'assistant', content })
    if (calls.length > 0) {
      messages.push({
        role: 'tool',
        content: calls.map((call) => ({
          type: 'tool-result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: 'text', value: toolOutput(call) }
        }))
      })
    }
    content = []
    calls = []
  }

  for (const part of message.parts) {
    // Reasoning and subagent activity are never part of this conversation's context.
    if (part.type === 'text') {
      if (calls.length > 0) flush()
      content.push({ type: 'text', text: part.text })
    } else if (part.type === 'tool-call' && !part.subagentId) {
      content.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input
      })
      calls.push(part)
    }
  }
  flush()
}

/** Rebuilds the model conversation from stored messages. */
export function toModelMessages(stored: ChatMessage[]): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const message of stored) {
    if (message.role === 'assistant') {
      appendAssistant(message, messages)
      continue
    }
    const text = message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    messages.push({ role: 'user', content: text })
  }
  return messages
}
