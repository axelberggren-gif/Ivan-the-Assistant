import { describe, expect, it, vi } from 'vitest'
import { Chess } from 'chess.js'
import type { AnalyzeOptions, EngineAnalysis, EngineAPI } from '../types'
import { DEFAULT_BUDGET, annotateGame, budgetSignature, verifyMove } from './annotate'
import type { AnalysisGameInput, AnnotatedMove } from './types'

// ---------------------------------------------------------------------------
// Fake engine (the session.test.ts seam): scripted White-perspective evals
// keyed by how many plies have been played to reach the position.
// ---------------------------------------------------------------------------

interface FakeEngine extends EngineAPI {
  /** Every (fen, opts) pair the engine was asked for, in order. */
  calls: Array<{ fen: string; opts?: AnalyzeOptions }>
  initCalls: number
  disposeCalls: number
}

/**
 * `cpByPly[i]` is the White-perspective eval of the position BEFORE ply i.
 * Anything past the end of the array repeats the last value.
 */
function makeEngine(movesSan: string[], cpByPly: number[]): FakeEngine {
  const chess = new Chess()
  const fenToPly = new Map<string, number>()
  fenToPly.set(chess.fen(), 0)
  movesSan.forEach((san, i) => {
    chess.move(san)
    fenToPly.set(chess.fen(), i + 1)
  })

  const engine: FakeEngine = {
    calls: [],
    initCalls: 0,
    disposeCalls: 0,
    init: vi.fn(async () => {
      engine.initCalls++
    }),
    analyze: vi.fn(async (fen: string, opts?: AnalyzeOptions): Promise<EngineAnalysis> => {
      engine.calls.push({ fen, opts })
      const ply = fenToPly.get(fen) ?? 0
      const cp = cpByPly[Math.min(ply, cpByPly.length - 1)] ?? 0
      // A legal best move so the coach's helpers have something real to chew on.
      const position = new Chess(fen)
      const legal = position.moves()
      return {
        fen,
        depth: 12,
        bestMoveSan: legal[0] ?? '',
        bestMoveUci: '',
        lines: [{ pvSan: legal.slice(0, 1), pvUci: [], cp }],
      }
    }),
    opponentMove: vi.fn(async () => ({ san: 'a3', uci: 'a2a3' })),
    dispose: vi.fn(() => {
      engine.disposeCalls++
    }),
  }
  return engine
}

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'd6', 'O-O', 'Nf6']

function input(overrides: Partial<AnalysisGameInput> = {}): AnalysisGameInput {
  return {
    id: 'game-1',
    movesSan: ITALIAN,
    userColor: 'white',
    meta: { url: 'https://chess.com/1', endTimeMs: 5, result: 'loss' },
    ...overrides,
  }
}

/** Flat eval everywhere: every move is "good", nothing is decided. */
const FLAT = [20]

