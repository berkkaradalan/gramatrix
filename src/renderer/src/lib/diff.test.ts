import { describe, expect, it } from 'vitest'
import { diffLines } from './diff'

describe('diffLines', () => {
  it('marks changed lines and keeps the rest', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a', oldIndex: 0, newIndex: 0 },
      { kind: 'removed', text: 'b', oldIndex: 1 },
      { kind: 'added', text: 'x', newIndex: 1 },
      { kind: 'same', text: 'c', oldIndex: 2, newIndex: 2 }
    ])
  })

  it('handles an empty side', () => {
    expect(diffLines('', 'a')).toEqual([
      { kind: 'removed', text: '', oldIndex: 0 },
      { kind: 'added', text: 'a', newIndex: 0 }
    ])
  })

  it('falls back to a full replacement for huge inputs', () => {
    const before = Array.from({ length: 1000 }, (_, index) => `old ${index}`).join('\n')
    const after = Array.from({ length: 1000 }, (_, index) => `new ${index}`).join('\n')
    const lines = diffLines(before, after)
    expect(lines).toHaveLength(2000)
    expect(lines[0]?.kind).toBe('removed')
  })
})
