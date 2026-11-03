import { describe, expect, it } from 'vitest'
import {
  DECODE_GLYPHS,
  DECODE_LEAD_MS,
  DECODE_STEP_MS,
  decodeDuration,
  decodeFrame
} from './decode-text'

const text = (frame: { character: string }[]): string =>
  frame.map(({ character }) => character).join('')

describe('decodeFrame', () => {
  it('starts as noise with the spaces in place', () => {
    const frame = decodeFrame('Hi you', 0, () => 0)
    expect(text(frame)).toBe('AA AAA')
    expect(frame.filter(({ settled }) => !settled)).toHaveLength(5)
  })

  it('settles the letters from left to right', () => {
    const frame = decodeFrame('abc', DECODE_LEAD_MS + 2 * DECODE_STEP_MS, () => 0)
    expect(frame.map(({ settled }) => settled)).toEqual([true, true, false])
    expect(text(frame).slice(0, 2)).toBe('ab')
  })

  it('shows the real text once the duration has passed', () => {
    const heading = 'What should we work on?'
    const frame = decodeFrame(heading, decodeDuration(heading))
    expect(text(frame)).toBe(heading)
    expect(frame.every(({ settled }) => settled)).toBe(true)
  })

  it('only ever shows glyphs from the set while decoding', () => {
    const frame = decodeFrame('abcdef', 0, () => 0.999)
    expect(frame.every(({ character }) => DECODE_GLYPHS.includes(character))).toBe(true)
  })
})
