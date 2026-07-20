/**
 * React bindings for the insights store: a context so the store (created once
 * in App with the chess.com client) can be consumed anywhere with a selector.
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { InsightsState, InsightsStore } from './insights'

export const InsightsStoreContext = createContext<InsightsStore | null>(null)

export function useInsightsStore(): InsightsStore {
  const store = useContext(InsightsStoreContext)
  if (!store) {
    throw new Error('useInsightsStore must be used within InsightsStoreContext.Provider')
  }
  return store
}

/** Select a slice of insights state; re-renders only when the slice changes. */
export function useInsights<T>(selector: (state: InsightsState) => T): T {
  return useStore(useInsightsStore(), selector)
}
