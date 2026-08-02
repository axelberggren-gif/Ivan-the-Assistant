import { useProblems } from '../store/problemsContext'
import { answerHeldNotice, exploreHint, formatSanLine, selfCheckNotice } from '../problems'

/**
 * Phase 2 — Reasoning (PLAN §8.1, the heart of the exercise): show the read
 * check reveal, let the user try candidate lines on the scratch board, then
 * write their idea before any real move is played. Submit hands the prose to
 * the reasoning coach (BYOK) or, keyless, moves on to the engine-line
 * self-check.
 *
 * The scratch board (ProblemBoard, reason phase) is a throwaway line the user
 * can commit into their notes as notation — so they only have to add the
 * "why", not transcribe every move.
 */
export default function ReasonPanel() {
  const status = useProblems((s) => s.status)
  const readReport = useProblems((s) => s.readReport)
  const reasoning = useProblems((s) => s.reasoning)
  const setReasoning = useProblems((s) => s.setReasoning)
  const submitReasoning = useProblems((s) => s.submitReasoning)
  const llmAvailable = useProblems((s) => s.llmAvailable)
  const exploreSan = useProblems((s) => s.exploreSan)
  const solveFen = useProblems((s) => s.solveFen)
  const undoExplore = useProblems((s) => s.undoExplore)
  const resetExplore = useProblems((s) => s.resetExplore)
  const commitExploreToReasoning = useProblems((s) => s.commitExploreToReasoning)

  const grading = status === 'grading'
  const hasLine = exploreSan.length > 0
  const scratchLine = solveFen ? formatSanLine(solveFen, exploreSan) : exploreSan.join(' ')

  return (
    <div className="panel reason-panel">
      <div className="panel-title">Your reasoning</div>

      {readReport && (
        <div className="read-report">
          <div className="report-chips">
            <span className={`chip ${readReport.materialCorrect ? 'chip-good' : 'chip-blunder'}`}>
              Material {readReport.materialCorrect ? '✓' : '✗'}
            </span>
            <span className={`chip ${readReport.verdictCorrect ? 'chip-good' : 'chip-blunder'}`}>
              Verdict {readReport.verdictCorrect ? '✓' : '✗'}
            </span>
          </div>
          <p className="coach-notice">{readReport.comment}</p>
        </div>
      )}

      <div className="explore-box">
        <div className="explore-header">
          <span className="explore-title">Scratch line</span>
          <div className="explore-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={undoExplore}
              disabled={!hasLine || grading}
            >
              Take back
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={resetExplore}
              disabled={!hasLine || grading}
            >
              Clear
            </button>
          </div>
        </div>
        {hasLine ? (
          <div className="explore-line" aria-live="polite">
            {scratchLine}
          </div>
        ) : (
          <p className="explore-empty">{exploreHint()}</p>
        )}
        <button
          type="button"
          className="btn explore-commit"
          onClick={commitExploreToReasoning}
          disabled={!hasLine || grading}
        >
          ↵ Add line to my notes
        </button>
      </div>

      <label className="reason-label" htmlFor="reasoning-input">
        Now motivate it: why does the line work?
      </label>
      <textarea
        id="reasoning-input"
        className="reason-textarea"
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        placeholder="e.g. 'I take on d4 first because otherwise the knight hangs.'"
        rows={5}
        disabled={grading}
      />

      <button
        type="button"
        className="btn btn-primary reason-submit"
        onClick={submitReasoning}
        disabled={grading}
      >
        {grading && <span className="spinner" aria-hidden="true" />}
        {grading ? 'Grading your reasoning…' : 'Lock it in & solve'}
      </button>

      {/*
        Nothing is revealed by submitting any more (ADR-0007) — the button used
        to promise engine lines, and the coach's feedback used to land on the
        solve panel. Both now wait for the attempt to finish.
      */}
      <p className="reason-hint">{answerHeldNotice()}</p>
      {!llmAvailable && <p className="reason-hint">{selfCheckNotice()}</p>}
    </div>
  )
}
