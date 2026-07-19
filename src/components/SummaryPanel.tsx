import type { Classification } from '../types'
import { useSession } from '../store/context'

const ORDER: Classification[] = ['book', 'good', 'inaccuracy', 'mistake', 'blunder']

const LABELS: Record<Classification, string> = {
  book: 'Book',
  good: 'Good',
  inaccuracy: 'Inaccuracies',
  mistake: 'Mistakes',
  blunder: 'Blunders',
}

export default function SummaryPanel() {
  const summary = useSession((s) => s.sessionSummary)
  const restartOpening = useSession((s) => s.restartOpening)
  const backToPicker = useSession((s) => s.backToPicker)

  if (!summary) return null

  return (
    <div className="panel summary-panel">
      <div className="panel-title">End of the line</div>
      <p className="summary-message">{summary.message}</p>
      <div className="summary-counts">
        {ORDER.map((c) => (
          <div key={c} className="summary-count">
            <span className={`chip chip-${c}`}>{LABELS[c]}</span>
            <span className="summary-count-value">{summary.counts[c]}</span>
          </div>
        ))}
      </div>
      <div className="summary-traps">
        <span>
          Traps avoided <strong className="dev-yes">{summary.trapsAvoided}</strong>
        </span>
        <span>
          Traps hit{' '}
          <strong className={summary.trapsHit > 0 ? 'dev-no' : ''}>{summary.trapsHit}</strong>
        </span>
        <span>
          Moves played <strong>{summary.userMoves}</strong>
        </span>
      </div>
      <div className="summary-actions">
        <button type="button" className="btn btn-primary" onClick={restartOpening}>
          Restart opening
        </button>
        <button type="button" className="btn" onClick={backToPicker}>
          Choose another opening
        </button>
      </div>
    </div>
  )
}
