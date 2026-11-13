// @vitest-environment node

import * as OTPAuth from 'otpauth'
import { describe, expect, it } from 'vitest'
import { SecretError } from './otp.ts'
import {
  MAX_TOKENS,
  STORAGE_KEY,
  addToken,
  createEmptyVault,
  parseVault,
  readVault,
  removeToken,
  setActiveToken,
  writeVault,
} from './vault.ts'

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

function byteSecret(index: number): string {
  return OTPAuth.Secret.fromHex(index.toString(16).padStart(2, '0')).base32
}

describe('vault storage', () => {
  it('starts empty', () => {
    expect(createEmptyVault()).toEqual({
      version: 1,
      tokens: [],
      activeId: null,
    })
    expect(STORAGE_KEY).toBe('meridian.vault.v1')
  })

  it('drops malformed payloads and keeps valid tokens', () => {
    expect(parseVault(null)).toEqual(createEmptyVault())
    expect(parseVault('not-json')).toEqual(createEmptyVault())
    expect(parseVault('42')).toEqual(createEmptyVault())
    expect(parseVault('true')).toEqual(createEmptyVault())
    expect(parseVault(JSON.stringify({ version: 2, tokens: [] }))).toEqual(
      createEmptyVault(),
    )
    expect(parseVault(JSON.stringify({ version: 1, tokens: 'nope' }))).toEqual(
      createEmptyVault(),
    )

    const parsed = parseVault(
      JSON.stringify({
        version: 1,
        activeId: 'missing',
        tokens: [
          null,
          'nope',
          { id: '', label: 'x', secretBase32: 'VI', createdAt: 1 },
          { id: 'blank', label: '   ', secretBase32: 'VI', createdAt: 1 },
          { id: 'empty-secret', label: 'Kept', secretBase32: '', createdAt: 1 },
          { id: 'bad-time', label: 'Kept', secretBase32: 'VI', createdAt: 'nope' },
          { id: 'good', label: 'Lab', secretBase32: 'VI', createdAt: 4 },
          { id: 'good', label: 'Duplicate', secretBase32: 'AA', createdAt: 5 },
        ],
      }),
    )

    expect(parsed.tokens).toEqual([
      { id: 'good', label: 'Lab', secretBase32: 'VI', createdAt: 4 },
    ])
    expect(parsed.activeId).toBe('good')
  })

  it('keeps a known active id and falls back when it is stale', () => {
    const raw = JSON.stringify({
      version: 1,
      activeId: 'b',
      tokens: [
        { id: 'a', label: 'One', secretBase32: 'VI', createdAt: 1 },
        { id: 'b', label: 'Two', secretBase32: 'AA', createdAt: 2 },
      ],
    })
    expect(parseVault(raw).activeId).toBe('b')
    expect(
      parseVault(
        JSON.stringify({
          version: 1,
          activeId: null,
          tokens: [{ id: 'a', label: 'One', secretBase32: 'VI', createdAt: 1 }],
        }),
      ).activeId,
    ).toBe('a')
    expect(parseVault(raw.replace('"b"', '"gone"')).activeId).toBe('a')
  })

  it('adds, switches, and removes keys', () => {
    const first = addToken(createEmptyVault(), {
      id: 'one',
      label: '  Lab   bench ',
      base32: 'VI======',
      now: 10,
    })
    expect(first.tokens).toEqual([
      { id: 'one', label: 'Lab bench', secretBase32: 'VI', createdAt: 10 },
    ])
    expect(first.activeId).toBe('one')

    const second = addToken(first, {
      id: 'two',
      label: 'RFC',
      base32: 'AA',
      now: 11,
    })
    expect(second.tokens.map((token) => token.id)).toEqual(['two', 'one'])
    expect(second.activeId).toBe('two')

    expect(setActiveToken(second, 'one').activeId).toBe('one')
    expect(setActiveToken(second, 'two')).toBe(second)
    expect(setActiveToken(second, 'missing')).toBe(second)

    const removedActive = removeToken(second, 'two')
    expect(removedActive.tokens.map((token) => token.id)).toEqual(['one'])
    expect(removedActive.activeId).toBe('one')

    const removedOther = removeToken(second, 'one')
    expect(removedOther.tokens.map((token) => token.id)).toEqual(['two'])
    expect(removedOther.activeId).toBe('two')
    expect(removeToken(second, 'missing')).toBe(second)
    expect(removeToken(first, 'one')).toEqual({
      version: 1,
      tokens: [],
      activeId: null,
    })
  })

  it('uses crypto.randomUUID when it exists', () => {
    const vault = addToken(createEmptyVault(), { label: 'Lab', base32: 'VI', now: 1 })
    expect(vault.tokens[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('assigns an id when crypto.randomUUID is missing', () => {
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
    try {
      const vault = addToken(createEmptyVault(), { label: 'Lab', base32: 'VI', now: 1 })
      expect(vault.tokens[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID
    }
  })

  it('rejects blank names, long names, duplicates, invalid secrets, and a full vault', () => {
    const vault = addToken(createEmptyVault(), {
      id: 'one',
      label: 'Lab',
      base32: 'VI',
      now: 1,
    })

    expect(() => addToken(vault, { label: '   ', base32: 'AA', now: 1 })).toThrow(
      'Name this key.',
    )
    expect(() =>
      addToken(vault, { label: 'a'.repeat(49), base32: 'AA', now: 1 }),
    ).toThrow('That name is too long.')
    expect(() => addToken(vault, { label: 'Again', base32: 'vi', now: 1 })).toThrow(
      'That secret is already on this device.',
    )
    expect(() => addToken(vault, { label: 'Bad', base32: '!!!', now: 1 })).toThrow(
      SecretError,
    )

    let filled = createEmptyVault()
    for (let index = 0; index < MAX_TOKENS; index += 1) {
      filled = addToken(filled, {
        id: `id-${index}`,
        label: `Key ${index}`,
        base32: byteSecret(index),
        now: index,
      })
    }
    expect(filled.tokens).toHaveLength(20)
    expect(() =>
      addToken(filled, { label: 'Overflow', base32: byteSecret(20), now: 99 }),
    ).toThrow('This device vault holds 20 keys. Remove one to add another.')
  })

  it('round-trips through local storage and survives a storage read failure', () => {
    const storage = memoryStorage({ other: 'keep' })
    const vault = addToken(createEmptyVault(), {
      id: 'one',
      label: 'Lab',
      base32: 'VI',
      now: 3,
    })
    writeVault(storage, vault)
    expect(storage.getItem('other')).toBe('keep')
    expect(readVault(storage)).toEqual(vault)
    expect(storage.getItem(STORAGE_KEY)).toContain('"Lab"')

    expect(
      readVault({
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => {},
        removeItem: () => {},
      }),
    ).toEqual(createEmptyVault())
  })
})
