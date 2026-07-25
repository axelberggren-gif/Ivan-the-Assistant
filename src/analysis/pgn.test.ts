import { describe, expect, it } from 'vitest'
import { parseGameMoves, selectGamesForAnalysis } from './pgn'
import type { SelectableGame } from './types'

// A real-shaped chess.com PGN: headers, per-move clock comments, result token.
const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.07.20"]
[White "axel"]
[Black "opponent"]
[Result "0-1"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game"]
[TimeControl "600"]

1. e4 {[%clk 0:10:00]} 1... e5 {[%clk 0:09:58.1]} 2. Nf3 {[%clk 0:09:55]} 2... Nc6 {[%clk 0:09:52]} 3. Bc4 {[%clk 0:09:50]} 3... Bc5 {[%clk 0:09:47]} 0-1`

describe('parseGameMoves', () => {
  it('extracts SAN moves from a chess.com PGN with clock comments', () => {
    expect(parseGameMoves(CHESSCOM_PGN)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])
  })

  it('handles a bare movetext with no headers', () => {
    expect(parseGameMoves('1. d4 d5 2. c4 e6 1/2-1/2')).toEqual(['d4', 'd5', 'c4', 'e6'])
  })

  it('strips NAGs and variations', () => {
    const pgn = '1. e4 e5 2. Nf3 $1 Nc6 (2... d6 3. d4) 3. Bb5 *'
    expect(parseGameMoves(pgn)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'])
  })

  it('returns an empty list for an unparseable game rather than throwing', () => {
    expect(parseGameMoves('1. Ke5 Qz9 2. ???')).toEqual([])
    expect(parseGameMoves('')).toEqual([])
  })

  it('keeps promotion, castling and check notation intact', () => {
    const moves = parseGameMoves(
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O 6. Bg5 h6 7. Bxf6 Qxf6',
    )
    expect(moves).toContain('O-O')
    expect(moves).toContain('Bxf6')
    expect(moves.length).toBe(14)
  })
})

// ---------------------------------------------------------------------------

function game(overrides: Partial<SelectableGame> = {}): SelectableGame {
  return {
    url: 'https://www.chess.com/game/live/1',
    pgn: CHESSCOM_PGN,
    endTimeMs: 1_000,
    userColor: 'white',
    rated: true,
    timeClass: 'blitz',
    result: 'loss',
    ...overrides,
  }
}

const budget = { maxGames: 25, minPlies: 6 }

describe('selectGamesForAnalysis', () => {
  it('orders newest first and carries metadata through', () => {
    const picked = selectGamesForAnalysis(
      [
        game({ url: 'a', endTimeMs: 100 }),
        game({ url: 'c', endTimeMs: 300, openingFamily: 'Italian Game' }),
        game({ url: 'b', endTimeMs: 200 }),
      ],
      budget,
    )
    expect(picked.map((g) => g.id)).toEqual(['c', 'b', 'a'])
    expect(picked[0].meta).toMatchObject({
      url: 'c',
      endTimeMs: 300,
      openingFamily: 'Italian Game',
      result: 'loss',
    })
    expect(picked[0].movesSan[0]).toBe('e4')
  })

  it('skips unrated, daily, PGN-less and too-short games', () => {
    const picked = selectGamesForAnalysis(
      [
        game({ url: 'unrated', rated: false }),
        game({ url: 'daily', timeClass: 'daily' }),
        game({ url: 'nopgn', pgn: undefined }),
        game({ url: 'short', pgn: '1. e4 e5 2. Nf3 *' }),
        game({ url: 'keep' }),
      ],
      budget,
    )
    expect(picked.map((g) => g.id)).toEqual(['keep'])
  })

  it('caps at maxGames after sorting, so the newest survive', () => {
    const games = Array.from({ length: 5 }, (_, i) =>
      game({ url: `g${i}`, endTimeMs: i * 1000 }),
    )
    const picked = selectGamesForAnalysis(games, { maxGames: 2, minPlies: 6 })
    expect(picked.map((g) => g.id)).toEqual(['g4', 'g3'])
  })
})
