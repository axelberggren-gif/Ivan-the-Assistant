import { Chess } from 'chess.js'
import type { Color, DevelopmentScore } from '../types'
import { HOME_SQUARES, countCenterPawns, countDevelopedMinors, toCc } from './position'

/** Full-move window in which repeat moves / retreats count as tempo loss. */
const TEMPO_WINDOW = 10
/** Full-move window in which a queen sortie counts as "early". */
const EARLY_QUEEN_WINDOW = 6

/**
 * Replay `historySan` from the starting position and score `color`'s opening
 * play. Weighting: minors 15 each (60), castling 20, center pawns 10 each
 * (20); minus 15 for an early queen and 10 per lost tempo; clamped 0-100.
 */
export function developmentScore(historySan: string[], color: Color): DevelopmentScore {
  const chess = new Chess()
  const c = toCc(color)
  // square -> how many times the piece currently on it has moved
  const movedCounts = new Map<string, number>()
  let castled = false
  let earlyQueen = false
  let tempoLoss = 0

  for (let i = 0; i < historySan.length; i++) {
    let m
    try {
      m = chess.move(historySan[i])
    } catch {
      break // ignore an unreplayable tail rather than throwing at the UI
    }
    const prev = movedCounts.get(m.from) ?? 0
    movedCounts.delete(m.from)
    movedCounts.set(m.to, prev + 1)

    if (m.color !== c) continue
    const fullMove = Math.floor(i / 2) + 1
    if (m.san.startsWith('O-O')) {
      castled = true
      continue
    }
    if (m.piece !== 'p' && m.piece !== 'k' && fullMove <= TEMPO_WINDOW && prev >= 1) {
      tempoLoss++ // same piece moved again in the opening
      const homes = HOME_SQUARES[c][m.piece] ?? []
      if (homes.includes(m.to)) tempoLoss++ // and it went all the way home
    }
    if (
      m.piece === 'q' &&
      fullMove <= EARLY_QUEEN_WINDOW &&
      countDevelopedMinors(chess, color) < 2
    ) {
      earlyQueen = true
    }
  }

  const developedMinors = countDevelopedMinors(chess, color)
  const centerPawns = countCenterPawns(chess, color)

  let score = developedMinors * 15 + (castled ? 20 : 0) + centerPawns * 10
  if (earlyQueen) score -= 15
  score -= tempoLoss * 10
  score = Math.max(0, Math.min(100, score))

  return { developedMinors, castled, earlyQueen, centerPawns, tempoLoss, score }
}
