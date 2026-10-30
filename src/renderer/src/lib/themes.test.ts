import { describe, expect, it } from 'vitest'
import { THEME_IDS } from '@shared/types'
import { contrastRatio, isHexColor } from './colors'
import { THEMES, isThemeId, themeById, themeTokens, type ThemeDefinition } from './themes'

/** WCAG AA for body text. */
const BODY_TEXT = 4.5
/** WCAG AA for icons, borders and other non-text marks. */
const GRAPHICS = 3

const SURFACES = ['bg', 'surface', 'popover'] as const satisfies readonly (keyof ThemeDefinition)[]
const COLOR_KEYS = [
  'bg',
  'surface',
  'popover',
  'raised',
  'text',
  'muted',
  'faint',
  'accent',
  'onAccent',
  'warning',
  'success',
  'danger'
] as const satisfies readonly (keyof ThemeDefinition)[]

describe('theme registry', () => {
  it('has exactly one entry for each id', () => {
    expect(THEMES.map(({ id }) => id).sort()).toEqual([...THEME_IDS].sort())
  })

  it('uses plain hex colors for every token', () => {
    for (const theme of THEMES) {
      for (const key of COLOR_KEYS) expect(isHexColor(theme[key]), `${theme.id} ${key}`).toBe(true)
    }
  })

  it('falls back to matrix for ids saved by older versions', () => {
    expect(themeById('phosphor').id).toBe('matrix')
    expect(themeById('terminal').id).toBe('matrix')
    expect(isThemeId('phosphor')).toBe(false)
  })
})

describe.each(THEMES.map((theme) => [theme.id, theme] as const))('contrast of %s', (_, theme) => {
  it.each(SURFACES)('body text is readable on %s', (surface) => {
    expect(contrastRatio(theme.text, theme[surface])).toBeGreaterThanOrEqual(BODY_TEXT)
  })

  it('body text is readable on selected rows', () => {
    expect(contrastRatio(theme.text, theme.raised)).toBeGreaterThanOrEqual(BODY_TEXT)
  })

  it.each(SURFACES)('secondary text is readable on %s', (surface) => {
    expect(contrastRatio(theme.muted, theme[surface])).toBeGreaterThanOrEqual(BODY_TEXT)
  })

  it('text on the accent is readable', () => {
    expect(contrastRatio(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(BODY_TEXT)
  })

  it.each(['bg', 'surface'] as const)('the accent stands out on %s', (surface) => {
    expect(contrastRatio(theme.accent, theme[surface])).toBeGreaterThanOrEqual(GRAPHICS)
  })

  it.each(['danger', 'warning', 'success'] as const)('%s stands out on the background', (color) => {
    expect(contrastRatio(theme[color], theme.bg)).toBeGreaterThanOrEqual(GRAPHICS)
  })
})

describe('themeTokens', () => {
  const theme = themeById('dracula')

  it('uses solid surfaces by default', () => {
    expect(themeTokens(theme)['--bg']).toBe('#282a36')
  })

  it('makes surfaces see through and keeps text solid', () => {
    const tokens = themeTokens(theme, { windowAlpha: 0.5 })
    expect(tokens['--bg']).toContain('50%')
    expect(tokens['--text']).toBe(theme.text)
    expect(tokens['--popover']).toBe(theme.popover)
  })

  it('applies an accent override', () => {
    const tokens = themeTokens(theme, { accent: { color: '#ff0000', onColor: '#000000' } })
    expect(tokens['--accent']).toBe('#ff0000')
    expect(tokens['--on-accent']).toBe('#000000')
  })
})
