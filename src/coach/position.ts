/**
 * chess.js-based position helpers: replaying histories, counting development,
 * and evidence-based heuristics about the last move played.
 */
import { Chess, type Square } from 'chess.js'
import type { Color } from '../types'

type Cc = 'w' | 'b'

export const PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
}

/** Home squares by piece type, per side (used for retreat detection). */
export const HOME_SQUARES: Record<Cc, Record<string, string[]>> = {
  w: { n: ['b1', 'g1'], b: ['c1', 'f1'], q: ['d1'], r: ['a1', 'h1'], k: ['e1'] },
  b: { n: ['b8', 'g8'], b: ['c8', 'f8'], q: ['d8'], r: ['a8', 'h8'], k: ['e8'] },
}

const MINOR_HOMES: Record<Cc, Array<[Square, 'n' | 'b']>> = {
  w: [
    ['b1', 'n'],
    ['g1', 'n'],
    ['c1', 'b'],
    ['f1', 'b'],
  ],
  b: [
    ['b8', 'n'],
    ['g8', 'n'],
    ['c8', 'b'],
    ['f8', 'b'],
  ],
}

const CENTER_PAWN_HOMES: Record<Cc, Square[]> = {
  w: ['d2', 'e2'],
  b: ['d7', 'e7'],
}

/** Early pawn pushes that loosen the king's shelter (fianchetto g3/g6 excluded). */
const KING_WEAKENING_SQUARES: Record<Cc, string[]> = {
  w: ['f3', 'g4', 'h4'],
  b: ['f6', 'g5', 'h5'],
}

export function toCc(color: Color): Cc {
  return color === 'white' ? 'w' : 'b'
}

/** Minor pieces (N/B) no longer sitting on their original home squares (0-4). */
export function countDevelopedMinors(chess: Chess, color: Color): number {
  const c = toCc(color)
  let developed = 0
  for (const [square, type] of MINOR_HOMES[c]) {
    const piece = chess.get(square)
    if (!piece || piece.color !== c || piece.type !== type) developed++
  }
  return developed
}

/** Central d/e pawns that have left their home squares (0-2). */
export function countCenterPawns(chess: Chess, color: Color): number {
  const c = toCc(color)
  let advanced = 0
  for (const square of CENTER_PAWN_HOMES[c]) {
    const piece = chess.get(square)
    if (!piece || piece.color !== c || piece.type !== 'p') advanced++
  }
  return advanced
}

/** Material balance (White minus Black) in pawn units. */
export function materialWhite(chess: Chess): number {
  let total = 0
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue
      const value = PIECE_VALUES[sq.type] ?? 0
      total += sq.color === 'w' ? value : -value
    }
  }
  return total
}

/**
 * Does the opponent's best line win a piece? True when the PV starts with a
 * capture and replaying up to 4 plies of it from `fenAfter` costs the user at
 * least a minor piece (3 pawn units) of material.
 */
export function detectHangsPiece(fenAfter: string, pvSan: string[], userColor: Color): boolean {
  if (pvSan.length === 0 || !pvSan[0].includes('x')) return false
  try {
    const chess = new Chess(fenAfter)
    const before = materialWhite(chess)
    const plies = Math.min(4, pvSan.length)
    for (let i = 0; i < plies; i++) chess.move(pvSan[i])
    const swingWhite = materialWhite(chess) - before
    const swingUser = userColor === 'white' ? swingWhite : -swingWhite
    return swingUser <= -3
  } catch {
    return false
  }
}

/** Evidence about the final move of a history, for reason-code heuristics. */
export interface LastMoveFacts {
  color: Color
  /** 1-based full-move number of the last move */
  fullMove: number
  piece: string
  san: string
  isCapture: boolean
  /** Same piece moved for the second (or more) time within the first 10 moves */
  movedTwice: boolean
  /** Piece returned to one of its home squares after having moved */
  retreatToHome: boolean
  /** Queen moved within the first 6 moves with < 2 minors developed */
  earlyQueen: boolean
  /** Move blocks own development (piece in front of center pawn, d3/d6 pawn) */
  blocksDevelopment: boolean
  /** Early f/g/h pawn push loosening the king */
  weakensKing: boolean
  /** No center pawn advanced by full move 4+ */
  neglectsCenter: boolean
}

/**
 * Replay `historySan` and return heuristic facts about the LAST move.
 * Returns null when history is empty or fails to replay.
 */
export function lastMoveFacts(historySan: string[]): LastMoveFacts | null {
  if (historySan.length === 0) return null
  const chess = new Chess()
  // square -> how many times the piece currently on it has moved
  const movedCounts = new Map<string, number>()
  let lastPrevMoves = 0
  let last: ReturnType<Chess['move']> | null = null
  try {
    for (const san of historySan) {
      const m = chess.move(san)
      const prev = movedCounts.get(m.from) ?? 0
      movedCounts.delete(m.from)
      movedCounts.set(m.to, prev + 1)
      last = m
      lastPrevMoves = prev
    }
  } catch {
    return null
  }
  if (!last) return null

  const c = last.color as Cc
  const color: Color = c === 'w' ? 'white' : 'black'
  const fullMove = Math.floor((historySan.length - 1) / 2) + 1
  const isCastle = last.san.startsWith('O-O')
  const homes = HOME_SQUARES[c][last.piece] ?? []

  const movedTwice = !isCastle && last.piece !== 'p' && lastPrevMoves >= 1 && fullMove <= 10
  const retreatToHome = movedTwice && homes.includes(last.to)

  const developedMinors = countDevelopedMinors(chess, color)
  const earlyQueen = !isCastle && last.piece === 'q' && fullMove <= 6 && developedMinors < 2

  const centerPawns = countCenterPawns(chess, color)
  const neglectsCenter = centerPawns === 0 && fullMove >= 4 && fullMove <= 12

  const weakensKing =
    last.piece === 'p' &&
    !last.captured &&
    fullMove <= 10 &&
    KING_WEAKENING_SQUARES[c].includes(last.to)

  const blocksDevelopment = detectBlocksDevelopment(chess, c, last.piece, last.to)

  return {
    color,
    fullMove,
    piece: last.piece,
    san: last.san,
    isCapture: Boolean(last.captured),
    movedTwice,
    retreatToHome,
    earlyQueen,
    blocksDevelopment,
    weakensKing,
    neglectsCenter,
  }
}

function detectBlocksDevelopment(chess: Chess, c: Cc, piece: string, to: string): boolean {
  // A minor piece or queen parked directly in front of an unmoved center pawn
  // (Nd3/Be3-style) blocks that pawn from advancing.
  const blockSquares: Record<Cc, Record<string, Square>> = {
    w: { d3: 'd2', e3: 'e2' },
    b: { d6: 'd7', e6: 'e7' },
  }
  if (piece === 'n' || piece === 'b' || piece === 'q') {
    const pawnHome = blockSquares[c][to]
    if (pawnHome) {
      const behind = chess.get(pawnHome)
      if (behind && behind.color === c && behind.type === 'p') return true
    }
  }
  // A d3/d6 pawn while the king's bishop is still at home shuts it out of
  // its active diagonal (Bf1-c4 / Bf8-c5).
  if (piece === 'p') {
    if (c === 'w' && to === 'd3') {
      const bishop = chess.get('f1')
      if (bishop && bishop.color === 'w' && bishop.type === 'b') return true
    }
    if (c === 'b' && to === 'd6') {
      const bishop = chess.get('f8')
      if (bishop && bishop.color === 'b' && bishop.type === 'b') return true
    }
  }
  return false
}
