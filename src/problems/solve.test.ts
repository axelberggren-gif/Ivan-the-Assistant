import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { EngineAnalysis, EngineLine } from '../types'
import {
  engineLineSummaries,
  formatSanLine,
  gradeLine,
  isSolutionMove,
  sanLineFromUci,
  uciToSan,
} from './solve'

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
// formatSanLine — numbered notation for the reason-phase scratchpad
// ---------------------------------------------------------------------------

describe('formatSanLine', () => {
  it('numbers a White-to-move line from the start', () => {
    expect(formatSanLine(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6'])).toBe('1.e4 e5 2.Nf3 Nc6')
  })

  it('uses the ellipsis when Black opens the line, keeping the fullmove number', () => {
    // Black to move at fullmove 23.
    const fen = legalFen('r4rk1/pppq1ppp/2n5/3pp3/3PP3/2N2N2/PPP2PPP/R2QR1K1 b - - 0 23')
    expect(formatSanLine(fen, ['exd4', 'Nxd4', 'Nxd4'])).toBe('23...exd4 24.Nxd4 Nxd4')
  })

  it('advances the fullmove number across several full moves (White opens)', () => {
    const fen = legalFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3')
    expect(formatSanLine(fen, ['Bc4', 'Bc5', 'c3', 'Nf6'])).toBe('3.Bc4 Bc5 4.c3 Nf6')
  })

  it('returns an empty string for an empty line', () => {
    expect(formatSanLine(START_FEN, [])).toBe('')
  })

  it('falls back to fullmove 1 when the FEN header is malformed', () => {
    expect(formatSanLine('not a fen', ['e4', 'e5'])).toBe('1.e4 e5')
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

// ---------------------------------------------------------------------------
// gradeLine — the whole committed line, judged in one go (ADR-0006)
// ---------------------------------------------------------------------------

describe('gradeLine', () => {
  /**
   * Back-rank two-mover from the solve position (White to move): the authored
   * line is 2.Rb7+ Kg8 3.Qa8#. Even plies are the user's own moves, odd plies
   * are the replies they predict.
   */
  const SOLVE_FEN = legalFen('7k/8/8/8/8/8/1R6/Q5K1 w - - 0 2')
  const SOLUTION = ['b2b7', 'h8g8', 'a1a8']

  it('accepts the authored line', () => {
    const grade = gradeLine(SOLVE_FEN, SOLUTION, [...SOLUTION])
    expect(grade.correct).toBe(true)
    expect(grade.deviation).toBeNull()
    expect(grade.mated).toBe(true)
  })

  it('is not correct until the whole line is played', () => {
    expect(gradeLine(SOLVE_FEN, SOLUTION, []).correct).toBe(false)
    const partial = gradeLine(SOLVE_FEN, SOLUTION, ['b2b7', 'h8g8'])
    expect(partial.correct).toBe(false)
    // Right so far is NOT a deviation — the caller must not report a failure.
    expect(partial.deviation).toBeNull()
  })

  it('reports the user\'s own wrong move, with what was expected there', () => {
    const grade = gradeLine(SOLVE_FEN, SOLUTION, ['a1a2', 'h8h7', 'a2a3'])
    expect(grade.correct).toBe(false)
    expect(grade.deviation).toMatchObject({
      plyIndex: 0,
      side: 'user',
      playedSan: 'Qa2',
      expectedUci: 'b2b7',
      expectedSan: 'Rb7+',
      fenBefore: SOLVE_FEN,
    })
  })

  it('reports a mispredicted reply as the opponent\'s ply', () => {
    // 2.Qd8+ and Black chooses: Kf7 (authored) or Kg7.
    const fen = legalFen('5k2/8/8/8/8/8/3Q4/4K3 w - - 0 2')
    const solution = ['d2d8', 'f8f7', 'd8d7']
    const grade = gradeLine(fen, solution, ['d2d8', 'f8g7', 'd8d7'])
    expect(grade.correct).toBe(false)
    expect(grade.deviation).toMatchObject({
      plyIndex: 1,
      side: 'opponent',
      playedSan: 'Kg7',
      expectedSan: 'Kf7',
    })
  })

  it('accepts an unlisted mate the user finds early (Lichess semantics)', () => {
    // 2.Ra8+ Rb8 3.Rxb8# instead of the authored 3.Qxb8#.
    const fen = legalFen('6k1/5ppp/8/8/1r6/8/1Q6/R5K1 w - - 1 2')
    const grade = gradeLine(fen, ['a1a8', 'b4b8', 'b2b8'], ['a1a8', 'b4b8', 'a8b8'])
    expect(grade.correct).toBe(true)
    expect(grade.mated).toBe(true)
  })

  it('treats an illegal or unparseable line as not correct, not as a deviation', () => {
    const grade = gradeLine(SOLVE_FEN, SOLUTION, ['b2b7', 'h8h1'])
    expect(grade.correct).toBe(false)
    expect(grade.deviation).toBeNull()
    expect(gradeLine('not a fen', SOLUTION, [...SOLUTION]).correct).toBe(false)
  })
})
