import { Chessboard } from 'react-chessboard'
import type { Piece, Square } from 'react-chessboard/dist/chessboard/types'
import { useProblems } from '../store/problemsContext'
import { useClickToMove } from './useClickToMove'

/**
 * Problems-mode board: same look and move handling as BoardPanel, but reading
 * from the problems store. Pieces are movable in the solve phase (the real
 * attempt — both sides, since the user plays the replies they predict too,
 * ADR-0006) and in the reason phase (a throwaway scratchpad for trying lines);
 * the read phase is hands-off by design (PLAN §8.1).
 */
export default function ProblemBoard() {
  const fen = useProblems((s) => s.fen)
  const userColor = useProblems((s) => s.userColor)
  const status = useProblems((s) => s.status)
  const userMove = useProblems((s) => s.userMove)
  const exploreMove = useProblems((s) => s.exploreMove)

  const exploring = status === 'reason'
  const draggable = status === 'solve' || exploring

  // In the reason phase the board is a scratchpad — moves feed the tried line,
  // never the real attempt.
  const move = exploring ? exploreMove : userMove

  // Two ways to play the same move: drag it, or click the piece and then the
  // square it should land on.
  const click = useClickToMove({ fen, enabled: draggable, move })

  function onPieceDrop(source: Square, target: Square, piece: Piece): boolean {
    const isPromotion =
      piece[1] === 'P' && (target[1] === '8' || target[1] === '1')
    return move(source, target, isPromotion ? 'q' : undefined)
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
        animationDuration={250}
        customBoardStyle={{ borderRadius: '16px', boxShadow: '0 12px 30px rgba(0,0,0,0.16)' }}
        customDarkSquareStyle={{ backgroundColor: 'oklch(0.62 0.11 150)' }}
        customLightSquareStyle={{ backgroundColor: '#e9f0dd' }}
      />
    </div>
  )
}

const CLAMP = 600

/**
 * Problems-mode eval bar (same visuals as EvalBar, problems store). Masked in
 * two places: during the read check, where showing the engine's eval would give
 * away the verdict the user is being asked to guess, and for the whole of a
 * live attempt (ADR-0007). The second one is also a correctness fix — the store
 * deliberately runs no engine during the solve phase, so the number left in
 * `evalCp` is the solve position's, not the position now on the board.
 */
const MASKED_STATUSES: ReadonlySet<string> = new Set(['read', 'solve', 'wrong_move'])

export function ProblemEvalBar() {
  const evalCp = useProblems((s) => s.evalCp)
  const status = useProblems((s) => s.status)

  const masked = MASKED_STATUSES.has(status)

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
      title={masked ? 'Engine evaluation is hidden while you work' : `Engine evaluation: ${label}`}
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
