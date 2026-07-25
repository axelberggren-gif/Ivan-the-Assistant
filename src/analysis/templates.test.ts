import { describe, expect, it } from 'vitest'
import {
  PHASE_LABELS,
  developmentComment,
  formatEta,
  progressLabel,
  reasonHint,
  reasonLabel,
  reportHeadline,
} from './templates'

describe('reportHeadline', () => {
  it('names the count, the average and the worst phase', () => {
    const text = reportHeadline({
      gamesAnalysed: 12,
      blunders: 7,
      avgCpLoss: 84.4,
      worstPhase: 'middlegame',
    })
    expect(text).toContain('12 games')
    expect(text).toContain('7 blunders')
    expect(text).toContain('84 centipawns')
    expect(text).toContain('middlegame')
  })

  it('says so when there are no blunders', () => {
    const text = reportHeadline({ gamesAnalysed: 1, blunders: 0, avgCpLoss: 12 })
    expect(text).toContain('1 game')
    expect(text).toContain('no outright blunders')
  })

  it('reads correctly for a single blunder in a single game', () => {
    const text = reportHeadline({
      gamesAnalysed: 1,
      blunders: 1,
      avgCpLoss: 300,
      worstPhase: 'opening',
    })
    expect(text).toContain('1 game you played 1 blunder,')
  })
})

describe('developmentComment', () => {
  it('agrees in number when some but not all games are affected', () => {
    const text = developmentComment({
      gamesAnalysed: 3,
      avgScore: 62,
      gamesUncastled: 1,
      gamesEarlyQueen: 0,
      avgTempoLoss: 0.3,
      avgDevelopedMinors: 3,
    })
    expect(text).toContain('1 of 3 games')
    expect(text).not.toMatch(/\d of \d game\b/)
    expect(text).toContain('62 out of 100')
  })

  it('says "every one of" when every game is affected', () => {
    const text = developmentComment({
      gamesAnalysed: 4,
      avgScore: 30,
      gamesUncastled: 4,
      gamesEarlyQueen: 4,
      avgTempoLoss: 2.4,
      avgDevelopedMinors: 1,
    })
    expect(text).toContain('every one of 4 games')
    expect(text).toContain('2.4 tempi')
  })

  it('handles a single analysed game without saying "1 of 1 games"', () => {
    const text = developmentComment({
      gamesAnalysed: 1,
      avgScore: 40,
      gamesUncastled: 1,
      gamesEarlyQueen: 0,
      avgTempoLoss: 0,
      avgDevelopedMinors: 2,
    })
    expect(text).toContain('the only game analysed')
  })

  it('is encouraging when nothing is systematically wrong', () => {
    const text = developmentComment({
      gamesAnalysed: 5,
      avgScore: 88,
      gamesUncastled: 0,
      gamesEarlyQueen: 0,
      avgTempoLoss: 0.2,
      avgDevelopedMinors: 4,
    })
    expect(text).toContain('Nothing systematic')
  })

  it('needs at least one game', () => {
    expect(
      developmentComment({
        gamesAnalysed: 0,
        avgScore: 0,
        gamesUncastled: 0,
        gamesEarlyQueen: 0,
        avgTempoLoss: 0,
        avgDevelopedMinors: 0,
      }),
    ).toContain('Not enough games')
  })
})

describe('progressLabel', () => {
  it('counts games and appends the ETA', () => {
    expect(
      progressLabel({ phase: 'analysing', gamesDone: 6, gamesTotal: 25, etaMs: 180_000 }),
    ).toBe('Game 7 of 25 · ~3 min left')
  })

  it('omits the ETA while it is still unknown', () => {
    expect(progressLabel({ phase: 'analysing', gamesDone: 0, gamesTotal: 25, etaMs: null })).toBe(
      'Game 1 of 25',
    )
  })

  it('never counts past the total', () => {
    expect(
      progressLabel({ phase: 'analysing', gamesDone: 25, gamesTotal: 25, etaMs: null }),
    ).toBe('Game 25 of 25')
  })

  it('has its own wording for the deep re-check and the end', () => {
    expect(progressLabel({ phase: 'verifying', gamesDone: 25, gamesTotal: 25, etaMs: null })).toContain(
      'worst moments',
    )
    expect(progressLabel({ phase: 'done', gamesDone: 25, gamesTotal: 25, etaMs: 0 })).toBe(
      'Analysis complete',
    )
  })
})

describe('formatEta', () => {
  it('rounds seconds to a friendly step, and minutes above 90s', () => {
    expect(formatEta(12_000)).toBe('~10 sec left')
    expect(formatEta(1_000)).toBe('~5 sec left')
    expect(formatEta(89_000)).toBe('~90 sec left')
    expect(formatEta(180_000)).toBe('~3 min left')
  })

  it('is null when there is nothing honest to say', () => {
    expect(formatEta(null)).toBeNull()
    expect(formatEta(0)).toBeNull()
    expect(formatEta(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('reason text', () => {
  it('has a label and a hint for every code the coach can emit', () => {
    const codes = [
      'ok',
      'book_move',
      'hangs_piece',
      'misses_tactic',
      'falls_for_trap',
      'loses_tempo',
      'moves_piece_twice',
      'early_queen',
      'blocks_development',
      'neglects_center',
      'weakens_king',
      'wrong_move_order',
    ] as const
    for (const code of codes) {
      expect(reasonLabel(code).length).toBeGreaterThan(3)
      expect(reasonHint(code).length).toBeGreaterThan(10)
    }
  })

  it('labels both analysed phases', () => {
    expect(PHASE_LABELS.opening).toContain('1–12')
    expect(PHASE_LABELS.middlegame).toContain('13–30')
  })
})
