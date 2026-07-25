/**
 * Analysis store: the background deep-analysis run over your real games
 * (PLAN.md §5.2, ADR-0005).
 *
 * Same seam as ./session.ts and ./problems.ts — a zustand vanilla store created
 * once with injected deps (`AnalysisDeps`: an engine factory, a cache, a clock)
 * so it is testable with a fake engine. The store orchestrates; annotation,
 * classification and prose all live in src/analysis and src/coach.
 *
 * It is created at App level, NOT inside the insights screen, so a run survives
 * navigation: the user can train or solve problems while their games are
 * analysed (ADR-0005 decision 4b).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  DEFAULT_BUDGET,
  buildWeaknessReport,
  createAnalysisQueue,
  selectGamesForAnalysis,
} from '../analysis'
import type {
  AnalysisBudget,
  AnalysisDeps,
  AnalysisProgress,
  AnnotatedGame,
  SelectableGame,
  WeaknessReport,
} from '../analysis'

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export type AnalysisStatus = 'idle' | 'running' | 'ready' | 'cancelled' | 'error'

export interface AnalysisState {
  status: AnalysisStatus
  progress: AnalysisProgress | null
  /** Annotated games committed so far — the report grows as they land. */
  games: AnnotatedGame[]
  /** Recomputed on every commit, so the panel fills in during the run. */
  report: WeaknessReport | null
  error: string | null
  /** How many games the next run will cover. */
  maxGames: number
  /** True while a run is in flight, for the cross-screen progress chip. */
  running: boolean

  // Actions
  /**
   * Start a run over `games` (newest first, filtered by the budget). No-op
   * while a run is already in flight — never auto-start this (ADR-0005).
   */
  analyse: (games: SelectableGame[]) => void
  /** Cancel the run; everything already committed is kept. */
  cancel: () => void
  setMaxGames: (n: number) => void
  /** Drop the report and go back to idle (e.g. a different username loaded). */
  reset: () => void
  clearError: () => void
}

export type AnalysisStore = StoreApi<AnalysisState>

/** Scope choices offered in the UI. 25 is the ADR-0005 default. */
export const MAX_GAMES_CHOICES = [25, 50, 100] as const

function friendlyError(e: unknown): string {
  if (e instanceof Error && e.message) {
    return `Analysing your games failed: ${e.message}`
  }
  return 'Analysing your games failed.'
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createAnalysisStore(deps: AnalysisDeps): AnalysisStore {
  const queue = createAnalysisQueue(deps)
  let controller: AbortController | null = null

  return createStore<AnalysisState>()((set, get) => ({
    status: 'idle',
    progress: null,
    games: [],
    report: null,
    error: null,
    maxGames: DEFAULT_BUDGET.maxGames,
    running: false,

    setMaxGames: (n: number) => {
      if (get().status === 'running') return
      set({ maxGames: n })
    },

    clearError: () => set({ error: null }),

    reset: () => {
      if (get().status === 'running') return
      set({ status: 'idle', progress: null, games: [], report: null, error: null })
    },

    cancel: () => {
      controller?.abort()
    },

    analyse: (games: SelectableGame[]) => {
      if (get().status === 'running') return

      const budget: Partial<AnalysisBudget> = { maxGames: get().maxGames }
      const selected = selectGamesForAnalysis(games, {
        maxGames: get().maxGames,
        minPlies: DEFAULT_BUDGET.minPlies,
      })

      if (selected.length === 0) {
        set({
          status: 'error',
          error:
            'None of those games can be analysed — deep analysis needs rated games with a full move list.',
        })
        return
      }

      controller = new AbortController()
      const signal = controller.signal
      // Committed games are collected here and the report is rebuilt from the
      // whole set on each commit, so a cancel always leaves a coherent report.
      const committed = new Map<string, AnnotatedGame>()

      set({
        status: 'running',
        running: true,
        error: null,
        games: [],
        report: null,
        progress: {
          phase: 'analysing',
          gamesTotal: selected.length,
          gamesDone: 0,
          gamesCached: 0,
          pliesDone: 0,
          pliesTotal: 0,
          etaMs: null,
        },
      })

      void (async () => {
        try {
          const result = await queue.run(selected, {
            budget,
            signal,
            onProgress: (progress) => set({ progress }),
            onGame: (game) => {
              // Upsert: the deep re-check re-commits a game it has revised.
              committed.set(game.id, game)
              const games = [...committed.values()]
              set({ games, report: buildWeaknessReport(games) })
            },
          })
          const finalGames = result.games
          set({
            status: result.aborted ? 'cancelled' : 'ready',
            running: false,
            games: finalGames,
            report: buildWeaknessReport(finalGames),
          })
        } catch (e) {
          // Whatever landed before the failure is still worth showing.
          const games = [...committed.values()]
          set({
            status: 'error',
            running: false,
            error: friendlyError(e),
            games,
            report: games.length > 0 ? buildWeaknessReport(games) : null,
          })
        } finally {
          controller = null
        }
      })()
    },
  }))
}
