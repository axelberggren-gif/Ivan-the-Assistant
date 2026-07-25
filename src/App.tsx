import { useEffect, useMemo, useState } from 'react'
import type { LlmAPI, SessionDeps } from './types'
import { createEngine } from './engine'
import { createBook } from './book'
import { createCoach } from './coach'
import { openings } from './data'
import { createSessionStore } from './store/session'
import { SessionStoreContext, useSession } from './store/context'
import { createChesscomClient } from './insights/chesscom'
import { createIndexedDbStore } from './insights/cache'
import { createInsightsStore, type InsightsStore } from './store/insights'
import { InsightsStoreContext } from './store/insightsContext'
import { createAnalysisStore, type AnalysisStore } from './store/analysis'
import { AnalysisStoreContext } from './store/analysisContext'
import { createProblemSource } from './problems'
import { createLlm } from './llm'
import { createProblemsStore, type ProblemsStore } from './store/problems'
import { ProblemsStoreContext } from './store/problemsContext'
import { loadActivity, persistActivity, withSolved, type ActivityState } from './store/activity'
import AnalysisProgressChip from './components/AnalysisProgressChip'
import OpeningPicker from './components/OpeningPicker'
import TrainerScreen from './components/TrainerScreen'
import InsightsScreen from './components/InsightsScreen'
import ProblemsScreen from './components/ProblemsScreen'
import TodayScreen from './components/TodayScreen'

type View = 'today' | 'train' | 'problems' | 'insights'

/** Personal training tool first (AGENTS.md) — the owner's name for the greeting. */
const USER_NAME = 'Axel'

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'today', label: 'Today', icon: '🏠' },
  { view: 'train', label: 'Train', icon: '♟' },
  { view: 'problems', label: 'Problems', icon: '🎯' },
  { view: 'insights', label: 'Insights', icon: '📈' },
]

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

/**
 * Transposition table for the batch engine. At 150ms per search a big table
 * buys nothing and only invites the WASM allocation to grow (ADR-0005).
 */
const BATCH_ENGINE_HASH_MB = 16

/**
 * Deep analysis (PLAN.md §5.2). Created at App level so a run survives
 * navigation — the user can train or solve problems while their games are
 * analysed. It is the ONE deliberate exception to sharing a single engine
 * (ADR-0005 decision 1): the batch instance is created lazily when the user
 * clicks "Analyse my games" and disposed the moment the run ends, so it never
 * parks an interactive move behind a five-minute queue. It must never
 * auto-start.
 */
function buildAnalysisStore(): AnalysisStore | null {
  try {
    return createAnalysisStore({
      createEngine: () => createEngine({ hashMb: BATCH_ENGINE_HASH_MB }),
      // Same IndexedDB database the insights month cache uses.
      cache: createIndexedDbStore(),
    })
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
  const [analysisStore] = useState(buildAnalysisStore)
  const store = useMemo(() => (deps ? createSessionStore(deps) : null), [deps])
  const problems = useMemo(() => buildProblems(deps), [deps])

  const [view, setView] = useState<View>('today')

  // Daily activity (streak + goal) for the Today screen. Rolled forward once on
  // mount; solved puzzles are recorded by watching the problems store.
  const [activity, setActivity] = useState<ActivityState>(loadActivity)
  const [puzzleCount, setPuzzleCount] = useState<number | null>(null)

  useEffect(() => {
    if (!problems) return
    const pStore = problems.store
    const applyManifest = (m: { total: number } | null | undefined) => {
      if (m && typeof m.total === 'number') setPuzzleCount(m.total)
    }
    applyManifest(pStore.getState().manifest)
    // Surfaces the real puzzle count on the Today card; idempotent in the store.
    if (!pStore.getState().manifest) pStore.getState().loadManifest()

    let lastSolved = pStore.getState().solvedCount
    return pStore.subscribe((s) => {
      applyManifest(s.manifest)
      if (s.solvedCount > lastSolved) {
        const delta = s.solvedCount - lastSolved
        lastSolved = s.solvedCount
        setActivity((a) => {
          const next = withSolved(a, delta)
          persistActivity(next)
          return next
        })
      }
    })
  }, [problems])

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
  if (import.meta.env.DEV && analysisStore) {
    ;(window as unknown as { __analysis?: unknown }).__analysis = analysisStore
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

  // "Train it now" from the insights dashboard / Today resume card: switch to
  // the trainer and, if no session is in progress (status 'picking'), start the
  // opening directly. If a session IS running we do NOT call pickOpening — it
  // would silently reset the user's game mid-move; we just switch views and the
  // picker's recommendation banner offers the same one-click start once back.
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
      activity={activity}
      puzzleCount={puzzleCount}
    />
  )

  let tree = shell
  if (analysisStore) {
    tree = (
      <AnalysisStoreContext.Provider value={analysisStore}>{tree}</AnalysisStoreContext.Provider>
    )
  }
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
  streak,
}: {
  view?: View
  onSelectView?: (v: View) => void
  streak?: number
}) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <span className="app-logo" aria-hidden="true">
          ♞
        </span>
        <span className="app-name">Ivan</span>
      </div>

      {view && onSelectView && (
        <nav className="nav-tabs" aria-label="App sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              type="button"
              className={`nav-tab${view === item.view ? ' nav-tab-active' : ''}`}
              onClick={() => onSelectView(item.view)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {view && onSelectView && (
        <div className="app-header-right">
          {/* Deep analysis runs at App level, so its progress follows the user
              across screens; on Insights the full bar is already on screen. */}
          {view !== 'insights' && (
            <AnalysisProgressChip onOpen={() => onSelectView('insights')} />
          )}
          {typeof streak === 'number' && streak > 0 && (
            <span className="streak-badge" title={`${streak}-day streak`}>
              🔥 {streak}
            </span>
          )}
          <span className="app-avatar" aria-hidden="true">
            {USER_NAME.charAt(0)}
          </span>
        </div>
      )}
    </header>
  )
}

/** Fixed bottom navigation shown on narrow (phone) viewports. */
function MobileNav({ view, onSelectView }: { view: View; onSelectView: (v: View) => void }) {
  return (
    <nav className="mobile-nav" aria-label="App sections">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          type="button"
          className={`mobile-nav-item${view === item.view ? ' mobile-nav-item-active' : ''}`}
          onClick={() => onSelectView(item.view)}
        >
          <span className="mobile-nav-icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="mobile-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function Shell({
  view,
  onSelectView,
  onTrain,
  hasInsights,
  problems,
  activity,
  puzzleCount,
}: {
  view: View
  onSelectView: (v: View) => void
  onTrain: (openingId: string) => void
  hasInsights: boolean
  problems: ProblemsParts | null
  activity: ActivityState
  puzzleCount: number | null
}) {
  const status = useSession((s) => s.status)
  const engineInitializing = useSession((s) => s.engineInitializing)

  return (
    <div className="app">
      <Header view={view} onSelectView={onSelectView} streak={activity.streak} />
      <ErrorBanner />
      <main className="app-main">
        {view === 'today' ? (
          <TodayScreen
            userName={USER_NAME}
            streak={activity.streak}
            solvedToday={activity.solvedToday}
            puzzleCount={puzzleCount}
            hasProblems={problems !== null}
            hasInsights={hasInsights}
            onResume={onTrain}
            onTrain={() => onSelectView('train')}
            onProblems={() => onSelectView('problems')}
            onInsights={() => onSelectView('insights')}
          />
        ) : view === 'problems' ? (
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
      <MobileNav view={view} onSelectView={onSelectView} />
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
