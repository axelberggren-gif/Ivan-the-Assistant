import { describe, expect, it } from 'vitest'
import type { EngineAnalysis } from '../types'
import { createCoach } from './index'

const coach = createCoach()

function evalNow(cp: number): EngineAnalysis {
  return {
    fen: '',
    depth: 16,
    bestMoveSan: 'd4',
    bestMoveUci: '',
    lines: [{ pvSan: ['d4'], pvUci: [], cp }],
  }
}

describe('developmentScore', () => {
  it('scores 1.e4 e5 2.Nf3 Nc6 3.Bc4 for White: 2 minors, e-pawn, not castled', () => {
    const dev = coach.developmentScore(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 'white')
    expect(dev.developedMinors).toBe(2)
    expect(dev.castled).toBe(false)
    expect(dev.earlyQueen).toBe(false)
    expect(dev.centerPawns).toBe(1)
    expect(dev.tempoLoss).toBe(0)
    expect(dev.score).toBe(40) // 2*15 + 1*10
  })

  it('counts Black development independently', () => {
    const dev = coach.developmentScore(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 'black')
    expect(dev.developedMinors).toBe(1)
    expect(dev.centerPawns).toBe(1)
    expect(dev.castled).toBe(false)
  })

  it('detects tempo loss for 1.e4 e5 2.Nf3 Nc6 3.Ng1 (moved twice + retreat home)', () => {
    const dev = coach.developmentScore(['e4', 'e5', 'Nf3', 'Nc6', 'Ng1'], 'white')
    expect(dev.tempoLoss).toBeGreaterThan(0)
    expect(dev.developedMinors).toBe(0) // knight is back home
    expect(dev.score).toBeLessThan(40)
  })

  it('detects an early queen (2.Qh5 with no minors out)', () => {
    const dev = coach.developmentScore(['e4', 'e5', 'Qh5'], 'white')
    expect(dev.earlyQueen).toBe(true)
  })

  it('does not flag a queen move once development is done', () => {
    const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'Qe2', 'd6']
    const dev = coach.developmentScore(moves, 'white')
    expect(dev.earlyQueen).toBe(false)
    expect(dev.castled).toBe(true)
    expect(dev.developedMinors).toBe(2)
    expect(dev.score).toBe(60) // 2*15 + 20 + 1*10
  })

  it('clamps the composite score to 0-100', () => {
    const dev = coach.developmentScore(['e4', 'e5', 'Nf3', 'Nc6', 'Ng1', 'Nb8', 'Nf3', 'Nc6', 'Ng1'], 'white')
    expect(dev.score).toBeGreaterThanOrEqual(0)
    expect(dev.score).toBeLessThanOrEqual(100)
  })
})

describe('outOfBookSummary', () => {
  const history = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']

  it('says the position is level when eval is near zero', () => {
    const text = coach.outOfBookSummary(history, 'white', evalNow(10))
    expect(text).toMatch(/roughly level/)
    expect(text).toMatch(/minor pieces/)
  })

  it('converts the verdict to the user perspective for Black', () => {
    // +200 for White is bad news for a Black user.
    const text = coach.outOfBookSummary(history, 'black', evalNow(200))
    expect(text).toMatch(/pressure/)
  })

  it('mentions castling status', () => {
    const text = coach.outOfBookSummary(history, 'white', evalNow(0))
    expect(text).toMatch(/castled/)
  })
})
