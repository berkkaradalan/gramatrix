import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { SecretBackend } from '@shared/types'

/** The part of Electron's safeStorage this store needs, so tests can supply a fake. */
export interface Cipher {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend?(): string
}

/**
 * Keeps secrets encrypted on disk with a key held by the operating system keychain.
 * Nothing here asks the user for a password: the keychain is unlocked by logging in.
 * Decrypted values stay in memory only and are never sent to the renderer.
 */
export class SecretStore {
  private encrypted: Record<string, string> = {}
  private readonly decrypted = new Map<string, string>()

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher
  ) {
    if (existsSync(filePath)) {
      this.encrypted = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>
    }
  }

  async backend(): Promise<SecretBackend> {
    if (!(await this.cipher.isAsyncEncryptionAvailable())) return 'unavailable'
    return this.cipher.getSelectedStorageBackend?.() === 'basic_text' ? 'weak' : 'keychain'
  }

  has(name: string): boolean {
    return name in this.encrypted
  }

  async get(name: string): Promise<string | null> {
    const cached = this.decrypted.get(name)
    if (cached !== undefined) return cached
    const stored = this.encrypted[name]
    if (stored === undefined) return null
    const { result, shouldReEncrypt } = await this.cipher.decryptStringAsync(
      Buffer.from(stored, 'base64')
    )
    if (shouldReEncrypt) await this.set(name, result)
    this.decrypted.set(name, result)
    return result
  }

  async set(name: string, value: string): Promise<void> {
    if ((await this.backend()) === 'unavailable') {
      throw new Error('Secret storage is not available.')
    }
    const encrypted = await this.cipher.encryptStringAsync(value)
    this.encrypted[name] = encrypted.toString('base64')
    this.decrypted.set(name, value)
    this.persist()
  }

  delete(name: string): void {
    delete this.encrypted[name]
    this.decrypted.delete(name)
    this.persist()
  }

  private persist(): void {
    // Write then rename so a crash cannot leave a truncated file, and the file
    // is never readable by other users, even briefly.
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(this.encrypted), { mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
    chmodSync(this.filePath, 0o600)
  }
}
