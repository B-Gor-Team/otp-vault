import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import {
  VAULT_BACKEND_KEY,
  awaitOrNull,
  createIndexedDbStore,
  openDeviceStore,
  probeStore,
  safeLocalStorage,
  type AsyncKeyValueStore,
} from './device-store.ts'
import { STORAGE_KEY, type KeyValueStore } from './vault.ts'

const NOW = 1_699_999_980_000

function memory(initial?: Record<string, string>): KeyValueStore {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function asyncMemory(initial?: Record<string, string>): AsyncKeyValueStore {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    async getItem(key) {
      return values.get(key) ?? null
    },
    async setItem(key, value) {
      values.set(key, value)
    },
    async removeItem(key) {
      values.delete(key)
    },
  }
}

type FakeControl = {
  failOpen: boolean
  failTx: boolean
  failPut: boolean
}

function createFakeIndexedDB() {
  const control: FakeControl = { failOpen: false, failTx: false, failPut: false }
  let created = false
  const data = new Map<string, unknown>()
  const factory = {
    open() {
      const request = {
        result: undefined as IDBDatabase | undefined,
        error: null as DOMException | null,
        onupgradeneeded: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
      }
      queueMicrotask(() => {
        if (control.failOpen) {
          request.error = new DOMException('blocked', 'SecurityError')
          request.onerror?.(new Event('error'))
          return
        }
        let oncomplete: ((event: Event) => void) | null = null
        let onerror: ((event: Event) => void) | null = null
        const tx = {
          error: null as DOMException | null,
          objectStore() {
            const schedule = (work: () => unknown) => {
              const req = {
                result: undefined as unknown,
                error: null as DOMException | null,
                onsuccess: null as ((event: Event) => void) | null,
                onerror: null as ((event: Event) => void) | null,
              }
              queueMicrotask(() => {
                try {
                  req.result = work()
                  req.onsuccess?.(new Event('success'))
                  oncomplete?.(new Event('success'))
                } catch (error) {
                  req.error = error as DOMException
                  tx.error = req.error
                  onerror?.(new Event('error'))
                }
              })
              return req
            }
            return {
              get: (key: IDBValidKey) => schedule(() => data.get(String(key))),
              put: (value: unknown, key: IDBValidKey) =>
                schedule(() => {
                  if (control.failPut) throw new DOMException('quota', 'QuotaExceededError')
                  data.set(String(key), value)
                  return key
                }),
              delete: (key: IDBValidKey) =>
                schedule(() => {
                  data.delete(String(key))
                }),
            }
          },
        }
        const db = {
          objectStoreNames: {
            contains: (name: string) => created && name === 'kv',
          },
          createObjectStore() {
            created = true
          },
          transaction() {
            if (control.failTx) throw new Error('tx failed')
            return {
              get error() {
                return tx.error
              },
              set oncomplete(value: ((event: Event) => void) | null) {
                oncomplete = value
              },
              get oncomplete() {
                return oncomplete
              },
              set onerror(value: ((event: Event) => void) | null) {
                onerror = value
              },
              get onerror() {
                return onerror
              },
              set onabort(value: ((event: Event) => void) | null) {
                onerror = value
              },
              get onabort() {
                return onerror
              },
              objectStore: () => tx.objectStore(),
            }
          },
        }
        request.result = db as unknown as IDBDatabase
        request.onupgradeneeded?.(new Event('upgradeneeded'))
        request.onsuccess?.(new Event('success'))
      })
      return request as unknown as IDBOpenDBRequest
    },
  }
  return { factory: factory as unknown as IDBFactory, data, control }
}

