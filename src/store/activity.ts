/**
 * Daily activity tracking for the Today screen (streak + daily goal).
 *
 * Deliberately tiny and honest: the only numbers the Today screen shows are the
 * ones tracked here. "Streak" = consecutive calendar days the app was opened;
 * "solved today" = puzzles solved in problems mode today. Everything lives in
 * localStorage on this browser — no backend, no accounts (AGENTS.md invariant 6).
 *
 * The date-maths core (`advance`, `withSolved`, `dateKey`) is pure so it is
 * unit-testable without touching the clock or storage.
 */

/** How many puzzles a "done for today" ring represents. */
export const DAILY_GOAL = 3

const STORAGE_KEY = 'ivan.activity'

export interface ActivityState {
  /** Local calendar day this state describes, as YYYY-MM-DD. */
  date: string
  /** Consecutive days (including `date`) the app has been opened. */
  streak: number
  /** Puzzles solved on `date`. */
  solvedToday: number
}

/** Local (not UTC) calendar-day key for a Date — the streak is about the user's day. */
export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Whole-day difference `b - a` for two YYYY-MM-DD keys (UTC-anchored, so DST-safe). */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const aMs = Date.UTC(ay, am - 1, ad)
  const bMs = Date.UTC(by, bm - 1, bd)
  return Math.round((bMs - aMs) / 86_400_000)
}

/**
 * Roll a stored state forward to `today`:
 * - first ever visit → streak 1
 * - same day → unchanged
 * - the very next day → streak + 1
 * - a gap of two or more days → streak resets to 1
 * Any day change resets `solvedToday` to 0.
 */
export function advance(prev: ActivityState | null, today: string): ActivityState {
  if (!prev) return { date: today, streak: 1, solvedToday: 0 }
  if (prev.date === today) return prev
  const gap = dayDiff(prev.date, today)
  const streak = gap === 1 ? prev.streak + 1 : 1
  return { date: today, streak, solvedToday: 0 }
}

/** Record one (or more) solved puzzles for the current day. */
export function withSolved(state: ActivityState, delta = 1): ActivityState {
  return { ...state, solvedToday: state.solvedToday + delta }
}

function readRaw(): ActivityState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActivityState>
    if (
      typeof parsed?.date !== 'string' ||
      typeof parsed?.streak !== 'number' ||
      typeof parsed?.solvedToday !== 'number'
    ) {
      return null
    }
    return { date: parsed.date, streak: parsed.streak, solvedToday: parsed.solvedToday }
  } catch {
    return null
  }
}

/** Persist state, swallowing storage errors (private mode, quota). */
export function persistActivity(state: ActivityState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* non-fatal — the Today screen still works from in-memory state */
  }
}

/**
 * Load the stored activity, roll it forward to `now`, persist, and return it.
 * Call once on app start; the returned streak is ready to display.
 */
export function loadActivity(now: Date = new Date()): ActivityState {
  const next = advance(readRaw(), dateKey(now))
  persistActivity(next)
  return next
}
