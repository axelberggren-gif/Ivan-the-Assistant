import { useEffect, useState } from 'react'
import type { ProblemSessionStatus } from '../types'
import { useProblems } from '../store/problemsContext'
import { buildingLineNotice, formatSanLine, oneLineAttemptNotice } from '../problems'

const STATUS_TEXT: Partial<Record<ProblemSessionStatus, string>> = {
  wrong_move: 'Not correct',
  showing_refutation: 'Watch the refutation…',
  stopped: 'Attempt stopped',
  solved: 'Solved',
}

/**
 * Phase 3 — Solve (PLAN §8.1): play the whole line out — the user's moves AND
 * the replies they predicted — and commit it as one answer. Nothing is judged
 * until the commit; a failed line is then named as failed and nothing more,
 * and the user picks another attempt or the answer (stop-and-explain, then
 * fix-move-gated retry).
 *
 * While an attempt is live, the only thing on this panel about the answer is
 * what the user played (ADR-0007). The coach's feedback and the engine lines
 * appear at 'stopped' or 'solved' and nowhere else — the store enforces that by
 * withholding the data, and `attemptOver` below is the second lock.
 */
export default function SolvePanel() {
  const status = useProblems((s) => s.status)
  const problem = useProblems((s) => s.problem)
  const solveFen = useProblems((s) => s.solveFen)
  const historySan = useProblems((s) => s.historySan)
  const solveStep = useProblems((s) => s.solveStep)
  const lineComplete = useProblems((s) => s.lineComplete)
  const userColor = useProblems((s) => s.userColor)
  const notice = useProblems((s) => s.notice)
  const feedback = useProblems((s) => s.feedback)
  const gradeError = useProblems((s) => s.gradeError)
  const engineLines = useProblems((s) => s.engineLines)
  const stopExplanation = useProblems((s) => s.stopExplanation)
  const undoLineMove = useProblems((s) => s.undoLineMove)
  const clearLine = useProblems((s) => s.clearLine)
  const commitLine = useProblems((s) => s.commitLine)
  const retryWrongMove = useProblems((s) => s.retryWrongMove)
  const revealAnswer = useProblems((s) => s.revealAnswer)
  const retryFromStop = useProblems((s) => s.retryFromStop)
  const nextProblem = useProblems((s) => s.nextProblem)
  const backToPicker = useProblems((s) => s.backToPicker)

  // The attempt is over: the answer material is allowed on screen.
  const attemptOver = status === 'stopped' || status === 'solved'

  // Engine lines open automatically once the attempt is over, and close again
  // if the user starts another one (a retry after a reveal).
  const [linesOpen, setLinesOpen] = useState(false)
  useEffect(() => {
    if (status === 'stopped' || status === 'solved') setLinesOpen(true)
    else if (status === 'solve') setLinesOpen(false)
  }, [status])

  const solving = status === 'solve'
  // While the line is being built, historySan is the setup move plus the line.
  const lineSan = historySan.slice(1)
  const hasLine = lineSan.length > 0
  const showLine = status === 'solve' || status === 'wrong_move'

  // problem.moves = setup move + alternating user/reply plies, and solveStep is
  // the index of the next one — odd indices are the user's own moves.
  const totalPlies = problem ? problem.moves.length - 1 : 0
  const yourTurn = solveStep % 2 === 1

  return (
    <div className="panel solve-panel">
      <div className="panel-title">Solve</div>

      <div className={`status-line problem-status-${status}`}>
        <span>
          {solving
            ? lineComplete
              ? 'Line complete — commit it when you are ready'
              : yourTurn
                ? 'Your move — play the line you calculated'
                : `Their reply — play the ${userColor === 'white' ? 'Black' : 'White'} move you expect`
            : (STATUS_TEXT[status] ?? '')}
        </span>
        {solving && problem && (
          <span className="solve-progress">
            Move {Math.min(totalPlies, lineSan.length + (lineComplete ? 0 : 1))} of {totalPlies}
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
        The line under construction (both sides). Nothing here is judged until
        "Commit my line" — that is the only checkpoint (PLAN §8.1).
      */}
      {showLine && (
        <div className="explore-box">
          <div className="explore-header">
            <span className="explore-title">Your line</span>
            {/* At the gate the line is frozen — editing it is what "Try again?" is for. */}
            {solving && (
              <div className="explore-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={undoLineMove}
                  disabled={!hasLine}
                >
                  Take back
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={clearLine}
                  disabled={!hasLine}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
          {hasLine ? (
            <div className="explore-line" aria-live="polite">
              {solveFen ? formatSanLine(solveFen, lineSan) : lineSan.join(' ')}
            </div>
          ) : (
            <p className="explore-empty">{buildingLineNotice()}</p>
          )}
          {solving && (
            <button
              type="button"
              className="btn btn-primary explore-commit"
              onClick={commitLine}
              disabled={!lineComplete}
            >
              {lineComplete ? 'Commit my line' : 'Commit my line (play it out first)'}
            </button>
          )}
        </div>
      )}

      {/*
        The wrong-line gate: the verdict is above, the answer is not — not even
        which move failed. The user chooses another attempt or the lesson.
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

      {attemptOver && gradeError && <p className="grade-error">{gradeError}</p>}

      {attemptOver && feedback && (
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

      {attemptOver && engineLines.length > 0 && (
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
