/**
 * One game → AnnotatedGame, driving the injected engine.
 *
 * Impure (engine calls) but engine-agnostic: it takes an `EngineAPI` and is
 * therefore testable against a fake, the same seam session.ts uses.
 *
 * Classification comes from src/coach (`classifyMove` / `deriveReasonCodes`,
 * ADR-0005 decision 2). The thresholds are NOT duplicated here and must never
 * be — see src/coach/CLAUDE.md.
 */
import { Chess } from 'chess.js'
import type { Color, EngineAnalysis, EngineAPI } from '../types'
import { classifyMove, deriveReasonCodes } from '../coach'
import { developmentScore } from '../coach/development'
import { lineCpWhite } from '../coach/eval'
import { OPENING_PLY_COUNT, phaseForMoveNumber } from './aggregate'
import type {
  AnalysisBudget,
  AnalysisGameInput,
  AnnotatedGame,
  AnnotatedMove,
  TruncationReason,
} from './types'

/**
 * Bumping this invalidates every cached annotation. Bump it whenever the
 * meaning of an AnnotatedGame changes (new fields, changed classification).
 */
export const ANALYSIS_VERSION = 1

/**
 * The default budget (ADR-0005 decision 4). One search per position — the eval
 * after move N is the eval before move N+1 — so a 30-move pass is ~61 searches
 * at 150ms, about 12s per game.
 */
export const DEFAULT_BUDGET: AnalysisBudget = {
  movetimeMs: 150,
  plyCap: 60,
  multiPv: 3,
  decidedCp: 800,
  decidedPlies: 6,
  minPlies: 10,
  maxGames: 25,
  verifyTopN: 10,
  verifyDepth: 16,
}

/**
 * Cache-key component: any budget change that would alter the numbers
 * invalidates cached annotations. `maxGames` and `verifyTopN` are deliberately
 * excluded — they change how many games are analysed, not what an annotation
 * of one game says.
 */
export function budgetSignature(budget: AnalysisBudget): string {
  return [
    `v${ANALYSIS_VERSION}`,
    `mt${budget.movetimeMs}`,
    `pc${budget.plyCap}`,
    `pv${budget.multiPv}`,
    `dc${budget.decidedCp}`,
    `dp${budget.decidedPlies}`,
  ].join('-')
}

export function resolveBudget(partial?: Partial<AnalysisBudget>): AnalysisBudget {
  return { ...DEFAULT_BUDGET, ...partial }
}

export interface AnnotateOptions {
  budget?: Partial<AnalysisBudget>
  signal?: AbortSignal
  /** Called after each position is evaluated, for the progress bar. */
  onPly?: (pliesDone: number, pliesTotal: number) => void
}

/** White-perspective cp of an analysis's best line (mate mapped via MATE_CP). */
export function analysisCpWhite(analysis: EngineAnalysis): number {
  const line = analysis.lines[0]
  return line ? lineCpWhite(line) : 0
}

/** Whose move it is at position index `ply` (0-based, White moves first). */
function moverAt(ply: number): Color {
  return ply % 2 === 0 ? 'white' : 'black'
}

/**
 * Annotate one game. Only the USER's moves are judged, but every position up to
 * the budget's cap is evaluated once: the eval after the user's move is also
 * the eval before the opponent's reply.
 *
 * Stops early on the ply cap, on a decided position (the eval has stayed beyond
 * ±`decidedCp` for `decidedPlies` plies — blunders in an already-won or
 * already-lost game are not lessons), or on abort. An aborted game keeps the
 * moves it managed to judge and is marked `truncated: 'aborted'` so the caller
 * knows not to cache it.
 */
