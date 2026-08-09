import type { Color, ProblemSessionStatus, SessionStatus } from '../types'

/**
 * What the mobile bottom sheet shows while it is collapsed (see `BoardSheet`).
 *
 * On a phone the board eats the whole screen, so everything in the side column
 * — the phase you are in, the coach's last word, the one button that moves the
 * session forward — used to sit below the fold. The sheet keeps a peek row
 * above the nav; these pure functions decide what goes in it. They are pure so
 * the mapping is testable without a DOM (`sheetPeek.test.ts`), the same split
 * as `clickToMove.ts` / `useClickToMove.ts`.
 */

/** The three gated phases of a problem (PLAN §8.1) — also the stepper labels. */
export const PHASES = ['Read', 'Reason', 'Solve'] as const

/** Which of the three gated phases the current status belongs to. */
export function phaseIndex(status: ProblemSessionStatus): number {
  if (status === 'read') return 0
  if (status === 'reason' || status === 'grading') return 1
  return 2
}

/**
 * Which store action the peek button runs. `'expand'` means the real control
 * is a form in the panel (a verdict to pick, prose to write), so the button
 * just opens the sheet rather than pretending to be the control.
 */
export type SheetActionKind =
  | 'expand'
  | 'commitLine'
  | 'retryWrongMove'
  | 'retryFromStop'
  | 'nextProblem'

export interface SheetAction {
  label: string
  kind: SheetActionKind
  disabled?: boolean
}

export interface SheetPeek {
  /** First line — always legible, never wraps. */
  title: string
  /** Second line, truncated: the coach's latest word where there is one. */
  sub?: string
  /** The one control that must never be behind a scroll. */
  action: SheetAction | null
  /**
   * Non-null for the moments that exist to be read (a failed line, a
   * stop-and-explain, a solve): when this value changes the sheet expands
   * itself. Null while the board matters more than the text — the read check
   * and the solve phase must not be covered up.
   */
  expandOn: string | null
  /**
   * The mirror image: non-null for the moments that hand the board back (the
   * solve phase begins, a refutation is about to play out). A change collapses
   * the sheet. Never non-null at the same time as `expandOn`.
   */
  collapseOn: string | null
}

/** The trainer's status line, shared by the side panel and the sheet peek. */
export const TRAINER_STATUS_TEXT: Record<SessionStatus, string> = {
  picking: '',
  playing: 'Your move',
  engine_thinking: 'Opponent is thinking…',
  assessing: 'Coach is checking your move…',
  showing_refutation: 'Watch how this gets punished…',
  stopped_blunder: 'Game stopped',
  out_of_book: 'You reached the end of the book line',
  complete: 'Session complete',
}

/**
 * The solve phase's status line. Shared by `SolvePanel` and the sheet peek so
 * the two can never drift apart.
 */
export function solveStatusText(args: {
  lineComplete: boolean
  /** True when the next ply is one of the user's own moves. */
  yourTurn: boolean
  userColor: Color
}): string {
  if (args.lineComplete) return 'Line complete — commit it when you are ready'
  if (args.yourTurn) return 'Your move — play the line you calculated'
  return `Their reply — play the ${args.userColor === 'white' ? 'Black' : 'White'} move you expect`
}

export function trainerPeek(args: {
  status: SessionStatus
  notice?: string | null
  openingName?: string | null
}): SheetPeek {
  const { status, notice, openingName } = args

  // A coach notice is the whole reason to look away from the board, so a new
  // one opens the sheet — except mid-refutation, where the board is the point
  // and the blunder gets its own modal anyway.
  const readable =
    status === 'out_of_book' || status === 'complete'
      ? status
      : notice && status !== 'showing_refutation'
        ? `notice:${notice}`
        : null

  return {
    title: TRAINER_STATUS_TEXT[status] || openingName || 'Training',
    sub: notice ?? openingName ?? undefined,
    action: null,
    expandOn: readable,
    // The user has just moved, or is about to watch a punishment play out:
    // either way the board is the thing. A new notice re-opens the sheet.
    collapseOn:
      !readable && (status === 'assessing' || status === 'showing_refutation') ? status : null,
  }
}

export function problemPeek(args: {
  status: ProblemSessionStatus
  lineComplete: boolean
  yourTurn: boolean
  userColor: Color
  notice?: string | null
}): SheetPeek {
  const { status, lineComplete, yourTurn, userColor, notice } = args
  const i = phaseIndex(status)
  const step = `Step ${i + 1} of ${PHASES.length} · ${PHASES[i]}`

  switch (status) {
    case 'read':
      return {
        title: step,
        sub: 'Count the material, then call the verdict',
        action: { label: 'Read check', kind: 'expand' },
        expandOn: null,
        // A fresh problem is a position to look at before anything else.
        collapseOn: 'read',
      }
    case 'reason':
      return {
        title: step,
        sub: notice ?? 'Write the idea before you play it',
        action: { label: 'Write it up', kind: 'expand' },
        expandOn: null,
        collapseOn: null,
      }
    case 'grading':
      return {
        title: step,
        sub: 'Reading your notes…',
        action: null,
        expandOn: null,
        collapseOn: null,
      }
    case 'solve':
      return {
        title: step,
        sub: solveStatusText({ lineComplete, yourTurn, userColor }),
        action: { label: 'Commit my line', kind: 'commitLine', disabled: !lineComplete },
        expandOn: null,
        // The line is played on the board — hand it back, sheet or no sheet.
        collapseOn: 'solve',
      }
    case 'wrong_move':
      return {
        title: 'Not correct',
        sub: notice ?? undefined,
        action: { label: 'Try again?', kind: 'retryWrongMove' },
        expandOn: 'wrong_move',
        collapseOn: null,
      }
    case 'showing_refutation':
      return {
        title: 'Watch the refutation…',
        sub: notice ?? undefined,
        action: null,
        expandOn: null,
        collapseOn: 'showing_refutation',
      }
    case 'stopped':
      return {
        title: 'Attempt stopped',
        sub: notice ?? undefined,
        action: { label: 'Retry', kind: 'retryFromStop' },
        expandOn: 'stopped',
        collapseOn: null,
      }
    case 'solved':
      return {
        title: 'Solved',
        sub: notice ?? undefined,
        action: { label: 'Next problem', kind: 'nextProblem' },
        expandOn: 'solved',
        collapseOn: null,
      }
    default:
      return {
        title: step,
        sub: notice ?? undefined,
        action: null,
        expandOn: null,
        collapseOn: null,
      }
  }
}
