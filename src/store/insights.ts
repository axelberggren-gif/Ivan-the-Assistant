/**
 * Insights store: username → chess.com games → report → recommendations.
 *
 * Built strictly against the contracts in ../insights/types.ts. Vanilla
 * zustand store created once with an injected ChesscomClient and consumed
 * from React via `useStore` (see ./insightsContext.ts).
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  ChesscomClient,
  ChesscomStats,
  FetchProgress,
  InsightsGame,
  InsightsReport,
  TrainRecommendation,
} from '../insights/types'
import { InsightsError } from '../insights/types'
import { normalizeGames, computeReport } from '../insights/stats'
import { recommendTraining } from '../insights/recommend'
import { openings } from '../data'

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export type InsightsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface InsightsState {
  usernameInput: string
  status: InsightsStatus
  progress: FetchProgress | null
  report: InsightsReport | null
  /**
   * The normalized games the report was computed from, kept so deep analysis
   * (src/analysis) can select from the same list instead of re-fetching.
   */
  games: InsightsGame[]
  stats: ChesscomStats | null
  recommendations: TrainRecommendation[]
  error: string | null

  // Actions
  setUsernameInput: (v: string) => void
  loadUser: () => void
}

export type InsightsStore = StoreApi<InsightsState>

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const USERNAME_KEY = 'chess-coach:chesscom-username'

function readStoredUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function persistUsername(username: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, username)
  } catch {
    /* private mode / quota — the app works without persistence */
  }
}

function friendlyError(e: unknown, username: string): string {
  if (e instanceof InsightsError) {
    switch (e.kind) {
      case 'not_found':
        return `No chess.com account named “${username}” — check the spelling and try again.`
      case 'network':
        return 'Could not reach chess.com — check your connection and try again.'
      case 'bad_response':
        return 'chess.com returned something unexpected — try again in a moment.'
      case 'aborted':
        return 'The load was cancelled.'
    }
  }
  return e instanceof Error && e.message ? e.message : 'Loading your games failed'
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createInsightsStore(client: ChesscomClient): InsightsStore {
  return createStore<InsightsState>()((set, get) => ({
    usernameInput: readStoredUsername(),
    status: 'idle',
    progress: null,
    report: null,
    games: [],
    stats: null,
    recommendations: [],
    error: null,

    setUsernameInput: (v: string) => set({ usernameInput: v }),

    loadUser: () => {
      const st = get()
      if (st.status === 'loading') return // guard against overlapping loads
      const username = st.usernameInput.trim()
      if (!username) return
      persistUsername(username)
      set({ status: 'loading', progress: null, error: null })
      void (async () => {
        try {
          const result = await client.load(username, {
            onProgress: (p) => {
              if (get().status === 'loading') set({ progress: p })
            },
          })
          const games = normalizeGames(result.games, result.username)
          const report = computeReport(games, result.username)
          const recommendations = recommendTraining(
            report,
            openings.map((o) => ({ id: o.id, name: o.name, userColor: o.userColor })),
          )
          set({
            status: 'ready',
            progress: null,
            report,
            games,
            stats: result.stats,
            recommendations,
            error: null,
          })
        } catch (e) {
          set({
            status: 'error',
            progress: null,
            error: friendlyError(e, username),
          })
        }
      })()
    },
  }))
}
