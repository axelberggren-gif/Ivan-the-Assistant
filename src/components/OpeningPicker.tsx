import { useContext } from 'react'
import type { Opening } from '../types'
import { useSession } from '../store/context'
import { InsightsStoreContext, useInsights } from '../store/insightsContext'

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
      <RecommendationBannerGuard openings={openings} pickOpening={pickOpening} />
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

interface BannerProps {
  openings: Opening[]
  pickOpening: (id: string) => void
}

/**
 * The picker must stay fully functional when the insights provider is absent
 * (e.g. the module failed to initialise), so the context read happens here and
 * the hook-using banner is only mounted when a store actually exists.
 */
function RecommendationBannerGuard(props: BannerProps) {
  const store = useContext(InsightsStoreContext)
  if (!store) return null
  return <RecommendationBanner {...props} />
}

function RecommendationBanner({ openings, pickOpening }: BannerProps) {
  const status = useInsights((s) => s.status)
  const recommendations = useInsights((s) => s.recommendations)

  if (status !== 'ready' || recommendations.length === 0) return null
  const rec = recommendations[0]
  // Guard against id mismatches between the recommender and the loaded book.
  if (!openings.some((op) => op.id === rec.openingId)) return null

  return (
    <div className="picker-reco">
      <div className="picker-reco-body">
        <span className="insights-reco-badge">Train what you lose</span>
        <p className="picker-reco-message">{rec.message}</p>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => pickOpening(rec.openingId)}
      >
        Train now
      </button>
    </div>
  )
}
