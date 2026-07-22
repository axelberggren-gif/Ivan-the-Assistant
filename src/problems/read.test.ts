import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type { EngineAnalysis, EngineLine, ReadCheckAnswer } from '../types'
import { MATE_CP } from '../coach/eval'
import {
  analysisCpWhite,
  checkRead,
  materialDiff,
  verdictFromCp,
  VERDICT_BETTER_MIN,
  VERDICT_WINNING_MIN,
} from './read'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function line(cp: number | undefined, pvSan: string[] = [], mate?: number): EngineLine {
  return {
    pvSan,
    pvUci: [],
    ...(cp !== undefined ? { cp } : {}),
    ...(mate !== undefined ? { mate } : {}),
  }
}

function analysis(lines: EngineLine[], fen = new Chess().fen()): EngineAnalysis {
  return { fen, depth: 16, bestMoveSan: '', bestMoveUci: '', lines }
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

// ---------------------------------------------------------------------------
// materialDiff
// ---------------------------------------------------------------------------

describe('materialDiff', () => {
  it('is 0 in the start position', () => {
    expect(materialDiff(new Chess().fen())).toBe(0)
  })

  it('is +1 after White wins a pawn (1.e4 d5 2.exd5)', () => {
    expect(materialDiff(fenAfterMoves(['e4', 'd5', 'exd5']))).toBe(1)
  })

  it('is -8 after White loses queen for pawn (Qxf7+ Kxf7)', () => {
    const fen = fenAfterMoves(['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7+', 'Kxf7'])
    expect(materialDiff(fen)).toBe(-8)
  })

  it('counts promoted pieces from the board (two extra White queens = +18)', () => {
    expect(materialDiff(legalFen('4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1'))).toBe(18)
  })

  it('handles uneven endings: R+P vs bare king = +6', () => {
    expect(materialDiff(legalFen('4k3/8/8/8/8/8/4P3/4K2R w K - 0 1'))).toBe(6)
  })

  it('handles Black being up an exchange: -2', () => {
    // White has a bishop, Black has a rook.
    expect(materialDiff(legalFen('4k2r/8/8/8/8/8/8/2B1K3 w k - 0 1'))).toBe(-2)
  })
})

// ---------------------------------------------------------------------------
// verdictFromCp — thresholds live in read.ts only
// ---------------------------------------------------------------------------

describe('verdictFromCp', () => {
  const cases: Array<[number, string]> = [
    [0, 'equal'],
    [VERDICT_BETTER_MIN - 1, 'equal'],
    [-(VERDICT_BETTER_MIN - 1), 'equal'],
    [VERDICT_BETTER_MIN, 'white_better'],
    [VERDICT_WINNING_MIN - 1, 'white_better'],
    [VERDICT_WINNING_MIN, 'white_winning'],
    [-VERDICT_BETTER_MIN, 'black_better'],
    [-(VERDICT_WINNING_MIN - 1), 'black_better'],
    [-VERDICT_WINNING_MIN, 'black_winning'],
  ]
  for (const [cp, expected] of cases) {
    it(`${cp} cp → ${expected}`, () => {
      expect(verdictFromCp(cp)).toBe(expected)
    })
  }

  it('mate scores map into the winning buckets via MATE_CP', () => {
    expect(verdictFromCp(MATE_CP - 3)).toBe('white_winning')
    expect(verdictFromCp(-(MATE_CP - 2))).toBe('black_winning')
  })
})

// ---------------------------------------------------------------------------
// analysisCpWhite
// ---------------------------------------------------------------------------

describe('analysisCpWhite', () => {
  it('returns the best line cp (White perspective)', () => {
    expect(analysisCpWhite(analysis([line(120), line(40)]))).toBe(120)
  })

  it('maps mate scores via MATE_CP', () => {
    expect(analysisCpWhite(analysis([line(undefined, [], 3)]))).toBe(MATE_CP - 3)
    expect(analysisCpWhite(analysis([line(undefined, [], -2)]))).toBe(-(MATE_CP - 2))
  })

  it('is 0 when there are no lines', () => {
    expect(analysisCpWhite(analysis([]))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// checkRead
// ---------------------------------------------------------------------------

describe('checkRead', () => {
  const startFen = new Chess().fen()

  it('passes when material and verdict are both right (White user)', () => {
    const answer: ReadCheckAnswer = { materialDiff: 0, verdict: 'equal' }
    const report = checkRead(answer, startFen, analysis([line(20)]), 'white')
    expect(report.materialCorrect).toBe(true)
    expect(report.actualMaterialDiff).toBe(0)
    expect(report.verdictCorrect).toBe(true)
    expect(report.actualVerdict).toBe('equal')
    expect(report.evalCp).toBe(20)
    expect(report.comment.length).toBeGreaterThan(0)
  })

  it('hooks the White user who called a winning position equal (PLAN §8.1)', () => {
    const answer: ReadCheckAnswer = { materialDiff: 0, verdict: 'equal' }
    const report = checkRead(answer, startFen, analysis([line(320)]), 'white')
    expect(report.verdictCorrect).toBe(false)
    expect(report.actualVerdict).toBe('white_winning')
    expect(report.comment).toContain('You said equal')
    expect(report.comment).toContain("Stockfish says you're winning")
    expect(report.comment).toContain('prove it')
  })

  it('hooks the Black user when BLACK is winning (perspective conversion)', () => {
    const answer: ReadCheckAnswer = { materialDiff: 0, verdict: 'equal' }
    const report = checkRead(answer, startFen, analysis([line(-320)]), 'black')
    expect(report.actualVerdict).toBe('black_winning')
    expect(report.evalCp).toBe(-320)
    expect(report.comment).toContain("Stockfish says you're winning")
    expect(report.comment).toContain('prove it')
  })

  it('tells a Black user they are losing when White is winning — no hook', () => {
    const answer: ReadCheckAnswer = { materialDiff: 0, verdict: 'black_better' }
    const report = checkRead(answer, startFen, analysis([line(320)]), 'black')
    expect(report.actualVerdict).toBe('white_winning')
    expect(report.verdictCorrect).toBe(false)
    expect(report.comment).toContain("you're losing")
    expect(report.comment).not.toContain('prove it')
  })

  it('flags a wrong material count and states the actual diff (Black user)', () => {
    // White is up a pawn ⇒ the Black user is DOWN 1 point.
    const fen = fenAfterMoves(['e4', 'd5', 'exd5'])
    const answer: ReadCheckAnswer = { materialDiff: 0, verdict: 'equal' }
    const report = checkRead(answer, fen, analysis([line(50)], fen), 'black')
    expect(report.materialCorrect).toBe(false)
    expect(report.actualMaterialDiff).toBe(1)
    expect(report.verdictCorrect).toBe(true)
    expect(report.comment).toContain("you're down 1 point")
  })

  it('mate for the user maps to the winning bucket and hooks', () => {
    const answer: ReadCheckAnswer = { materialDiff: 0, verdict: 'white_better' }
    const report = checkRead(answer, startFen, analysis([line(undefined, [], 2)]), 'white')
    expect(report.actualVerdict).toBe('white_winning')
    expect(report.evalCp).toBe(MATE_CP - 2)
    expect(report.comment).toContain('prove it')
  })
})
