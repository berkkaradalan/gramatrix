import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
import { normalizeSettings } from './settings'

function stored(patch: object): AppSettings {
  return { ...DEFAULT_SETTINGS, ...patch } as AppSettings
}

describe('normalizeSettings', () => {
  it('replaces themes that no longer exist', () => {
    expect(normalizeSettings(stored({ theme: 'phosphor' })).theme).toBe('matrix')
    expect(normalizeSettings(stored({ theme: 'terminal' })).theme).toBe('matrix')
  })

  it('keeps themes that exist', () => {
    expect(normalizeSettings(stored({ theme: 'nord' })).theme).toBe('nord')
  })

  it('completes nested groups saved by older versions', () => {
    const settings = normalizeSettings(
      stored({ code: { lineNumbers: true }, backgroundVideo: undefined })
    )
    expect(settings.code).toEqual({ ...DEFAULT_SETTINGS.code, lineNumbers: true })
    expect(settings.backgroundVideo).toEqual(DEFAULT_SETTINGS.backgroundVideo)
  })

  it('falls back to auto for an unknown code theme', () => {
    const settings = normalizeSettings(
      stored({ code: { ...DEFAULT_SETTINGS.code, theme: 'gone' } })
    )
    expect(settings.code.theme).toBe('auto')
  })
})
