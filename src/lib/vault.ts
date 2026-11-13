import { SecretError, parseSecret } from './otp.ts'

export const STORAGE_KEY = 'meridian.vault.v1'
export const MAX_TOKENS = 20
const MAX_LABEL = 48

export class VaultError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

export type TokenRecord = {
  id: string
  label: string
  secretBase32: string
  createdAt: number
}

export type VaultFile = {
  version: 1
  tokens: TokenRecord[]
  activeId: string | null
}

export type KeyValueStore = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void | Promise<void>
  removeItem: (key: string) => void | Promise<void>
  hydrate?: () => Promise<void>
}

export function createEmptyVault(): VaultFile {
  return { version: 1, tokens: [], activeId: null }
}

// iPhone Safari omits crypto.randomUUID on http:// LAN addresses. getRandomValues
// is still available there, and on older Safari releases.
export function createTokenId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseVault(raw: string | null): VaultFile {
  if (!raw) return createEmptyVault()

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return createEmptyVault()
  }

  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.tokens)) {
    return createEmptyVault()
  }

  const tokens: TokenRecord[] = []
  const seen = new Set<string>()
  for (const entry of data.tokens) {
    if (!isRecord(entry)) continue
    const { id, label, secretBase32, createdAt } = entry
    if (typeof id !== 'string' || id.length === 0) continue
    if (typeof label !== 'string' || label.trim().length === 0) continue
    if (typeof secretBase32 !== 'string' || secretBase32.length === 0) continue
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue
    if (seen.has(id)) continue
    seen.add(id)
    tokens.push({ id, label: label.trim(), secretBase32, createdAt })
  }

  if (tokens.length === 0) return createEmptyVault()

  const requested = typeof data.activeId === 'string' ? data.activeId : null
  const activeId = tokens.some((token) => token.id === requested)
    ? requested
    : tokens[0]!.id

  return { version: 1, tokens, activeId }
}

export function addToken(
  vault: VaultFile,
  input: { id?: string; label: string; base32: string; now: number },
): VaultFile {
  const label = input.label.replace(/\s+/g, ' ').trim()
  if (!label) throw new VaultError('Name this key.')
  if (label.length > MAX_LABEL) throw new VaultError('That name is too long.')

  const parsed = parseSecret(input.base32, 'base32')
  if (!parsed.ok) throw new SecretError(parsed.error)
  if (vault.tokens.some((token) => token.secretBase32 === parsed.base32)) {
    throw new VaultError('That secret is already on this device.')
  }
  if (vault.tokens.length >= MAX_TOKENS) {
    throw new VaultError(
      'This device vault holds 20 keys. Remove one to add another.',
    )
  }

  const token: TokenRecord = {
    id: input.id ?? createTokenId(),
    label,
    secretBase32: parsed.base32,
    createdAt: input.now,
  }

  return {
    version: 1,
    tokens: [token, ...vault.tokens],
    activeId: token.id,
  }
}

export function setActiveToken(vault: VaultFile, id: string): VaultFile {
  if (!vault.tokens.some((token) => token.id === id) || vault.activeId === id) {
    return vault
  }
  return { ...vault, activeId: id }
}

export function removeToken(vault: VaultFile, id: string): VaultFile {
  if (!vault.tokens.some((token) => token.id === id)) return vault
  const tokens = vault.tokens.filter((token) => token.id !== id)
  const activeId = vault.activeId === id ? (tokens[0]?.id ?? null) : vault.activeId
  return { version: 1, tokens, activeId }
}

export function readVault(storage: KeyValueStore): VaultFile {
  try {
    return parseVault(storage.getItem(STORAGE_KEY))
  } catch {
    return createEmptyVault()
  }
}

export function writeVault(storage: KeyValueStore, vault: VaultFile): void | Promise<void> {
  return storage.setItem(STORAGE_KEY, JSON.stringify(vault))
}
