import { describe, expect, it } from 'vitest'
import {
  infoToEngineLine,
  keepDeepestPerMultiPv,
  parseBestMoveLine,
  parseInfoLine,
  pvToSan,
  scoreToWhitePerspective,
  sideToMove,
  uciToSan,
  type ParsedInfo,
} from './uci'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
// White pawn on e7, kings far away: e7e8q is legal.
const PROMOTION_FEN = '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1'
// Italian game position where White can castle kingside (e1g1).
const CASTLE_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

describe('parseInfoLine', () => {
  it('parses a cp score line with depth, multipv and pv', () => {
    const line =
      'info depth 14 seldepth 21 multipv 1 score cp 34 nodes 123456 nps 500000 hashfull 12 time 250 pv e2e4 e7e5 g1f3'
    expect(parseInfoLine(line)).toEqual({
      depth: 14,
      multiPv: 1,
      score: { type: 'cp', value: 34 },
      pvUci: ['e2e4', 'e7e5', 'g1f3'],
    })
  })

  it('parses positive and negative mate scores', () => {
    const win = parseInfoLine('info depth 20 multipv 1 score mate 3 pv d1h5 g7g6 h5g6')
    expect(win?.score).toEqual({ type: 'mate', value: 3 })

    const loss = parseInfoLine('info depth 18 multipv 1 score mate -2 pv e8e7 d1h5 e7e6')
    expect(loss?.score).toEqual({ type: 'mate', value: -2 })
  })

  it('parses the multipv index', () => {
    const line = 'info depth 12 multipv 3 score cp -15 nodes 999 pv b1c3 g8f6'
    const parsed = parseInfoLine(line)
    expect(parsed?.multiPv).toBe(3)
    expect(parsed?.score).toEqual({ type: 'cp', value: -15 })
  })

  it('defaults multipv to 1 when absent', () => {
    const parsed = parseInfoLine('info depth 10 score cp 20 pv e2e4')
    expect(parsed?.multiPv).toBe(1)
  })

  it('returns null for non-eval lines', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-abc.nnue')).toBeNull()
    expect(parseInfoLine('info depth 5 currmove e2e4 currmovenumber 1')).toBeNull()
    expect(parseInfoLine('bestmove e2e4 ponder e7e5')).toBeNull()
    expect(parseInfoLine('readyok')).toBeNull()
  })
})

describe('parseBestMoveLine', () => {
  it('extracts the best move', () => {
    expect(parseBestMoveLine('bestmove e2e4 ponder e7e5')).toBe('e2e4')
    expect(parseBestMoveLine('bestmove e7e8q')).toBe('e7e8q')
  })

  it('returns null for (none) and unrelated lines', () => {
    expect(parseBestMoveLine('bestmove (none)')).toBeNull()
    expect(parseBestMoveLine('info depth 1 score cp 0 pv e2e4')).toBeNull()
  })
})

describe('sideToMove / scoreToWhitePerspective', () => {
  it('reads the side to move from a FEN', () => {
    expect(sideToMove(START_FEN)).toBe('w')
    expect(sideToMove(AFTER_E4_FEN)).toBe('b')
  })

  it('keeps scores unchanged when White is to move', () => {
    expect(scoreToWhitePerspective({ type: 'cp', value: 34 }, START_FEN)).toEqual({ cp: 34 })
    expect(scoreToWhitePerspective({ type: 'mate', value: 3 }, START_FEN)).toEqual({ mate: 3 })
  })

  it('negates scores when Black is to move', () => {
    // Engine says +25 for the side to move (Black) => -25 from White's view.
    expect(scoreToWhitePerspective({ type: 'cp', value: 25 }, AFTER_E4_FEN)).toEqual({ cp: -25 })
    expect(scoreToWhitePerspective({ type: 'cp', value: -40 }, AFTER_E4_FEN)).toEqual({ cp: 40 })
    // Black mates in 2 => White gets mated => -2 from White's perspective.
    expect(scoreToWhitePerspective({ type: 'mate', value: 2 }, AFTER_E4_FEN)).toEqual({ mate: -2 })
  })
})

describe('uciToSan / pvToSan', () => {
  it('converts simple moves', () => {
    expect(uciToSan(START_FEN, 'e2e4')).toBe('e4')
    expect(uciToSan(START_FEN, 'g1f3')).toBe('Nf3')
  })

  it('converts promotion moves (e7e8q)', () => {
    expect(uciToSan(PROMOTION_FEN, 'e7e8q')).toBe('e8=Q')
  })

  it('converts castling (e1g1 => O-O)', () => {
    expect(uciToSan(CASTLE_FEN, 'e1g1')).toBe('O-O')
  })

  it('returns null for illegal or malformed moves', () => {
    expect(uciToSan(START_FEN, 'e2e5')).toBeNull()
    expect(uciToSan(START_FEN, 'nonsense')).toBeNull()
  })

  it('replays a full pv and keeps san/uci aligned', () => {
    const { pvSan, pvUci } = pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6'])
    expect(pvSan).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
    expect(pvUci).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6'])
  })

  it('truncates cleanly at the first illegal pv move', () => {
    const { pvSan, pvUci } = pvToSan(START_FEN, ['e2e4', 'e7e5', 'e4e6', 'g1f3'])
    expect(pvSan).toEqual(['e4', 'e5'])
    expect(pvUci).toEqual(['e2e4', 'e7e5'])
  })
})

describe('infoToEngineLine', () => {
  it('builds a white-perspective EngineLine for a black-to-move fen', () => {
    const info: ParsedInfo = {
      depth: 14,
      multiPv: 1,
      score: { type: 'cp', value: 30 }, // +30 for Black (side to move)
      pvUci: ['e7e5', 'g1f3', 'b8c6'],
    }
    const line = infoToEngineLine(AFTER_E4_FEN, info)
    expect(line.cp).toBe(-30)
    expect(line.mate).toBeUndefined()
    expect(line.pvSan).toEqual(['e5', 'Nf3', 'Nc6'])
    expect(line.pvUci).toEqual(['e7e5', 'g1f3', 'b8c6'])
  })

  it('maps mate scores to the mate field', () => {
    const info: ParsedInfo = {
      depth: 10,
      multiPv: 1,
      score: { type: 'mate', value: 1 },
      pvUci: ['e7e8q'],
    }
    const line = infoToEngineLine(PROMOTION_FEN, info)
    expect(line.mate).toBe(1)
    expect(line.cp).toBeUndefined()
  })
})

describe('keepDeepestPerMultiPv', () => {
  const info = (depth: number, multiPv: number, cp: number): ParsedInfo => ({
    depth,
    multiPv,
    score: { type: 'cp', value: cp },
    pvUci: ['e2e4'],
  })

  it('keeps the deepest entry per multipv index', () => {
    const best = new Map<number, ParsedInfo>()
    keepDeepestPerMultiPv(best, info(10, 1, 10))
    keepDeepestPerMultiPv(best, info(12, 1, 20))
    keepDeepestPerMultiPv(best, info(11, 2, -5))
    expect(best.get(1)?.depth).toBe(12)
    expect(best.get(1)?.score.value).toBe(20)
    expect(best.get(2)?.depth).toBe(11)
  })

  it('prefers the later entry at equal depth and ignores stale shallower ones', () => {
    const best = new Map<number, ParsedInfo>()
    keepDeepestPerMultiPv(best, info(12, 1, 20))
    keepDeepestPerMultiPv(best, info(12, 1, 25)) // same depth, later wins
    keepDeepestPerMultiPv(best, info(8, 1, 99)) // shallower, ignored
    expect(best.get(1)?.score.value).toBe(25)
  })
})
