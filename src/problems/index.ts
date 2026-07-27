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
  engineLineSummaries,
  formatSanLine,
} from './solve'
export {
  readCheckComment,
  wrongMoveVerdict,
  correctMoveNotice,
  tryAgainNotice,
  wrongMoveExplanation,
  fixReminder,
  curatedMotifNames,
  solvedMessage,
  setupMoveNotice,
  selfCheckNotice,
  oneLineAttemptNotice,
  exploreHint,
} from './templates'
export type { ReadCheckCommentOpts, WrongMoveOpts, SolvedOpts } from './templates'
