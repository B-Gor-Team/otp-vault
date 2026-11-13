import * as OTPAuth from 'otpauth'

export const OTP_ALGORITHM = 'SHA1' as const
export const OTP_DIGITS = 6
export const OTP_PERIOD_SECONDS = 60
export const REFERENCE_HEX = '05a06f6c6f38fc646dbba4f39aeed9719b98d35e'

const MAX_BYTES = 128

export class SecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretError'
  }
}

export type SecretFormat = 'hex' | 'base32'

export type ParsedSecret =
  | { ok: true; base32: string; hex: string }
  | { ok: false; error: string }

export type OtpStep = {
  offset: number
  counter: number
  code: string
  validFrom: number
  validUntil: number
}

function compact(input: string): string {
  return input.replace(/[\s-]+/g, '')
}

function accepted(secret: OTPAuth.Secret, tooLong: string): ParsedSecret {
  const bytes = secret.hex.length / 2
  if (!secret.hex) {
    return { ok: false, error: 'That is not a base32 secret.' }
  }
  if (bytes > MAX_BYTES) {
    return { ok: false, error: tooLong }
  }
  return { ok: true, base32: secret.base32, hex: secret.hex }
}

export function parseSecret(input: string, format: SecretFormat): ParsedSecret {
  const compactInput = compact(input)
  if (!compactInput) return { ok: false, error: 'Enter a secret.' }

  if (format === 'hex') {
    let body = compactInput
    if (/^0x/i.test(body)) body = body.slice(2)
    if (!body) return { ok: false, error: 'Enter a secret.' }
    if (!/^[0-9a-f]+$/i.test(body)) {
      if (/^[A-Z2-7]+=*$/i.test(compactInput)) {
        return {
          ok: false,
          error: 'This looks like base32. Switch the format to Base32.',
        }
      }
      return { ok: false, error: 'That is not a hex key.' }
    }
    if (body.length % 2 !== 0) {
      return { ok: false, error: 'Hex keys need an even number of digits.' }
    }
    if (body.length / 2 > MAX_BYTES) {
      return { ok: false, error: 'That hex key is too long.' }
    }
    return accepted(OTPAuth.Secret.fromHex(body), 'That hex key is too long.')
  }

  const body = compactInput.replace(/=+$/g, '')
  if (!body) return { ok: false, error: 'Enter a secret.' }
  if (!/^[A-Z2-7]+$/i.test(body)) {
    if (/^[0-9a-f]+$/i.test(compactInput)) {
      return {
        ok: false,
        error: 'This looks like a hex key. Switch the format to Hex key.',
      }
    }
    return { ok: false, error: 'That is not a base32 secret.' }
  }

  let secret: OTPAuth.Secret
  try {
    secret = OTPAuth.Secret.fromBase32(body)
  } catch {
    return { ok: false, error: 'That is not a base32 secret.' }
  }
  return accepted(secret, 'That base32 secret is too long.')
}

function engine(base32: string): OTPAuth.TOTP {
  let secret: OTPAuth.Secret
  try {
    secret = OTPAuth.Secret.fromBase32(base32)
  } catch {
    throw new SecretError('That is not a base32 secret.')
  }
  if (!secret.hex) throw new SecretError('That is not a base32 secret.')
  return new OTPAuth.TOTP({
    algorithm: OTP_ALGORITHM,
    digits: OTP_DIGITS,
    period: OTP_PERIOD_SECONDS,
    secret,
  })
}

export function generateCode(base32: string, timestampMs: number): OtpStep {
  const counter = Math.floor(timestampMs / 1000 / OTP_PERIOD_SECONDS)
  return {
    offset: 0,
    counter,
    code: engine(base32).generate({ timestamp: timestampMs }),
    validFrom: counter * OTP_PERIOD_SECONDS * 1000,
    validUntil: (counter + 1) * OTP_PERIOD_SECONDS * 1000,
  }
}

export function generateWindow(
  base32: string,
  timestampMs: number,
  range?: { before?: number; after?: number },
): OtpStep[] {
  const before = range?.before ?? 2
  const after = range?.after ?? 5
  const current = Math.floor(timestampMs / 1000 / OTP_PERIOD_SECONDS)
  const start = Math.max(0, current - before)
  const end = current + after
  const totp = engine(base32)
  const steps: OtpStep[] = []

  for (let counter = start; counter <= end; counter += 1) {
    const validFrom = counter * OTP_PERIOD_SECONDS * 1000
    steps.push({
      offset: counter - current,
      counter,
      code: totp.generate({ timestamp: validFrom }),
      validFrom,
      validUntil: validFrom + OTP_PERIOD_SECONDS * 1000,
    })
  }

  return steps
}

export function secondsRemaining(
  timestampMs: number,
  period = OTP_PERIOD_SECONDS,
): number {
  const elapsed = Math.floor(timestampMs / 1000) % period
  return period - elapsed
}

export function groupCode(code: string): string {
  return code.replace(/(\d{3})(?=\d)/g, '$1 ')
}
