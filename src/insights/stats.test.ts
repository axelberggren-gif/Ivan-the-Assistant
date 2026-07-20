import { describe, expect, it } from 'vitest'
import type { ChesscomGame, InsightsGame } from './types'
import { computeReport, normalizeGames } from './stats'

const USER = 'Axel800'

function pgn(eco: string, ecoUrl: string, movetext: string): string {
  return [
    '[Event "Live Chess"]',
    '[Site "Chess.com"]',
    `[ECO "${eco}"]`,
    `[ECOUrl "${ecoUrl}"]`,
    '',
    movetext,
  ].join('\n')
}

const CARO_PGN = pgn(
  'B12',
  'https://www.chess.com/openings/Caro-Kann-Defense-Advance-Variation-3...Bf5',
  '1. e4 {[%clk 0:09:58.2]} 1... c6 {[%clk 0:09:57]} 2. d4 d5 3. e5 Bf5 1-0',
)

let urlCounter = 0

function rawGame(overrides: Partial<ChesscomGame> = {}): ChesscomGame {
  return {
    url: `https://www.chess.com/game/live/${++urlCounter}`,
    pgn: CARO_PGN,
    end_time: 1_700_000_000,
    rated: true,
    time_class: 'rapid',
    rules: 'chess',
    time_control: '600',
    white: { username: 'Opponent1', rating: 850, result: 'resigned' },
    black: { username: USER, rating: 820, result: 'win' },
    ...overrides,
  }
}

