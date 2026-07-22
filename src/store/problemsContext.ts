/**
 * React bindings for the problems store: a context so the store (created once
 * in App with injected deps) can be consumed anywhere with a selector hook.
 * Mirrors ./context.ts for the session store.
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { ProblemsState, ProblemsStore } from './problems'

export const ProblemsStoreContext = createContext<ProblemsStore | null>(null)

export function useProblemsStore(): ProblemsStore {
  const store = useContext(ProblemsStoreContext)
  if (!store) {
    throw new Error('useProblemsStore must be used within ProblemsStoreContext.Provider')
  }
  return store
}

/** Select a slice of problems state; re-renders only when the slice changes. */
export function useProblems<T>(selector: (state: ProblemsState) => T): T {
  return useStore(useProblemsStore(), selector)
}
