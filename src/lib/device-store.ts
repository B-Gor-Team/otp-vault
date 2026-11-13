import { STORAGE_KEY, type KeyValueStore } from './vault.ts'

export const VAULT_BACKEND_KEY = 'meridian.vault.backend'
const PROBE_KEY = 'meridian.probe'
const DB_NAME = 'meridian.vault'
const DB_STORE = 'kv'

export type AsyncKeyValueStore = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export function probeStore(store: KeyValueStore): boolean {
  try {
    store.setItem(PROBE_KEY, '1')
    const ok = store.getItem(PROBE_KEY) === '1'
    try {
      store.removeItem(PROBE_KEY)
    } catch {
      // The write itself succeeded. Deletion of the probe is best-effort.
    }
    return ok
  } catch {
    try {
      store.removeItem(PROBE_KEY)
    } catch {
      // The probe was rejected before it was stored.
    }
    return false
  }
}

export function safeLocalStorage(getStorage: () => Storage = () => localStorage): KeyValueStore | null {
  try {
    const storage = getStorage()
    const store: KeyValueStore = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        storage.setItem(key, value)
      },
      removeItem: (key) => {
        storage.removeItem(key)
      },
    }
    if (probeStore(store)) return store
    // Safari can reject every new write while an existing vault is still readable.
    try {
      return store.getItem(STORAGE_KEY) ? store : null
    } catch {
      return null
    }
  } catch {
    return null
  }
}

export function awaitOrNull<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, 1)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Could not open the vault database.'))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      reject(request.error ?? new Error('Could not open the vault database.'))
    }
  })
}

function runTransaction<T>(
  open: () => Promise<IDBDatabase>,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        try {
          const tx = db.transaction(DB_STORE, mode)
          const request = run(tx.objectStore(DB_STORE))
          const fail = () => {
            reject(tx.error ?? request.error ?? new Error('Vault database request failed.'))
          }
          tx.oncomplete = () => resolve(request.result)
          tx.onerror = fail
          tx.onabort = fail
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Vault database request failed.'))
        }
      }),
  )
}

export function createIndexedDbStore(factory: IDBFactory): AsyncKeyValueStore {
  let database: Promise<IDBDatabase> | null = null
  const open = () => {
    database ??= openDatabase(factory).catch((error: unknown) => {
      database = null
      throw error
    })
    return database
  }
  return {
    async getItem(key) {
      const value = await runTransaction(open, 'readonly', (store) => store.get(key))
      return typeof value === 'string' ? value : null
    },
    async setItem(key, value) {
      await runTransaction(open, 'readwrite', (store) => store.put(value, key))
    },
    async removeItem(key) {
      await runTransaction(open, 'readwrite', (store) => store.delete(key))
    },
  }
}

async function openIndexedDbBackup(): Promise<AsyncKeyValueStore | null> {
  try {
    if (typeof indexedDB === 'undefined') return null
    return createIndexedDbStore(indexedDB)
  } catch {
    return null
  }
}

function readKey(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

// iPhone Safari throws SecurityError when cookies or site data are blocked, and
// QuotaExceededError for some private-browsing sessions. IndexedDB stays on the
// device and is not attached to requests, so the secret is not sent anywhere.
export function openDeviceStore(
  deps: {
    local?: KeyValueStore | null
    openBackup?: () => Promise<AsyncKeyValueStore | null>
    backupTimeoutMs?: number
  } = {},
): KeyValueStore {
  const local = Object.prototype.hasOwnProperty.call(deps, 'local')
    ? (deps.local ?? null)
    : safeLocalStorage()
  const openBackup = deps.openBackup ?? openIndexedDbBackup
  const timeoutMs = deps.backupTimeoutMs ?? (local ? 1500 : 4000)
  const cache = new Map<string, string>()
  let mode: 'local' | 'backup' = local ? 'local' : 'backup'
  let backup: AsyncKeyValueStore | null = null
  let opening: Promise<AsyncKeyValueStore | null> | null = null
  let mutated = false

  const loadBackup = () => {
    opening ??= awaitOrNull(
      Promise.resolve()
        .then(() => openBackup())
        .catch(() => null),
      timeoutMs,
    )
    return opening
  }

  async function persistBackup(next: AsyncKeyValueStore, key: string, value: string) {
    await next.setItem(key, value)
    const read = await next.getItem(key)
    if (read !== value) throw new Error('storage blocked')
    cache.set(key, value)
    backup = next
    mode = 'backup'
  }

  async function failOver(key: string, value: string, cause: unknown): Promise<void> {
    const next = await loadBackup()
    if (!next) throw cause instanceof Error ? cause : new Error('storage blocked')
    if (local) {
      try {
        local.setItem(VAULT_BACKEND_KEY, 'idb')
      } catch {
        // A missing vault key still makes the next visit check IndexedDB.
      }
      try {
        local.removeItem(key)
      } catch {
        // Stale local data is ignored while the backend flag is set.
      }
    }
    await persistBackup(next, key, value)
  }

  async function writeBackup(key: string, value: string): Promise<void> {
    const next = backup ?? (await loadBackup())
    if (!next) throw new Error('storage blocked')
    await persistBackup(next, key, value)
  }

  const store: KeyValueStore = {
    getItem(key) {
      if (mode === 'backup') return cache.get(key) ?? null
      try {
        return local?.getItem(key) ?? cache.get(key) ?? null
      } catch {
        return cache.get(key) ?? null
      }
    },
    setItem(key, value) {
      mutated = true
      if (mode === 'local' && local) {
        try {
          local.setItem(key, value)
          if (local.getItem(key) !== value) throw new Error('dropped')
          return
        } catch (error) {
          return failOver(key, value, error)
        }
      }
      return writeBackup(key, value)
    },
    removeItem(key) {
      mutated = true
      cache.delete(key)
      if (mode === 'local' && local) {
        try {
          local.removeItem(key)
          return
        } catch {
          mode = 'backup'
        }
      }
      return loadBackup().then((next) => next?.removeItem(key))
    },
  }

  const hasVault = local ? readKey(local, STORAGE_KEY) != null : false
  const preferBackup = local ? readKey(local, VAULT_BACKEND_KEY) === 'idb' : false
  if (!local || preferBackup || !hasVault) {
    store.hydrate = async () => {
      const next = await loadBackup()
      if (!next || mutated) return
      let saved: string | null
      try {
        saved = await next.getItem(STORAGE_KEY)
      } catch {
        return
      }
      if (!saved || mutated) return
      if (local) {
        try {
          local.setItem(STORAGE_KEY, saved)
          if (local.getItem(STORAGE_KEY) === saved) {
            try {
              local.removeItem(VAULT_BACKEND_KEY)
            } catch {
              // The copied vault is what the next visit reads.
            }
            await next.removeItem(STORAGE_KEY).catch(() => {})
            mode = 'local'
            return
          }
        } catch {
          // IndexedDB keeps the only copy.
        }
      }
      if (mutated) return
      cache.set(STORAGE_KEY, saved)
      backup = next
      mode = 'backup'
    }
  }

  return store
}
