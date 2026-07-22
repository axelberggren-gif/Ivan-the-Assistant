/**
 * Shared contracts for the Chess Coach opening trainer.
 *
 * This file is the interface boundary between modules built by different
 * agents. Do NOT change existing signatures without coordinating — extend
 * with new optional fields or module-local types instead.
 *
 * Conventions:
 * - Moves are SAN strings ("Nf3", "exd5", "O-O") unless a field is named *Uci.
 * - Move sequences are always from the standard starting position, White first.
 * - Engine centipawn values are ALWAYS from White's perspective.
 */

export type Color = 'white' | 'black'

// ---------------------------------------------------------------------------
// Opening data (src/data)
// ---------------------------------------------------------------------------

export interface Line {
  /** SAN moves from the starting position, e.g. ["e4","e5","Nf3","Nc6","Bc4"] */
  moves: string[]
  /** Variation name, e.g. "Giuoco Piano, main line" */
  name?: string
  /** Index into `moves` → short idea text shown when that move is played */
  ideas?: Record<number, string>
}

export interface TrickLine extends Line {
  trapId: string
  /**
   * How bad falling for it is: 'losing' traps stop the session
   * (stop-and-explain); 'minor' traps (e.g. lose a pawn) deliver their
   * authored explanation inline and play continues.
   */
  severity: 'losing' | 'minor'
  /**
   * `moves` ends with the OPPONENT's bait move (so after `moves` it is the
   * user's turn). `wrongReply` is the natural-looking user reply that loses.
   */
  wrongReply: string
  /**
   * Refutation played out if the user bites: SAN continuation after
   * `moves + [wrongReply]`, starting with the opponent's move, alternating.
   */
  punishment: string[]
  /** Hand-written coaching text: what the trap is and why the reply fails */
  explanation: string
  /** The correct reply (SAN) plus a one-line why */
  fix: string
  /** Correct reply SAN only (must be legal in the bait position) */
  fixMove: string
}

export interface Opening {
  id: string
  name: string
  eco: string
  /** Which side the user trains in this opening (v1: one side per opening) */
  userColor: Color
  description: string
  mainlines: Line[]
  trickLines: TrickLine[]
}

// ---------------------------------------------------------------------------
// Opening book (src/book)
// ---------------------------------------------------------------------------

export interface BookMoveOption {
  san: string
  kind: 'mainline' | 'trick'
  /** Relative sampling weight (>0) */
  weight: number
  idea?: string
  trapId?: string
}

export interface BookCheckResult {
  inBook: boolean
  idea?: string
  lineName?: string
}

export interface OpeningBook {
  openings: Opening[]
  getOpening(id: string): Opening | undefined
  /**
   * Known next moves after `historySan` within this opening (for whichever
   * side is to move). Empty array ⇒ out of book.
   */
  continuations(openingId: string, historySan: string[]): BookMoveOption[]
  /** Is `san` a known continuation after `historySan`? */
  check(openingId: string, historySan: string[], san: string): BookCheckResult
  /**
   * If `historySan` (whose last element is the user's move) exactly matches a
   * trick line's `moves + [wrongReply]`, return that trick line.
   */
  matchTrap(openingId: string, historySan: string[]): TrickLine | undefined
}

// ---------------------------------------------------------------------------
// Engine (src/engine) — Stockfish WASM in a Web Worker
// ---------------------------------------------------------------------------

export interface EngineLine {
  pvSan: string[]
  pvUci: string[]
  /** Centipawns from WHITE's perspective (converted from side-to-move) */
  cp?: number
  /** Mate in N (negative = White gets mated), White's perspective */
  mate?: number
}

export interface EngineAnalysis {
  fen: string
  depth: number
  bestMoveSan: string
  bestMoveUci: string
  /** MultiPV lines, best first */
  lines: EngineLine[]
}

export interface AnalyzeOptions {
  depth?: number
  multiPv?: number
  /** Hard time budget; engine returns best found so far */
  movetimeMs?: number
}

