import { useEffect, useRef } from 'react'
import type { Classification } from '../types'
import { useSession } from '../store/context'

const LABELS: Record<Classification, string> = {
  book: 'Book',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
}

export default function FeedbackLog() {
  const feedback = useSession((s) => s.feedback)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [feedback.length])

  return (
    <div className="panel feedback-log">
      <div className="panel-title">Move feedback</div>
      {feedback.length === 0 ? (
        <div className="feedback-empty">Your moves and coaching notes appear here.</div>
      ) : (
        <ol className="feedback-list">
          {feedback.map((f, i) => (
            <li key={i} className="feedback-item">
              <div className="feedback-head">
                <span className="feedback-move">
                  {f.moveNumber}
                  {f.color === 'white' ? '.' : '…'} {f.san}
                </span>
                <span className={`chip chip-${f.classification}`}>
                  {LABELS[f.classification]}
                </span>
                {f.cpLoss > 0 && (
                  <span className="feedback-cploss">−{(f.cpLoss / 100).toFixed(1)}</span>
                )}
              </div>
              <div className="feedback-comment">{f.comment}</div>
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  )
}
