/**
 * AnnotatedGame[] → WeaknessReport. Pure: no engine, no fetch, no DOM.
 *
 * This module owns the phase definition (`phaseForMoveNumber`) — the boundary
 * between opening and middlegame lives here and nowhere else.
 */
import type { ReasonCode } from '../types'
import {
  developmentComment,
  reasonHint,
  reasonLabel,
  reportFindings,
  reportHeadline,
} from './templates'
import type {
  AnnotatedGame,
  AnnotatedMove,
  DevelopmentDiagnosis,
  GamePhase,
  PhaseStats,
  ReasonTally,
  WeaknessReport,
  WorstMoment,
} from './types'

/** Last full move counted as "the opening" — the coach's home ground. */
export const OPENING_LAST_FULL_MOVE = 12
/** Plies of history the development score is measured over (moves 1–12). */
export const OPENING_PLY_COUNT = OPENING_LAST_FULL_MOVE * 2

export const PHASES: GamePhase[] = ['opening', 'middlegame']

export function phaseForMoveNumber(moveNumber: number): GamePhase {
  return moveNumber <= OPENING_LAST_FULL_MOVE ? 'opening' : 'middlegame'
}

/** Reason codes that describe a non-problem and never belong in "recurring". */
const NON_FINDING_CODES = new Set<ReasonCode>(['ok', 'book_move'])

/** How many worst moments the report surfaces. */
const WORST_MOMENTS = 10

/** A move is only worth listing as a "moment" once it costs at least this much. */
const WORST_MOMENT_MIN_CP_LOSS = 100

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function buildPhaseStats(moves: AnnotatedMove[]): PhaseStats[] {
  return PHASES.map((phase) => {
    const inPhase = moves.filter((m) => m.phase === phase)
    return {
      phase,
      moves: inPhase.length,
      avgCpLoss: mean(inPhase.map((m) => m.cpLoss)),
      inaccuracies: inPhase.filter((m) => m.classification === 'inaccuracy').length,
      mistakes: inPhase.filter((m) => m.classification === 'mistake').length,
      blunders: inPhase.filter((m) => m.classification === 'blunder').length,
    }
  })
}

function buildTimeline(
  moves: AnnotatedMove[],
): Array<{ moveNumber: number; mistakes: number; blunders: number }> {
  const byMove = new Map<number, { mistakes: number; blunders: number }>()
  for (const move of moves) {
    if (move.classification !== 'mistake' && move.classification !== 'blunder') continue
    const entry = byMove.get(move.moveNumber) ?? { mistakes: 0, blunders: 0 }
    if (move.classification === 'blunder') entry.blunders++
    else entry.mistakes++
    byMove.set(move.moveNumber, entry)
  }
  return [...byMove.entries()]
    .map(([moveNumber, counts]) => ({ moveNumber, ...counts }))
    .sort((a, b) => a.moveNumber - b.moveNumber)
}

function buildRecurring(games: AnnotatedGame[]): ReasonTally[] {
  const counts = new Map<ReasonCode, { count: number; games: Set<string> }>()
  for (const game of games) {
    for (const move of game.moves) {
      // Only moves that actually went wrong contribute a pattern — a reason
      // code on a "good" move is a note, not a weakness.
      if (move.classification === 'good') continue
      for (const code of move.reasonCodes) {
        if (NON_FINDING_CODES.has(code)) continue
        const entry = counts.get(code) ?? { count: 0, games: new Set<string>() }
        entry.count++
        entry.games.add(game.id)
        counts.set(code, entry)
      }
    }
  }
  return [...counts.entries()]
    .map(([code, { count, games: gameIds }]) => ({
      code,
      count,
      games: gameIds.size,
      label: reasonLabel(code),
      hint: reasonHint(code),
    }))
    .sort((a, b) => b.count - a.count || b.games - a.games)
}

/**
 * Full-move number the user most often first drifts at: the first move in each
 * game worse than an inaccuracy. Needs the same number to repeat in at least
 * two games, otherwise there is no pattern to report.
 */
function driftMoveNumber(games: AnnotatedGame[]): number | undefined {
  const firstDrifts: number[] = []
  for (const game of games) {
    const drift = game.moves.find(
      (m) => m.classification === 'mistake' || m.classification === 'blunder',
    )
    if (drift) firstDrifts.push(drift.moveNumber)
  }
  const counts = new Map<number, number>()
  for (const moveNumber of firstDrifts) {
    counts.set(moveNumber, (counts.get(moveNumber) ?? 0) + 1)
  }
  let best: number | undefined
  let bestCount = 1 // a single occurrence is not a pattern
  for (const [moveNumber, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      best = moveNumber
      bestCount = count
    }
  }
  return best
}

function buildDevelopment(games: AnnotatedGame[]): DevelopmentDiagnosis {
  const scores = games.map((g) => g.development)
  const diagnosis = {
    avgScore: mean(scores.map((d) => d.score)),
    gamesUncastled: scores.filter((d) => !d.castled).length,
    gamesEarlyQueen: scores.filter((d) => d.earlyQueen).length,
    avgTempoLoss: mean(scores.map((d) => d.tempoLoss)),
    avgDevelopedMinors: mean(scores.map((d) => d.developedMinors)),
    driftMoveNumber: driftMoveNumber(games),
  }
  return {
    ...diagnosis,
    comment: developmentComment({ gamesAnalysed: games.length, ...diagnosis }),
  }
}

function buildWorstMoments(games: AnnotatedGame[]): WorstMoment[] {
  const moments: WorstMoment[] = []
  for (const game of games) {
    for (const move of game.moves) {
      if (move.cpLoss < WORST_MOMENT_MIN_CP_LOSS) continue
      moments.push({
        ...move,
        gameId: game.id,
        url: game.meta.url,
        endTimeMs: game.meta.endTimeMs,
        opponentUsername: game.meta.opponentUsername,
        openingFamily: game.meta.openingFamily,
      })
    }
  }
  return moments.sort((a, b) => b.cpLoss - a.cpLoss).slice(0, WORST_MOMENTS)
}

/**
 * Aggregate annotated games into the weakness report shown on the insights
 * screen. Games with no judged moves are dropped — they carry no signal and
 * would only dilute the averages.
 */
export function buildWeaknessReport(annotated: AnnotatedGame[]): WeaknessReport {
  const games = annotated.filter((g) => g.moves.length > 0)
  const moves = games.flatMap((g) => g.moves)

  const byPhase = buildPhaseStats(moves)
  const recurring = buildRecurring(games)
  const development = buildDevelopment(games)
  const worstMoments = buildWorstMoments(games)

  const blunders = moves.filter((m) => m.classification === 'blunder').length
  const avgCpLoss = mean(moves.map((m) => m.cpLoss))
  const worstPhase = [...byPhase]
    .filter((p) => p.moves > 0)
    .sort((a, b) => b.avgCpLoss - a.avgCpLoss)[0]?.phase

  return {
    gamesAnalysed: games.length,
    movesAnalysed: moves.length,
    avgCpLoss,
    inaccuracies: moves.filter((m) => m.classification === 'inaccuracy').length,
    mistakes: moves.filter((m) => m.classification === 'mistake').length,
    blunders,
    blundersPerGame: games.length === 0 ? 0 : blunders / games.length,
    byPhase,
    timeline: buildTimeline(moves),
    development,
    recurring,
    worstMoments,
    headline: reportHeadline({
      gamesAnalysed: games.length,
      blunders,
      avgCpLoss,
      worstPhase,
    }),
    findings: reportFindings({ byPhase, recurring, development, worstMoments }),
  }
}
