import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { EngineAnalysis, EngineLine } from '../types'
import { engineLineSummaries, isSolutionMove, sanLineFromUci, uciToSan } from './solve'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const START_FEN = new Chess().fen()

function line(cp: number | undefined, pvSan: string[] = [], mate?: number): EngineLine {
  return {
    pvSan,
    pvUci: [],
    ...(cp !== undefined ? { cp } : {}),
    ...(mate !== undefined ? { mate } : {}),
  }
}

function analysis(lines: EngineLine[]): EngineAnalysis {
  return { fen: START_FEN, depth: 16, bestMoveSan: '', bestMoveUci: '', lines }
}

/** Real position reached by legal moves — chess.js is the legality oracle. */
function fenAfterMoves(moves: string[]): string {
  const chess = new Chess()
  for (const san of moves) chess.move(san)
  return chess.fen()
}

/** Assert a literal FEN is a position chess.js accepts, then return it. */
function legalFen(fen: string): string {
  new Chess(fen)
  return fen
}

// Back rank with doubled rooks: BOTH Ra8 and Re8 deliver mate.
const TWO_MATES_FEN = legalFen('6k1/5ppp/8/8/8/8/8/R3R1K1 w - - 0 1')

// ---------------------------------------------------------------------------
// uciToSan
// ---------------------------------------------------------------------------

describe('uciToSan', () => {
  it('converts a simple pawn move', () => {
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4')
  })

  it('converts kingside castling (e1g1 → O-O)', () => {
    const fen = fenAfterMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])
    expect(uciToSan(fen, 'e1g1')).toBe('O-O')
  })

  it('converts a promotion (e7e8q → e8=Q) and normalizes piece case', () => {
    const fen = legalFen('8/4P3/8/8/8/8/2k5/4K3 w - - 0 1')
    expect(uciToSan(fen, 'e7e8q')).toBe('e8=Q')
    expect(uciToSan(fen, 'e7e8Q')).toBe('e8=Q')
  })

  it('returns null for an illegal move', () => {
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull()
  })

  it('returns null for a malformed FEN', () => {
    expect(uciToSan('not a fen', 'e2e4')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// sanLineFromUci
// ---------------------------------------------------------------------------

describe('sanLineFromUci', () => {
  it('converts a full legal sequence', () => {
    expect(sanLineFromUci(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('stops at the first illegal move', () => {
    expect(sanLineFromUci(START_FEN, ['e2e4', 'a7a6', 'e4e6'])).toEqual(['e4', 'a6'])
  })

  it('returns [] for a malformed FEN', () => {
    expect(sanLineFromUci('not a fen', ['e2e4'])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// isSolutionMove — Lichess matching semantics (PLAN §8.1)
// ---------------------------------------------------------------------------

describe('isSolutionMove', () => {
  it('accepts the exact authored move', () => {
    expect(isSolutionMove(START_FEN, 'e2e4', 'e2e4')).toBe(true)
  })

  it('normalizes promotion-piece case before comparing', () => {
    const fen = legalFen('8/4P3/8/8/8/8/2k5/4K3 w - - 0 1')
    expect(isSolutionMove(fen, 'e7e8Q', 'e7e8q')).toBe(true)
  })

  it('accepts a non-authored move that delivers immediate checkmate', () => {
    // Sanity: both rook lifts really are legal and Re8 really is mate.
    const probe = new Chess(TWO_MATES_FEN)
    probe.move({ from: 'e1', to: 'e8' })
    expect(probe.isCheckmate()).toBe(true)

    // Authored solution is Ra8#; the user plays Re8# instead — still correct.
    expect(isSolutionMove(TWO_MATES_FEN, 'e1e8', 'a1a8')).toBe(true)
  })

  it('rejects a wrong move that does not mate', () => {
    expect(isSolutionMove(TWO_MATES_FEN, 'a1a2', 'a1a8')).toBe(false)
  })

  it('rejects an illegal move', () => {
    expect(isSolutionMove(START_FEN, 'e2e5', 'e2e4')).toBe(false)
  })

  it('a check that is not mate does not count', () => {
    // 1.e4 e5 2.Qh5 Nc6: Qxf7+ is check (Kxf7 refutes) — not a solution.
    const fen = fenAfterMoves(['e4', 'e5', 'Qh5', 'Nc6'])
    expect(isSolutionMove(fen, 'h5f7', 'h5f3')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// engineLineSummaries — eval text from the USER's perspective
// ---------------------------------------------------------------------------

describe('engineLineSummaries', () => {
  it('formats cp as signed pawns with one decimal, per user color', () => {
    const a = analysis([line(230, ['Nf3', 'Nc6'])])
    expect(engineLineSummaries(a, 'white')[0].evalText).toBe('+2.3')
    expect(engineLineSummaries(a, 'black')[0].evalText).toBe('-2.3')
  })

  it('formats a negative cp for both colors', () => {
    const a = analysis([line(-50)])
    expect(engineLineSummaries(a, 'white')[0].evalText).toBe('-0.5')
    expect(engineLineSummaries(a, 'black')[0].evalText).toBe('+0.5')
  })

  it('formats mate for the winning and the losing user', () => {
    const mateForWhite = analysis([line(undefined, ['Qh5'], 2)])
    expect(engineLineSummaries(mateForWhite, 'white')[0].evalText).toBe('mate in 2')
    expect(engineLineSummaries(mateForWhite, 'black')[0].evalText).toBe('gets mated in 2')

    const mateForBlack = analysis([line(undefined, ['Qh4'], -3)])
    expect(engineLineSummaries(mateForBlack, 'white')[0].evalText).toBe('gets mated in 3')
    expect(engineLineSummaries(mateForBlack, 'black')[0].evalText).toBe('mate in 3')
  })

  it('trims the pv to 6 plies and caps the number of lines (default 3)', () => {
    const longPv = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6']
    const a = analysis([line(10, longPv), line(5), line(0), line(-5)])
    const summaries = engineLineSummaries(a, 'white')
    expect(summaries).toHaveLength(3)
    expect(summaries[0].san).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])
  })

  it('respects an explicit max', () => {
    const a = analysis([line(10), line(5), line(0)])
    expect(engineLineSummaries(a, 'white', 1)).toHaveLength(1)
  })
})
