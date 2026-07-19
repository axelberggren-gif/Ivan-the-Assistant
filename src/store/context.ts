/**
 * React bindings for the session store: a context so the store (created once
 * in App with injected deps) can be consumed anywhere with a selector hook.
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { SessionState, SessionStore } from './session'

export const SessionStoreContext = createContext<SessionStore | null>(null)

export function useSessionStore(): SessionStore {
  const store = useContext(SessionStoreContext)
  if (!store) {
    throw new Error('useSessionStore must be used within SessionStoreContext.Provider')
  }
  return store
}

/** Select a slice of session state; re-renders only when the slice changes. */
export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(useSessionStore(), selector)
}
