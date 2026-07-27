import { Chessboard } from 'react-chessboard'
import type { Arrow, Piece, Square } from 'react-chessboard/dist/chessboard/types'
import { useSession } from '../store/context'
import { useClickToMove } from './useClickToMove'

export default function BoardPanel() {
  const fen = useSession((s) => s.fen)
  const userColor = useSession((s) => s.userColor)
  const status = useSession((s) => s.status)
  const hintArrow = useSession((s) => s.hintArrow)
  const userMove = useSession((s) => s.userMove)

  const draggable = status === 'playing'

  // Two ways to play the same move: drag it, or click the piece and then the
  // square it should land on.
  const click = useClickToMove({ fen, enabled: draggable, move: userMove })

  const arrows: Arrow[] = hintArrow
    ? [[hintArrow.from as Square, hintArrow.to as Square, 'oklch(0.6 0.13 150)']]
    : []

  function onPieceDrop(source: Square, target: Square, piece: Piece): boolean {
    const isPromotion =
      piece[1] === 'P' && (target[1] === '8' || target[1] === '1')
    return userMove(source, target, isPromotion ? 'q' : undefined)
  }

  return (
    <div
      ref={click.boardRef}
      className={`board-wrap${status === 'showing_refutation' ? ' board-refuting' : ''}`}
    >
      <Chessboard
        position={fen}
        onPieceDrop={onPieceDrop}
        onSquareClick={click.onSquareClick}
        customSquareStyles={click.squareStyles}
        boardOrientation={userColor}
        arePiecesDraggable={draggable}
        customArrows={arrows}
        animationDuration={250}
        customBoardStyle={{ borderRadius: '16px', boxShadow: '0 12px 30px rgba(0,0,0,0.16)' }}
        customDarkSquareStyle={{ backgroundColor: 'oklch(0.62 0.11 150)' }}
        customLightSquareStyle={{ backgroundColor: '#e9f0dd' }}
      />
    </div>
  )
}
