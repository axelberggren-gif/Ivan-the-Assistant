import { useMemo } from 'react'
import type {
  ChesscomStats,
  FetchProgress,
  InsightsReport,
  OpeningReportRow,
  RatingPoint,
  Termination,
  TimeClass,
  TrainRecommendation,
  WdlSplit,
} from '../insights/types'
import { useInsights } from '../store/insightsContext'
import WeaknessPanel from './WeaknessPanel'

interface InsightsScreenProps {
  /** Provided by App: switches to the trainer and starts the opening. */
  onTrain?: (openingId: string) => void
}

const TIME_CLASS_LABELS: Record<TimeClass, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  daily: 'Daily',
}

const TERMINATION_LABELS: Record<Termination, string> = {
  checkmate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Timeout',
  draw: 'Draw',
  abandoned: 'Abandoned',
  other: 'Other',
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export default function InsightsScreen({ onTrain }: InsightsScreenProps) {
  const status = useInsights((s) => s.status)
  const report = useInsights((s) => s.report)

  return (
    <div className="insights">
      <UsernameForm />
      {status === 'error' && <InsightsErrorState />}
      {status === 'ready' && report && <Dashboard onTrain={onTrain} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Username form + loading progress
// ---------------------------------------------------------------------------

function UsernameForm() {
  const usernameInput = useInsights((s) => s.usernameInput)
  const setUsernameInput = useInsights((s) => s.setUsernameInput)
  const loadUser = useInsights((s) => s.loadUser)
  const status = useInsights((s) => s.status)
  const progress = useInsights((s) => s.progress)

  const loading = status === 'loading'

  return (
    <div className="panel insights-form-panel">
      <div className="panel-title">Your chess.com games</div>
      <form
        className="insights-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!loading) loadUser()
        }}
      >
        <input
          type="text"
          className="insights-input"
          placeholder="chess.com username"
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
          disabled={loading}
          aria-label="chess.com username"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || usernameInput.trim() === ''}
        >
          {loading ? 'Loading…' : 'Load my games'}
        </button>
      </form>
      {status === 'idle' && (
        <p className="insights-form-hint">
          Public chess.com data — just your username, no login.
        </p>
      )}
      {loading && <LoadingProgress progress={progress} />}
    </div>
  )
}

const PHASE_LABELS: Record<FetchProgress['phase'], string> = {
  archives: 'Finding your game archives',
  months: 'Fetching games',
  stats: 'Fetching your ratings',
  done: 'Crunching the numbers',
}

function LoadingProgress({ progress }: { progress: FetchProgress | null }) {
  return (
    <div className="insights-progress">
      <span className="spinner" aria-hidden="true" />
      {progress ? (
        <span>
          {PHASE_LABELS[progress.phase]}
          {progress.monthsTotal > 0 && (
            <>
              {' — month '}
              {Math.min(progress.monthsDone + 1, progress.monthsTotal)} of{' '}
              {progress.monthsTotal} · {progress.gamesSoFar} games
            </>
          )}
        </span>
      ) : (
        <span>Contacting chess.com…</span>
      )}
    </div>
  )
}

function InsightsErrorState() {
  const error = useInsights((s) => s.error)
  const loadUser = useInsights((s) => s.loadUser)

  return (
    <div className="insights-error" role="alert">
      <span>{error ?? 'Loading your games failed.'}</span>
      <button type="button" className="btn btn-small" onClick={loadUser}>
        Retry
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard (status === 'ready')
// ---------------------------------------------------------------------------

function Dashboard({ onTrain }: InsightsScreenProps) {
  const report = useInsights((s) => s.report)
  const stats = useInsights((s) => s.stats)
  const recommendations = useInsights((s) => s.recommendations)

  if (!report) return null

  return (
    <>
      <SummaryStrip report={report} stats={stats} />
      {recommendations.length > 0 && (
        <RecommendationCallout rec={recommendations[0]} onTrain={onTrain} />
      )}
      <RatingChart series={report.ratingSeries} />
      <ResultsGrid report={report} />
      <OpeningsTable openings={report.openings} recommendations={recommendations} />
      <Endings report={report} />
      {/* Engine-based half of Milestone 5 (PLAN.md §5.2): opt-in, background. */}
      <WeaknessPanel />
    </>
  )
}

// -- Summary strip -----------------------------------------------------------

const RATING_SECTIONS: Array<{ key: keyof ChesscomStats; label: string }> = [
  { key: 'chess_rapid', label: 'Rapid' },
  { key: 'chess_blitz', label: 'Blitz' },
  { key: 'chess_bullet', label: 'Bullet' },
]

function SummaryStrip({
  report,
  stats,
}: {
  report: InsightsReport
  stats: ChesscomStats | null
}) {
  return (
    <div className="insights-summary-strip">
      {RATING_SECTIONS.map(({ key, label }) => {
        const section = stats?.[key]
        if (!section?.last) return null
        return (
          <div key={key} className="insights-card">
            <div className="insights-card-label">{label}</div>
            <div className="insights-card-value">{section.last.rating}</div>
            {section.record && (
              <div className="insights-card-sub">
                {section.record.win}W / {section.record.loss}L / {section.record.draw}D
              </div>
            )}
          </div>
        )
      })}
      <div className="insights-card">
        <div className="insights-card-label">Games analyzed</div>
        <div className="insights-card-value">{report.totalGames}</div>
        {report.from != null && report.to != null && (
          <div className="insights-card-sub">
            {formatDate(report.from)} – {formatDate(report.to)}
          </div>
        )}
      </div>
    </div>
  )
}

// -- Recommendation callout ---------------------------------------------------

function RecommendationCallout({
  rec,
  onTrain,
}: {
  rec: TrainRecommendation
  onTrain?: (openingId: string) => void
}) {
  return (
    <div className="insights-reco">
      <div className="insights-reco-body">
        <span className="insights-reco-badge">Train what you lose</span>
        <p className="insights-reco-message">{rec.message}</p>
      </div>
      {onTrain && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onTrain(rec.openingId)}
        >
          Train it now
        </button>
      )}
    </div>
  )
}

// -- Rating over time (inline SVG) --------------------------------------------

const CHART_W = 700
const CHART_H = 220
const PAD_X = 12
const PAD_TOP = 16
/* Tall enough that the min-rating label clears the date row below it. */
const PAD_BOTTOM = 44

function RatingChart({
  series,
}: {
  series: Partial<Record<TimeClass, RatingPoint[]>>
}) {
  const picked = useMemo(() => {
    let best: { timeClass: TimeClass; points: RatingPoint[] } | null = null
    for (const [tc, points] of Object.entries(series) as Array<
      [TimeClass, RatingPoint[] | undefined]
    >) {
      if (points && points.length > 1 && (!best || points.length > best.points.length)) {
        best = { timeClass: tc, points }
      }
    }
    return best
  }, [series])

  if (!picked) return null

  const { timeClass, points } = picked
  const ratings = points.map((p) => p.rating)
  const minRating = Math.min(...ratings)
  const maxRating = Math.max(...ratings)
  const spread = Math.max(maxRating - minRating, 1)
  const minTime = points[0].endTimeMs
  const maxTime = points[points.length - 1].endTimeMs
  const timeSpread = Math.max(maxTime - minTime, 1)

  const x = (t: number) => PAD_X + ((t - minTime) / timeSpread) * (CHART_W - PAD_X * 2)
  const y = (r: number) =>
    PAD_TOP + (1 - (r - minRating) / spread) * (CHART_H - PAD_TOP - PAD_BOTTOM)

  const line = points.map((p) => `${x(p.endTimeMs).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ')

  return (
    <div className="panel insights-section">
      <div className="panel-title">
        Rating over time — {TIME_CLASS_LABELS[timeClass]} ({points.length} games)
      </div>
      <svg
        className="insights-chart"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`${TIME_CLASS_LABELS[timeClass]} rating over time, from ${minRating} to ${maxRating}`}
      >
        <line
          x1={PAD_X}
          y1={y(maxRating)}
          x2={CHART_W - PAD_X}
          y2={y(maxRating)}
          className="insights-chart-grid"
        />
        <line
          x1={PAD_X}
          y1={y(minRating)}
          x2={CHART_W - PAD_X}
          y2={y(minRating)}
          className="insights-chart-grid"
        />
        <polyline points={line} className="insights-chart-line" />
        <text x={PAD_X} y={y(maxRating) - 5} className="insights-chart-label">
          {maxRating}
        </text>
        <text x={PAD_X} y={y(minRating) + 14} className="insights-chart-label">
          {minRating}
        </text>
        <text x={PAD_X} y={CHART_H - 8} className="insights-chart-label">
          {formatDate(minTime)}
        </text>
        <text
          x={CHART_W - PAD_X}
          y={CHART_H - 8}
          textAnchor="end"
          className="insights-chart-label"
        >
          {formatDate(maxTime)}
        </text>
      </svg>
    </div>
  )
}

// -- W/D/L split bars ----------------------------------------------------------

function SplitBar({ split, label }: { split: WdlSplit; label: string }) {
  if (split.games === 0) {
    return (
      <div className="split-row">
        <span className="split-label">{label}</span>
        <div className="split-bar split-bar-empty" aria-hidden="true" />
        <span className="split-score">—</span>
      </div>
    )
  }
  const w = (split.wins / split.games) * 100
  const d = (split.draws / split.games) * 100
  const l = (split.losses / split.games) * 100
  return (
    <div className="split-row">
      <span className="split-label">
        {label} <span className="split-games">({split.games})</span>
      </span>
      <div
        className="split-bar"
        role="img"
        aria-label={`${label}: ${split.wins} wins, ${split.draws} draws, ${split.losses} losses`}
      >
        {w > 0 && <span className="split-seg split-win" style={{ width: `${w}%` }} />}
        {d > 0 && <span className="split-seg split-draw" style={{ width: `${d}%` }} />}
        {l > 0 && <span className="split-seg split-loss" style={{ width: `${l}%` }} />}
      </div>
      <span className="split-score">{pct(split.score)}</span>
    </div>
  )
}

const OPPONENT_BAND_LABELS: Record<'weaker' | 'similar' | 'stronger', string> = {
  weaker: 'vs weaker',
  similar: 'vs similar',
  stronger: 'vs stronger',
}

function ResultsGrid({ report }: { report: InsightsReport }) {
  return (
    <div className="insights-results-grid">
      <div className="panel insights-section">
        <div className="panel-title">Overall &amp; by color</div>
        <SplitBar split={report.overall} label="Overall" />
        <SplitBar split={report.byColor.white} label="As White" />
        <SplitBar split={report.byColor.black} label="As Black" />
      </div>
      <div className="panel insights-section">
        <div className="panel-title">By time class</div>
        {(Object.entries(report.byTimeClass) as Array<[TimeClass, WdlSplit]>).map(
          ([tc, split]) => (
            <SplitBar key={tc} split={split} label={TIME_CLASS_LABELS[tc]} />
          ),
        )}
      </div>
      <div className="panel insights-section">
        <div className="panel-title">By opponent strength</div>
        {(['weaker', 'similar', 'stronger'] as const).map((band) => (
          <SplitBar
            key={band}
            split={report.byOpponentBand[band]}
            label={OPPONENT_BAND_LABELS[band]}
          />
        ))}
      </div>
    </div>
  )
}

// -- Openings table -------------------------------------------------------------

/** Words too generic to link an opening family to a recommendation on their own. */
const STOP_WORDS = new Set(['defense', 'defence', 'game', 'gambit', 'opening', 'attack', 'the'])

function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
}

/** Best-effort match between a report row and a recommendation, by name keywords. */
function matchesRecommendation(row: OpeningReportRow, recs: TrainRecommendation[]): boolean {
  const familyWords = significantWords(row.family)
  return recs.some((rec) => {
    const recWords = significantWords(rec.openingName)
    return recWords.some((w) => familyWords.includes(w))
  })
}

function OpeningsTable({
  openings,
  recommendations,
}: {
  openings: OpeningReportRow[]
  recommendations: TrainRecommendation[]
}) {
  if (openings.length === 0) return null

  return (
    <div className="panel insights-section">
      <div className="panel-title">Your openings</div>
      <div className="insights-table-wrap">
        <table className="insights-table">
          <thead>
            <tr>
              <th>Opening</th>
              <th>Color</th>
              <th className="insights-table-num">Games</th>
              <th>Score</th>
              <th className="insights-table-num">W / D / L</th>
            </tr>
          </thead>
          <tbody>
            {openings.map((row) => {
              const highlighted = matchesRecommendation(row, recommendations)
              return (
                <tr
                  key={`${row.family}-${row.asColor}`}
                  className={highlighted ? 'insights-table-row-reco' : undefined}
                >
                  <td>
                    {row.family}
                    {row.eco && <span className="insights-table-eco"> {row.eco}</span>}
                    {highlighted && <span className="insights-table-flag">train this</span>}
                  </td>
                  <td className="insights-table-color">{row.asColor}</td>
                  <td className="insights-table-num">{row.split.games}</td>
                  <td>
                    <div className="split-bar split-bar-compact" aria-hidden="true">
                      {row.split.wins > 0 && (
                        <span
                          className="split-seg split-win"
                          style={{ width: `${(row.split.wins / row.split.games) * 100}%` }}
                        />
                      )}
                      {row.split.draws > 0 && (
                        <span
                          className="split-seg split-draw"
                          style={{ width: `${(row.split.draws / row.split.games) * 100}%` }}
                        />
                      )}
                      {row.split.losses > 0 && (
                        <span
                          className="split-seg split-loss"
                          style={{ width: `${(row.split.losses / row.split.games) * 100}%` }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="insights-table-num">
                    {row.split.wins} / {row.split.draws} / {row.split.losses}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -- Endings + game length --------------------------------------------------------

function EndingsList({
  title,
  endings,
}: {
  title: string
  endings: Partial<Record<Termination, number>>
}) {
  const entries = (Object.entries(endings) as Array<[Termination, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="insights-endings-col">
      <div className="insights-endings-title">{title}</div>
      {entries.length === 0 ? (
        <p className="insights-endings-empty">None yet</p>
      ) : (
        <ul className="insights-endings-list">
          {entries.map(([term, n]) => (
            <li key={term}>
              <span>{TERMINATION_LABELS[term]}</span>
              <span className="insights-endings-count">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Endings({ report }: { report: InsightsReport }) {
  const { lengthBuckets } = report
  return (
    <div className="panel insights-section">
      <div className="panel-title">How your games end</div>
      <div className="insights-endings">
        <EndingsList title="Wins end by" endings={report.winEndings} />
        <EndingsList title="Losses end by" endings={report.lossEndings} />
        <div className="insights-endings-col">
          <div className="insights-endings-title">Game length</div>
          <ul className="insights-endings-list">
            <li>
              <span>Short (&lt; 20 moves)</span>
              <span className="insights-endings-count">{lengthBuckets.short}</span>
            </li>
            <li>
              <span>Medium (20–39 moves)</span>
              <span className="insights-endings-count">{lengthBuckets.medium}</span>
            </li>
            <li>
              <span>Long (40+ moves)</span>
              <span className="insights-endings-count">{lengthBuckets.long}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
