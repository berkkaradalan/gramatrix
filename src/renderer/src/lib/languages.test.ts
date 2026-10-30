import { describe, expect, it } from 'vitest'
import { languageFromPath, resolveLanguage } from './languages'

describe('resolveLanguage', () => {
  it('accepts names and aliases in any case', () => {
    expect(resolveLanguage('TypeScript')).toBe('typescript')
    expect(resolveLanguage('ts')).toBe('typescript')
    expect(resolveLanguage('sh')).toBe('bash')
  })

  it('falls back to plain text', () => {
    expect(resolveLanguage('cobol')).toBeNull()
    expect(resolveLanguage(undefined)).toBeNull()
    expect(resolveLanguage('')).toBeNull()
  })
})

describe('languageFromPath', () => {
  it('uses the extension', () => {
    expect(languageFromPath('src/host/job-service.test.ts')).toBe('typescript')
    expect(languageFromPath('a/b.PY')).toBe('python')
  })

  it('knows files without an extension', () => {
    expect(languageFromPath('deploy/Dockerfile')).toBe('dockerfile')
    expect(languageFromPath('LICENSE')).toBeNull()
  })
})
