import { Chessboard } from 'react-chessboard'
import type { Arrow, Piece, Square } from 'react-chessboard/dist/chessboard/types'
import { useSession } from '../store/context'

export default function BoardPanel() {
  const fen = useSession((s) => s.fen)
  const userColor = useSession((s) => s.userColor)
  const status = useSession((s) => s.status)
  const hintArrow = useSession((s) => s.hintArrow)
  const userMove = useSession((s) => s.userMove)

  const draggable = status === 'playing'

  const arrows: Arrow[] = hintArrow
    ? [[hintArrow.from as Square, hintArrow.to as Square, '#d9a35a']]
    : []

  function onPieceDrop(source: Square, target: Square, piece: Piece): boolean {
    const isPromotion =
      piece[1] === 'P' && (target[1] === '8' || target[1] === '1')
    return userMove(source, target, isPromotion ? 'q' : undefined)
  }

  return (
    <div
      className={`board-wrap${status === 'showing_refutation' ? ' board-refuting' : ''}`}
    >
      <Chessboard
        position={fen}
        onPieceDrop={onPieceDrop}
        boardOrientation={userColor}
        arePiecesDraggable={draggable}
        customArrows={arrows}
        animationDuration={250}
        customBoardStyle={{ borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}
        customDarkSquareStyle={{ backgroundColor: '#8a6446' }}
        customLightSquareStyle={{ backgroundColor: '#e6d3b1' }}
      />
    </div>
  )
}
