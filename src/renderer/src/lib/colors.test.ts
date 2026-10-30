import { describe, expect, it } from 'vitest'
import { contrastRatio, isHexColor, mix, readableOn, withAlpha } from './colors'

describe('contrastRatio', () => {
  it('matches the known extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1)
  })

  it('does not depend on the order', () => {
    expect(contrastRatio('#336699', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#336699'))
  })
})

describe('mix', () => {
  it('blends between two colors', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('withAlpha', () => {
  it('writes a percentage', () => {
    expect(withAlpha('#102030', 0.5)).toBe('rgb(16 32 48 / 50%)')
  })
})

describe('readableOn', () => {
  it('picks black on light colors and white on dark ones', () => {
    expect(readableOn('#ffee00')).toBe('#000000')
    expect(readableOn('#101040')).toBe('#ffffff')
  })
})

describe('isHexColor', () => {
  it('accepts six digit colors only', () => {
    expect(isHexColor('#a1B2c3')).toBe(true)
    expect(isHexColor('#abc')).toBe(false)
    expect(isHexColor('red')).toBe(false)
  })
})