export interface EngineAPI {
  init(): Promise<void>
  analyze(fen: string, opts?: AnalyzeOptions): Promise<EngineAnalysis>
  /** Limited-strength move for the opponent when out of book */
  opponentMove(
    fen: string,
    opts?: { skillLevel?: number; movetimeMs?: number },
  ): Promise<{ san: string; uci: string }>
  dispose(): void
}

// ---------------------------------------------------------------------------
// Coach (src/coach)
// ---------------------------------------------------------------------------

export type Classification = 'book' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export type ReasonCode =
  | 'ok'
  | 'book_move'
  | 'hangs_piece'
  | 'misses_tactic'
  | 'falls_for_trap'
  | 'loses_tempo'
  | 'moves_piece_twice'
  | 'early_queen'
  | 'blocks_development'
  | 'neglects_center'
  | 'weakens_king'
  | 'wrong_move_order'

export interface DevelopmentScore {
  /** Minor pieces developed off their home squares (0–4) */
  developedMinors: number
  castled: boolean
  /** Queen moved before at least 2 minors developed */
  earlyQueen: boolean
  /** Central pawns (d/e) advanced (0–2) */
  centerPawns: number
  /** Tempi wasted (same piece moved twice early, retreats, pointless pawn moves) */
  tempoLoss: number
  /** Composite 0–100 */
  score: number
}

export interface MoveAssessment {
  san: string
  classification: Classification
  /** Centipawns lost vs the best move, from the user's perspective (>= 0) */
  cpLoss: number
  reasonCodes: ReasonCode[]
  bestMoveSan: string
  /** Short feedback shown inline after every move */
  comment: string
  /** True ⇒ game-losing move: stop the session and run stop-and-explain */
  stopGame: boolean
  /** Refutation to animate when stopping (SAN, starting with opponent's move) */
  refutationSan?: string[]
  /** Long-form diagnosis when stopping */
  explanation?: string
  /** How to fix it: the right move and why */
  fix?: string
}

export interface AssessMoveInput {
  openingId: string
  userColor: Color
  /** Full game history in SAN, INCLUDING the user's move as last element */
  historySan: string[]
  fenBefore: string
  fenAfter: string
  san: string
  book: BookCheckResult
  /** Matched trick line if the user just played a known wrongReply */
  trap?: TrickLine
  /** Analysis of fenBefore (multiPv >= 3) */
  evalBefore: EngineAnalysis
  /** Analysis of fenAfter */
  evalAfter: EngineAnalysis
}

export interface CoachAPI {
  assessMove(input: AssessMoveInput): MoveAssessment
  developmentScore(historySan: string[], color: Color): DevelopmentScore
  /** Friendly wrap-up when the user exits book in a sound position */
  outOfBookSummary(historySan: string[], userColor: Color, evalNow: EngineAnalysis): string
}

// ---------------------------------------------------------------------------
// Session (src/store)
// ---------------------------------------------------------------------------

export interface MoveFeedback extends MoveAssessment {
  /** 1-based full-move number */
  moveNumber: number
  color: Color
}

export type SessionStatus =
  | 'picking'
  | 'playing'
  | 'engine_thinking'
  | 'assessing'
  | 'showing_refutation'
  | 'stopped_blunder'
  | 'out_of_book'
  | 'complete'

export interface SessionDeps {
  engine: EngineAPI
  book: OpeningBook
  coach: CoachAPI
}

// ---------------------------------------------------------------------------
// Problems mode (src/problems, src/llm, src/store/problems.ts) — Milestone 6
// ---------------------------------------------------------------------------

/**
 * One bundled tactics problem, curated from the Lichess puzzle database (CC0)
 * by scripts/build-problems.mjs and served from public/problems/.
 */
