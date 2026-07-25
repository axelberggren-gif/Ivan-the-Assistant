/**
 * Shared contracts for the Insights milestone (PLAN.md §5.1 + §5.3 banner).
 *
 * This file is the interface boundary between modules built by different
 * agents. Do NOT change existing signatures without coordinating — extend
 * with new optional fields or module-local types instead.
 *
 * Modules:
 * - src/insights/chesscom.ts  — chess.com public API client (raw shapes)
 * - src/insights/cache.ts     — per-month game cache (IndexedDB + in-memory)
 * - src/insights/stats.ts     — normalize games, compute the report (pure)
 * - src/insights/recommend.ts — map weaknesses to trainable openings (pure)
 * - src/components/InsightsScreen.tsx + src/store/insights.ts — UI/state
 */

// ---------------------------------------------------------------------------
// chess.com public API — raw response shapes (only the fields we consume)
// https://api.chess.com/pub/... — public, read-only, no auth.
// NOTE: browsers forbid setting the User-Agent header on fetch; the API works
// from the browser without it. Do not attempt to set it.
// ---------------------------------------------------------------------------

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily'

/** Per-player result codes chess.com uses on each game side. */
export type ChesscomResultCode =
  | 'win'
  | 'checkmated'
  | 'agreed'
  | 'repetition'
  | 'timeout'
  | 'resigned'
  | 'stalemate'
  | 'lose'
  | 'insufficient'
  | '50move'
  | 'abandoned'
  | 'kingofthehill'
  | 'threecheck'
  | 'timevsinsufficient'
  | 'bughousepartnerlose'
  | (string & {})

export interface ChesscomPlayer {
  username: string
  rating: number
  result: ChesscomResultCode
}

export interface ChesscomGame {
  url: string
  /** Full PGN including headers (ECO, ECOUrl, ...). Missing on some daily games. */
  pgn?: string
  /** Epoch seconds when the game ended */
  end_time: number
  rated: boolean
  time_class: TimeClass
  /** "chess", "chess960", "bughouse", ... — insights only use "chess" */
  rules: string
  time_control: string
  white: ChesscomPlayer
  black: ChesscomPlayer
  /** Opening URL, sometimes present alongside/instead of PGN ECOUrl header */
  eco?: string
}

export interface ChesscomMonth {
  games: ChesscomGame[]
}

/** Subset of GET /pub/player/{user}/stats we display */
export interface ChesscomStatsSection {
  last?: { rating: number; date: number }
  best?: { rating: number; date: number }
  record?: { win: number; loss: number; draw: number }
}

export interface ChesscomStats {
  chess_bullet?: ChesscomStatsSection
  chess_blitz?: ChesscomStatsSection
  chess_rapid?: ChesscomStatsSection
  chess_daily?: ChesscomStatsSection
}

// ---------------------------------------------------------------------------
// Client + cache (src/insights/chesscom.ts, src/insights/cache.ts)
// ---------------------------------------------------------------------------

/** "YYYY/MM" exactly as it appears at the end of archive URLs */
export type ArchiveMonth = string

export interface FetchProgress {
  phase: 'archives' | 'months' | 'stats' | 'done'
  monthsTotal: number
  monthsDone: number
  gamesSoFar: number
  /** Month currently being fetched, e.g. "2026/07" */
  currentMonth?: ArchiveMonth
}

export interface LoadOptions {
  /** Stop after this many games collected (newest first). Default 300. */
  maxGames?: number
  /** Look back at most this many month archives. Default 12. */
  maxMonths?: number
  onProgress?: (p: FetchProgress) => void
  signal?: AbortSignal
}

export interface LoadResult {
  /** Normalized username as chess.com reports it (lowercase) */
  username: string
  /** Raw games, newest month first, within each month as returned by the API */
  games: ChesscomGame[]
  stats: ChesscomStats
  /** Months that were served from cache (for the UI to mention) */
  cachedMonths: ArchiveMonth[]
}

/**
 * Storage backend for the month cache. Production: IndexedDB. Tests: in-memory.
 * Keys are opaque strings; values must survive structured clone / JSON.
 */
export interface KVStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
}

export interface ChesscomClient {
  /**
   * Fetch a player's recent games + stats, using the cache for past months
   * (immutable → cached forever). The CURRENT calendar month is always
   * refetched. Throws InsightsError with kind 'not_found' for unknown users
   * and 'network' for transport failures.
   */
  load(username: string, opts?: LoadOptions): Promise<LoadResult>
}

export type InsightsErrorKind = 'not_found' | 'network' | 'bad_response' | 'aborted'

