import { describe, expect, it } from 'vitest'
import { splitMessage } from './split-message'

describe('splitMessage', () => {
  it('keeps short text whole', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello'])
  })

  it('returns nothing for blank text', () => {
    expect(splitMessage('  \n ', 100)).toEqual([])
  })

  it('prefers line breaks', () => {
    expect(splitMessage('aaaa aaaa\nbbbb', 12)).toEqual(['aaaa aaaa', 'bbbb'])
  })

  it('cuts a single long word', () => {
    expect(splitMessage('x'.repeat(25), 10)).toEqual([
      'x'.repeat(10),
      'x'.repeat(10),
      'x'.repeat(5)
    ])
  })

  it('never exceeds the limit and loses no words', () => {
    const words = Array.from({ length: 500 }, (_, index) => `word${index}`)
    const pieces = splitMessage(words.join(' '), 80)
    expect(pieces.every((piece) => piece.length <= 80)).toBe(true)
    expect(pieces.join(' ').split(' ')).toEqual(words)
  })
})
