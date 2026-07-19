import { useSession } from '../store/context'

export default function OpeningPicker() {
  const openings = useSession((s) => s.openings)
  const pickOpening = useSession((s) => s.pickOpening)

  return (
    <div className="picker">
      <div className="picker-intro">
        <h2>Pick an opening to train</h2>
        <p>
          Play the line against a coached opponent. Every move gets feedback, and if you
          walk into a losing trap the game stops and shows you why.
        </p>
      </div>
      {openings.length === 0 ? (
        <div className="picker-empty">
          No openings loaded yet. The opening data module has not been initialised.
        </div>
      ) : (
        <div className="picker-grid">
          {openings.map((op) => (
            <button
              key={op.id}
              type="button"
              className="opening-card"
              onClick={() => pickOpening(op.id)}
            >
              <div className="opening-card-top">
                <span className="opening-eco">{op.eco}</span>
                <span className={`opening-color opening-color-${op.userColor}`}>
                  You play {op.userColor}
                </span>
              </div>
              <h3 className="opening-name">{op.name}</h3>
              <p className="opening-desc">{op.description}</p>
              <div className="opening-meta">
                {op.mainlines.length} line{op.mainlines.length === 1 ? '' : 's'} ·{' '}
                {op.trickLines.length} trap{op.trickLines.length === 1 ? '' : 's'} to dodge
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
