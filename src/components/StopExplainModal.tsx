import { useSession } from '../store/context'

export default function StopExplainModal() {
  const lastAssessment = useSession((s) => s.lastAssessment)
  const retryFromBlunder = useSession((s) => s.retryFromBlunder)
  const restartOpening = useSession((s) => s.restartOpening)
  const backToPicker = useSession((s) => s.backToPicker)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal stop-modal">
        <div className="stop-modal-badge">Game stopped</div>
        <h2 className="stop-modal-title">
          {lastAssessment ? `${lastAssessment.san} loses the game` : 'That move loses'}
        </h2>
        {lastAssessment?.explanation && (
          <p className="stop-modal-explanation">{lastAssessment.explanation}</p>
        )}
        {!lastAssessment?.explanation && lastAssessment?.comment && (
          <p className="stop-modal-explanation">{lastAssessment.comment}</p>
        )}
        {lastAssessment?.fix && (
          <div className="stop-modal-fix">
            <span className="stop-modal-fix-label">The fix</span>
            <p>{lastAssessment.fix}</p>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={retryFromBlunder}>
            Retry from before the mistake
          </button>
          <button type="button" className="btn" onClick={restartOpening}>
            Restart opening
          </button>
          <button type="button" className="btn btn-ghost" onClick={backToPicker}>
            Choose another opening
          </button>
        </div>
      </div>
    </div>
  )
}
