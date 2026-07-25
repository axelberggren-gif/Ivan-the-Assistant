import { describe, expect, it } from 'vitest'
import type { Classification, ReasonCode } from '../types'
import {
  OPENING_LAST_FULL_MOVE,
  buildWeaknessReport,
  phaseForMoveNumber,
} from './aggregate'
import type { AnnotatedGame, AnnotatedMove } from './types'

function move(
  moveNumber: number,
  classification: Exclude<Classification, 'book'>,
  cpLoss: number,
  reasonCodes: ReasonCode[] = ['ok'],
): AnnotatedMove {
  return {
    ply: (moveNumber - 1) * 2,
    moveNumber,
    color: 'white',
    san: `M${moveNumber}`,
    fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    cpBefore: 0,
    cpAfter: -cpLoss,
    cpLoss,
    classification,
    reasonCodes,
    bestMoveSan: 'd4',
    phase: phaseForMoveNumber(moveNumber),
  }
}

function game(id: string, moves: AnnotatedMove[], overrides: Partial<AnnotatedGame> = {}): AnnotatedGame {
  return {
    id,
    userColor: 'white',
    meta: { url: `https://chess.com/${id}`, endTimeMs: 1, opponentUsername: 'rival' },
    pliesTotal: 40,
    pliesAnalysed: 40,
    moves,
    development: {
      developedMinors: 2,
      castled: true,
      earlyQueen: false,
      centerPawns: 1,
      tempoLoss: 0,
      score: 60,
    },
    signature: 'sig',
    ...overrides,
  }
}

describe('phaseForMoveNumber', () => {
  it('splits at the end of the opening', () => {
    expect(phaseForMoveNumber(1)).toBe('opening')
    expect(phaseForMoveNumber(OPENING_LAST_FULL_MOVE)).toBe('opening')
    expect(phaseForMoveNumber(OPENING_LAST_FULL_MOVE + 1)).toBe('middlegame')
  })
})