export interface Problem {
  /** Lichess puzzle id */
  id: string
  /** Position BEFORE the setup move (Lichess convention) */
  fen: string
  /**
   * UCI moves: `moves[0]` is the opponent's setup move (auto-played on load);
   * the user's solution starts at `moves[1]` and alternates user/opponent.
   */
  moves: string[]
  /** Lichess difficulty rating */
  rating: number
  /** Lichess motif tags, e.g. "fork", "pin" */
  themes: string[]
}

export interface ProblemThemeInfo {
  /** Motif id used in filenames and lookups, e.g. "fork" */
  id: string
  /** Display name, e.g. "Fork" */
  name: string
  /** One-line description for the picker */
  description: string
  /** File name under /problems/, e.g. "fork.json" */
  file: string
  /** Number of problems in the file */
  count: number
}

export interface ProblemManifest {
  /** Provenance: source dataset name (ADR-0003) */
  source: string
  /** Date of the upstream dump the set was built from (YYYY-MM-DD) */
  sourceDate: string
  generatedAt: string
  license: string
  ratingMin: number
  ratingMax: number
  total: number
  themes: ProblemThemeInfo[]
}

/** Read-only source of bundled problems (fetch + validate, src/problems). */
export interface ProblemSource {
  manifest(): Promise<ProblemManifest>
  /** All problems for one theme; validated before being returned. */
  theme(themeId: string): Promise<Problem[]>
}

/** 5-bucket verdict for the read check, named from White's side. */
export type VerdictBucket =
  | 'white_winning'
  | 'white_better'
  | 'equal'
  | 'black_better'
  | 'black_winning'

/** The user's answers to the read check (CONTEXT.md: "Read check"). */
export interface ReadCheckAnswer {
  /** Material diff in pawns the user believes, White minus Black (Q9 R5 B3 N3 P1) */
  materialDiff: number
  verdict: VerdictBucket
}

/** Machine-checked result of the read check. */
export interface ReadCheckReport {
  materialCorrect: boolean
  /** Actual material diff (White minus Black), computed from the FEN */
  actualMaterialDiff: number
  verdictCorrect: boolean
  /** Bucket derived from the engine's eval */
  actualVerdict: VerdictBucket
  /** White-perspective cp the verdict was derived from (mate mapped via MATE_CP) */
  evalCp: number
  /** Coaching hook, e.g. "You said equal — Stockfish says you're winning. Prove it." */
  comment: string
}

/** One engine line summarised for prose feedback (reasoning coach input). */
export interface EngineLineSummary {
  san: string[]
  /** Human-readable eval from the user's perspective, e.g. "+2.3" or "mate in 2" */
  evalText: string
}

export interface ReasoningGradeInput {
  /** Position the user reasons about (AFTER the setup move; user to move) */
  fen: string
  userColor: Color
  /** The user's free-text reasoning */
  reasoning: string
  /** Authored solution in SAN (user + opponent moves, user first) */
  solutionSan: string[]
  /** Engine ground truth: top lines from the solve position */
  engineLines: EngineLineSummary[]
}

/** Structured feedback from the reasoning coach (validated before rendering). */
export interface ReasoningFeedback {
  goodPoints: string[]
  missed: string[]
  wrong: string[]
  comment: string
}

/**
 * BYOK reasoning coach (ADR-0003). All LLM traffic goes through src/llm —
 * mirror of the src/engine rule. Key lives only in localStorage; no key ⇒
 * hasKey() is false and the app degrades to engine-only feedback.
 */
export interface LlmAPI {
  hasKey(): boolean
  setKey(key: string | null): void
  /** Language-only comparison of the user's prose vs engine lines. */
  gradeReasoning(input: ReasoningGradeInput): Promise<ReasoningFeedback>
}

export type ProblemSessionStatus =
  | 'picking'
  | 'loading'
  | 'read'
  | 'reason'
  | 'grading'
  | 'solve'
  | 'opponent_replying'
  | 'showing_refutation'
  | 'stopped'
  | 'solved'

export interface ProblemsDeps {
  engine: EngineAPI
  problems: ProblemSource
  llm: LlmAPI
}