describe('normalizeGames', () => {
  it('keeps only rules === "chess" and games the user played', () => {
    const games = normalizeGames(
      [
        rawGame(),
        rawGame({ rules: 'chess960' }),
        rawGame({ rules: 'bughouse' }),
        rawGame({
          white: { username: 'SomeoneElse', rating: 900, result: 'win' },
          black: { username: 'AnotherPlayer', rating: 880, result: 'checkmated' },
        }),
      ],
      USER,
    )
    expect(games).toHaveLength(1)
  })

  it('matches the username case-insensitively on either side', () => {
    const games = normalizeGames(
      [
        rawGame({
          white: { username: 'AXEL800', rating: 810, result: 'win' },
          black: { username: 'Opponent1', rating: 830, result: 'resigned' },
        }),
      ],
      'axel800',
    )
    expect(games).toHaveLength(1)
    expect(games[0].userColor).toBe('white')
    expect(games[0].userRating).toBe(810)
    expect(games[0].opponentRating).toBe(830)
    expect(games[0].opponentUsername).toBe('Opponent1')
  })

  it('converts end_time seconds to endTimeMs and sorts oldest first', () => {
    const games = normalizeGames(
      [rawGame({ end_time: 2000 }), rawGame({ end_time: 1000 }), rawGame({ end_time: 1500 })],
      USER,
    )
    expect(games.map((g) => g.endTimeMs)).toEqual([1_000_000, 1_500_000, 2_000_000])
  })

  it('maps the user result code to win/draw/loss', () => {
    const [win, draw, loss] = normalizeGames(
      [
        rawGame({ end_time: 1 }),
        rawGame({
          end_time: 2,
          white: { username: 'Opponent1', rating: 850, result: 'stalemate' },
          black: { username: USER, rating: 820, result: 'stalemate' },
        }),
        rawGame({
          end_time: 3,
          white: { username: 'Opponent1', rating: 850, result: 'win' },
          black: { username: USER, rating: 820, result: 'checkmated' },
        }),
      ],
      USER,
    )
    expect(win.result).toBe('win')
    expect(draw.result).toBe('draw')
    expect(loss.result).toBe('loss')
  })

  it('maps every chess.com draw code to draw', () => {
    const codes = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']
    const games = normalizeGames(
      codes.map((code, i) =>
        rawGame({
          end_time: i + 1,
          white: { username: 'Opponent1', rating: 850, result: code },
          black: { username: USER, rating: 820, result: code },
        }),
      ),
      USER,
    )
    expect(games.map((g) => g.result)).toEqual(codes.map(() => 'draw'))
    expect(games.map((g) => g.termination)).toEqual(codes.map(() => 'draw'))
  })

  it('takes the termination from the losing side, whichever side that is', () => {
    const games = normalizeGames(
      [
        // user wins, opponent resigned → resignation
        rawGame({ end_time: 1 }),
        // user wins on time → timeout (opponent's code)
        rawGame({
          end_time: 2,
          white: { username: 'Opponent1', rating: 850, result: 'timeout' },
          black: { username: USER, rating: 820, result: 'win' },
        }),
        // user checkmated → checkmate
        rawGame({
          end_time: 3,
          white: { username: 'Opponent1', rating: 850, result: 'win' },
          black: { username: USER, rating: 820, result: 'checkmated' },
        }),
        // user abandoned → abandoned
        rawGame({
          end_time: 4,
          white: { username: 'Opponent1', rating: 850, result: 'win' },
          black: { username: USER, rating: 820, result: 'abandoned' },
        }),
        // unknown decisive code → other
        rawGame({
          end_time: 5,
          white: { username: 'Opponent1', rating: 850, result: 'win' },
          black: { username: USER, rating: 820, result: 'lose' },
        }),
      ],
      USER,
    )
    expect(games.map((g) => g.termination)).toEqual([
      'resignation',
      'timeout',
      'checkmate',
      'abandoned',
      'other',
    ])
  })

  it('parses ECO, opening name and family from the PGN headers', () => {
    const [g] = normalizeGames([rawGame()], USER)
    expect(g.eco).toBe('B12')
    expect(g.openingName).toBe('Caro Kann Defense Advance Variation')
    expect(g.openingFamily).toBe('Caro Kann Defense')
  })

  it.each([
    ['Queens-Gambit-Declined-Exchange-Variation-4.cxd5', 'Queens Gambit Declined Exchange Variation', 'Queens Gambit'],
    ['Italian-Game-Two-Knights-Defense-4.Ng5', 'Italian Game Two Knights Defense', 'Italian Game'],
    ['Sicilian-Defense-Najdorf-Variation-6.Bg5', 'Sicilian Defense Najdorf Variation', 'Sicilian Defense'],
    ['Caro-Kann-Defense-Advance-Variation-3...Bf5', 'Caro Kann Defense Advance Variation', 'Caro Kann Defense'],
  ])('derives name and family from slug %s', (slug, name, family) => {
    const [g] = normalizeGames(
      [rawGame({ pgn: pgn('A00', `https://www.chess.com/openings/${slug}`, '1. e4 e5 1-0') })],
      USER,
    )
    expect(g.openingName).toBe(name)
    expect(g.openingFamily).toBe(family)
  })

  it('falls back to the first 3 words when no terminator word appears', () => {
    const [g] = normalizeGames(
      [rawGame({ pgn: pgn('A00', 'https://www.chess.com/openings/Old-Indian-Ukrainian-Line-Extra', '1. d4 1-0') })],
      USER,
    )
    expect(g.openingName).toBe('Old Indian Ukrainian Line Extra')
    expect(g.openingFamily).toBe('Old Indian Ukrainian')
  })

  it('drops query strings from the ECOUrl before parsing the slug', () => {
    const [g] = normalizeGames(
      [rawGame({ pgn: pgn('B10', 'https://www.chess.com/openings/Caro-Kann-Defense?ref=x', '1. e4 1-0') })],
      USER,
    )
    expect(g.openingName).toBe('Caro Kann Defense')
  })

  it('falls back to game.eco (a URL) when the PGN is missing', () => {
    const [g] = normalizeGames(
      [rawGame({ pgn: undefined, eco: 'https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation' })],
      USER,
    )
    expect(g.eco).toBeUndefined()
    expect(g.openingName).toBe('Sicilian Defense Najdorf Variation')
    expect(g.openingFamily).toBe('Sicilian Defense')
    expect(g.fullMoves).toBeUndefined()
  })

  it('counts full moves from the movetext, ignoring headers and {comments}', () => {
    const [g] = normalizeGames([rawGame()], USER)
    expect(g.fullMoves).toBe(3)
  })

  it('leaves fullMoves undefined when the movetext has no numbered moves', () => {
    const [g] = normalizeGames([rawGame({ pgn: '[Event "Live Chess"]\n\n*' })], USER)
    expect(g.fullMoves).toBeUndefined()
  })
})

