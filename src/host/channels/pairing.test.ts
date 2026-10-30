import { describe, expect, it } from 'vitest'
import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS_PER_CHANNEL,
  MAX_FAILED_ATTEMPTS_PER_USER,
  PAIRING_CODE_TTL_MS,
  PairingCodes,
  parsePairingCode
} from './pairing'

const WRONG_CODE = 'AAAAAAAA'

function setup(): { codes: PairingCodes; advance(milliseconds: number): void } {
  let time = 0
  return {
    codes: new PairingCodes(() => time),
    advance: (milliseconds) => {
      time += milliseconds
    }
  }
}

describe('parsePairingCode', () => {
  it('accepts a bare code, a /pair command and lower case', () => {
    expect(parsePairingCode('ABCD2345')).toBe('ABCD2345')
    expect(parsePairingCode('  /pair abcd2345 ')).toBe('ABCD2345')
  })

  it.each(['hello there', 'ABC', 'ABCD23456', 'ABCD234O', ''])('ignores "%s"', (text) => {
    expect(parsePairingCode(text)).toBeNull()
  })
})

describe('PairingCodes', () => {
  it('creates a different eight character code each time', () => {
    const { codes } = setup()
    const first = codes.create('telegram')
    expect(first).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(codes.create('telegram')).not.toBe(first)
  })

  it('accepts a code once', () => {
    const { codes } = setup()
    const code = codes.create('telegram')
    expect(codes.redeem('telegram', 'alice', code)).toBe('paired')
    expect(codes.redeem('telegram', 'bob', code)).toBe('invalid')
  })

  it('rejects an expired code', () => {
    const { codes, advance } = setup()
    const code = codes.create('telegram')
    advance(PAIRING_CODE_TTL_MS)
    expect(codes.redeem('telegram', 'alice', code)).toBe('invalid')
  })

  it('invalidates the previous code when a new one is created', () => {
    const { codes } = setup()
    const first = codes.create('telegram')
    codes.create('telegram')
    expect(codes.redeem('telegram', 'alice', first)).toBe('invalid')
  })

  it('does not accept a code for another channel', () => {
    const { codes } = setup()
    const code = codes.create('telegram')
    expect(codes.redeem('slack', 'alice', code)).toBe('invalid')
  })

  it('burns a code found inside exposed text', () => {
    const { codes } = setup()
    const code = codes.create('telegram')
    expect(codes.burnIfExposed('telegram', `@bot please use ${code.toLowerCase()}.`)).toBe(true)
    expect(codes.redeem('telegram', 'alice', code)).toBe('invalid')
  })

  it('leaves the code alone when exposed text does not contain it', () => {
    const { codes } = setup()
    const code = codes.create('telegram')
    expect(codes.burnIfExposed('telegram', 'building a thing')).toBe(false)
    expect(codes.redeem('telegram', 'alice', code)).toBe('paired')
  })

  it('does not count exposed text as failed attempts', () => {
    const { codes } = setup()
    codes.create('telegram')
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS_PER_CHANNEL; attempt++) {
      codes.burnIfExposed('telegram', WRONG_CODE)
    }
    expect(codes.isLocked('telegram', 'alice')).toBe(false)
  })

  it('locks a sender after repeated wrong codes, even for the right code', () => {
    const { codes } = setup()
    const code = codes.create('telegram')
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS_PER_USER; attempt++) {
      expect(codes.redeem('telegram', 'mallory', WRONG_CODE)).toBe('invalid')
    }
    expect(codes.redeem('telegram', 'mallory', WRONG_CODE)).toBe('locked')
    expect(codes.redeem('telegram', 'mallory', code)).toBe('locked')
    expect(codes.redeem('telegram', 'alice', code)).toBe('paired')
  })

  it('lifts a lockout after it expires', () => {
    const { codes, advance } = setup()
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS_PER_USER; attempt++) {
      codes.redeem('telegram', 'mallory', WRONG_CODE)
    }
    advance(LOCKOUT_MS)
    expect(codes.isLocked('telegram', 'mallory')).toBe(false)
  })

  it('locks the channel when many senders fail, until the owner creates a new code', () => {
    const { codes } = setup()
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS_PER_CHANNEL; attempt++) {
      codes.redeem('telegram', `sender-${attempt}`, WRONG_CODE)
    }
    expect(codes.isLocked('telegram', 'alice')).toBe(true)
    const code = codes.create('telegram')
    expect(codes.redeem('telegram', 'alice', code)).toBe('paired')
  })
})
