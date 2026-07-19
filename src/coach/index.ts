/**
 * Coaching brain: move classification, reason-code heuristics, and
 * template-based feedback. See src/types.ts for the CoachAPI contract.
 */
import { Chess } from 'chess.js'
import type {
  AssessMoveInput,
  Classification,
  CoachAPI,
  Color,
  EngineAnalysis,
  MoveAssessment,
  ReasonCode,
} from '../types'
import { bestLineUserCp, computeCpLoss } from './eval'
import { developmentScore } from './development'
import { detectHangsPiece, lastMoveFacts } from './position'
import { buildBookComment, buildComment, reasonPhrase } from './templates'

// Classification thresholds (cpLoss from the user's perspective)
const GOOD_MAX = 30 // < 30 → good
const INACCURACY_MAX = 90 // 30-90 → inaccuracy
const MISTAKE_MAX = 200 // 91-200 → mistake, > 200 → blunder
// "Threw a holdable position": eval collapses below this after the move...
const COLLAPSE_AFTER = -250
// ...while it was still above this before the move.
const COLLAPSE_BEFORE = -100
// Evidence thresholds for reason codes
const MISSED_TACTIC_MARGIN = 150
const HANG_CHECK_MIN_LOSS = 90
const REFUTATION_PLIES = 6

export function createCoach(): CoachAPI {
  return {
    assessMove,
    developmentScore,
    outOfBookSummary,
  }
}

function assessMove(input: AssessMoveInput): MoveAssessment {
  const { san, userColor, evalBefore, evalAfter } = input
  const seed = input.historySan.length
  const cpLoss = computeCpLoss(evalBefore, evalAfter, userColor)

  // (a) Authored trap content always wins over generic engine text.
  if (input.trap) {
    const label = input.trap.name ?? 'a known trap in this opening'
    return {
      san,
      classification: 'blunder',
      cpLoss,
      reasonCodes: ['falls_for_trap'],
      bestMoveSan: input.trap.fixMove,
      comment: `You took the bait — ${label}.`,
      stopGame: true,
      refutationSan: [...input.trap.punishment],
      explanation: input.trap.explanation,
      fix: input.trap.fix,
    }
  }

  // (c) Book move — unless the data is bad and it actually loses > 90cp.
  if (input.book.inBook && cpLoss <= INACCURACY_MAX) {
    return {
      san,
      classification: 'book',
      cpLoss,
      reasonCodes: ['book_move'],
      bestMoveSan: evalBefore.bestMoveSan || san,
      comment: buildBookComment(san, input.book, seed),
      stopGame: false,
    }
  }

  // (d) Classify by cpLoss, plus the thrown-position rule.
  const beforeUser = bestLineUserCp(evalBefore, userColor)
  const afterUser = bestLineUserCp(evalAfter, userColor)
  let classification: Exclude<Classification, 'book'>
  if (cpLoss < GOOD_MAX) classification = 'good'
  else if (cpLoss <= INACCURACY_MAX) classification = 'inaccuracy'
  else if (cpLoss <= MISTAKE_MAX) classification = 'mistake'
  else classification = 'blunder'
  const threwPosition = afterUser < COLLAPSE_AFTER && beforeUser > COLLAPSE_BEFORE
  if (threwPosition) classification = 'blunder'
  const stopGame = classification === 'blunder'

  // (e) Reason codes, in priority order, only with concrete evidence.
  const reasonCodes: ReasonCode[] = []
  const pvAfter = evalAfter.lines[0]?.pvSan ?? []
  if (
    (cpLoss >= HANG_CHECK_MIN_LOSS || threwPosition) &&
    detectHangsPiece(input.fenAfter, pvAfter, userColor)
  ) {
    reasonCodes.push('hangs_piece')
  }
  if (cpLoss >= MISSED_TACTIC_MARGIN && san !== evalBefore.bestMoveSan) {
    reasonCodes.push('misses_tactic')
  }
  const facts = lastMoveFacts(input.historySan)
  if (facts) {
    if (facts.earlyQueen) reasonCodes.push('early_queen')
    if (facts.movedTwice) reasonCodes.push('moves_piece_twice')
    if (facts.retreatToHome) reasonCodes.push('loses_tempo')
    if (facts.blocksDevelopment) reasonCodes.push('blocks_development')
    if (facts.neglectsCenter) reasonCodes.push('neglects_center')
    if (facts.weakensKing) reasonCodes.push('weakens_king')
  }
  if (reasonCodes.length === 0) reasonCodes.push('ok')
  const primary = reasonCodes[0]

  // (f) Inline comment from the template library.
  const bestMoveSan = evalBefore.bestMoveSan || san
  const comment = buildComment(classification, primary, { san, best: bestMoveSan }, seed)

  const assessment: MoveAssessment = {
    san,
    classification,
    cpLoss,
    reasonCodes,
    bestMoveSan,
    comment,
    stopGame,
  }

  // (g) Stop-and-explain package for non-trap blunders.
  if (stopGame) {
    const refutationSan = pvAfter.slice(0, REFUTATION_PLIES)
    assessment.refutationSan = refutationSan
    assessment.explanation = buildStopExplanation(san, primary, cpLoss, refutationSan, seed)
    assessment.fix = `${bestMoveSan} was the right move — ${describeBestMove(
      input.fenBefore,
      bestMoveSan,
    )}.`
  }

  return assessment
}

