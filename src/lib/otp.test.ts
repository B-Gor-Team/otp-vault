// @vitest-environment node

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  OTP_ALGORITHM,
  OTP_DIGITS,
  OTP_PERIOD_SECONDS,
  REFERENCE_HEX,
  SecretError,
  generateCode,
  generateWindow,
  groupCode,
  parseSecret,
  secondsRemaining,
} from './otp.ts'

/**
 * Independent RFC 4226 / 6238 oracle. These expected codes were also produced by
 * pyotp.TOTP(base32, interval=60) — SHA-1, 6 digits — the same call as:
 *
 * secret = base64.b32encode(bytes.fromhex(hex_key)).decode()
 * pyotp.TOTP(secret, interval=60).now()
 */
function hotp(key: Buffer, counter: number, digits = 6): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)
  return String(binary % 10 ** digits).padStart(digits, '0')
}

const REFERENCE_BASE32 = 'AWQG63DPHD6GI3N3UTZZV3WZOGNZRU26'
const RFC_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('parseSecret', () => {
  it('base32-encodes the reference hex key the way the pyotp snippet does', () => {
    const parsed = parseSecret(
      '05A0 6F6C 6F38-FC64 6dbb a4f3 9aee d971 9b98 d35e',
      'hex',
    )
    expect(parsed).toEqual({
      ok: true,
      base32: REFERENCE_BASE32,
      hex: '05A06F6C6F38FC646DBBA4F39AEED9719B98D35E',
    })
  })

  it('accepts a 0x prefix', () => {
    const parsed = parseSecret(`0x${REFERENCE_HEX}`, 'hex')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.base32).toBe(REFERENCE_BASE32)
  })

  it('accepts base32 in any case, with or without padding', () => {
    const lower = parseSecret(REFERENCE_BASE32.toLowerCase(), 'base32')
    const padded = parseSecret('VI======', 'base32')
    expect(lower).toMatchObject({ ok: true, base32: REFERENCE_BASE32 })
    expect(padded).toMatchObject({ ok: true, base32: 'VI', hex: 'AA' })
  })

  it('rejects empty, odd, oversized, and non-alphabet input', () => {
    expect(parseSecret('   ', 'hex')).toEqual({
      ok: false,
      error: 'Enter a secret.',
    })
    expect(parseSecret('abc', 'hex')).toEqual({
      ok: false,
      error: 'Hex keys need an even number of digits.',
    })
    expect(parseSecret('ab'.repeat(129), 'hex')).toEqual({
      ok: false,
      error: 'That hex key is too long.',
    })
    expect(parseSecret('zz!!', 'hex')).toEqual({
      ok: false,
      error: 'That is not a hex key.',
    })
    expect(parseSecret('A', 'base32')).toEqual({
      ok: false,
      error: 'That is not a base32 secret.',
    })
    expect(parseSecret('hello!', 'base32')).toEqual({
      ok: false,
      error: 'That is not a base32 secret.',
    })
    expect(parseSecret('====', 'base32')).toEqual({
      ok: false,
      error: 'Enter a secret.',
    })
    expect(parseSecret('0x', 'hex')).toEqual({
      ok: false,
      error: 'Enter a secret.',
    })
    expect(parseSecret('A'.repeat(300), 'base32')).toEqual({
      ok: false,
      error: 'That base32 secret is too long.',
    })
  })

  it('points at the other format when the pasted key is unambiguous', () => {
    const asHex = parseSecret(REFERENCE_BASE32, 'hex')
    const asBase32 = parseSecret(REFERENCE_HEX, 'base32')
    const oddHex = parseSecret('058', 'base32')
    expect(asHex.ok).toBe(false)
    expect(asBase32.ok).toBe(false)
    expect(oddHex.ok).toBe(false)
    if (!asHex.ok) expect(asHex.error).toMatch(/Base32/)
    if (!asBase32.ok) expect(asBase32.error).toMatch(/Hex key/)
    if (!oddHex.ok) expect(oddHex.error).toMatch(/Hex key/)
  })
})

