import { useSession } from '../store/context'
import BoardPanel from './BoardPanel'
import BoardSheet from './BoardSheet'
import EvalBar from './EvalBar'
import DevelopmentMeter from './DevelopmentMeter'
import FeedbackLog from './FeedbackLog'
import StopExplainModal from './StopExplainModal'
import SummaryPanel from './SummaryPanel'
import { TRAINER_STATUS_TEXT, trainerPeek } from './sheetPeek'

export default function TrainerScreen() {
  const status = useSession((s) => s.status)
  const opening = useSession((s) => s.opening)
  const userColor = useSession((s) => s.userColor)
  const backToPicker = useSession((s) => s.backToPicker)
  const notice = useSession((s) => s.notice)
  const sessionSummary = useSession((s) => s.sessionSummary)

  const busy = status === 'engine_thinking' || status === 'assessing'

  // On a phone the status line is hoisted into the sheet's peek row, so the
  // copy inside the head panel is marked a duplicate and hidden there (see
  // `.sheet-dup` in index.css).
  const peek = trainerPeek({ status, notice, openingName: opening?.name })

  return (
    <div className="trainer">
      <div className="trainer-board-area">
        <EvalBar />
        <BoardPanel />
      </div>

      <BoardSheet peek={peek}>
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
          <div className={`status-line status-${status} sheet-dup`}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {TRAINER_STATUS_TEXT[status]}
          </div>
          {/* The notice stays: the peek only has room for its first line. */}
          {notice && <div className="coach-notice">{notice}</div>}
        </div>

        <DevelopmentMeter />
        {sessionSummary && <SummaryPanel />}
        <FeedbackLog />
      </BoardSheet>

      {status === 'stopped_blunder' && <StopExplainModal />}
    </div>
  )
}