/** 2-4 sentence diagnosis shown when the game is stopped after a blunder. */
function buildStopExplanation(
  san: string,
  primary: ReasonCode,
  cpLoss: number,
  refutationSan: string[],
  seed: number,
): string {
  const refText = refutationSan.join(' ')
  const sentences: string[] = []
  sentences.push(`${san} is a game-losing move.`)
  if (primary === 'hangs_piece' && refText) {
    sentences.push(`After ${refText} you simply lose material — the piece ends up undefended.`)
  } else {
    const phrase = reasonPhrase(primary, seed)
    if (primary !== 'ok') {
      sentences.push(`The core problem: ${phrase}.`)
    }
    if (refText) {
      sentences.push(`The punishing line is ${refText}, and your position collapses.`)
    }
  }
  sentences.push(`Overall this cost you about ${Math.round(cpLoss)} centipawns.`)
  return sentences.join(' ')
}

/** Why the best move was right, from its concrete role in the position. */
function describeBestMove(fenBefore: string, bestSan: string): string {
  try {
    const chess = new Chess(fenBefore)
    const m = chess.move(bestSan)
    if (m.san.startsWith('O-O')) return 'it tucks your king into safety'
    if (m.captured) return 'it deals with the threat by capturing'
    if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to)) {
      return 'it fights for the center'
    }
    if (m.piece === 'n' || m.piece === 'b') {
      return 'it develops a piece and keeps everything defended'
    }
    return 'it keeps your position solid and your pieces coordinated'
  } catch {
    return 'it keeps your position solid'
  }
}

/** (3) Friendly wrap-up when the user leaves book in a sound position. */
function outOfBookSummary(
  historySan: string[],
  userColor: Color,
  evalNow: EngineAnalysis,
): string {
  const cp = bestLineUserCp(evalNow, userColor)
  const dev = developmentScore(historySan, userColor)

  let verdict: string
  if (cp >= 80) verdict = "you're clearly better here"
  else if (cp >= -40) verdict = 'the position is roughly level'
  else if (cp >= -150) verdict = "you're only slightly worse"
  else verdict = "you're under some pressure"

  const minors =
    dev.developedMinors === 1
      ? '1 minor piece is developed'
      : `${dev.developedMinors} minor pieces are developed`
  const king = dev.castled
    ? 'your king is safely castled'
    : "you haven't castled yet, so make that a priority"

  return (
    `That's the end of the theory we know here — from now on you're on your own, and ${verdict}. ` +
    `So far ${minors} and ${king}. ` +
    'Keep developing toward the center and play natural, solid moves.'
  )
}
