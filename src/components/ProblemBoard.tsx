import { Chessboard } from 'react-chessboard'
import type { Piece, Square } from 'react-chessboard/dist/chessboard/types'
import { useProblems } from '../store/problemsContext'

/**
 * Problems-mode board: same look and drop handling as BoardPanel, but reading
 * from the problems store. Pieces are draggable only in the solve phase — the
 * read and reason phases are hands-off by design (PLAN §8.1).
 */
export default function ProblemBoard() {
  const fen = useProblems((s) => s.fen)
  const userColor = useProblems((s) => s.userColor)
  const status = useProblems((s) => s.status)
  const userMove = useProblems((s) => s.userMove)

  const draggable = status === 'solve'

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
        animationDuration={250}
        customBoardStyle={{ borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}
        customDarkSquareStyle={{ backgroundColor: '#8a6446' }}
        customLightSquareStyle={{ backgroundColor: '#e6d3b1' }}
      />
    </div>
  )
}

const CLAMP = 600

/**
 * Problems-mode eval bar (same visuals as EvalBar, problems store). During
 * the read check the bar is masked — showing the engine's eval would give
 * away the verdict the user is being asked to guess.
 */
export function ProblemEvalBar() {
  const evalCp = useProblems((s) => s.evalCp)
  const status = useProblems((s) => s.status)

  const masked = status === 'read'

  const clamped = Math.max(-CLAMP, Math.min(CLAMP, evalCp))
  // White's share of the bar: 50% at equality, 100% at +6 or better.
  const whitePct = masked ? 50 : 50 + (clamped / CLAMP) * 50

  const label = masked
    ? '?'
    : Math.abs(evalCp) >= 9000
      ? evalCp > 0
        ? '#'
        : '-#'
      : `${evalCp >= 0 ? '+' : ''}${(evalCp / 100).toFixed(1)}`

  return (
    <div
      className="eval-bar"
      title={masked ? 'Engine evaluation hidden until your read check' : `Engine evaluation: ${label}`}
    >
      <div className="eval-bar-track">
        <div className="eval-bar-white" style={{ height: `${whitePct}%` }} />
      </div>
      <div className={`eval-bar-label ${evalCp >= 0 ? 'eval-white' : 'eval-black'}`}>
        {label}
      </div>
    </div>
  )
}
