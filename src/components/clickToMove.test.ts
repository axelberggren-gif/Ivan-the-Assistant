import { describe, expect, it } from 'vitest'
import type { Piece, Square } from 'react-chessboard/dist/chessboard/types'
import {
  isPromotionTarget,
  nextClickAction,
  selectedSquareStyles,
  sideToMoveFromFen,
  type Selection,
} from './clickToMove'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function sel(square: Square, piece: Piece): Selection {
  return { square, piece }
}

describe('sideToMoveFromFen', () => {
  it('reads the active-colour field', () => {
    expect(sideToMoveFromFen(START)).toBe('w')
    expect(
      sideToMoveFromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'),
    ).toBe('b')
  })

  it('is null for a FEN without a usable colour field', () => {
    expect(sideToMoveFromFen('')).toBeNull()
    expect(sideToMoveFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')).toBeNull()
  })
})

describe('isPromotionTarget', () => {
  it('is true only for a pawn reaching the last rank', () => {
    expect(isPromotionTarget('wP', 'e8')).toBe(true)
    expect(isPromotionTarget('bP', 'e1')).toBe(true)
    expect(isPromotionTarget('wP', 'e7')).toBe(false)
    expect(isPromotionTarget('wR', 'e8')).toBe(false)
    expect(isPromotionTarget('wK', 'e1')).toBe(false)
  })
})

describe('nextClickAction — with nothing selected', () => {
  it('selects a piece of the side to move', () => {
    expect(
      nextClickAction({ selection: null, clicked: 'e2', piece: 'wP', sideToMove: 'w' }),
    ).toEqual({ kind: 'select', selection: sel('e2', 'wP') })
  })

  it('ignores an empty square', () => {
    expect(
      nextClickAction({ selection: null, clicked: 'e4', piece: undefined, sideToMove: 'w' }),
    ).toEqual({ kind: 'noop' })
  })

  it("ignores the opponent's pieces", () => {
    expect(
      nextClickAction({ selection: null, clicked: 'e7', piece: 'bP', sideToMove: 'w' }),
    ).toEqual({ kind: 'noop' })
  })

  it('selects nothing when the side to move is unknown', () => {
    expect(
      nextClickAction({ selection: null, clicked: 'e2', piece: 'wP', sideToMove: null }),
    ).toEqual({ kind: 'noop' })
  })
})

describe('nextClickAction — with a piece selected', () => {
  it('clicking the same square puts the piece back down', () => {
    expect(
      nextClickAction({
        selection: sel('e2', 'wP'),
        clicked: 'e2',
        piece: 'wP',
        sideToMove: 'w',
      }),
    ).toEqual({ kind: 'unselect' })
  })

  it('clicking an empty square asks for the move', () => {
    expect(
      nextClickAction({
        selection: sel('e2', 'wP'),
        clicked: 'e4',
        piece: undefined,
        sideToMove: 'w',
      }),
    ).toEqual({ kind: 'move', from: 'e2', to: 'e4', promotion: undefined })
  })

  it('clicking an enemy piece asks for the capture', () => {
    expect(
      nextClickAction({
        selection: sel('f3', 'wN'),
        clicked: 'e5',
        piece: 'bP',
        sideToMove: 'w',
      }),
    ).toEqual({ kind: 'move', from: 'f3', to: 'e5', promotion: undefined })
  })

  it('asks for an illegal target too — the store decides legality', () => {
    // The point of the interaction: a nonsense target is still sent, comes back
    // rejected, and the hook just unselects. No special case here.
    expect(
      nextClickAction({
        selection: sel('e2', 'wP'),
        clicked: 'h6',
        piece: undefined,
        sideToMove: 'w',
      }),
    ).toEqual({ kind: 'move', from: 'e2', to: 'h6', promotion: undefined })
  })

  it('re-aims onto another piece of the side to move', () => {
    expect(
      nextClickAction({
        selection: sel('e2', 'wP'),
        clicked: 'g1',
        piece: 'wN',
        sideToMove: 'w',
      }),
    ).toEqual({ kind: 'select', selection: sel('g1', 'wN') })
  })

  it('auto-queens a pawn landing on the last rank', () => {
    expect(
      nextClickAction({
        selection: sel('b7', 'wP'),
        clicked: 'b8',
        piece: undefined,
        sideToMove: 'w',
      }),
    ).toEqual({ kind: 'move', from: 'b7', to: 'b8', promotion: 'q' })
  })

  it('lets Black select Black when it is Black to move (scratch board)', () => {
    expect(
      nextClickAction({ selection: null, clicked: 'd7', piece: 'bP', sideToMove: 'b' }),
    ).toEqual({ kind: 'select', selection: sel('d7', 'bP') })
  })
})

describe('selectedSquareStyles', () => {
  it('highlights exactly the selected square', () => {
    const styles = selectedSquareStyles(sel('e2', 'wP'))
    expect(Object.keys(styles)).toEqual(['e2'])
    expect(styles.e2).toMatchObject({ backgroundColor: expect.any(String) })
  })

  it('is empty with no selection', () => {
    expect(selectedSquareStyles(null)).toEqual({})
  })
})
