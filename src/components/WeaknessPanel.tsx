/**
 * The weakness panel on the insights screen (PLAN.md §5.2d): blunder timeline,
 * phase table, development diagnosis, recurring mistakes, and your worst
 * moments linking back to the game on chess.com.
 *
 * All coaching prose comes from src/analysis/templates via the report — this
 * component renders strings, it never composes them.
 */
import { useStore } from 'zustand'
import { EMPTY_REPORT_NOTICE, PHASE_LABELS, formatEta, progressLabel } from '../analysis'
import type {
  AnalysisProgress,
  PhaseStats,
  ReasonTally,
  WeaknessReport,
  WorstMoment,
} from '../analysis'
import type { AnalysisState, AnalysisStore } from '../store/analysis'
import { MAX_GAMES_CHOICES } from '../store/analysis'
import { useAnalysisStoreOrNull } from '../store/analysisContext'
import { useInsights } from '../store/insightsContext'

export default function WeaknessPanel() {
  const store = useAnalysisStoreOrNull()
  // Deep analysis is optional, exactly like insights itself: without it the
  // rest of the dashboard still works.
  if (!store) return null
  return <Panel store={store} />
}

function Panel({ store }: { store: AnalysisStore }) {
  const games = useInsights((s) => s.games)
  const status = useStore(store, (s: AnalysisState) => s.status)
  const progress = useStore(store, (s: AnalysisState) => s.progress)
  const report = useStore(store, (s: AnalysisState) => s.report)
  const error = useStore(store, (s: AnalysisState) => s.error)
  const maxGames = useStore(store, (s: AnalysisState) => s.maxGames)
  const running = useStore(store, (s: AnalysisState) => s.running)
  const analyse = useStore(store, (s: AnalysisState) => s.analyse)
  const cancel = useStore(store, (s: AnalysisState) => s.cancel)
  const setMaxGames = useStore(store, (s: AnalysisState) => s.setMaxGames)

  const analysable = games.filter((g) => g.rated && g.pgn && g.timeClass !== 'daily').length

  return (
    <div className="panel insights-section analysis-panel">
      <div className="panel-title">Deep analysis — where you actually lose games</div>

      <p className="analysis-intro">
        Runs your games through the same Stockfish and the same coach the trainer uses, right
        here in your browser. The first pass takes a few minutes; results are cached, so
        after that it is instant. Keep training while it runs — it will not slow the board
        down.
      </p>

      <div className="analysis-controls">
        <label className="analysis-scope">
          Games
          <select
            className="analysis-select"
            value={maxGames}
            disabled={running}
            onChange={(e) => setMaxGames(Number(e.target.value))}
          >
            {MAX_GAMES_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} most recent
              </option>
            ))}
          </select>
        </label>

        {running ? (
          <button type="button" className="btn btn-small" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => analyse(games)}
            disabled={analysable === 0}
          >
            {report ? 'Analyse again' : 'Analyse my games'}
          </button>
        )}

        <span className="analysis-scope-hint">
          {analysable} rated {analysable === 1 ? 'game' : 'games'} available
        </span>
      </div>

      {running && progress && <RunProgress progress={progress} />}

      {status === 'error' && error && (
        <div className="insights-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {status === 'cancelled' && report && (
        <p className="analysis-note">
          Cancelled — the {report.gamesAnalysed} {report.gamesAnalysed === 1 ? 'game' : 'games'}{' '}
          already analysed are below, newest first.
        </p>
      )}

      {report && report.gamesAnalysed === 0 && !running && (
        <p className="analysis-note">{EMPTY_REPORT_NOTICE}</p>
      )}

      {report && report.gamesAnalysed > 0 && <Report report={report} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function RunProgress({ progress }: { progress: AnalysisProgress }) {
  const gamePct = progress.gamesTotal > 0 ? (progress.gamesDone / progress.gamesTotal) * 100 : 0
  const plyPct = progress.pliesTotal > 0 ? (progress.pliesDone / progress.pliesTotal) * 100 : 0
  const label = progressLabel({
    phase: progress.phase,
    gamesDone: progress.gamesDone,
    gamesTotal: progress.gamesTotal,
    etaMs: progress.etaMs,
  })

  return (
    <div className="analysis-progress" role="status">
      <div className="analysis-progress-head">
        <span className="spinner" aria-hidden="true" />
        <span>{label}</span>
        {progress.gamesCached > 0 && (
          <span className="analysis-progress-cached">
            {progress.gamesCached} from cache
          </span>
        )}
      </div>
      <div
        className="analysis-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.gamesTotal}
        aria-valuenow={progress.gamesDone}
        aria-label="Games analysed"
      >
        <span className="analysis-bar-fill" style={{ width: `${gamePct}%` }} />
        <span className="analysis-bar-current" style={{ width: `${plyPct}%` }} />
      </div>
      {progress.phase === 'analysing' && formatEta(progress.etaMs) === null && (
        <p className="analysis-progress-hint">Timing the first game before estimating…</p>
      )}
      {progress.phase === 'verifying' && (
        <p className="analysis-progress-hint">
          Re-running your worst moments at full depth so the findings are real.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function Report({ report }: { report: WeaknessReport }) {
  return (
    <div className="analysis-report">
      <p className="analysis-headline">{report.headline}</p>

      {report.findings.length > 0 && (
        <ul className="analysis-findings">
          {report.findings.map((finding, i) => (
            <li key={i}>{finding}</li>
          ))}
        </ul>
      )}

      <div className="analysis-stat-row">
        <Stat label="Games" value={String(report.gamesAnalysed)} />
        <Stat label="Your moves judged" value={String(report.movesAnalysed)} />
        <Stat label="Avg cp lost / move" value={String(Math.round(report.avgCpLoss))} />
        <Stat label="Blunders / game" value={report.blundersPerGame.toFixed(1)} />
      </div>

      <BlunderTimeline timeline={report.timeline} />
      <PhaseTable byPhase={report.byPhase} />
      <DevelopmentDiagnosisBlock report={report} />
      <RecurringMistakes recurring={report.recurring} />
      <WorstMoments moments={report.worstMoments} />

      <p className="analysis-footnote">
        Analysis covers the first 30 moves of each game — the opening and early middlegame,
        where the coach knows what it is talking about. Already-decided positions are skipped.
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="insights-card">
      <div className="insights-card-label">{label}</div>
      <div className="insights-card-value">{value}</div>
    </div>
  )
}

// -- Blunder timeline ---------------------------------------------------------

const TIMELINE_W = 700
const TIMELINE_H = 140
const TIMELINE_PAD = 24

function BlunderTimeline({
  timeline,
}: {
  timeline: Array<{ moveNumber: number; mistakes: number; blunders: number }>
}) {
  if (timeline.length === 0) {
    return (
      <div className="analysis-block">
        <div className="analysis-block-title">Blunder timeline</div>
        <p className="analysis-note">
          No mistakes or blunders in the moves analysed — nothing to plot.
        </p>
      </div>
    )
  }

  const lastMove = Math.max(...timeline.map((t) => t.moveNumber), 20)
  const peak = Math.max(...timeline.map((t) => t.mistakes + t.blunders))
  const usableW = TIMELINE_W - TIMELINE_PAD * 2
  const usableH = TIMELINE_H - TIMELINE_PAD * 2
  const barW = Math.max(4, Math.min(18, usableW / lastMove - 2))
  const x = (moveNumber: number) =>
    TIMELINE_PAD + ((moveNumber - 0.5) / lastMove) * usableW - barW / 2
  const h = (count: number) => (count / peak) * usableH

  return (
    <div className="analysis-block">
      <div className="analysis-block-title">Blunder timeline — when it goes wrong</div>
      <svg
        className="analysis-timeline"
        viewBox={`0 0 ${TIMELINE_W} ${TIMELINE_H}`}
        role="img"
        aria-label={`Mistakes and blunders by move number, peaking at ${peak} on move ${
          timeline.reduce((worst, t) =>
            t.mistakes + t.blunders > worst.mistakes + worst.blunders ? t : worst,
          ).moveNumber
        }`}
      >
        <line
          x1={TIMELINE_PAD}
          y1={TIMELINE_H - TIMELINE_PAD}
          x2={TIMELINE_W - TIMELINE_PAD}
          y2={TIMELINE_H - TIMELINE_PAD}
          className="insights-chart-grid"
        />
        {timeline.map((entry) => {
          const blunderH = h(entry.blunders)
          const mistakeH = h(entry.mistakes)
          const baseY = TIMELINE_H - TIMELINE_PAD
          return (
            <g key={entry.moveNumber}>
              <rect
                x={x(entry.moveNumber)}
                y={baseY - mistakeH}
                width={barW}
                height={mistakeH}
                className="analysis-bar-mistake"
              />
              <rect
                x={x(entry.moveNumber)}
                y={baseY - mistakeH - blunderH}
                width={barW}
                height={blunderH}
                className="analysis-bar-blunder"
              />
            </g>
          )
        })}
        <text x={TIMELINE_PAD} y={TIMELINE_H - 6} className="insights-chart-label">
          move 1
        </text>
        <text
          x={TIMELINE_W - TIMELINE_PAD}
          y={TIMELINE_H - 6}
          textAnchor="end"
          className="insights-chart-label"
        >
          move {lastMove}
        </text>
      </svg>
      <div className="analysis-legend">
        <span className="analysis-legend-item">
          <span className="analysis-swatch analysis-swatch-blunder" aria-hidden="true" /> Blunders
        </span>
        <span className="analysis-legend-item">
          <span className="analysis-swatch analysis-swatch-mistake" aria-hidden="true" /> Mistakes
        </span>
      </div>
    </div>
  )
}

// -- Phase table ---------------------------------------------------------------

function PhaseTable({ byPhase }: { byPhase: PhaseStats[] }) {
  const rows = byPhase.filter((p) => p.moves > 0)
  if (rows.length === 0) return null

  return (
    <div className="analysis-block">
      <div className="analysis-block-title">Cost by phase</div>
      <div className="insights-table-wrap">
        <table className="insights-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th className="insights-table-num">Your moves</th>
              <th className="insights-table-num">Avg cp lost</th>
              <th className="insights-table-num">Inaccuracies</th>
              <th className="insights-table-num">Mistakes</th>
              <th className="insights-table-num">Blunders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.phase}>
                <td>{PHASE_LABELS[row.phase]}</td>
                <td className="insights-table-num">{row.moves}</td>
                <td className="insights-table-num">{Math.round(row.avgCpLoss)}</td>
                <td className="insights-table-num">{row.inaccuracies}</td>
                <td className="insights-table-num">{row.mistakes}</td>
                <td className="insights-table-num">{row.blunders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -- Development diagnosis ------------------------------------------------------

function DevelopmentDiagnosisBlock({ report }: { report: WeaknessReport }) {
  const dev = report.development
  return (
    <div className="analysis-block">
      <div className="analysis-block-title">Opening-phase diagnosis</div>
      <div className="analysis-dev">
        <div className="analysis-dev-score">
          <div className="analysis-dev-value">{Math.round(dev.avgScore)}</div>
          <div className="analysis-dev-label">avg development</div>
        </div>
        <div className="analysis-dev-body">
          <p>{dev.comment}</p>
          <ul className="analysis-dev-facts">
            <li>
              <span>Minors developed by move 12</span>
              <span>{dev.avgDevelopedMinors.toFixed(1)} of 4</span>
            </li>
            <li>
              <span>Games still uncastled</span>
              <span>
                {dev.gamesUncastled} of {report.gamesAnalysed}
              </span>
            </li>
            <li>
              <span>Games with an early queen</span>
              <span>
                {dev.gamesEarlyQueen} of {report.gamesAnalysed}
              </span>
            </li>
            <li>
              <span>Tempi lost per game</span>
              <span>{dev.avgTempoLoss.toFixed(1)}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// -- Recurring mistakes ----------------------------------------------------------

function RecurringMistakes({ recurring }: { recurring: ReasonTally[] }) {
  if (recurring.length === 0) return null
  const peak = recurring[0].count

  return (
    <div className="analysis-block">
      <div className="analysis-block-title">Recurring mistakes</div>
      <ul className="analysis-reasons">
        {recurring.slice(0, 6).map((tally) => (
          <li key={tally.code} className="analysis-reason">
            <div className="analysis-reason-head">
              <span className="analysis-reason-label">{tally.label}</span>
              <span className="analysis-reason-count">
                {tally.count}× in {tally.games} {tally.games === 1 ? 'game' : 'games'}
              </span>
            </div>
            <div className="analysis-reason-track" aria-hidden="true">
              <span
                className="analysis-reason-fill"
                style={{ width: `${(tally.count / peak) * 100}%` }}
              />
            </div>
            <p className="analysis-reason-hint">{tally.hint}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

// -- Worst moments ----------------------------------------------------------------

function formatCp(cp: number): string {
  const pawns = cp / 100
  const sign = pawns > 0 ? '+' : ''
  return `${sign}${pawns.toFixed(1)}`
}

function WorstMoments({ moments }: { moments: WorstMoment[] }) {
  if (moments.length === 0) return null

  return (
    <div className="analysis-block">
      <div className="analysis-block-title">Your worst moments</div>
      <ul className="analysis-moments">
        {moments.map((moment) => (
          <li key={`${moment.gameId}-${moment.ply}`} className="analysis-moment">
            <span className={`analysis-moment-tag analysis-moment-${moment.classification}`}>
              {moment.classification}
            </span>
            <span className="analysis-moment-move">
              {moment.moveNumber}
              {moment.color === 'white' ? '.' : '...'}
              {moment.san}
            </span>
            <span className="analysis-moment-detail">
              −{Math.round(moment.cpLoss)}cp · {formatCp(moment.cpBefore)} →{' '}
              {formatCp(moment.cpAfter)} · {moment.bestMoveSan} was better
              {moment.verified && (
                <span className="analysis-moment-verified" title="Re-checked at full depth">
                  {' '}
                  ✓
                </span>
              )}
            </span>
            <span className="analysis-moment-meta">
              {moment.openingFamily && <span>{moment.openingFamily}</span>}
              {moment.opponentUsername && <span>vs {moment.opponentUsername}</span>}
              {moment.url && (
                <a
                  href={moment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="analysis-moment-link"
                >
                  View game
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
