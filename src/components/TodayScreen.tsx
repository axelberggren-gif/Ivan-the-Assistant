import { Chessboard } from 'react-chessboard'
import { useSession } from '../store/context'
import { DAILY_GOAL } from '../store/activity'

/** A calm, decorative Italian-Game position for the resume card. Not interactive. */
const DECOR_FEN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1'

function greeting(hour: number): string {
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export interface TodayScreenProps {
  userName: string
  streak: number
  solvedToday: number
  puzzleCount: number | null
  hasProblems: boolean
  hasInsights: boolean
  onResume: (openingId: string) => void
  onTrain: () => void
  onProblems: () => void
  onInsights: () => void
}

/**
 * "Today" home — the landing screen (Ivan · Meadow design). Everything shown
 * here is real: the greeting comes from the clock, the streak and daily-goal
 * ring come from the local activity tracker, and the resume card launches an
 * actual opening. No placeholder numbers.
 */
export default function TodayScreen({
  userName,
  streak,
  solvedToday,
  puzzleCount,
  hasProblems,
  hasInsights,
  onResume,
  onTrain,
  onProblems,
  onInsights,
}: TodayScreenProps) {
  const openings = useSession((s) => s.openings)
  const featured = openings[0] ?? null

  const hello = greeting(new Date().getHours())
  const goalPct = Math.min(100, Math.round((solvedToday / DAILY_GOAL) * 100))
  const goalDone = solvedToday >= DAILY_GOAL
  const remaining = Math.max(0, DAILY_GOAL - solvedToday)

  const streakLine =
    streak <= 1
      ? "Fresh start — let's get today on the board."
      : `You're on a ${streak}-day streak — let's keep it rolling.`

  const goalSub = goalDone
    ? "Today's goal is done. Anything more is a bonus. 🎉"
    : remaining === DAILY_GOAL
      ? `Solve ${DAILY_GOAL} puzzles to finish today.`
      : `${remaining} more puzzle${remaining === 1 ? '' : 's'} and today is done.`

  return (
    <div className="today">
      <div className="today-hello">
        <h2>
          {hello}, {userName} <span aria-hidden="true">👋</span>
        </h2>
        <p>{streakLine}</p>
      </div>

      <div className="today-top">
        {featured ? (
          <section className="today-resume">
            <div className="today-resume-body">
              <span className="today-kicker">Pick up where you left off</span>
              <h3>{featured.name}</h3>
              <p className="today-resume-meta">
                {featured.eco} · you play {featured.userColor}
              </p>
              <button
                type="button"
                className="btn-resume"
                onClick={() => onResume(featured.id)}
              >
                Start training →
              </button>
            </div>
            <div className="today-resume-board" aria-hidden="true">
              <Chessboard
                position={DECOR_FEN}
                arePiecesDraggable={false}
                customBoardStyle={{ borderRadius: '14px', boxShadow: '0 10px 26px rgba(0,0,0,0.25)' }}
                customDarkSquareStyle={{ backgroundColor: 'oklch(0.58 0.1 150)' }}
                customLightSquareStyle={{ backgroundColor: '#eaf2df' }}
              />
            </div>
          </section>
        ) : (
          <section className="today-resume today-resume-empty">
            <div className="today-resume-body">
              <span className="today-kicker">Get started</span>
              <h3>Train an opening</h3>
              <p className="today-resume-meta">Play a book line against Ivan.</p>
              <button type="button" className="btn-resume" onClick={onTrain}>
                Browse openings →
              </button>
            </div>
          </section>
        )}

        <section className="today-goal" aria-label="Daily goal progress">
          <div
            className="today-ring"
            style={{
              background: `conic-gradient(var(--accent) 0 ${goalPct}%, var(--ring-track) 0)`,
            }}
          >
            <div className="today-ring-hole">
              <span className="today-ring-count">
                {solvedToday}/{DAILY_GOAL}
              </span>
              <span className="today-ring-unit">puzzles</span>
            </div>
          </div>
          <div className="today-goal-copy">
            <h3>Daily goal</h3>
            <p>{goalSub}</p>
            <div className="today-goal-dots" aria-hidden="true">
              {Array.from({ length: DAILY_GOAL }, (_, i) => (
                <span key={i} className={i < solvedToday ? 'dot dot-on' : 'dot'}>
                  🔥
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="today-actions">
        <button type="button" className="action-card" onClick={onTrain}>
          <span className="action-icon" aria-hidden="true">♟</span>
          <span className="action-title">Train openings</span>
          <span className="action-desc">
            Play through book lines and let Ivan catch your blunders.
          </span>
          <span className="action-link">
            {openings.length} opening{openings.length === 1 ? '' : 's'} →
          </span>
        </button>

        <button
          type="button"
          className="action-card"
          onClick={onProblems}
          disabled={!hasProblems}
        >
          <span className="action-icon" aria-hidden="true">🎯</span>
          <span className="action-title">Solve problems</span>
          <span className="action-desc">
            Read, reason, then prove it — one honest attempt each.
          </span>
          <span className="action-link">
            {puzzleCount ? `${puzzleCount.toLocaleString()} puzzles →` : 'Start solving →'}
          </span>
        </button>

        <button
          type="button"
          className="action-card"
          onClick={onInsights}
          disabled={!hasInsights}
        >
          <span className="action-icon" aria-hidden="true">📈</span>
          <span className="action-title">See insights</span>
          <span className="action-desc">
            Where you're strong, where you leak points, what to drill.
          </span>
          <span className="action-link">From Chess.com →</span>
        </button>
      </div>
    </div>
  )
}
