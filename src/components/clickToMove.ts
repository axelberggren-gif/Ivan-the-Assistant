import type { CustomSquareStyles, Piece, Square } from 'react-chessboard/dist/chessboard/types'

/**
 * Click-to-move decision logic — pure, so it is Node-testable without a board.
 *
 * The interaction the owner asked for: click a piece to highlight (select) it,
 * then click the landing square. An illegal move does nothing at all — the
 * piece is simply unselected. Clicking off the board unselects too (that part
 * lives in `useClickToMove`, which owns the document listener).
 */

/** Colour to move, straight from the FEN's active-colour field. */
export function sideToMoveFromFen(fen: string): 'w' | 'b' | null {
  const field = fen.split(' ')[1]
  return field === 'w' || field === 'b' ? field : null
}

/** Whether moving `piece` onto `target` is a pawn promotion. */
export function isPromotionTarget(piece: Piece, target: Square): boolean {
  return piece[1] === 'P' && (target[1] === '8' || target[1] === '1')
}

/** A selected (highlighted) piece: the square it stands on and what it is. */
export type Selection = { square: Square; piece: Piece }

/** What a click on a square should do. The hook executes it; this decides it. */
export type ClickAction =
  | { kind: 'noop' }
  | { kind: 'select'; selection: Selection }
  | { kind: 'unselect' }
  | { kind: 'move'; from: Square; to: Square; promotion?: 'q' }

/**
 * Decide what a click on `clicked` means given the current selection.
 *
 * A piece is selectable when it belongs to the side to move — which is the
 * right rule for every board we have: the trainer and the solve phase only
 * accept the user's own moves anyway (the store rejects the rest), and the
 * reason-phase scratch board deliberately lets the user play out both sides.
 */
export function nextClickAction(args: {
  selection: Selection | null
  clicked: Square
  piece: Piece | undefined
  sideToMove: 'w' | 'b' | null
}): ClickAction {
  const { selection, clicked, piece, sideToMove } = args
  const ownPiece = piece !== undefined && piece[0] === sideToMove

  if (!selection) {
    // Nothing selected: only picking up a piece of the side to move does
    // anything. Clicking an empty square or the opponent is a no-op.
    return ownPiece ? { kind: 'select', selection: { square: clicked, piece } } : { kind: 'noop' }
  }

  // Clicking the highlighted piece again puts it back down.
  if (clicked === selection.square) return { kind: 'unselect' }

  // Clicking another of your own pieces re-aims the selection instead of
  // costing a click — the standard behaviour on every chess board.
  if (ownPiece) return { kind: 'select', selection: { square: clicked, piece } }

  // Otherwise this is the landing square. The store validates legality: an
  // illegal move changes nothing and the piece is unselected either way.
  return {
    kind: 'move',
    from: selection.square,
    to: clicked,
    promotion: isPromotionTarget(selection.piece, clicked) ? 'q' : undefined,
  }
}

/**
 * The highlight for the selected square. Warm gold so it reads on both the
 * meadow-green dark squares and the pale light ones, and never reads as the
 * coach's green hint arrow.
 */
export function selectedSquareStyles(selection: Selection | null): CustomSquareStyles {
  if (!selection) return {}
  return {
    [selection.square]: {
      backgroundColor: 'rgba(246, 200, 95, 0.62)',
      boxShadow: 'inset 0 0 0 3px rgba(160, 118, 24, 0.7)',
    },
  }
}
