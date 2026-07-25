/**
 * All analysis-report prose — mirror of the src/coach/templates.ts rule:
 * logic returns strings from here, components render them and never compose
 * their own coaching text.
 *
 * Tone matches the coach: encouraging, concrete, CONTEXT.md vocabulary
 * (blunder vs mistake, drift, development).
 */
import type { ReasonCode } from '../types'
import type {
  DevelopmentDiagnosis,
  GamePhase,
  PhaseStats,
  ReasonTally,
  WorstMoment,
} from './types'

export const PHASE_LABELS: Record<GamePhase, string> = {
  opening: 'Opening (moves 1–12)',
  middlegame: 'Middlegame (moves 13–30)',
}

/** Short label + one-line coaching hint per reason code. */
const REASON_TEXT: Record<ReasonCode, { label: string; hint: string }> = {
  ok: { label: 'Sound moves', hint: 'Nothing concrete to fix here.' },
  book_move: { label: 'Theory', hint: 'Known opening moves.' },
  hangs_piece: {
    label: 'Leaving pieces hanging',
    hint: 'Before you commit to a move, check every piece you own is defended or safe.',
  },
  misses_tactic: {
    label: 'Missing tactics',
    hint: 'Look for captures, checks and threats first — yours and your opponent’s.',
  },
  falls_for_trap: {
    label: 'Walking into traps',
    hint: 'When a move looks free, ask what your opponent gets in return.',
  },
  loses_tempo: {
    label: 'Losing tempo',
    hint: 'Moving a piece twice in the opening hands your opponent a free move.',
  },
  moves_piece_twice: {
    label: 'Moving the same piece twice',
    hint: 'Get every piece out once before you improve one that is already out.',
  },
  early_queen: {
    label: 'Early queen sorties',
    hint: 'The queen out early becomes a target your opponent develops by attacking.',
  },
  blocks_development: {
    label: 'Blocking your own pieces',
    hint: 'Watch for moves that shut in your own bishop or freeze a centre pawn.',
  },
  neglects_center: {
    label: 'Neglecting the centre',
    hint: 'Stake a claim with a d- or e-pawn early; the centre decides where the game is played.',
  },
  weakens_king: {
    label: 'Loosening your king',
    hint: 'Early f/g/h pawn pushes open lines toward your own king.',
  },
  wrong_move_order: {
    label: 'Move-order slips',
    hint: 'Right ideas, wrong order — play the move your opponent can least afford to allow.',
  },
}

export function reasonLabel(code: ReasonCode): string {
  return REASON_TEXT[code]?.label ?? 'Something to work on'
}

export function reasonHint(code: ReasonCode): string {
  return REASON_TEXT[code]?.hint ?? 'Slow down on moves like this one.'
}

/** Shown instead of a report when nothing could be analysed. */
export const EMPTY_REPORT_NOTICE =
  'No games could be analysed yet — load your chess.com games first, and make sure some of them are rated games of at least a few moves.'

/** One-line headline over the weakness panel. */
export function reportHeadline(input: {
  gamesAnalysed: number
  blunders: number
  avgCpLoss: number
  worstPhase?: GamePhase
}): string {
  const { gamesAnalysed, blunders, avgCpLoss, worstPhase } = input
  const games = `${gamesAnalysed} ${gamesAnalysed === 1 ? 'game' : 'games'}`
  if (blunders === 0) {
    return `Across ${games} Stockfish found no outright blunders — you gave away ${Math.round(
      avgCpLoss,
    )} centipawns per move on average.`
  }
  const where = worstPhase ? ` Most of the damage happens in the ${phaseWord(worstPhase)}.` : ''
  return (
    `Across ${games} you played ${blunders} ${blunders === 1 ? 'blunder' : 'blunders'}, ` +
    `losing ${Math.round(avgCpLoss)} centipawns per move on average.${where}`
  )
}

function phaseWord(phase: GamePhase): string {
  return phase === 'opening' ? 'opening' : 'middlegame'
}

/** "3 of 8 games" / "every one of 8 games" / "the only game analysed". */
function countOfTotal(count: number, total: number): string {
  if (total === 1) return 'the only game analysed'
  if (count === total) return `every one of ${total} games`
  return `${count} of ${total} games`
}

