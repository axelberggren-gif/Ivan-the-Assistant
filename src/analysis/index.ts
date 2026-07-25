/**
 * src/analysis — deep analysis of real games (PLAN.md §5.2, ADR-0005).
 *
 * The public surface the store and UI import from. Deliberately
 * chess.com-agnostic: everything here works from SAN moves and a colour, so
 * Phase 5's post-game review of in-app games reuses it unchanged.
 */
export {
  ANALYSIS_VERSION,
  DEFAULT_BUDGET,
  analysisCpWhite,
  annotateGame,
  budgetSignature,
  resolveBudget,
  verifyMove,
  type AnnotateOptions,
} from './annotate'

export {
  OPENING_LAST_FULL_MOVE,
  OPENING_PLY_COUNT,
  PHASES,
  buildWeaknessReport,
  phaseForMoveNumber,
} from './aggregate'

export { parseGameMoves, selectGamesForAnalysis } from './pgn'

export { createAnalysisQueue } from './queue'

export {
  EMPTY_REPORT_NOTICE,
  PHASE_LABELS,
  formatEta,
  progressLabel,
  reasonHint,
  reasonLabel,
} from './templates'

export type {
  AnalysisBudget,
  AnalysisCache,
  AnalysisDeps,
  AnalysisGameInput,
  AnalysisGameMeta,
  AnalysisPhase,
  AnalysisProgress,
  AnalysisQueue,
  AnalysisRunResult,
  AnnotatedGame,
  AnnotatedMove,
  DevelopmentDiagnosis,
  GamePhase,
  PhaseStats,
  ReasonTally,
  RunOptions,
  SelectableGame,
  TruncationReason,
  WeaknessReport,
  WorstMoment,
} from './types'
