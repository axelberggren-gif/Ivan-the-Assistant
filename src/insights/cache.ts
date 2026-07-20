import type { KVStore } from './types'

/**
 * KVStore backends for the insights month cache.
 *
 * Caching is an optimization, never a failure source: the IndexedDB store
 * degrades to in-memory behavior when IndexedDB is unavailable (tests, SSR)
 * or when any operation fails.
 */

/** Simple Map-backed store. Used by tests and as the IndexedDB fallback. */
export function createMemoryStore(): KVStore {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, value)
    },
  }
}

const OBJECT_STORE = 'kv'
const DB_VERSION = 1

/**
 * IndexedDB-backed store with a single object store ('kv').
 *
 * The database is opened lazily on first use and the open promise is reused.
 * If `indexedDB` is undefined or any operation throws/rejects, reads and
 * writes silently fall back to a per-store in-memory Map instead of rejecting.
 */
export function createIndexedDbStore(dbName = 'chess-coach-insights'): KVStore {
  const fallback = createMemoryStore()
  let dbPromise: Promise<IDBDatabase | null> | null = null

  const openDb = (): Promise<IDBDatabase | null> => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          if (typeof indexedDB === 'undefined') {
            resolve(null)
            return
          }
          const request = indexedDB.open(dbName, DB_VERSION)
          request.onupgradeneeded = () => {
            request.result.createObjectStore(OBJECT_STORE)
          }
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
    }
    return dbPromise
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const db = await openDb()
      if (!db) return fallback.get<T>(key)
      try {
        return await new Promise<T | undefined>((resolve, reject) => {
          const tx = db.transaction(OBJECT_STORE, 'readonly')
          const request = tx.objectStore(OBJECT_STORE).get(key)
          request.onsuccess = () => resolve(request.result as T | undefined)
          request.onerror = () => reject(request.error)
        })
      } catch {
        return fallback.get<T>(key)
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      const db = await openDb()
      if (!db) return fallback.set(key, value)
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(OBJECT_STORE, 'readwrite')
          tx.objectStore(OBJECT_STORE).put(value, key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
          tx.onabort = () => reject(tx.error)
        })
      } catch {
        return fallback.set(key, value)
      }
    },
  }
}
