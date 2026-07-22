/**
 * localStorage wrapper for the user's BYOK Anthropic API key (ADR-0003).
 *
 * The key lives ONLY here — never bundled, committed, logged, or sent
 * anywhere except api.anthropic.com (by src/llm/index.ts). Guarded for
 * environments without localStorage (Node/tests): loadKey returns null and
 * saveKey is a no-op there.
 */

/** localStorage key under which the user's Anthropic API key is stored. */
export const KEY_STORAGE_KEY = 'chess-coach.anthropic-key'

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    // Some environments throw on localStorage access (e.g. blocked storage).
    return null
  }
}

/** Returns the stored key, or null if absent/unavailable. */
export function loadKey(): string | null {
  const store = storage()
  if (store === null) return null
  try {
    const key = store.getItem(KEY_STORAGE_KEY)
    return key !== null && key.trim() !== '' ? key : null
  } catch {
    return null
  }
}

/** Stores the key; null (or blank) removes it. No-op without localStorage. */
export function saveKey(key: string | null): void {
  const store = storage()
  if (store === null) return
  try {
    if (key === null || key.trim() === '') {
      store.removeItem(KEY_STORAGE_KEY)
    } else {
      store.setItem(KEY_STORAGE_KEY, key)
    }
  } catch {
    // Quota/privacy-mode failures: silently degrade — the app works keyless.
  }
}
