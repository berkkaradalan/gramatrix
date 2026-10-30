import { describe, expect, it } from 'vitest'
import { errorMessage, formatAge, formatDateTime, formatJson } from './format'

describe('errorMessage', () => {
  it('removes the IPC wrapper', () => {
    const error = new Error("Error invoking remote method 'rpc': Error: Project not found")
    expect(errorMessage(error)).toBe('Project not found')
  })

  it('accepts values that are not errors', () => {
    expect(errorMessage('plain')).toBe('plain')
  })
})

describe('formatDateTime', () => {
  it('handles missing timestamps', () => {
    expect(formatDateTime(null)).toBe('Never')
  })
})

describe('formatAge', () => {
  const now = 10 * 24 * 60 * 60 * 1000

  it('picks the largest fitting unit', () => {
    expect(formatAge(now - 1000, now)).toBe('now')
    expect(formatAge(now - 5 * 60_000, now)).toBe('5m')
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3h')
    expect(formatAge(now - 2 * 86_400_000, now)).toBe('2d')
  })
})

describe('formatJson', () => {
  it('keeps strings as they are', () => {
    expect(formatJson('line one\nline two')).toBe('line one\nline two')
  })

  it('pretty prints objects', () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})