export class InsightsError extends Error {
  kind: InsightsErrorKind
  constructor(kind: InsightsErrorKind, message: string) {
    super(message)
    this.name = 'InsightsError'
    this.kind = kind
  }
}

// ---------------------------------------------------------------------------
// Normalized games + report (src/insights/stats.ts) — all pure functions
// ---------------------------------------------------------------------------

export type GameResult = 'win' | 'draw' | 'loss'

/** How the game ended, folded into coarse buckets for the dashboard */
export type Termination =
  | 'checkmate'
  | 'resignation'
  | 'timeout'
  | 'draw'
  | 'abandoned'
  | 'other'

export interface InsightsGame {
  /** chess.com game URL (unique id) */
  url: string
  /** Epoch milliseconds when the game ended */
  endTimeMs: number
  timeClass: TimeClass
  rated: boolean
  userColor: 'white' | 'black'
  userRating: number
  opponentRating: number
  opponentUsername: string
  result: GameResult
  /** How the game ended (from the losing side's code, or draw code) */
  termination: Termination
  /** ECO code from PGN headers, e.g. "B12" */
  eco?: string
  /** Human opening name derived from the PGN ECOUrl / eco URL slug */
  openingName?: string
  /** Opening family: openingName truncated at the first hyphenated variation */
  openingFamily?: string
  /** Number of full moves in the game (from PGN movetext), if parseable */
  fullMoves?: number
  /**
   * Raw PGN as chess.com served it, when the game had one. Carried through so
   * deep analysis (src/analysis, ADR-0005 decision 5) can work from the same
   * normalized list the dashboard uses instead of a second parallel list.
   */
  pgn?: string
}

export interface WdlSplit {
  games: number
  wins: number
  draws: number
  losses: number
  /** wins + draws/2, as a fraction of games (0–1). 0 when games === 0. */
  score: number
}

export interface RatingPoint {
  endTimeMs: number
  rating: number
}

export interface OpeningReportRow {
  /** Opening family name, e.g. "Caro-Kann Defense" */
  family: string
  /** ECO of the most common variation seen in this family */
  eco?: string
  asColor: 'white' | 'black'
  split: WdlSplit
}

export interface InsightsReport {
  username: string
  /** Games included after filtering to rules === "chess" */
  totalGames: number
  /** Time range covered, epoch ms */
  from?: number
  to?: number
  /** Rating over time per time class, oldest first */
  ratingSeries: Partial<Record<TimeClass, RatingPoint[]>>
  overall: WdlSplit
  byColor: Record<'white' | 'black', WdlSplit>
  byTimeClass: Partial<Record<TimeClass, WdlSplit>>
  /**
   * Opponent strength bands relative to the user's rating in that game:
   * 'weaker' (≤ −50), 'similar' (±50), 'stronger' (≥ +50).
   */
  byOpponentBand: Record<'weaker' | 'similar' | 'stronger', WdlSplit>
  /** Opening families with ≥ 3 games, sorted by games desc */
  openings: OpeningReportRow[]
  /** How the user's LOSSES end */
  lossEndings: Partial<Record<Termination, number>>
  /** How the user's WINS end */
  winEndings: Partial<Record<Termination, number>>
  /** Distribution of game length in full moves: [0-20), [20-40), [40+] */
  lengthBuckets: { short: number; medium: number; long: number }
}

/**
 * Contracts implemented by src/insights/stats.ts:
 *   export const normalizeGames: NormalizeGames  — filter to rules === "chess",
 *     normalize each raw game from the user's side
 *   export const computeReport: ComputeReport
 */
export type NormalizeGames = (raw: ChesscomGame[], username: string) => InsightsGame[]

export type ComputeReport = (games: InsightsGame[], username: string) => InsightsReport

// ---------------------------------------------------------------------------
// Trainer recommendations (src/insights/recommend.ts) — pure
// ---------------------------------------------------------------------------

export interface TrainRecommendation {
  /** Opening id from src/data (e.g. "caro-kann") — must exist in the book */
  openingId: string
  /** Display name of the trainable opening */
  openingName: string
  /** e.g. "You've lost 8 of your last 11 games in the Caro-Kann — train it now" */
  message: string
  split: WdlSplit
  /** Higher = more urgent. Sorted desc by the caller. */
  urgency: number
}

/**
 * Contract implemented by src/insights/recommend.ts:
 *   export const recommendTraining: RecommendTraining
 * Match the report's opening families against the trainable openings
 * (by family-name keywords + the color the user trains) and return
 * recommendations for ones with ≥ 5 games and score < 0.5, sorted by urgency.
 */
export type RecommendTraining = (
  report: InsightsReport,
  trainable: Array<{ id: string; name: string; userColor: 'white' | 'black' }>,
) => TrainRecommendation[]
