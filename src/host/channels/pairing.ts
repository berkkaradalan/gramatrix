import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { ChannelKind } from '@shared/types'

export const PAIRING_CODE_TTL_MS = 10 * 60_000
/** Wrong codes one sender may try before being locked out. */
export const MAX_FAILED_ATTEMPTS_PER_USER = 5
/** Wrong codes from all senders together, to stop one attacker using many accounts. */
export const MAX_FAILED_ATTEMPTS_PER_CHANNEL = 20
export const LOCKOUT_MS = 15 * 60_000

// No 0, O, 1 or I, so a code survives being read from one screen and typed on another.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

const CODE_PATTERN = new RegExp(`^(?:/pair\\s+)?([${CODE_ALPHABET}]{${CODE_LENGTH}})$`, 'i')

// A group message usually carries a bot mention too, so the code can sit anywhere in the text.
const EMBEDDED_CODE_PATTERN = new RegExp(
  `(?<![A-Z0-9])[${CODE_ALPHABET}]{${CODE_LENGTH}}(?![A-Z0-9])`,
  'gi'
)

function digest(code: string): Buffer {
  return createHash('sha256').update(code).digest()
}

/** Returns the code when `text` looks like a pairing attempt, otherwise null. */
export function parsePairingCode(text: string): string | null {
  return CODE_PATTERN.exec(text.trim())?.[1]?.toUpperCase() ?? null
}

interface FailureWindow {
  count: number
  windowEndsAt: number
  lockedUntil: number
}

export type PairingResult = 'paired' | 'invalid' | 'locked'

/**
 * Single use pairing codes and the limits around them. State lives in memory on
 * purpose: restarting the app cancels every code, which is the safe direction.
 */
export class PairingCodes {
  private readonly codes = new Map<ChannelKind, { digest: Buffer; expiresAt: number }>()
  private readonly userFailures = new Map<string, FailureWindow>()
  private readonly channelFailures = new Map<ChannelKind, FailureWindow>()

  constructor(private readonly now: () => number) {}

  /** Replaces any earlier code. The owner asking for one also lifts a channel wide lockout. */
  create(kind: ChannelKind): string {
    let code = ''
    for (let index = 0; index < CODE_LENGTH; index++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    }
    this.codes.set(kind, { digest: digest(code), expiresAt: this.now() + PAIRING_CODE_TTL_MS })
    this.channelFailures.delete(kind)
    return code
  }

  /**
   * Cancels the active code if it appears anywhere in `text`, and reports whether it did.
   * Used for text other people can read. It never counts as a failed attempt, because
   * ordinary words can have the shape of a code.
   */
  burnIfExposed(kind: ChannelKind, text: string): boolean {
    const pending = this.codes.get(kind)
    if (!pending || pending.expiresAt <= this.now()) return false
    const candidates = text.match(EMBEDDED_CODE_PATTERN) ?? []
    const exposed = candidates.some((candidate) =>
      timingSafeEqual(pending.digest, digest(candidate.toUpperCase()))
    )
    if (exposed) this.codes.delete(kind)
    return exposed
  }

  isLocked(kind: ChannelKind, userId: string): boolean {
    const now = this.now()
    return (
      (this.channelFailures.get(kind)?.lockedUntil ?? 0) > now ||
      (this.userFailures.get(`${kind}:${userId}`)?.lockedUntil ?? 0) > now
    )
  }

  redeem(kind: ChannelKind, userId: string, attempt: string): PairingResult {
    if (this.isLocked(kind, userId)) return 'locked'
    const pending = this.codes.get(kind)
    const attemptDigest = digest(attempt)
    // Hashing first gives both sides the same length, which timingSafeEqual needs.
    const matches = pending ? timingSafeEqual(pending.digest, attemptDigest) : false
    if (pending && matches && pending.expiresAt > this.now()) {
      this.codes.delete(kind)
      this.userFailures.delete(`${kind}:${userId}`)
      return 'paired'
    }
    this.recordFailure(kind, userId)
    return this.isLocked(kind, userId) ? 'locked' : 'invalid'
  }

  private recordFailure(kind: ChannelKind, userId: string): void {
    this.bump(this.userFailures, `${kind}:${userId}`, MAX_FAILED_ATTEMPTS_PER_USER)
    this.bump(this.channelFailures, kind, MAX_FAILED_ATTEMPTS_PER_CHANNEL)
  }

  private bump<K>(windows: Map<K, FailureWindow>, key: K, limit: number): void {
    const now = this.now()
    let window = windows.get(key)
    if (!window || window.windowEndsAt <= now) {
      window = { count: 0, windowEndsAt: now + LOCKOUT_MS, lockedUntil: 0 }
      windows.set(key, window)
    }
    window.count += 1
    if (window.count >= limit) window.lockedUntil = now + LOCKOUT_MS
  }
}
