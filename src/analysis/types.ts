/**
 * Module-local contracts for deep analysis (PLAN.md §5.2, ADR-0005).
 *
 * Same precedent as src/insights/types.ts: `src/types.ts` is NOT touched — the
 * analysis module talks to the rest of the app through `EngineAPI` and the
 * shapes below.
 *
 * Deliberately chess.com-agnostic: `annotate.ts` takes SAN moves and a colour,
 * so Phase 5's post-game review of in-app games reuses it unchanged.
 *
 * Conventions (repo-wide): centipawns are ALWAYS White-perspective; convert to
 * the user's side only via src/coach/eval (`toUserCp`, `MATE_CP`).
 */
import type { Classification, Color, DevelopmentScore, ReasonCode } from '../types'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Display metadata carried through annotation into the report, untouched. */
export interface AnalysisGameMeta {
  /** Epoch milliseconds the game ended — used for "newest first" ordering */
  endTimeMs?: number
  result?: 'win' | 'draw' | 'loss'
  /** Link back to the game (chess.com URL) */
  url?: string
  openingFamily?: string
  eco?: string
  opponentUsername?: string
}

/** One game to annotate: SAN moves from the start position, White first. */
export interface AnalysisGameInput {
  /** Stable unique id — the cache key (chess.com game URL for insights games) */
  id: string
  movesSan: string[]
  userColor: Color
  meta?: AnalysisGameMeta
}

/**
 * The subset of a normalized game list the selector needs. Structurally
 * satisfied by `InsightsGame` (src/insights/types.ts) so no import is needed
 * in either direction.
 */
export interface SelectableGame {
  url: string
  pgn?: string
  endTimeMs: number
  userColor: Color
  rated: boolean
  timeClass: string
  result?: 'win' | 'draw' | 'loss'
  openingFamily?: string
  eco?: string
  opponentUsername?: string
}

// ---------------------------------------------------------------------------
// Budget (ADR-0005 decision 4) — bounded, cached, resumable
// ---------------------------------------------------------------------------

/**
 * Game phases the analysis covers. The coach's competence is the opening and
 * early middlegame, and the ply cap stops at full move 30, so the endgame is
 * explicitly out of scope for this milestone (ADR-0005 decision 4).
 */
export type GamePhase = 'opening' | 'middlegame'

