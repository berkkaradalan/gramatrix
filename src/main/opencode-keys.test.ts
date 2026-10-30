import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readOpencodeKey } from './opencode-keys'

function dataDirWith(contents: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'gramatrix-opencode-'))
  mkdirSync(join(dataDir, 'opencode'))
  writeFileSync(join(dataDir, 'opencode', 'auth.json'), contents)
  return dataDir
}

describe('readOpencodeKey', () => {
  it('finds an API key', () => {
    const dataDir = dataDirWith('{"zai-coding-plan":{"type":"api","key":"plan-key"}}')
    expect(readOpencodeKey('zai-coding-plan', { XDG_DATA_HOME: dataDir })).toBe('plan-key')
  })

  it('maps ids that differ between the two apps', () => {
    const dataDir = dataDirWith('{"zhipuai-coding-plan":{"type":"api","key":"plan-key"}}')
    expect(readOpencodeKey('zhipu-coding-plan', { XDG_DATA_HOME: dataDir })).toBe('plan-key')
  })

  it('ignores other sign in methods', () => {
    const dataDir = dataDirWith('{"anthropic":{"type":"oauth","access":"token"}}')
    expect(readOpencodeKey('anthropic', { XDG_DATA_HOME: dataDir })).toBeNull()
  })

  it('returns null when opencode is missing or its file is broken', () => {
    const empty = mkdtempSync(join(tmpdir(), 'gramatrix-opencode-'))
    expect(readOpencodeKey('openai', { XDG_DATA_HOME: empty })).toBeNull()
    expect(readOpencodeKey('openai', { XDG_DATA_HOME: dataDirWith('not json') })).toBeNull()
  })
})