function insightsGame(overrides: Partial<InsightsGame> = {}): InsightsGame {
  return {
    url: `https://www.chess.com/game/live/n${++urlCounter}`,
    endTimeMs: 1_000,
    timeClass: 'rapid',
    rated: true,
    userColor: 'black',
    userRating: 800,
    opponentRating: 800,
    opponentUsername: 'Opponent1',
    result: 'win',
    termination: 'resignation',
    ...overrides,
  }
}

describe('computeReport', () => {
  it('returns an empty report for no games', () => {
    const report = computeReport([], USER)
    expect(report.username).toBe(USER)
    expect(report.totalGames).toBe(0)
    expect(report.from).toBeUndefined()
    expect(report.to).toBeUndefined()
    expect(report.overall).toEqual({ games: 0, wins: 0, draws: 0, losses: 0, score: 0 })
    expect(report.openings).toEqual([])
    expect(report.ratingSeries).toEqual({})
  })

  it('aggregates a small fixture set end-to-end', () => {
    const caro = { openingFamily: 'Caro Kann Defense', eco: 'B12' } as const
    const games: InsightsGame[] = [
      // 4 rapid Caro-Kann games as black: 1 win, 2 losses, 1 draw
      insightsGame({ ...caro, endTimeMs: 4_000, userRating: 815, result: 'loss', termination: 'checkmate', fullMoves: 19 }),
      insightsGame({ ...caro, endTimeMs: 1_000, userRating: 800, result: 'win', termination: 'resignation', fullMoves: 25 }),
      insightsGame({ ...caro, endTimeMs: 3_000, userRating: 820, result: 'draw', termination: 'draw', fullMoves: 60 }),
      insightsGame({ ...caro, eco: 'B10', endTimeMs: 2_000, userRating: 810, result: 'loss', termination: 'timeout', fullMoves: 40 }),
      // 2 blitz games as white (below the 3-game opening threshold)
      insightsGame({
        openingFamily: 'Queens Gambit',
        eco: 'D06',
        timeClass: 'blitz',
        userColor: 'white',
        endTimeMs: 5_000,
        userRating: 780,
        result: 'win',
        termination: 'checkmate',
        fullMoves: 20,
      }),
      insightsGame({
        openingFamily: 'Queens Gambit',
        eco: 'D06',
        timeClass: 'blitz',
        userColor: 'white',
        endTimeMs: 6_000,
        userRating: 790,
        result: 'loss',
        termination: 'resignation',
        // fullMoves undefined → excluded from length buckets
      }),
    ]

    const report = computeReport(games, USER)

    expect(report.totalGames).toBe(6)
    expect(report.from).toBe(1_000)
    expect(report.to).toBe(6_000)
    expect(report.overall).toEqual({ games: 6, wins: 2, draws: 1, losses: 3, score: 2.5 / 6 })

    expect(report.ratingSeries.rapid).toEqual([
      { endTimeMs: 1_000, rating: 800 },
      { endTimeMs: 2_000, rating: 810 },
      { endTimeMs: 3_000, rating: 820 },
      { endTimeMs: 4_000, rating: 815 },
    ])
    expect(report.ratingSeries.blitz).toEqual([
      { endTimeMs: 5_000, rating: 780 },
      { endTimeMs: 6_000, rating: 790 },
    ])
    expect(report.ratingSeries.bullet).toBeUndefined()

    expect(report.byColor.black).toEqual({ games: 4, wins: 1, draws: 1, losses: 2, score: 1.5 / 4 })
    expect(report.byColor.white).toEqual({ games: 2, wins: 1, draws: 0, losses: 1, score: 0.5 })

    expect(report.byTimeClass.rapid?.games).toBe(4)
    expect(report.byTimeClass.blitz?.games).toBe(2)
    expect(report.byTimeClass.bullet).toBeUndefined()

    expect(report.openings).toEqual([
      {
        family: 'Caro Kann Defense',
        eco: 'B12', // most frequent (3× B12 vs 1× B10)
        asColor: 'black',
        split: { games: 4, wins: 1, draws: 1, losses: 2, score: 1.5 / 4 },
      },
    ])

    expect(report.lossEndings).toEqual({ checkmate: 1, timeout: 1, resignation: 1 })
    expect(report.winEndings).toEqual({ resignation: 1, checkmate: 1 })

    // fullMoves: 19 short; 25, 20 medium; 60, 40 long; one undefined excluded
    expect(report.lengthBuckets).toEqual({ short: 1, medium: 2, long: 2 })
  })

  it('bands opponents with ±50 boundaries inclusive of weaker/stronger', () => {
    const games: InsightsGame[] = [
      insightsGame({ endTimeMs: 1, userRating: 800, opponentRating: 750, result: 'win' }), // -50 → weaker
      insightsGame({ endTimeMs: 2, userRating: 800, opponentRating: 850, result: 'loss' }), // +50 → stronger
      insightsGame({ endTimeMs: 3, userRating: 800, opponentRating: 751, result: 'draw' }), // -49 → similar
      insightsGame({ endTimeMs: 4, userRating: 800, opponentRating: 849, result: 'win' }), // +49 → similar
      insightsGame({ endTimeMs: 5, userRating: 800, opponentRating: 800, result: 'loss' }), // 0 → similar
    ]
    const report = computeReport(games, USER)
    expect(report.byOpponentBand.weaker.games).toBe(1)
    expect(report.byOpponentBand.weaker.wins).toBe(1)
    expect(report.byOpponentBand.stronger.games).toBe(1)
    expect(report.byOpponentBand.stronger.losses).toBe(1)
    expect(report.byOpponentBand.similar).toEqual({ games: 3, wins: 1, draws: 1, losses: 1, score: 0.5 })
  })

  it('keeps only opening families with ≥ 3 games, sorted by games desc', () => {
    const mk = (family: string, n: number, color: 'white' | 'black' = 'black') =>
      Array.from({ length: n }, (_, i) =>
        insightsGame({ openingFamily: family, userColor: color, endTimeMs: urlCounter * 100 + i }),
      )
    const games = [
      ...mk('Sicilian Defense', 3),
      ...mk('Caro Kann Defense', 5),
      ...mk('Queens Gambit', 2, 'white'),
    ]
    const report = computeReport(games, USER)
    expect(report.openings.map((o) => o.family)).toEqual(['Caro Kann Defense', 'Sicilian Defense'])
  })

  it('splits the same family by color into separate rows', () => {
    const games = [
      ...Array.from({ length: 3 }, (_, i) =>
        insightsGame({ openingFamily: 'Italian Game', userColor: 'white', endTimeMs: i, result: 'win' }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        insightsGame({ openingFamily: 'Italian Game', userColor: 'black', endTimeMs: 10 + i, result: 'loss' }),
      ),
    ]
    const report = computeReport(games, USER)
    expect(report.openings).toHaveLength(2)
    expect(report.openings[0]).toMatchObject({ family: 'Italian Game', asColor: 'black' })
    expect(report.openings[0].split.losses).toBe(4)
    expect(report.openings[1]).toMatchObject({ family: 'Italian Game', asColor: 'white' })
    expect(report.openings[1].split.wins).toBe(3)
  })
})