describe('TOTP', () => {
  it('uses the pyotp defaults from the snippet: SHA-1, 6 digits, 60 seconds', () => {
    expect(OTP_ALGORITHM).toBe('SHA1')
    expect(OTP_DIGITS).toBe(6)
    expect(OTP_PERIOD_SECONDS).toBe(60)
    expect(REFERENCE_HEX).toBe('05a06f6c6f38fc646dbba4f39aeed9719b98d35e')
  })

  it('matches pyotp and an independent HMAC oracle for the reference key', () => {
    const key = Buffer.from(REFERENCE_HEX, 'hex')
    const pins: Record<number, string> = {
      0: '156893',
      59: '156893',
      60: '075853',
      61: '075853',
      119: '075853',
      120: '301699',
      1111111111: '921512',
      1700000000: '026209',
      1730000000: '964388',
      1762272000: '623264',
    }

    for (const [stamp, code] of Object.entries(pins)) {
      const seconds = Number(stamp)
      const counter = Math.floor(seconds / 60)
      expect(hotp(key, counter)).toBe(code)
      expect(generateCode(REFERENCE_BASE32, seconds * 1000)).toMatchObject({
        offset: 0,
        counter,
        code,
        validFrom: counter * 60 * 1000,
        validUntil: (counter + 1) * 60 * 1000,
      })
    }
  })

  it('matches pyotp for the RFC secret and a one-byte key at a 60-second step', () => {
    expect(generateCode(RFC_BASE32, 59_000).code).toBe('755224')
    expect(generateCode(RFC_BASE32, 60_000).code).toBe('287082')
    expect(generateCode(RFC_BASE32, 1_111_111_109_000).code).toBe('360094')
    expect(generateCode(RFC_BASE32, 1_234_567_890_000).code).toBe('713351')
    expect(generateCode(RFC_BASE32, 2_000_000_000_000).code).toBe('864010')
    expect(generateCode(RFC_BASE32, 1_700_000_000_000).code).toBe('895298')
    expect(generateCode('VI', 1_700_000_000_000).code).toBe('997370')
    expect(hotp(Buffer.from('aa', 'hex'), Math.floor(1_700_000_000 / 60))).toBe(
      '997370',
    )
  })

  it('throws when a stored secret cannot be decoded', () => {
    expect(() => generateCode('!!!', 0)).toThrow(SecretError)
    expect(() => generateCode('A', 0)).toThrow(SecretError)
  })

  it('lists the codes around the current minute, clamped at the epoch', () => {
    const steps = generateWindow(REFERENCE_BASE32, 1_700_000_000_000)
    expect(steps.map((step) => step.offset)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5])
    expect(steps.map((step) => step.code)).toEqual([
      '686338',
      '386285',
      '026209',
      '249559',
      '787174',
      '372218',
      '130228',
      '786723',
    ])

    const early = generateWindow(REFERENCE_BASE32, 30_000, {
      before: 2,
      after: 5,
    })
    expect(early.map((step) => step.offset)).toEqual([0, 1, 2, 3, 4, 5])
    expect(early[0]?.counter).toBe(0)
  })

  it('counts a full minute at the opening of a window and one second at the end', () => {
    // 1_700_000_000 % 60 === 20, so that instant is 20s into its step.
    expect(secondsRemaining(1_699_999_980_000)).toBe(60)
    expect(secondsRemaining(1_700_000_000_000)).toBe(40)
    expect(secondsRemaining(1_700_000_010_000)).toBe(30)
    expect(secondsRemaining(1_700_000_039_000)).toBe(1)
    expect(secondsRemaining(1_700_000_040_000)).toBe(60)
  })

  it('groups a code into two halves', () => {
    expect(groupCode('026209')).toBe('026 209')
    expect(groupCode('156893')).toBe('156 893')
  })
})