describe('annotateGame', () => {
  it('judges only the user’s moves and evaluates each position exactly once', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    const game = await annotateGame(input(), engine, { budget: { verifyTopN: 0 } })

    // 10 plies → 11 positions, one search each.
    expect(engine.calls).toHaveLength(11)
    // White's 5 moves only (plies 0,2,4,6,8).
    expect(game.moves.map((m) => m.ply)).toEqual([0, 2, 4, 6, 8])
    expect(game.moves.map((m) => m.san)).toEqual(['e4', 'Nf3', 'Bc4', 'd3', 'O-O'])
    expect(game.moves.every((m) => m.color === 'white')).toBe(true)
    expect(game.pliesTotal).toBe(10)
    expect(game.pliesAnalysed).toBe(10)
    expect(game.truncated).toBeUndefined()
    expect(game.meta.url).toBe('https://chess.com/1')
    expect(game.signature).toBe(budgetSignature({ ...DEFAULT_BUDGET, verifyTopN: 0 }))
  })

  it('judges Black’s moves when the user is Black', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    const game = await annotateGame(input({ userColor: 'black' }), engine, {})
    expect(game.moves.map((m) => m.ply)).toEqual([1, 3, 5, 7, 9])
    expect(game.moves.map((m) => m.san)).toEqual(['e5', 'Nc6', 'Bc5', 'd6', 'Nf6'])
    expect(game.moves.map((m) => m.moveNumber)).toEqual([1, 2, 3, 4, 5])
  })

  it('asks for MultiPV 3 where the user is to move and 1 elsewhere', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    await annotateGame(input(), engine, {})
    // Position index i is the position before ply i: White (the user) is to
    // move at even indices.
    engine.calls.forEach((call, i) => {
      expect(call.opts?.multiPv).toBe(i % 2 === 0 ? 3 : 1)
      expect(call.opts?.movetimeMs).toBe(DEFAULT_BUDGET.movetimeMs)
    })
  })

  it('classifies with the coach’s thresholds from the user’s perspective', async () => {
    // Before White's 3rd move (ply 4) the eval is +50; after it, −200.
    // cpLoss = 250 → blunder for a White user.
    const cpByPly = [20, 20, 20, 20, 50, -200, -200, -200, -200, -200, -200]
    const engine = makeEngine(ITALIAN, cpByPly)
    const game = await annotateGame(input(), engine, {})

    const bad = game.moves.find((m) => m.ply === 4)!
    expect(bad.san).toBe('Bc4')
    expect(bad.cpBefore).toBe(50)
    expect(bad.cpAfter).toBe(-200)
    expect(bad.cpLoss).toBe(250)
    expect(bad.classification).toBe('blunder')
    expect(bad.phase).toBe('opening')
  })

  it('the same swing is a gain, not a loss, for the other colour', async () => {
    const cpByPly = [20, 20, 20, 20, 50, -200, -200, -200, -200, -200, -200]
    const engine = makeEngine(ITALIAN, cpByPly)
    const game = await annotateGame(input({ userColor: 'black' }), engine, {})
    // Black's 3rd move (ply 5) runs −200 → −200: no loss at all.
    const move = game.moves.find((m) => m.ply === 5)!
    expect(move.cpLoss).toBe(0)
    expect(move.classification).toBe('good')
  })

  it('stops at the ply cap and reports the truncation', async () => {
    const long = [...ITALIAN, 'h3', 'h6', 'Re1', 'a6', 'Nc3', 'b5']
    const engine = makeEngine(long, FLAT)
    const game = await annotateGame(input({ movesSan: long }), engine, {
      budget: { plyCap: 6 },
    })
    expect(engine.calls).toHaveLength(7) // positions 0..6
    expect(game.pliesTotal).toBe(16)
    expect(game.pliesAnalysed).toBe(6)
    expect(game.truncated).toBe('ply_cap')
    expect(game.moves.map((m) => m.ply)).toEqual([0, 2, 4])
  })

  it('cuts a decided game short: a blunder in a lost game is not a lesson', async () => {
    // Beyond ±800 from position 3 onward: 3 consecutive plies ends it.
    const cpByPly = [20, 20, 20, -900, -900, -900, -900, -900, -900, -900, -900]
    const engine = makeEngine(ITALIAN, cpByPly)
    const game = await annotateGame(input(), engine, {
      budget: { decidedPlies: 3, decidedCp: 800 },
    })
    expect(game.truncated).toBe('decided')
    expect(engine.calls).toHaveLength(6) // stops after position 5
    expect(game.pliesAnalysed).toBe(5)
  })

  it('does not cut a game that stays within the decided margin', async () => {
    const engine = makeEngine(ITALIAN, [700])
    const game = await annotateGame(input(), engine, { budget: { decidedPlies: 3 } })
    expect(game.truncated).toBeUndefined()
    expect(engine.calls).toHaveLength(11)
  })

  it('honours an abort signal and keeps the moves it already judged', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    const controller = new AbortController()
    const game = await annotateGame(input(), engine, {
      onPly: (done) => {
        if (done === 4) controller.abort()
      },
      signal: controller.signal,
    })
    expect(game.truncated).toBe('aborted')
    expect(engine.calls).toHaveLength(4)
    expect(game.moves.map((m) => m.ply)).toEqual([0, 2])
  })

  it('reports progress per position', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    const seen: Array<[number, number]> = []
    await annotateGame(input(), engine, { onPly: (done, total) => seen.push([done, total]) })
    expect(seen).toHaveLength(11)
    expect(seen[0]).toEqual([1, 11])
    expect(seen[10]).toEqual([11, 11])
  })

  it('scores development from the opening moves only', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    const game = await annotateGame(input(), engine, {})
    // 1.e4 2.Nf3 3.Bc4 4.d3 5.O-O: two minors out, castled, one centre pawn.
    expect(game.development.castled).toBe(true)
    expect(game.development.developedMinors).toBe(2)
    expect(game.development.score).toBeGreaterThan(40)
  })

  it('drops an unreplayable tail instead of throwing', async () => {
    const engine = makeEngine(ITALIAN, FLAT)
    const game = await annotateGame(
      input({ movesSan: ['e4', 'e5', 'Nf3', 'Qxh8', 'Nc6'] }),
      engine,
      {},
    )
    // Qxh8 is illegal there, so the game is treated as the 3 legal plies.
    expect(game.pliesTotal).toBe(3)
    expect(game.pliesAnalysed).toBe(3)
    expect(game.moves.map((m) => m.san)).toEqual(['e4', 'Nf3'])
  })

  it('handles a game shorter than one judgeable move', async () => {
    const engine = makeEngine(['e4'], FLAT)
    const game = await annotateGame(input({ movesSan: ['e4'] }), engine, {})
    expect(game.moves).toHaveLength(1)
    expect(game.pliesAnalysed).toBe(1)
  })

  it('labels moves past move 12 as middlegame', async () => {
    const chess = new Chess()
    const moves: string[] = []
    // 30 plies of legal shuffling gets us to move 15.
    for (let i = 0; i < 30; i++) {
      const legal = chess.moves()
      chess.move(legal[0])
      moves.push(legal[0])
    }
    const engine = makeEngine(moves, FLAT)
    const game = await annotateGame(input({ movesSan: moves }), engine, {})
    const phases = new Set(game.moves.map((m) => m.phase))
    expect(phases).toEqual(new Set(['opening', 'middlegame']))
    expect(game.moves.find((m) => m.moveNumber === 12)!.phase).toBe('opening')
    expect(game.moves.find((m) => m.moveNumber === 13)!.phase).toBe('middlegame')
  })
})

