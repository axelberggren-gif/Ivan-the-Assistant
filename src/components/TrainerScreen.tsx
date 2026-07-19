import type { SessionStatus } from '../types'
import { useSession } from '../store/context'
import BoardPanel from './BoardPanel'
import EvalBar from './EvalBar'
import DevelopmentMeter from './DevelopmentMeter'
import FeedbackLog from './FeedbackLog'
import StopExplainModal from './StopExplainModal'
import SummaryPanel from './SummaryPanel'

const STATUS_TEXT: Record<SessionStatus, string> = {
  picking: '',
  playing: 'Your move',
  engine_thinking: 'Opponent is thinking…',
  assessing: 'Coach is checking your move…',
  showing_refutation: 'Watch how this gets punished…',
  stopped_blunder: 'Game stopped',
  out_of_book: 'You reached the end of the book line',
  complete: 'Session complete',
}

export default function TrainerScreen() {
  const status = useSession((s) => s.status)
  const opening = useSession((s) => s.opening)
  const userColor = useSession((s) => s.userColor)
  const backToPicker = useSession((s) => s.backToPicker)

  const busy = status === 'engine_thinking' || status === 'assessing'

  return (
    <div className="trainer">
      <div className="trainer-board-area">
        <EvalBar />
        <BoardPanel />
      </div>

      <aside className="trainer-side">
        <div className="panel trainer-head">
          <div className="trainer-head-row">
            <div>
              <h2 className="trainer-opening-name">{opening?.name ?? 'Training'}</h2>
              <div className="trainer-opening-meta">
                {opening?.eco} · you play {userColor}
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={backToPicker}>
              Openings
            </button>
          </div>
          <div className={`status-line status-${status}`}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {STATUS_TEXT[status]}
          </div>
        </div>

        <DevelopmentMeter />
        {status === 'out_of_book' && <SummaryPanel />}
        <FeedbackLog />
      </aside>

      {status === 'stopped_blunder' && <StopExplainModal />}
    </div>
  )
}
