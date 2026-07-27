import { useEffect, useState } from 'react'
import type { ProblemSessionStatus } from '../types'
import { useProblems } from '../store/problemsContext'
import { oneLineAttemptNotice } from '../problems'

const STATUS_TEXT: Partial<Record<ProblemSessionStatus, string>> = {
  solve: 'Your move — play your calculated line',
  opponent_replying: 'Opponent is replying…',
  wrong_move: 'Not correct',
  showing_refutation: 'Watch the refutation…',
  stopped: 'Attempt stopped',
  solved: 'Solved',
}

/**
 * Phase 3 — Solve (PLAN §8.1): execute the committed line. A wrong move is
 * named as wrong first and nothing more; from there the user picks another
 * attempt or the answer (stop-and-explain, then fix-move-gated retry). Engine
 * lines are revealed for self-checking once the attempt is over.
 */
export default function SolvePanel() {
  const status = useProblems((s) => s.status)
  const problem = useProblems((s) => s.problem)
  const solveStep = useProblems((s) => s.solveStep)
  const notice = useProblems((s) => s.notice)
  const feedback = useProblems((s) => s.feedback)
  const gradeError = useProblems((s) => s.gradeError)
  const engineLines = useProblems((s) => s.engineLines)
  const stopExplanation = useProblems((s) => s.stopExplanation)
  const retryWrongMove = useProblems((s) => s.retryWrongMove)
  const revealAnswer = useProblems((s) => s.revealAnswer)
  const retryFromStop = useProblems((s) => s.retryFromStop)
  const nextProblem = useProblems((s) => s.nextProblem)
  const backToPicker = useProblems((s) => s.backToPicker)

  // Engine lines stay collapsed while solving (no free hints) and open
  // automatically once the attempt is over.
  const [linesOpen, setLinesOpen] = useState(false)
  useEffect(() => {
    if (status === 'stopped' || status === 'solved') setLinesOpen(true)
  }, [status])

  const busy = status === 'opponent_replying'
  const solving = status === 'solve' || status === 'opponent_replying'

  // problem.moves = setup move + alternating user/opponent moves, so the user
  // owns half of them; solveStep is the index of the NEXT expected move.
  const totalUserMoves = problem ? problem.moves.length / 2 : 0
  const userMoveNumber = Math.min(totalUserMoves, Math.ceil(solveStep / 2))

  return (
    <div className="panel solve-panel">
      <div className="panel-title">Solve</div>

      <div className={`status-line problem-status-${status}`}>
        {busy && <span className="spinner" aria-hidden="true" />}
        <span>{STATUS_TEXT[status] ?? ''}</span>
        {solving && problem && (
          <span className="solve-progress">
            Your move {userMoveNumber} of {totalUserMoves}
          </span>
        )}
      </div>

      {solving && <p className="solve-reminder">{oneLineAttemptNotice()}</p>}

      {notice && (
        <div className={`coach-notice${status === 'wrong_move' ? ' coach-notice-wrong' : ''}`}>
          {notice}
        </div>
      )}

      {/*
        The wrong-move gate: the verdict is above, the answer is not. The user
        chooses another attempt or the lesson (PLAN §8.1).
      */}
      {status === 'wrong_move' && (
        <div className="problem-actions">
          <button type="button" className="btn btn-primary" onClick={retryWrongMove}>
            Try again?
          </button>
          <button type="button" className="btn" onClick={revealAnswer}>
            Show answer
          </button>
        </div>
      )}

      {status === 'stopped' && stopExplanation && (
        <div className="problem-stop">
          <span className="problem-stop-badge">Stop and explain</span>
          <p className="problem-stop-text">{stopExplanation}</p>
        </div>
      )}

      {gradeError && <p className="grade-error">{gradeError}</p>}

      {feedback && (
        <div className="reason-feedback">
          <div className="reason-feedback-title">Reasoning coach</div>
          <ul className="feedback-points">
            {feedback.goodPoints.map((p, i) => (
              <li key={`g${i}`} className="fb-good">
                <span className="fb-mark" aria-hidden="true">✓</span>
                {p}
              </li>
            ))}
            {feedback.missed.map((p, i) => (
              <li key={`m${i}`} className="fb-missed">
                <span className="fb-mark" aria-hidden="true">○</span>
                {p}
              </li>
            ))}
            {feedback.wrong.map((p, i) => (
              <li key={`w${i}`} className="fb-wrong">
                <span className="fb-mark" aria-hidden="true">✗</span>
                {p}
              </li>
            ))}
          </ul>
          <p className="reason-feedback-comment">{feedback.comment}</p>
        </div>
      )}

      {engineLines.length > 0 && (
        <div className="engine-lines">
          <button
            type="button"
            className="lines-toggle"
            onClick={() => setLinesOpen((o) => !o)}
            aria-expanded={linesOpen}
          >
            <span className="lines-toggle-arrow" aria-hidden="true">
              {linesOpen ? '▾' : '▸'}
            </span>
            Engine lines
          </button>
          {linesOpen && (
            <ol className="lines-list">
              {engineLines.map((line, i) => (
                <li key={i} className="lines-item">
                  <span className="line-eval">{line.evalText}</span>
                  <span className="line-san">{line.san.join(' ')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {status === 'stopped' && (
        <div className="problem-actions">
          <button type="button" className="btn btn-primary" onClick={retryFromStop}>
            Retry from before the mistake
          </button>
          <button type="button" className="btn" onClick={nextProblem}>
            Next problem
          </button>
          <button type="button" className="btn btn-ghost" onClick={backToPicker}>
            Back to problems
          </button>
        </div>
      )}

      {status === 'solved' && (
        <div className="problem-actions">
          <button type="button" className="btn btn-primary" onClick={nextProblem}>
            Next problem
          </button>
          <button type="button" className="btn btn-ghost" onClick={backToPicker}>
            Back to problems
          </button>
        </div>
      )}
    </div>
  )
}