describe('budgetSignature', () => {
  it('changes when the numbers that shape an annotation change', () => {
    const base = budgetSignature(DEFAULT_BUDGET)
    expect(budgetSignature({ ...DEFAULT_BUDGET, movetimeMs: 300 })).not.toBe(base)
    expect(budgetSignature({ ...DEFAULT_BUDGET, plyCap: 40 })).not.toBe(base)
    expect(budgetSignature({ ...DEFAULT_BUDGET, decidedCp: 600 })).not.toBe(base)
  })

  it('ignores how many games are analysed — that is not part of an annotation', () => {
    const base = budgetSignature(DEFAULT_BUDGET)
    expect(budgetSignature({ ...DEFAULT_BUDGET, maxGames: 100 })).toBe(base)
    expect(budgetSignature({ ...DEFAULT_BUDGET, verifyTopN: 0 })).toBe(base)
  })
})

describe('verifyMove', () => {
  const move: AnnotatedMove = {
    ply: 4,
    moveNumber: 3,
    color: 'white',
    san: 'Bc4',
    fenBefore: (() => {
      const chess = new Chess()
      for (const san of ITALIAN.slice(0, 4)) chess.move(san)
      return chess.fen()
    })(),
    cpBefore: 50,
    cpAfter: -200,
    cpLoss: 250,
    classification: 'blunder',
    reasonCodes: ['misses_tactic'],
    bestMoveSan: 'd4',
    phase: 'opening',
  }

  it('re-judges at full depth and marks the move verified', async () => {
    const engine = makeEngine(ITALIAN, [30])
    const verified = await verifyMove(move, engine, { depth: 18 })
    expect(verified.verified).toBe(true)
    // Flat 30cp on both sides of the move: the deep pass clears it.
    expect(verified.cpLoss).toBe(0)
    expect(verified.classification).toBe('good')
    expect(engine.calls.every((c) => c.opts?.depth === 18)).toBe(true)
    expect(engine.calls).toHaveLength(2)
  })

  it('keeps the original reason codes when no history is supplied', async () => {
    const engine = makeEngine(ITALIAN, [30])
    const verified = await verifyMove(move, engine, {})
    expect(verified.reasonCodes).toEqual(['misses_tactic'])
  })

  it('re-derives reason codes when the history is supplied', async () => {
    const engine = makeEngine(ITALIAN, [30])
    const verified = await verifyMove(move, engine, {
      historySan: ITALIAN.slice(0, 5),
    })
    expect(verified.reasonCodes).toEqual(['ok'])
  })

  it('leaves a move it cannot replay untouched', async () => {
    const engine = makeEngine(ITALIAN, [30])
    const verified = await verifyMove({ ...move, san: 'Qxh8' }, engine, {})
    expect(verified).toEqual({ ...move, san: 'Qxh8' })
    expect(engine.calls).toHaveLength(0)
  })
})