describe('device store', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('accepts a store that can round-trip a probe and ignores a failed deletion', () => {
    const values = new Map<string, string>()
    expect(
      probeStore({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value)
        },
        removeItem: () => {
          throw new Error('no delete')
        },
      }),
    ).toBe(true)

    expect(
      probeStore({
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      }),
    ).toBe(false)

    expect(
      probeStore({
        getItem: () => null,
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toBe(false)
  })

  it('hides localStorage when the getter or a write is blocked', () => {
    expect(
      safeLocalStorage(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      }),
    ).toBeNull()

    const dropped = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage
    expect(safeLocalStorage(() => dropped)).toBeNull()

    const full = {
      getItem: (key: string) => (key === STORAGE_KEY ? '{"version":1}' : null),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    } as unknown as Storage
    expect(safeLocalStorage(() => full)?.getItem(STORAGE_KEY)).toContain('version')

    const unreadable = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    } as unknown as Storage
    expect(safeLocalStorage(() => unreadable)).toBeNull()

    localStorage.clear()
    const store = safeLocalStorage()
    expect(store?.getItem('meridian.probe')).toBeNull()
    store?.setItem('sample', 'kept')
    expect(localStorage.getItem('sample')).toBe('kept')
  })

  it('resolves, swallows a rejection, and gives up when a backup stalls', async () => {
    await expect(awaitOrNull(Promise.resolve('ok'), 50)).resolves.toBe('ok')
    await expect(awaitOrNull(Promise.reject(new Error('no')), 50)).resolves.toBeNull()

    vi.useFakeTimers()
    const pending = awaitOrNull(new Promise(() => {}), 400)
    await vi.advanceTimersByTimeAsync(400)
    await expect(pending).resolves.toBeNull()
    vi.useRealTimers()
  })

  it('round-trips IndexedDB and surfaces open and transaction failures', async () => {
    const fake = createFakeIndexedDB()
    const store = createIndexedDbStore(fake.factory)
    await store.setItem(STORAGE_KEY, 'vault')
    expect(await store.getItem(STORAGE_KEY)).toBe('vault')
    expect(await store.getItem('missing')).toBeNull()
    await store.removeItem(STORAGE_KEY)
    expect(await store.getItem(STORAGE_KEY)).toBeNull()

    fake.control.failPut = true
    await expect(store.setItem(STORAGE_KEY, 'again')).rejects.toThrow()

    fake.control.failTx = true
    await expect(store.getItem(STORAGE_KEY)).rejects.toThrow('tx failed')

    const blocked = createFakeIndexedDB()
    blocked.control.failOpen = true
    await expect(createIndexedDbStore(blocked.factory).getItem(STORAGE_KEY)).rejects.toThrow(
      /vault database|blocked|insecure/i,
    )

    const throwing = {
      open() {
        throw 'nope'
      },
    } as unknown as IDBFactory
    await expect(createIndexedDbStore(throwing).getItem('k')).rejects.toThrow(/vault database/)
  })

  it('keeps a local vault and falls back when a later write is dropped or rejected', async () => {
    const local = memory({ [STORAGE_KEY]: '{"version":1}' })
    const store = openDeviceStore({ local, openBackup: async () => asyncMemory() })
    expect(store.hydrate).toBeUndefined()
    expect(store.getItem(STORAGE_KEY)).toContain('version')
    store.setItem(STORAGE_KEY, '{"version":1,"ok":true}')
    expect(store.getItem(STORAGE_KEY)).toContain('ok')
    store.removeItem(STORAGE_KEY)
    expect(store.getItem(STORAGE_KEY)).toBeNull()
    store.setItem(STORAGE_KEY, '{"version":1,"ok":true}')

    const backup = asyncMemory()
    const dropping: KeyValueStore = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }
    const dropped = openDeviceStore({ local: dropping, openBackup: async () => backup })
    await dropped.setItem(STORAGE_KEY, 'saved')
    expect(dropped.getItem(STORAGE_KEY)).toBe('saved')
    expect(await backup.getItem(STORAGE_KEY)).toBe('saved')

    const blocked = openDeviceStore({
      local: dropping,
      openBackup: async () => null,
    })
    await expect(blocked.setItem(STORAGE_KEY, 'x')).rejects.toThrow('dropped')
  })

  it('rejects a backup that accepts a write and then drops it', async () => {
    const store = openDeviceStore({
      local: null,
      openBackup: async () => ({
        async getItem() {
          return null
        },
        async setItem() {},
        async removeItem() {},
      }),
    })
    await expect(store.setItem(STORAGE_KEY, 'secret')).rejects.toThrow('storage blocked')
    expect(store.getItem(STORAGE_KEY)).toBeNull()
  })

  it('reloads a vault from IndexedDB when localStorage cannot keep it', async () => {
    const backup = asyncMemory()
    const blocked: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      removeItem: () => {},
    }
    const first = openDeviceStore({ local: blocked, openBackup: async () => backup })
    await first.setItem(STORAGE_KEY, '{"kept":true}')

    const second = openDeviceStore({ local: null, openBackup: async () => backup })
    await second.hydrate?.()
    expect(second.getItem(STORAGE_KEY)).toBe('{"kept":true}')
  })

  it('copies an IndexedDB vault back when localStorage starts working', async () => {
    const local = memory()
    const backup = asyncMemory({ [STORAGE_KEY]: '{"from":"idb"}' })
    const store = openDeviceStore({ local, openBackup: async () => backup })
    await store.hydrate?.()
    expect(local.getItem(STORAGE_KEY)).toBe('{"from":"idb"}')
    expect(await backup.getItem(STORAGE_KEY)).toBeNull()
    expect(store.getItem(STORAGE_KEY)).toBe('{"from":"idb"}')
  })

  it('prefers the IndexedDB copy when localStorage was only a stale leftover', async () => {
    const local = memory({
      [STORAGE_KEY]: '{"stale":true}',
      [VAULT_BACKEND_KEY]: 'idb',
    })
    const backup = asyncMemory({ [STORAGE_KEY]: '{"fresh":true}' })
    const store = openDeviceStore({ local, openBackup: async () => backup })
    await store.hydrate?.()
    expect(store.getItem(STORAGE_KEY)).toBe('{"fresh":true}')
    expect(local.getItem(STORAGE_KEY)).toBe('{"fresh":true}')
    expect(local.getItem(VAULT_BACKEND_KEY)).toBeNull()

    const stuck = {
      getItem: (key: string) =>
        key === VAULT_BACKEND_KEY ? 'idb' : '{"stale":true}',
      setItem: () => {
        throw new Error('no')
      },
      removeItem: () => {
        throw new Error('no')
      },
    }
    const kept = asyncMemory({ [STORAGE_KEY]: '{"fresh":true}' })
    const fallback = openDeviceStore({ local: stuck, openBackup: async () => kept })
    await fallback.hydrate?.()
    expect(fallback.getItem(STORAGE_KEY)).toBe('{"fresh":true}')
  })

  it('does not let a late backup overwrite a key saved while opening', async () => {
    const local = memory()
    let release: ((store: AsyncKeyValueStore) => void) | undefined
    const opened = new Promise<AsyncKeyValueStore>((resolve) => {
      release = resolve
    })
    let store!: KeyValueStore
    const backup: AsyncKeyValueStore = {
      async getItem() {
        await store.setItem(STORAGE_KEY, '{"fresh":true}')
        return '{"stale":true}'
      },
      async setItem() {},
      async removeItem() {},
    }
    store = openDeviceStore({ local, openBackup: () => opened })
    const hydrating = store.hydrate?.()
    release?.(backup)
    await hydrating
    expect(local.getItem(STORAGE_KEY)).toBe('{"fresh":true}')
  })

  it('ignores a backup that cannot be read and a backup that never answers', async () => {
    const unreadable = openDeviceStore({
      local: memory(),
      openBackup: async () => ({
        async getItem() {
          throw new Error('read failed')
        },
        async setItem() {},
        async removeItem() {},
      }),
    })
    await expect(unreadable.hydrate?.()).resolves.toBeUndefined()

    const exploding = openDeviceStore({
      local: null,
      openBackup: () => Promise.reject(new Error('nope')),
    })
    await exploding.hydrate?.()
    await expect(exploding.setItem(STORAGE_KEY, 'x')).rejects.toThrow('storage blocked')

    vi.useFakeTimers()
    const stalled = openDeviceStore({
      local: null,
      openBackup: () => new Promise(() => {}),
      backupTimeoutMs: 500,
    })
    const hydrating = stalled.hydrate?.()
    await vi.advanceTimersByTimeAsync(500)
    await hydrating
    await expect(stalled.setItem(STORAGE_KEY, 'x')).rejects.toThrow('storage blocked')
    vi.useRealTimers()
  })

  it('removes a key from the backup when local deletion is rejected', async () => {
    const backup = asyncMemory({ [STORAGE_KEY]: 'gone' })
    const local: KeyValueStore = {
      getItem: () => 'present',
      setItem: () => {},
      removeItem: () => {
        throw new Error('no')
      },
    }
    const store = openDeviceStore({ local, openBackup: async () => backup })
    await store.removeItem(STORAGE_KEY)
    expect(store.getItem(STORAGE_KEY)).toBeNull()
    expect(await backup.getItem(STORAGE_KEY)).toBeNull()
  })

  it('reads null when localStorage throws on getItem', () => {
    const local: KeyValueStore = {
      getItem: () => {
        throw new Error('no')
      },
      setItem: () => {
        throw new Error('no')
      },
      removeItem: () => {},
    }
    const store = openDeviceStore({ local, openBackup: async () => null })
    expect(store.getItem(STORAGE_KEY)).toBeNull()
  })

  it('uses localStorage when IndexedDB is missing or blocked', async () => {
    localStorage.setItem(STORAGE_KEY, '{"version":1}')
    const existing = openDeviceStore({ openBackup: async () => null })
    expect(existing.hydrate).toBeUndefined()
    expect(existing.getItem(STORAGE_KEY)).toContain('version')
    expect(localStorage.getItem('meridian.probe')).toBeNull()

    localStorage.clear()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      const store = openDeviceStore({ backupTimeoutMs: 30 })
      await store.hydrate?.()
      store.setItem(STORAGE_KEY, 'kept')
      expect(localStorage.getItem(STORAGE_KEY)).toBe('kept')
    } finally {
      localStorage.clear()
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    }

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      const store = openDeviceStore({ backupTimeoutMs: 30 })
      await store.hydrate?.()
      store.setItem('other', 'ok')
      expect(localStorage.getItem('other')).toBe('ok')
    } finally {
      localStorage.clear()
      Reflect.deleteProperty(globalThis, 'indexedDB')
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    }
  })
})

describe('iPhone Safari keep', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('keeps a key in IndexedDB when Safari blocks localStorage', async () => {
    const fake = createFakeIndexedDB()
    const previousIdb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    const previousLocal = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: fake.factory,
    })
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })

    try {
      const user = userEvent.setup()
      const first = render(<App now={NOW} />)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Keep on this device' })).toBeEnabled()
      })
      await user.click(screen.getByRole('button', { name: 'Use the reference hex key' }))
      await user.click(screen.getByRole('button', { name: 'Keep on this device' }))
      expect(await screen.findByTestId('active-code')).toHaveTextContent('026 209')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(String(fake.data.get(STORAGE_KEY))).toContain('AWQG63DPHD6GI3N3UTZZV3WZOGNZRU26')
      first.unmount()

      render(<App now={NOW} />)
      expect(await screen.findByTestId('active-code')).toHaveTextContent('026 209')
    } finally {
      if (previousLocal) Object.defineProperty(window, 'localStorage', previousLocal)
      else Reflect.deleteProperty(window, 'localStorage')
      if (previousIdb) Object.defineProperty(globalThis, 'indexedDB', previousIdb)
      else Reflect.deleteProperty(globalThis, 'indexedDB')
    }
  })
})
