/**
 * Read check (CONTEXT.md): the machine-checked situational-awareness gate
 * before reasoning — material count verified against the FEN, verdict guess
 * compared against the engine's eval bucket.
 *
 * Pure and Node-testable: no fetch, no DOM, no chess.js. Centipawns are
 * White-perspective everywhere (repo invariant); conversion to the user's
 * perspective happens only via src/coach/eval helpers.
 *
 * The verdict thresholds live HERE and only here — never duplicate them in
 * UI or store (mirror of the src/coach threshold rule).
 */
import type {
  Color,
  EngineAnalysis,
  ReadCheckAnswer,
  ReadCheckReport,
  VerdictBucket,
} from '../types'
import { lineCpWhite } from '../coach/eval'
import { readCheckComment } from './templates'

/** |cp| below this ⇒ 'equal'. */
export const VERDICT_BETTER_MIN = 80
/** |cp| at or above this ⇒ 'winning'; between the two ⇒ 'better'. */
export const VERDICT_WINNING_MIN = 250

/** Standard point values in pawns; kings are ignored. */
const PIECE_PAWNS: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 }

/**
 * Material difference in pawns, White minus Black, parsed straight from the
 * FEN board field (promotions are naturally counted — the board is truth).
 */
export function materialDiff(fen: string): number {
  const board = fen.split(' ')[0] ?? ''
  let diff = 0
  for (const ch of board) {
    const value = PIECE_PAWNS[ch.toLowerCase()]
    if (value === undefined) continue
    // Uppercase = White piece, lowercase = Black piece (FEN convention).
    diff += ch === ch.toUpperCase() ? value : -value
  }
  return diff
}

/** Map a White-perspective cp value (mate already mapped via MATE_CP) to a bucket. */
export function verdictFromCp(cpWhite: number): VerdictBucket {
  const magnitude = Math.abs(cpWhite)
  if (magnitude < VERDICT_BETTER_MIN) return 'equal'
  if (cpWhite > 0) return magnitude >= VERDICT_WINNING_MIN ? 'white_winning' : 'white_better'
  return magnitude >= VERDICT_WINNING_MIN ? 'black_winning' : 'black_better'
}

/** Best line's White-perspective cp (mate mapped via MATE_CP); 0 if no lines. */
export function analysisCpWhite(analysis: EngineAnalysis): number {
  const best = analysis.lines[0]
  return best ? lineCpWhite(best) : 0
}

/**
 * Grade the user's read check against the FEN (material) and the engine's
 * eval (verdict). The comment is phrased from the USER's perspective and
 * carries the PLAN §8.1 hook when they misjudged a winning position.
 */
export function checkRead(
  answer: ReadCheckAnswer,
  fen: string,
  analysis: EngineAnalysis,
  userColor: Color,
): ReadCheckReport {
  const actualMaterialDiff = materialDiff(fen)
  const evalCp = analysisCpWhite(analysis)
  const actualVerdict = verdictFromCp(evalCp)
  const materialCorrect = answer.materialDiff === actualMaterialDiff
  const verdictCorrect = answer.verdict === actualVerdict
  const comment = readCheckComment({
    materialCorrect,
    verdictCorrect,
    saidVerdict: answer.verdict,
    actualVerdict,
    actualMaterialDiff,
    userColor,
  })
  return { materialCorrect, actualMaterialDiff, verdictCorrect, actualVerdict, evalCp, comment }
}
