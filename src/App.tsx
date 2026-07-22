import { useMemo, useState } from 'react'
import type { LlmAPI, SessionDeps } from './types'
import { createEngine } from './engine'
import { createBook } from './book'
import { createCoach } from './coach'
import { openings } from './data'
import { createSessionStore } from './store/session'
import { SessionStoreContext, useSession } from './store/context'
import { createChesscomClient } from './insights/chesscom'
import { createInsightsStore, type InsightsStore } from './store/insights'
import { InsightsStoreContext } from './store/insightsContext'
import { createProblemSource } from './problems'
import { createLlm } from './llm'
import { createProblemsStore, type ProblemsStore } from './store/problems'
import { ProblemsStoreContext } from './store/problemsContext'
import OpeningPicker from './components/OpeningPicker'
import TrainerScreen from './components/TrainerScreen'
import InsightsScreen from './components/InsightsScreen'
import ProblemsScreen from './components/ProblemsScreen'

type View = 'train' | 'problems' | 'insights'

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

/** Insights is optional: if it fails to initialise, the trainer still works. */
function buildInsightsStore(): InsightsStore | null {
  try {
    return createInsightsStore(createChesscomClient())
  } catch {
    return null
  }
}

interface ProblemsParts {
  store: ProblemsStore
  llm: LlmAPI
}

/**
 * Problems mode is optional like insights: if its deps fail to build, the
 * trainer still works. Reuses the SAME engine instance as the session deps —
 * the engine serializes searches, and a second worker would waste memory.
 */
function buildProblems(deps: SessionDeps | null): ProblemsParts | null {
  if (!deps) return null
  try {
    const llm = createLlm()
    const store = createProblemsStore({
      engine: deps.engine,
      // BASE_URL-aware so bundled problems resolve under a non-root deploy
      // base (GitHub Pages serves the app from /<repo>/).
      problems: createProblemSource(`${import.meta.env.BASE_URL}problems`),
      llm,
    })
    return { store, llm }
  } catch {
    return null
  }
}

export default function App() {
  // Instantiate deps and the stores exactly once for the app's lifetime.
  const [{ deps, error }] = useState(buildDeps)
  const [insightsStore] = useState(buildInsightsStore)
  const store = useMemo(() => (deps ? createSessionStore(deps) : null), [deps])
  const problems = useMemo(() => buildProblems(deps), [deps])

  const [view, setView] = useState<View>('train')

  // Dev-only handles for driving/inspecting the stores from the console.
  if (import.meta.env.DEV && store) {
    ;(window as unknown as { __session?: unknown }).__session = store
  }
  if (import.meta.env.DEV && insightsStore) {
    ;(window as unknown as { __insights?: unknown }).__insights = insightsStore
  }
  if (import.meta.env.DEV && problems) {
    ;(window as unknown as { __problems?: unknown }).__problems = problems.store
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

  // "Train it now" from the insights dashboard: switch to the trainer and, if
  // no session is in progress (status 'picking'), start the opening directly.
  // If a session IS running we do NOT call pickOpening — it would silently
  // reset the user's game mid-move; we just switch views and the picker's
  // recommendation banner offers the same one-click start once they're back.
  const handleTrain = (openingId: string) => {
    if (store.getState().status === 'picking') {
      store.getState().pickOpening(openingId)
    }
    setView('train')
  }

  const shell = (
    <Shell
      view={view}
      onSelectView={setView}
      onTrain={handleTrain}
      hasInsights={insightsStore !== null}
      problems={problems}
    />
  )

  let tree = shell
  if (insightsStore) {
    tree = (
      <InsightsStoreContext.Provider value={insightsStore}>{tree}</InsightsStoreContext.Provider>
    )
  }
  if (problems) {
    tree = (
      <ProblemsStoreContext.Provider value={problems.store}>{tree}</ProblemsStoreContext.Provider>
    )
  }

  return <SessionStoreContext.Provider value={store}>{tree}</SessionStoreContext.Provider>
}

function Header({
  view,
  onSelectView,
}: {
  view?: View
  onSelectView?: (v: View) => void
}) {
  return (
    <header className="app-header">
      <span className="app-logo" aria-hidden="true">
        ♞
      </span>
      <h1>Chess Coach</h1>
      <span className="app-tagline">opening trainer</span>
      {view && onSelectView && (
        <nav className="nav-tabs" aria-label="App sections">
          <button
            type="button"
            className={`nav-tab${view === 'train' ? ' nav-tab-active' : ''}`}
            onClick={() => onSelectView('train')}
          >
            Train
          </button>
          <button
            type="button"
            className={`nav-tab${view === 'problems' ? ' nav-tab-active' : ''}`}
            onClick={() => onSelectView('problems')}
          >
            Problems
          </button>
          <button
            type="button"
            className={`nav-tab${view === 'insights' ? ' nav-tab-active' : ''}`}
            onClick={() => onSelectView('insights')}
          >
            Insights
          </button>
        </nav>
      )}
    </header>
  )
}

function Shell({
  view,
  onSelectView,
  onTrain,
  hasInsights,
  problems,
}: {
  view: View
  onSelectView: (v: View) => void
  onTrain: (openingId: string) => void
  hasInsights: boolean
  problems: ProblemsParts | null
}) {
  const status = useSession((s) => s.status)
  const engineInitializing = useSession((s) => s.engineInitializing)

  return (
    <div className="app">
      <Header view={view} onSelectView={onSelectView} />
      <ErrorBanner />
      <main className="app-main">
        {view === 'problems' ? (
          problems ? (
            <ProblemsScreen llm={problems.llm} />
          ) : (
            <div className="fatal">
              <h2>Problems is not available</h2>
              <p>The problems module failed to initialise. Training still works.</p>
            </div>
          )
        ) : view === 'insights' ? (
          hasInsights ? (
            <InsightsScreen onTrain={onTrain} />
          ) : (
            <div className="fatal">
              <h2>Insights is not available</h2>
              <p>The insights module failed to initialise. Training still works.</p>
            </div>
          )
        ) : status === 'picking' ? (
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