describe('buildWeaknessReport', () => {
  it('counts classifications and averages cp loss', () => {
    const report = buildWeaknessReport([
      game('a', [move(3, 'good', 10), move(5, 'mistake', 150), move(9, 'blunder', 400)]),
      game('b', [move(4, 'inaccuracy', 50), move(20, 'blunder', 600)]),
    ])
    expect(report.gamesAnalysed).toBe(2)
    expect(report.movesAnalysed).toBe(5)
    expect(report.blunders).toBe(2)
    expect(report.mistakes).toBe(1)
    expect(report.inaccuracies).toBe(1)
    expect(report.blundersPerGame).toBe(1)
    expect(report.avgCpLoss).toBe((10 + 150 + 400 + 50 + 600) / 5)
  })

  it('splits stats by phase', () => {
    const report = buildWeaknessReport([
      game('a', [move(3, 'blunder', 300), move(20, 'good', 5), move(25, 'mistake', 120)]),
    ])
    const opening = report.byPhase.find((p) => p.phase === 'opening')!
    const middle = report.byPhase.find((p) => p.phase === 'middlegame')!
    expect(opening.moves).toBe(1)
    expect(opening.blunders).toBe(1)
    expect(opening.avgCpLoss).toBe(300)
    expect(middle.moves).toBe(2)
    expect(middle.mistakes).toBe(1)
    expect(middle.avgCpLoss).toBe(62.5)
  })

  it('builds an ascending timeline of mistakes and blunders only', () => {
    const report = buildWeaknessReport([
      game('a', [move(15, 'blunder', 400), move(3, 'good', 5), move(9, 'mistake', 120)]),
      game('b', [move(9, 'blunder', 500)]),
    ])
    expect(report.timeline).toEqual([
      { moveNumber: 9, mistakes: 1, blunders: 1 },
      { moveNumber: 15, mistakes: 0, blunders: 1 },
    ])
  })

  it('clusters recurring reason codes across games, ignoring good moves and "ok"', () => {
    const report = buildWeaknessReport([
      game('a', [
        move(5, 'blunder', 400, ['hangs_piece']),
        move(7, 'mistake', 150, ['hangs_piece', 'moves_piece_twice']),
        move(9, 'good', 5, ['hangs_piece']), // a good move contributes no pattern
      ]),
      game('b', [move(6, 'mistake', 120, ['hangs_piece']), move(8, 'inaccuracy', 40, ['ok'])]),
    ])
    expect(report.recurring[0]).toMatchObject({
      code: 'hangs_piece',
      count: 3,
      games: 2,
      label: 'Leaving pieces hanging',
    })
    expect(report.recurring.map((r) => r.code)).not.toContain('ok')
    expect(report.recurring.find((r) => r.code === 'moves_piece_twice')?.count).toBe(1)
  })

  it('surfaces the worst moments worst-first, with a link back to the game', () => {
    const report = buildWeaknessReport([
      game('a', [move(5, 'mistake', 150), move(9, 'blunder', 900)]),
      game('b', [move(4, 'blunder', 400), move(6, 'good', 20)]),
    ])
    expect(report.worstMoments.map((m) => m.cpLoss)).toEqual([900, 400, 150])
    expect(report.worstMoments[0]).toMatchObject({
      gameId: 'a',
      url: 'https://chess.com/a',
      opponentUsername: 'rival',
    })
    // A 20cp slip is not a "moment".
    expect(report.worstMoments.some((m) => m.cpLoss === 20)).toBe(false)
  })

  it('caps the worst moments at ten', () => {
    const moves = Array.from({ length: 20 }, (_, i) => move(i + 1, 'blunder', 300 + i))
    const report = buildWeaknessReport([game('a', moves)])
    expect(report.worstMoments).toHaveLength(10)
    expect(report.worstMoments[0].cpLoss).toBe(319)
  })

  it('diagnoses development across games and finds a repeated drift point', () => {
    const uncastled = {
      developedMinors: 1,
      castled: false,
      earlyQueen: true,
      centerPawns: 1,
      tempoLoss: 2,
      score: 20,
    }
    const report = buildWeaknessReport([
      game('a', [move(4, 'good', 5), move(9, 'blunder', 400)], { development: uncastled }),
      game('b', [move(5, 'good', 5), move(9, 'mistake', 150)], { development: uncastled }),
      game('c', [move(11, 'mistake', 120)]),
    ])
    expect(report.development.gamesUncastled).toBe(2)
    expect(report.development.gamesEarlyQueen).toBe(2)
    expect(report.development.avgScore).toBeCloseTo((20 + 20 + 60) / 3)
    expect(report.development.driftMoveNumber).toBe(9)
    expect(report.development.comment).toContain('uncastled')
  })

  it('reports no drift point when nothing repeats', () => {
    const report = buildWeaknessReport([
      game('a', [move(7, 'blunder', 400)]),
      game('b', [move(12, 'blunder', 400)]),
    ])
    expect(report.development.driftMoveNumber).toBeUndefined()
  })

  it('drops games with no judged moves rather than diluting the averages', () => {
    const report = buildWeaknessReport([game('a', [move(5, 'blunder', 400)]), game('empty', [])])
    expect(report.gamesAnalysed).toBe(1)
    expect(report.blundersPerGame).toBe(1)
  })

  it('produces a usable empty report', () => {
    const report = buildWeaknessReport([])
    expect(report.gamesAnalysed).toBe(0)
    expect(report.movesAnalysed).toBe(0)
    expect(report.avgCpLoss).toBe(0)
    expect(report.blundersPerGame).toBe(0)
    expect(report.worstMoments).toEqual([])
    expect(report.recurring).toEqual([])
    expect(report.headline).toBeTruthy()
    expect(report.byPhase.map((p) => p.phase)).toEqual(['opening', 'middlegame'])
  })

  it('writes prose only from the templates: headline and findings', () => {
    const report = buildWeaknessReport([
      game('a', [move(5, 'blunder', 400, ['hangs_piece'])]),
      game('b', [move(5, 'blunder', 350, ['hangs_piece'])]),
    ])
    expect(report.headline).toContain('2 blunders')
    expect(report.findings.length).toBeGreaterThan(0)
    expect(report.findings.join(' ')).toContain('leaving pieces hanging')
    expect(report.findings.join(' ')).toContain('move 5')
  })

  it('says so plainly when there are no blunders at all', () => {
    const report = buildWeaknessReport([game('a', [move(5, 'good', 10), move(6, 'good', 12)])])
    expect(report.headline).toContain('no outright blunders')
  })
})
