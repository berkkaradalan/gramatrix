import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore, type Cipher } from './secret-store'

const reversingCipher: Cipher = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text) => Buffer.from([...text].reverse().join('')),
  decryptStringAsync: async (data) => ({
    result: [...data.toString()].reverse().join(''),
    shouldReEncrypt: false
  })
}

function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'gramatrix-secrets-')), 'secrets.json')
}

describe('SecretStore', () => {
  it('round trips a secret across instances', async () => {
    const path = storePath()
    await new SecretStore(path, reversingCipher).set('provider:openai', 'sk-test')
    expect(await new SecretStore(path, reversingCipher).get('provider:openai')).toBe('sk-test')
  })

  it('never writes the plain value to disk', async () => {
    const path = storePath()
    await new SecretStore(path, reversingCipher).set('provider:openai', 'sk-test')
    expect(readFileSync(path, 'utf8')).not.toContain('sk-test')
  })

  it('restricts the file to the current user', async () => {
    const path = storePath()
    await new SecretStore(path, reversingCipher).set('a', 'b')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('removes deleted secrets', async () => {
    const store = new SecretStore(storePath(), reversingCipher)
    await store.set('a', 'b')
    store.delete('a')
    expect(store.has('a')).toBe(false)
    expect(await store.get('a')).toBeNull()
  })

  it('reports the Linux fallback as weak', async () => {
    const cipher = { ...reversingCipher, getSelectedStorageBackend: () => 'basic_text' }
    expect(await new SecretStore(storePath(), cipher).backend()).toBe('weak')
  })

  it('refuses to store secrets when encryption is unavailable', async () => {
    const cipher = { ...reversingCipher, isAsyncEncryptionAvailable: async () => false }
    await expect(new SecretStore(storePath(), cipher).set('a', 'b')).rejects.toThrow()
  })

  it('encrypts again when the key has rotated', async () => {
    const path = storePath()
    await new SecretStore(path, reversingCipher).set('a', 'b')
    const before = readFileSync(path, 'utf8')
    const rotating: Cipher = {
      ...reversingCipher,
      encryptStringAsync: async () => Buffer.from('rotated'),
      decryptStringAsync: async () => ({ result: 'b', shouldReEncrypt: true })
    }
    expect(await new SecretStore(path, rotating).get('a')).toBe('b')
    expect(readFileSync(path, 'utf8')).not.toBe(before)
  })
})