export interface AnalysisBudget {
  /** Hard time budget per position, so a game costs a predictable ~12s */
  movetimeMs: number
  /** Stop after this ply (60 = full move 30) */
  plyCap: number
  /** MultiPV used where the USER is to move (needed to name a better move) */
  multiPv: number
  /** Beyond ±this many cp for `decidedPlies` consecutive plies, stop the game */
  decidedCp: number
  decidedPlies: number
  /** Skip games shorter than this many plies */
  minPlies: number
  /** Analyse at most this many games (newest first) */
  maxGames: number
  /** Re-analyse this many worst moves at full depth before showing them */
  verifyTopN: number
  /** Depth for the deep re-check of the worst moments */
  verifyDepth: number
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** One of the USER's moves, judged by the coach's own thresholds. */
export interface AnnotatedMove {
  /** 0-based ply index in the game (ply 0 is White's first move) */
  ply: number
  /** 1-based full-move number */
  moveNumber: number
  color: Color
  san: string
  /** FEN before the move — lets the UI show the position without a replay */
  fenBefore: string
  /** White-perspective cp before the move (mate mapped via MATE_CP) */
  cpBefore: number
  /** White-perspective cp after the move */
  cpAfter: number
  /** Centipawns lost from the USER's perspective (>= 0) */
  cpLoss: number
  classification: Exclude<Classification, 'book'>
  reasonCodes: ReasonCode[]
  /** The engine's best move in `fenBefore` */
  bestMoveSan: string
  phase: GamePhase
  /** True once the deep re-check has confirmed this move at full depth */
  verified?: boolean
}

/** Why analysis of a game stopped before its last move. */
export type TruncationReason = 'ply_cap' | 'decided' | 'aborted'

export interface AnnotatedGame {
  /** Same id as the input — the cache key */
  id: string
  userColor: Color
  meta: AnalysisGameMeta
  /** Plies in the game as played */
  pliesTotal: number
  /** Plies actually covered by the engine pass */
  pliesAnalysed: number
  truncated?: TruncationReason
  /** The USER's moves only, in play order */
  moves: AnnotatedMove[]
  /** The user's development at the end of the opening phase */
  development: DevelopmentScore
  /** Budget signature this annotation was produced under (cache invalidation) */
  signature: string
}

// ---------------------------------------------------------------------------
// Weakness report (aggregate.ts) — pure
// ---------------------------------------------------------------------------

export interface PhaseStats {
  phase: GamePhase
  /** The user's moves analysed in this phase */
  moves: number
  /** Mean cpLoss over those moves (0 when none) */
  avgCpLoss: number
  inaccuracies: number
  mistakes: number
  blunders: number
}

/** How often a reason code shows up, and in how many separate games. */
export interface ReasonTally {
  code: ReasonCode
  count: number
  games: number
  /** Display label from templates.ts */
  label: string
  /** One-line coaching hint from templates.ts */
  hint: string
}

/** A single bad move worth looking at, with a link back to the game. */
export interface WorstMoment extends AnnotatedMove {
  gameId: string
  url?: string
  endTimeMs?: number
  opponentUsername?: string
  openingFamily?: string
}

export interface DevelopmentDiagnosis {
  /** Mean development score (0–100) at the end of the opening */
  avgScore: number
  /** Games where the user had not castled by the end of the opening */
  gamesUncastled: number
  gamesEarlyQueen: number
  avgTempoLoss: number
  avgDevelopedMinors: number
  /**
   * Full-move number the user most often first drifts at (first move worse
   * than an inaccuracy). Undefined when there is no repeated drift point.
   */
  driftMoveNumber?: number
  /** Prose from templates.ts */
  comment: string
}

export interface WeaknessReport {
  gamesAnalysed: number
  /** The user's moves judged across all games */
  movesAnalysed: number
  avgCpLoss: number
  inaccuracies: number
  mistakes: number
  blunders: number
  blundersPerGame: number
  byPhase: PhaseStats[]
  /** Blunders/mistakes keyed by full-move number, ascending — the timeline */
  timeline: Array<{ moveNumber: number; mistakes: number; blunders: number }>
  development: DevelopmentDiagnosis
  /** Reason codes by frequency, most common first ('ok' excluded) */
  recurring: ReasonTally[]
  /** The worst moves across all games, worst first */
  worstMoments: WorstMoment[]
  /** One-line summary from templates.ts */
  headline: string
  /** 1–4 concrete findings from templates.ts */
  findings: string[]
}

// ---------------------------------------------------------------------------
// Queue (queue.ts) — the batch scheduler
// ---------------------------------------------------------------------------

export type AnalysisPhase = 'idle' | 'analysing' | 'verifying' | 'done'

export interface AnalysisProgress {
  phase: AnalysisPhase
  gamesTotal: number
  gamesDone: number
  /** Games served from the cache (they complete instantly) */
  gamesCached: number
  currentGameId?: string
  /** Plies done / total within the game currently being analysed */
  pliesDone: number
  pliesTotal: number
  /**
   * Remaining time, from a rolling mean over GENUINELY analysed games only —
   * null while unknown. Cached games must never make the estimate optimistic
   * (ADR-0005 decision 4b).
   */
  etaMs: number | null
}

/**
 * Cache backend for annotated games. Structurally satisfied by the insights
 * `KVStore` (`createIndexedDbStore`), and by a Map in tests.
 */
export interface AnalysisCache {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
}

export interface AnalysisDeps {
  /**
   * Creates the batch engine instance. Called lazily at the start of a run and
   * disposed when it ends — deep analysis never shares the interactive engine
   * (ADR-0005 decision 1).
   */
  createEngine: () => import('../types').EngineAPI
  cache: AnalysisCache
  /** Injected clock so the ETA is testable. Defaults to Date.now. */
  now?: () => number
}

export interface RunOptions {
  budget?: Partial<AnalysisBudget>
  signal?: AbortSignal
  onProgress?: (p: AnalysisProgress) => void
  /** Per-game commit: cancelling keeps everything already reported here. */
  onGame?: (game: AnnotatedGame) => void
}

export interface AnalysisRunResult {
  games: AnnotatedGame[]
  /** True when the run was cancelled before finishing every game */
  aborted: boolean
}

export interface AnalysisQueue {
  run(games: AnalysisGameInput[], opts?: RunOptions): Promise<AnalysisRunResult>
}
