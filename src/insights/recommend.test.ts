import { describe, expect, it } from 'vitest'
import { openings } from '../data'
import type { InsightsReport, OpeningReportRow, WdlSplit } from './types'
import { recommendTraining } from './recommend'

/** The real trainable openings from src/data, as the caller would pass them. */
const trainable = openings.map((o) => ({ id: o.id, name: o.name, userColor: o.userColor }))

function split(wins: number, draws: number, losses: number): WdlSplit {
  const games = wins + draws + losses
  return { games, wins, draws, losses, score: games === 0 ? 0 : (wins + draws / 2) / games }
}

function row(family: string, asColor: 'white' | 'black', s: WdlSplit, eco?: string): OpeningReportRow {
  return { family, eco, asColor, split: s }
}

function report(rows: OpeningReportRow[]): InsightsReport {
  return {
    username: 'Axel800',
    totalGames: rows.reduce((n, r) => n + r.split.games, 0),
    ratingSeries: {},
    overall: split(0, 0, 0),
    byColor: { white: split(0, 0, 0), black: split(0, 0, 0) },
    byTimeClass: {},
    byOpponentBand: { weaker: split(0, 0, 0), similar: split(0, 0, 0), stronger: split(0, 0, 0) },
    openings: rows,
    lossEndings: {},
    winEndings: {},
    lengthBuckets: { short: 0, medium: 0, long: 0 },
  }
}

describe('recommendTraining', () => {
  it('returns nothing for an empty report', () => {
    expect(recommendTraining(report([]), trainable)).toEqual([])
  })

  it('recommends the Caro-Kann from a slug-derived family as black', () => {
    const recs = recommendTraining(report([row('Caro Kann Defense', 'black', split(3, 0, 8), 'B12')]), trainable)
    expect(recs).toHaveLength(1)
    expect(recs[0].openingId).toBe('caro-kann')
    expect(recs[0].openingName).toBe('Caro-Kann Defense')
    expect(recs[0].split).toEqual(split(3, 0, 8))
    expect(recs[0].message).toContain('lost 8')
    expect(recs[0].message).toContain('11 games')
    expect(recs[0].message).toContain('Caro-Kann Defense')
    expect(recs[0].message).not.toContain('drawn')
  })

  it("matches Queen's Gambit despite the apostrophe", () => {
    const recs = recommendTraining(report([row('Queens Gambit', 'white', split(2, 0, 6), 'D06')]), trainable)
    expect(recs).toHaveLength(1)
    expect(recs[0].openingId).toBe('queens-gambit')
  })

  it('matches the Sicilian Defense as black', () => {
    const recs = recommendTraining(report([row('Sicilian Defense', 'black', split(1, 1, 5), 'B90')]), trainable)
    expect(recs).toHaveLength(1)
    expect(recs[0].openingId).toBe('sicilian-defense')
    expect(recs[0].message).toContain('drawn 1')
  })

  it('matches the Italian Game directly and via the giuoco/two knights aliases, merging rows', () => {
    const recs = recommendTraining(
      report([
        row('Italian Game', 'white', split(1, 0, 2), 'C50'),
        row('Giuoco Piano Game', 'white', split(0, 1, 2), 'C53'),
        row('Two Knights Defense', 'white', split(1, 0, 2), 'C57'),
      ]),
      trainable,
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].openingId).toBe('italian-game')
    // merged: 2W 1D 6L of 9 → score 2.5/9
    expect(recs[0].split).toEqual(split(2, 1, 6))
  })

  it('ignores rows played as the wrong color', () => {
    // Caro-Kann is trained as black; a white-side row must not match it
    const recs = recommendTraining(report([row('Caro Kann Defense', 'white', split(0, 0, 9))]), trainable)
    expect(recs).toEqual([])
  })

  it('does not match unrelated families', () => {
    const recs = recommendTraining(
      report([row('Kings Indian Defense', 'black', split(0, 0, 9)), row('London System', 'white', split(0, 0, 9))]),
      trainable,
    )
    expect(recs).toEqual([])
  })

  it('requires at least 5 merged games', () => {
    const four = recommendTraining(report([row('Caro Kann Defense', 'black', split(0, 0, 4))]), trainable)
    expect(four).toEqual([])
    const five = recommendTraining(report([row('Caro Kann Defense', 'black', split(0, 0, 5))]), trainable)
    expect(five).toHaveLength(1)
  })

  it('requires score strictly below 0.5', () => {
    // 3W 0D 3L → score exactly 0.5 → no recommendation
    const atHalf = recommendTraining(report([row('Caro Kann Defense', 'black', split(3, 0, 3))]), trainable)
    expect(atHalf).toEqual([])
    // 2W 1D 3L → score 2.5/6 < 0.5 → recommended
    const below = recommendTraining(report([row('Caro Kann Defense', 'black', split(2, 1, 3))]), trainable)
    expect(below).toHaveLength(1)
  })

  it('computes urgency as (0.5 - score) * min(games, 20) and sorts desc', () => {
    const recs = recommendTraining(
      report([
        row('Caro Kann Defense', 'black', split(2, 0, 8)), // score 0.2, 10 games → 0.3 * 10 = 3
        row('Sicilian Defense', 'black', split(0, 0, 30)), // score 0, 30 games capped at 20 → 0.5 * 20 = 10
        row('Queens Gambit', 'white', split(2, 2, 4)), // score 3/8, 8 games → 0.125 * 8 = 1
      ]),
      trainable,
    )
    expect(recs.map((r) => r.openingId)).toEqual(['sicilian-defense', 'caro-kann', 'queens-gambit'])
    expect(recs[0].urgency).toBeCloseTo(10)
    expect(recs[1].urgency).toBeCloseTo(3)
    expect(recs[2].urgency).toBeCloseTo(1)
  })
})
