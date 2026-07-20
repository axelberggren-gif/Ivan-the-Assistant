import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIndexedDbStore, createMemoryStore } from './cache'

describe('createMemoryStore', () => {
  it('returns undefined for missing keys', async () => {
    const store = createMemoryStore()
    await expect(store.get('missing')).resolves.toBeUndefined()
  })

  it('round-trips values, including structured ones', async () => {
    const store = createMemoryStore()
    await store.set('num', 42)
    await store.set('games', [{ url: 'https://x', end_time: 1 }])
    await expect(store.get<number>('num')).resolves.toBe(42)
    await expect(store.get('games')).resolves.toEqual([{ url: 'https://x', end_time: 1 }])
  })

  it('overwrites existing keys', async () => {
    const store = createMemoryStore()
    await store.set('k', 'first')
    await store.set('k', 'second')
    await expect(store.get('k')).resolves.toBe('second')
  })

  it('keeps separate stores independent', async () => {
    const a = createMemoryStore()
    const b = createMemoryStore()
    await a.set('k', 'a-value')
    await expect(b.get('k')).resolves.toBeUndefined()
  })
})

describe('createIndexedDbStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('degrades to in-memory behavior when indexedDB is undefined', async () => {
    // Node test environment has no indexedDB.
    expect(typeof indexedDB).toBe('undefined')
    const store = createIndexedDbStore()
    await expect(store.get('k')).resolves.toBeUndefined()
    await store.set('k', { games: [] })
    await expect(store.get('k')).resolves.toEqual({ games: [] })
  })

  it('degrades to in-memory behavior when indexedDB.open throws', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('quota exceeded')
      },
    })
    const store = createIndexedDbStore()
    await store.set('k', 'v')
    await expect(store.get('k')).resolves.toBe('v')
  })

  it('degrades to in-memory behavior when the open request errors', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { onupgradeneeded: null, onsuccess: null, onerror: null as
          | (() => void)
          | null }
        queueMicrotask(() => request.onerror?.())
        return request
      },
    })
    const store = createIndexedDbStore()
    await store.set('k', 'v')
    await expect(store.get('k')).resolves.toBe('v')
  })

  it('never rejects the caller even under repeated failures', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('always broken')
      },
    })
    const store = createIndexedDbStore('custom-db')
    await expect(store.set('a', 1)).resolves.toBeUndefined()
    await expect(store.set('b', 2)).resolves.toBeUndefined()
    await expect(store.get('a')).resolves.toBe(1)
    await expect(store.get('b')).resolves.toBe(2)
    await expect(store.get('c')).resolves.toBeUndefined()
  })
})
