import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessagePart } from '@shared/types'
import { toModelMessages } from './history'

function message(role: 'user' | 'assistant', parts: MessagePart[]): ChatMessage {
  return { id: 'm', chatId: 'c', role, parts, createdAt: 1 }
}

function toolCall(id: string, extra: object = {}): MessagePart {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName: 'read_file',
    input: { path: 'a' },
    output: 'result',
    state: 'completed',
    ...extra
  }
}

describe('toModelMessages', () => {
  it('converts plain text turns', () => {
    expect(
      toModelMessages([
        message('user', [{ type: 'text', text: 'hi' }]),
        message('assistant', [{ type: 'text', text: 'hello' }])
      ])
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    ])
  })

  it('splits one stored message into model steps at each tool result', () => {
    const messages = toModelMessages([
      message('assistant', [
        { type: 'text', text: 'looking' },
        toolCall('a'),
        toolCall('b'),
        { type: 'text', text: 'done' }
      ])
    ])
    expect(messages.map(({ role }) => role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(messages[1]?.content).toHaveLength(2)
  })

  it('leaves out reasoning and subagent activity', () => {
    const messages = toModelMessages([
      message('assistant', [
        { type: 'reasoning', text: 'thinking' },
        toolCall('a', { subagentId: 's' }),
        { type: 'text', text: 'done' }
      ])
    ])
    expect(messages).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }])
  })

  it('gives unfinished calls a result so providers accept the history', () => {
    const messages = toModelMessages([
      message('assistant', [toolCall('a', { output: undefined, state: 'running' })])
    ])
    expect(JSON.stringify(messages[1])).toContain('did not finish')
  })

  it('skips assistant messages with nothing to send', () => {
    expect(toModelMessages([message('assistant', [])])).toEqual([])
  })
})
