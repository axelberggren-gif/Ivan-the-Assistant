/**
 * Public surface of src/problems (Milestone 6 logic layer). The problems
 * store (src/store/problems.ts) and UI build against these exports.
 */
export { createProblemSource, SOLUTION_MOVES_LENGTHS } from './loader'
export {
  materialDiff,
  verdictFromCp,
  analysisCpWhite,
  checkRead,
  VERDICT_BETTER_MIN,
  VERDICT_WINNING_MIN,
} from './read'
export {
  uciToSan,
  sanLineFromUci,
  isSolutionMove,
  gradeLine,
  engineLineSummaries,
  formatSanLine,
} from './solve'
export type { LineDeviation, LineGrade } from './solve'
export {
  readCheckComment,
  wrongLineVerdict,
  buildingLineNotice,
  tryAgainNotice,
  wrongMoveExplanation,
  wrongDefenceExplanation,
  fixReminder,
  curatedMotifNames,
  solvedMessage,
  setupMoveNotice,
  selfCheckNotice,
  answerHeldNotice,
  oneLineAttemptNotice,
  exploreHint,
} from './templates'
export type {
  ReadCheckCommentOpts,
  WrongMoveOpts,
  WrongDefenceOpts,
  SolvedOpts,
} from './templates'
