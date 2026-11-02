import { describe, expect, it } from 'vitest'
import type { BotMemory, ToolCallPart } from '@shared/types'
import {
  botInitial,
  describeMemoryCall,
  memoryOverflow,
  memoryUsage,
  readableMemoryError,
  soulPreview
} from './bots'

function memory(id: string, kind: BotMemory['kind'], content: string): BotMemory {
  return { id, botId: 'b1', kind, content, createdAt: 1, updatedAt: 1 }
}

function call(input: unknown, state: ToolCallPart['state'], output?: string): ToolCallPart {
  return { type: 'tool-call', toolCallId: 't1', toolName: 'memory', input, output, state }
}

describe('memoryUsage', () => {
  it('counts only the asked kind against its limit', () => {
    const memories = [memory('1', 'user', 'Name is Ada'), memory('2', 'notes', 'Uses pnpm')]
    expect(memoryUsage(memories, 'user')).toEqual({ used: 11, limit: 1375, ratio: 11 / 1375 })
  })

  it('never reports more than full', () => {
    expect(memoryUsage([memory('1', 'user', 'x'.repeat(2000))], 'user').ratio).toBe(1)
  })
})

describe('memoryOverflow', () => {
  const memories = [memory('1', 'user', 'x'.repeat(1370))]

  it('is zero when a draft fits', () => {
    expect(memoryOverflow(memories, 'user', '  12345  ')).toBe(0)
  })

  it('says how many characters are too many', () => {
    expect(memoryOverflow(memories, 'user', '1234567')).toBe(2)
  })

  it('does not count the entry being replaced', () => {
    expect(memoryOverflow(memories, 'user', 'short', memories[0])).toBe(0)
  })
})

describe('describeMemoryCall', () => {
  it('describes a saved entry', () => {
    const view = describeMemoryCall(
      call({ action: 'add', kind: 'user', content: 'Prefers tabs' }, 'completed', 'Done.')
    )
    expect(view).toMatchObject({
      label: 'Saved to memory',
      kindLabel: 'About you',
      content: 'Prefers tabs',
      error: null,
      failed: false
    })
  })

  it('shows the old text of a replaced entry', () => {
    const view = describeMemoryCall(
      call({ action: 'replace', kind: 'notes', oldText: 'npm', content: 'Uses pnpm' }, 'completed')
    )
    expect(view).toMatchObject({ label: 'Updated memory', previous: 'npm', content: 'Uses pnpm' })
  })

  it('shows what was removed', () => {
    const view = describeMemoryCall(
      call({ action: 'remove', kind: 'notes', oldText: 'old fact' }, 'running')
    )
    expect(view).toMatchObject({ label: 'Removing from memory', content: 'old fact' })
  })

  it('shows the error without its prefix', () => {
    const view = describeMemoryCall(
      call({ action: 'add', kind: 'user', content: 'x' }, 'failed', 'Error: The memory is full.')
    )
    expect(view).toMatchObject({
      label: 'Could not save to memory',
      error: 'The memory is full.',
      failed: true
    })
  })

  it('treats an error output as a failure', () => {
    const view = describeMemoryCall(call({ action: 'add' }, 'completed', 'Error: Nope.'))
    expect(view.failed).toBe(true)
  })

  it('copes with input that is still streaming', () => {
    expect(describeMemoryCall(call(undefined, 'running'))).toMatchObject({
      label: 'Saving to memory',
      kindLabel: null,
      content: ''
    })
  })
})

describe('labels', () => {
  it('picks one letter for an avatar', () => {
    expect(botInitial('  ada')).toBe('A')
    expect(botInitial('')).toBe('?')
  })

  it('previews the first line of a soul', () => {
    expect(soulPreview('\nCalm and direct.\nAnswer briefly.')).toBe('Calm and direct.')
  })
})

describe('readableMemoryError', () => {
  it('keeps the first line of a full memory error and names the group as the page does', () => {
    const message = [
      'The "user" memory is full: 1370 of 1375 characters are used and this needs 10 more. ' +
        'Remove or shorten entries first. Current entries:',
      '- Name is Ada'
    ].join('\n')
    expect(readableMemoryError(message)).toBe(
      'The "About you" memory is full: 1370 of 1375 characters are used and this needs 10 more. ' +
        'Remove or shorten entries first.'
    )
  })

  it('has a fallback for an empty message', () => {
    expect(readableMemoryError('Error: ')).toBe('The memory did not change.')
  })
})