/** Concrete findings listed under the headline, most useful first. */
export function reportFindings(input: {
  byPhase: PhaseStats[]
  recurring: ReasonTally[]
  development: DevelopmentDiagnosis
  worstMoments: WorstMoment[]
}): string[] {
  const findings: string[] = []

  const worst = [...input.byPhase]
    .filter((p) => p.moves > 0)
    .sort((a, b) => b.avgCpLoss - a.avgCpLoss)[0]
  if (worst) {
    findings.push(
      `Your ${phaseWord(worst.phase)} costs you the most: ${Math.round(
        worst.avgCpLoss,
      )} centipawns per move over ${worst.moves} ${worst.moves === 1 ? 'move' : 'moves'}, ` +
        `with ${worst.blunders} ${worst.blunders === 1 ? 'blunder' : 'blunders'} and ${
          worst.mistakes
        } ${worst.mistakes === 1 ? 'mistake' : 'mistakes'}.`,
    )
  }

  const top = input.recurring[0]
  if (top) {
    findings.push(
      `Your most repeated pattern is “${top.label.toLowerCase()}” — ${top.count} ${
        top.count === 1 ? 'time' : 'times'
      } across ${top.games} ${top.games === 1 ? 'game' : 'games'}. ${top.hint}`,
    )
  }

  const drift = input.development.driftMoveNumber
  if (drift !== undefined) {
    findings.push(
      `You most often drift first at move ${drift} — that is where the theory you know runs out.`,
    )
  }

  const moment = input.worstMoments[0]
  if (moment) {
    findings.push(
      `Your single worst moment: ${moment.moveNumber}${
        moment.color === 'white' ? '.' : '...'
      }${moment.san} cost ${Math.round(moment.cpLoss)} centipawns — ${
        moment.bestMoveSan
      } was the move.`,
    )
  }

  return findings
}

/** Prose for the opening-phase diagnosis, using the coach's own heuristics. */
export function developmentComment(input: {
  gamesAnalysed: number
  avgScore: number
  gamesUncastled: number
  gamesEarlyQueen: number
  avgTempoLoss: number
  avgDevelopedMinors: number
}): string {
  const { gamesAnalysed, avgScore, gamesUncastled, gamesEarlyQueen, avgTempoLoss } = input
  if (gamesAnalysed === 0) return 'Not enough games analysed to judge your development yet.'

  const sentences: string[] = []
  sentences.push(
    `Your development score at the end of the opening averages ${Math.round(avgScore)} out of 100.`,
  )
  if (gamesUncastled > 0) {
    sentences.push(
      `You were still uncastled by move 12 in ${countOfTotal(gamesUncastled, gamesAnalysed)}` +
        ' — castling earlier is the cheapest improvement available to you.',
    )
  }
  if (gamesEarlyQueen > 0) {
    sentences.push(
      `The queen came out early in ${countOfTotal(gamesEarlyQueen, gamesAnalysed)}, ` +
        'which lets your opponent develop by attacking it.',
    )
  }
  if (avgTempoLoss >= 1) {
    sentences.push(
      `You lose about ${avgTempoLoss.toFixed(1)} tempi per game moving pieces that had already moved.`,
    )
  }
  if (sentences.length === 1) {
    sentences.push('Nothing systematic to fix in your opening play — keep doing what you do.')
  }
  return sentences.join(' ')
}

/** Progress line shown on the insights screen and in the nav chip. */
export function progressLabel(input: {
  phase: 'idle' | 'analysing' | 'verifying' | 'done'
  gamesDone: number
  gamesTotal: number
  etaMs: number | null
}): string {
  if (input.phase === 'verifying') return 'Double-checking your worst moments…'
  if (input.phase === 'done') return 'Analysis complete'
  if (input.phase === 'idle') return 'Ready to analyse'
  const head = `Game ${Math.min(input.gamesDone + 1, input.gamesTotal)} of ${input.gamesTotal}`
  const eta = formatEta(input.etaMs)
  return eta ? `${head} · ${eta}` : head
}

/** "~3 min left" / "~40 sec left"; null while the estimate is unknown. */
export function formatEta(etaMs: number | null): string | null {
  if (etaMs === null || !Number.isFinite(etaMs) || etaMs <= 0) return null
  const seconds = Math.round(etaMs / 1000)
  if (seconds < 90) return `~${Math.max(5, Math.round(seconds / 5) * 5)} sec left`
  return `~${Math.round(seconds / 60)} min left`
}