export async function annotateGame(
  input: AnalysisGameInput,
  engine: EngineAPI,
  opts: AnnotateOptions = {},
): Promise<AnnotatedGame> {
  const budget = resolveBudget(opts.budget)
  const { userColor } = input

  // Replay the game once: fens[i] is the position BEFORE ply i.
  const chess = new Chess()
  const fens: string[] = [chess.fen()]
  const sans: string[] = []
  for (const san of input.movesSan) {
    try {
      chess.move(san)
    } catch {
      break // an unreplayable tail is dropped, never thrown at the UI
    }
    sans.push(san)
    fens.push(chess.fen())
  }

  const pliesTotal = sans.length
  const lastPly = Math.min(pliesTotal, budget.plyCap)
  const positionsTotal = lastPly + 1

  const analyses: EngineAnalysis[] = []
  let truncated: TruncationReason | undefined
  let decidedRun = 0

  for (let i = 0; i < positionsTotal; i++) {
    if (opts.signal?.aborted) {
      truncated = 'aborted'
      break
    }
    // MultiPV 3 only where the USER is to move — that is the only place a
    // "better move" has to be named. Elsewhere one line is enough.
    const multiPv = moverAt(i) === userColor ? budget.multiPv : 1
    analyses.push(
      await engine.analyze(fens[i], { movetimeMs: budget.movetimeMs, multiPv }),
    )
    opts.onPly?.(i + 1, positionsTotal)

    if (Math.abs(analysisCpWhite(analyses[i])) > budget.decidedCp) decidedRun++
    else decidedRun = 0
    if (decidedRun >= budget.decidedPlies && i + 1 < positionsTotal) {
      truncated = 'decided'
      break
    }
  }

  // A move can only be judged when we have the eval on BOTH sides of it.
  const pliesJudgeable = Math.max(0, analyses.length - 1)
  if (truncated === undefined && pliesJudgeable < pliesTotal) truncated = 'ply_cap'

  const moves: AnnotatedMove[] = []
  for (let ply = 0; ply < pliesJudgeable; ply++) {
    if (moverAt(ply) !== userColor) continue
    const evalBefore = analyses[ply]
    const evalAfter = analyses[ply + 1]
    const verdict = classifyMove(evalBefore, evalAfter, userColor)
    const historySan = sans.slice(0, ply + 1)
    const moveNumber = Math.floor(ply / 2) + 1
    moves.push({
      ply,
      moveNumber,
      color: userColor,
      san: sans[ply],
      fenBefore: fens[ply],
      cpBefore: analysisCpWhite(evalBefore),
      cpAfter: analysisCpWhite(evalAfter),
      cpLoss: verdict.cpLoss,
      classification: verdict.classification,
      reasonCodes: deriveReasonCodes({
        historySan,
        fenAfter: fens[ply + 1],
        san: sans[ply],
        evalBefore,
        evalAfter,
        userColor,
        cpLoss: verdict.cpLoss,
        threwPosition: verdict.threwPosition,
      }),
      bestMoveSan: evalBefore.bestMoveSan || sans[ply],
      phase: phaseForMoveNumber(moveNumber),
    })
  }

  return {
    id: input.id,
    userColor,
    meta: input.meta ?? {},
    pliesTotal,
    pliesAnalysed: pliesJudgeable,
    ...(truncated ? { truncated } : {}),
    moves,
    development: developmentScore(sans.slice(0, OPENING_PLY_COUNT), userColor),
    signature: budgetSignature(budget),
  }
}

/**
 * Re-judge one already-annotated move at full depth. A 150ms search is enough
 * to find the shape of a game but not to headline a finding, so the worst
 * moments are re-checked before they are shown (ADR-0005 decision 4b).
 *
 * Returns the move re-classified and marked `verified`. Both positions are
 * searched again: cpLoss is a difference, so re-evaluating only one side of the
 * move would compare a deep eval against a shallow one.
 *
 * `historySan` (the game's moves up to and including this one) is what the
 * history-based reason codes need; without it the original codes are kept
 * rather than silently narrowed to the position-based ones.
 */
export async function verifyMove(
  move: AnnotatedMove,
  engine: EngineAPI,
  opts: {
    depth?: number
    multiPv?: number
    signal?: AbortSignal
    historySan?: string[]
  } = {},
): Promise<AnnotatedMove> {
  const depth = opts.depth ?? DEFAULT_BUDGET.verifyDepth
  const multiPv = opts.multiPv ?? DEFAULT_BUDGET.multiPv

  const chess = new Chess(move.fenBefore)
  let fenAfter: string
  try {
    chess.move(move.san)
    fenAfter = chess.fen()
  } catch {
    return move // cannot replay it — leave the shallow verdict alone
  }

  const evalBefore = await engine.analyze(move.fenBefore, { depth, multiPv })
  if (opts.signal?.aborted) return move
  const evalAfter = await engine.analyze(fenAfter, { depth, multiPv: 1 })

  const verdict = classifyMove(evalBefore, evalAfter, move.color)
  const reasonCodes = opts.historySan
    ? deriveReasonCodes({
        historySan: opts.historySan,
        fenAfter,
        san: move.san,
        evalBefore,
        evalAfter,
        userColor: move.color,
        cpLoss: verdict.cpLoss,
        threwPosition: verdict.threwPosition,
      })
    : move.reasonCodes

  return {
    ...move,
    cpBefore: analysisCpWhite(evalBefore),
    cpAfter: analysisCpWhite(evalAfter),
    cpLoss: verdict.cpLoss,
    classification: verdict.classification,
    reasonCodes,
    bestMoveSan: evalBefore.bestMoveSan || move.bestMoveSan,
    verified: true,
  }
}
