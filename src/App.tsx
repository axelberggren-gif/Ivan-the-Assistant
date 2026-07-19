import { useMemo, useState } from 'react'
import type { SessionDeps } from './types'
import { createEngine } from './engine'
import { createBook } from './book'
import { createCoach } from './coach'
import { openings } from './data'
import { createSessionStore } from './store/session'
import { SessionStoreContext, useSession } from './store/context'
import OpeningPicker from './components/OpeningPicker'
import TrainerScreen from './components/TrainerScreen'

interface DepsResult {
  deps: SessionDeps | null
  error: string | null
}

function buildDeps(): DepsResult {
  try {
    return {
      deps: {
        engine: createEngine(),
        book: createBook(openings),
        coach: createCoach(),
      },
      error: null,
    }
  } catch (e) {
    return {
      deps: null,
      error: e instanceof Error ? e.message : 'Failed to initialise app modules',
    }
  }
}

export default function App() {
  // Instantiate deps and the store exactly once for the app's lifetime.
  const [{ deps, error }] = useState(buildDeps)
  const store = useMemo(() => (deps ? createSessionStore(deps) : null), [deps])

  // Dev-only handle for driving/inspecting the session from the console.
  if (import.meta.env.DEV && store) {
    ;(window as unknown as { __session?: unknown }).__session = store
  }

  if (!deps || !store) {
    return (
      <div className="app">
        <Header />
        <div className="fatal">
          <h2>Something is not ready yet</h2>
          <p>{error ?? 'The app modules could not be initialised.'}</p>
          <p className="fatal-hint">
            One of the app modules (engine, book, data or coach) failed to load. Reload
            the page once all modules are built.
          </p>
        </div>
      </div>
    )
  }

  return (
    <SessionStoreContext.Provider value={store}>
      <Shell />
    </SessionStoreContext.Provider>
  )
}

function Header() {
  return (
    <header className="app-header">
      <span className="app-logo" aria-hidden="true">
        ♞
      </span>
      <h1>Chess Coach</h1>
      <span className="app-tagline">opening trainer</span>
    </header>
  )
}

function Shell() {
  const status = useSession((s) => s.status)
  const engineInitializing = useSession((s) => s.engineInitializing)

  return (
    <div className="app">
      <Header />
      <ErrorBanner />
      <main className="app-main">
        {status === 'picking' ? (
          <OpeningPicker />
        ) : engineInitializing ? (
          <div className="loading-screen">
            <span className="spinner spinner-large" aria-hidden="true" />
            <p>Warming up the engine…</p>
          </div>
        ) : (
          <TrainerScreen />
        )}
      </main>
    </div>
  )
}

function ErrorBanner() {
  const error = useSession((s) => s.error)
  const clearError = useSession((s) => s.clearError)
  const backToPicker = useSession((s) => s.backToPicker)
  const status = useSession((s) => s.status)

  if (!error) return null

  return (
    <div className="error-banner" role="alert">
      <span className="error-banner-text">{error}</span>
      <span className="error-banner-actions">
        {status !== 'picking' && (
          <button type="button" className="btn btn-small" onClick={backToPicker}>
            Back to openings
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={clearError}
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </span>
    </div>
  )
}
