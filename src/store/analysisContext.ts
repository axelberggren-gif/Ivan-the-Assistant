/**
 * React bindings for the analysis store: a context so the store (created once
 * in App, at App level so runs survive navigation) can be consumed anywhere
 * with a selector. Mirrors ./insightsContext.ts.
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { AnalysisState, AnalysisStore } from './analysis'

export const AnalysisStoreContext = createContext<AnalysisStore | null>(null)

/** The store, or null when deep analysis failed to initialise. */
export function useAnalysisStoreOrNull(): AnalysisStore | null {
  return useContext(AnalysisStoreContext)
}

export function useAnalysisStore(): AnalysisStore {
  const store = useContext(AnalysisStoreContext)
  if (!store) {
    throw new Error('useAnalysisStore must be used within AnalysisStoreContext.Provider')
  }
  return store
}

/** Select a slice of analysis state; re-renders only when the slice changes. */
export function useAnalysis<T>(selector: (state: AnalysisState) => T): T {
  return useStore(useAnalysisStore(), selector)
}
