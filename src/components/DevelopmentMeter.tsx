import { useSession } from '../store/context'

export default function DevelopmentMeter() {
  const devScore = useSession((s) => s.devScore)

  return (
    <div className="panel dev-meter">
      <div className="panel-title">Development</div>
      {devScore === null ? (
        <div className="dev-empty">Make a move to see your development score.</div>
      ) : (
        <>
          <div className="dev-gauge">
            <div
              className="dev-gauge-fill"
              style={{ width: `${Math.max(0, Math.min(100, devScore.score))}%` }}
            />
            <span className="dev-gauge-value">{Math.round(devScore.score)}</span>
          </div>
          <div className="dev-stats">
            <span className="dev-stat">
              Minors out <strong>{devScore.developedMinors}/4</strong>
            </span>
            <span className="dev-stat">
              Castled{' '}
              <strong className={devScore.castled ? 'dev-yes' : 'dev-no'}>
                {devScore.castled ? '✓' : '✗'}
              </strong>
            </span>
            <span className="dev-stat">
              Center pawns <strong>{devScore.centerPawns}/2</strong>
            </span>
            <span className="dev-stat">
              Tempo lost{' '}
              <strong className={devScore.tempoLoss > 0 ? 'dev-no' : ''}>
                {devScore.tempoLoss}
              </strong>
            </span>
            {devScore.earlyQueen && <span className="dev-flag">Early queen</span>}
          </div>
        </>
      )}
    </div>
  )
}
