import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomSquareStyles, Piece, Square } from 'react-chessboard/dist/chessboard/types'
import {
  nextClickAction,
  selectedSquareStyles,
  sideToMoveFromFen,
  type Selection,
} from './clickToMove'

export type ClickToMove = {
  /** Attach to the element wrapping the board — a click outside it unselects. */
  boardRef: React.RefObject<HTMLDivElement>
  /** Pass to `<Chessboard onSquareClick>`. */
  onSquareClick: (square: Square, piece: Piece | undefined) => void
  /** Pass to `<Chessboard customSquareStyles>` (merge with your own styles). */
  squareStyles: CustomSquareStyles
}

/**
 * Click-to-move for a board: click a piece to highlight it, click the landing
 * square to play it. `move` is the store action (`userMove` / `exploreMove`) —
 * it owns legality, and an illegal move just unselects the piece.
 *
 * Selection is transient UI state, so it lives here rather than in the store
 * (`src/store/CLAUDE.md`: the store orchestrates the game, it does not track
 * pointer interactions). The decision logic itself is pure — `clickToMove.ts`.
 */
export function useClickToMove(args: {
  fen: string
  /** False while the board is hands-off (opponent thinking, read phase, …). */
  enabled: boolean
  move: (from: string, to: string, promotion?: string) => boolean
}): ClickToMove {
  const { fen, enabled, move } = args
  const boardRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  // Any new position — our own move, the opponent's reply, a retry reset — and
  // the highlight is stale. Same when the board goes hands-off.
  useEffect(() => {
    setSelection(null)
  }, [fen, enabled])

  // "Click anywhere but the board and the piece is unselected."
  useEffect(() => {
    if (!selection) return
    function onPointerDown(e: PointerEvent) {
      const board = boardRef.current
      if (board && e.target instanceof Node && board.contains(e.target)) return
      setSelection(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [selection])

  const onSquareClick = useCallback(
    (square: Square, piece: Piece | undefined) => {
      if (!enabled) {
        setSelection(null)
        return
      }
      const action = nextClickAction({
        selection,
        clicked: square,
        piece,
        sideToMove: sideToMoveFromFen(fen),
      })
      switch (action.kind) {
        case 'noop':
          return
        case 'select':
          setSelection(action.selection)
          return
        case 'unselect':
          setSelection(null)
          return
        case 'move':
          // Illegal (or bounced by the fix-move gate) is not an error here: the
          // board is unchanged and the piece is simply put back down.
          move(action.from, action.to, action.promotion)
          setSelection(null)
          return
      }
    },
    [enabled, fen, move, selection],
  )

  return { boardRef, onSquareClick, squareStyles: selectedSquareStyles(selection) }
}
