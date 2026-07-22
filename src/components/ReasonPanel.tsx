import { useProblems } from '../store/problemsContext'

/**
 * Phase 2 — Reasoning (PLAN §8.1, the heart of the exercise): show the read
 * check reveal, then have the user write their idea and calculation in plain
 * language before any move is played. Submit hands the prose to the reasoning
 * coach (BYOK) or, keyless, moves on to the engine-line self-check.
 */
export default function ReasonPanel() {
  const status = useProblems((s) => s.status)
  const readReport = useProblems((s) => s.readReport)
  const reasoning = useProblems((s) => s.reasoning)
  const setReasoning = useProblems((s) => s.setReasoning)
  const submitReasoning = useProblems((s) => s.submitReasoning)
  const llmAvailable = useProblems((s) => s.llmAvailable)

  const grading = status === 'grading'

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

      <label className="reason-label" htmlFor="reasoning-input">
        Before you move: what&rsquo;s the idea? Write your line.
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
        {grading
          ? 'Grading your reasoning…'
          : llmAvailable
            ? 'Get feedback & solve'
            : 'Reveal engine lines & solve'}
      </button>

      {!llmAvailable && (
        <p className="reason-hint">
          Add your own Anthropic API key in settings (⚙) to get written feedback on your
          reasoning — it stays in this browser (BYOK).
        </p>
      )}
    </div>
  )
}
