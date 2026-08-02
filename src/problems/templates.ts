/**
 * All user-visible prose for problems mode lives HERE (mirror of the
 * src/coach/templates.ts rule): read-check comments, stop-and-explain text,
 * fix-move reminders, solved messages, and small notices. Components and
 * phase logic render these strings — they never compose their own.
 *
 * Tone: encouraging, concrete, CONTEXT.md vocabulary (Problem, Read check,
 * Reasoning, Setup move, fix move, stop-and-explain).
 */
import type { Color, ProblemThemeInfo, VerdictBucket } from '../types'

// ---------------------------------------------------------------------------
// Read check
// ---------------------------------------------------------------------------

/** A verdict bucket re-expressed relative to the user's side. */
type RelativeVerdict = 'winning' | 'better' | 'equal' | 'worse' | 'losing'

function relativeVerdict(verdict: VerdictBucket, userColor: Color): RelativeVerdict {
  if (verdict === 'equal') return 'equal'
  const [side, degree] = verdict.split('_') as [Color, 'winning' | 'better']
  const forUser = side === userColor
  if (degree === 'winning') return forUser ? 'winning' : 'losing'
  return forUser ? 'better' : 'worse'
}

/** "you're winning" / "the position is equal" / … (present tense, actual). */
function verdictIsPhrase(rel: RelativeVerdict): string {
  switch (rel) {
    case 'equal':
      return 'the position is equal'
    case 'winning':
      return "you're winning"
    case 'better':
      return "you're better"
    case 'worse':
      return "you're worse"
    case 'losing':
      return "you're losing"
  }
}

/** "equal" / "you were winning" / … (what the user claimed). */
function verdictSaidPhrase(rel: RelativeVerdict): string {
  switch (rel) {
    case 'equal':
      return 'equal'
    case 'winning':
      return 'you were winning'
    case 'better':
      return 'you were better'
    case 'worse':
      return 'you were worse'
    case 'losing':
      return 'you were losing'
  }
}

/** Material diff (White minus Black) phrased from the user's side. */
function materialPhrase(actualMaterialDiff: number, userColor: Color): string {
  const userDiff = userColor === 'white' ? actualMaterialDiff : -actualMaterialDiff
  if (userDiff === 0) return 'material is level'
  const points = Math.abs(userDiff)
  const unit = points === 1 ? 'point' : 'points'
  return userDiff > 0 ? `you're up ${points} ${unit}` : `you're down ${points} ${unit}`
}

export interface ReadCheckCommentOpts {
  materialCorrect: boolean
  verdictCorrect: boolean
  /** What the user answered */
  saidVerdict: VerdictBucket
  /** What the engine says */
  actualVerdict: VerdictBucket
  /** Actual material diff, White minus Black (pawns) */
  actualMaterialDiff: number
  userColor: Color
}

/**
 * The read-check reveal. The PLAN §8.1 hook fires when the user misjudged a
 * position that is actually WINNING for them: "You said equal — Stockfish
 * says you're winning. Your job: prove it."
 */
export function readCheckComment(opts: ReadCheckCommentOpts): string {
  const actualRel = relativeVerdict(opts.actualVerdict, opts.userColor)
  const saidRel = relativeVerdict(opts.saidVerdict, opts.userColor)

  if (opts.materialCorrect && opts.verdictCorrect) {
    return "Read check passed — material and verdict both correct. Now prove it: what's the idea?"
  }

  const parts: string[] = []
  if (!opts.materialCorrect) {
    parts.push(
      `Count again — ${materialPhrase(opts.actualMaterialDiff, opts.userColor)} in this position.`,
    )
  }
  if (!opts.verdictCorrect) {
    if (actualRel === 'winning') {
      parts.push(
        `You said ${verdictSaidPhrase(saidRel)} — Stockfish says you're winning. Your job: prove it.`,
      )
    } else {
      parts.push(
        `You said ${verdictSaidPhrase(saidRel)} — Stockfish says ${verdictIsPhrase(actualRel)}. Keep that in mind while you calculate.`,
      )
    }
  } else if (!opts.materialCorrect) {
    parts.push(`Your verdict was right, though — ${verdictIsPhrase(actualRel)}.`)
  }
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Solve phase — stop-and-explain, fix move, solved
// ---------------------------------------------------------------------------

const REASONING_SNIPPET_MAX = 80

/** Short quotable snippet of the user's written reasoning (never the wall of text). */
function reasoningSnippet(reasoning: string): string {
  const compact = reasoning.replace(/\s+/g, ' ').trim()
  if (compact.length <= REASONING_SNIPPET_MAX) return compact
  return `${compact.slice(0, REASONING_SNIPPET_MAX).trimEnd()}…`
}

/**
 * The verdict-only line shown when a committed line is wrong, BEFORE anything
 * is revealed (PLAN.md §8.1). It must say the line failed and nothing else —
 * not which move failed, no refutation, no solution move, no eval — because
 * the user is about to choose between another attempt and the answer.
 */
export function wrongLineVerdict(): string {
  return (
    "Something in that line doesn't hold up. " +
    'Take another shot at it, or show the answer and take the lesson.'
  )
}

/** Shown while the line is still being played out (nothing judged yet). */
export function buildingLineNotice(): string {
  return (
    'Play the whole line out — your moves and the replies you expect — then commit it. ' +
    'Nothing is judged until you do.'
  )
}

/** Shown on a retry the user took instead of seeing the answer. */
export function tryAgainNotice(): string {
  return 'Back to the start of the line, with the answer still hidden. Play the line you calculated.'
}

export interface WrongMoveOpts {
  playedSan: string
  expectedSan: string
  /** Refutation to animate (SAN, starting with the opponent's reply) */
  refutationSan: string[]
  /** The user's written reasoning from the reason phase, if any */
  reasoning: string | null
}

/**
 * Stop-and-explain text for a wrong solve move. When the user wrote
 * reasoning, the explanation references it (PLAN §8.1: "you said the knight
 * was safe — here's why it isn't").
 */
export function wrongMoveExplanation(opts: WrongMoveOpts): string {
  const refutation =
    opts.refutationSan.length > 0
      ? ` Watch the refutation: ${opts.refutationSan.join(' ')}.`
      : ''
  if (opts.reasoning && opts.reasoning.trim().length > 0) {
    return (
      `Your plan was "${reasoningSnippet(opts.reasoning)}" — here's what it missed: ` +
      `${opts.playedSan} doesn't hold up.${refutation} ` +
      `The solution move is ${opts.expectedSan} — check it against your written line before retrying.`
    )
  }
  return (
    `${opts.playedSan} doesn't work here.${refutation} ` +
    `The solution move is ${opts.expectedSan}.`
  )
}

export interface WrongDefenceOpts {
  /** The reply the user predicted. */
  playedSan: string
  /** The reply the position actually calls for. */
  expectedSan: string
}

/**
 * Stop-and-explain text when the line failed on a *predicted reply* rather
 * than on one of the user's own moves: the idea may be fine, but it was
 * calculated against a defence the opponent doesn't have to play. No engine
 * refutation here — the engine's continuation after a bad defence would teach
 * the wrong lesson.
 */
export function wrongDefenceExplanation(opts: WrongDefenceOpts): string {
  return (
    `Your own moves aren't the problem — the reply is. They don't have to play ` +
    `${opts.playedSan}: ${opts.expectedSan} holds on longer, and your line has to work ` +
    `against that. Play ${opts.expectedSan} for them and take the line from there.`
  )
}

/** Bounce message when a retry move isn't the required fix move. */
export function fixReminder(expectedSan: string): string {
  return `Not that one — the fix move here is ${expectedSan}. Play it to continue the line.`
}

/**
 * Display names of a problem's motif tags, filtered to the curated set from
 * the manifest. Problems are served unlabeled — this mapping exists ONLY for
 * the post-solve reveal (owner decision, 2026-07-22). Uncurated tags stay
 * hidden; order follows the manifest.
 */
export function curatedMotifNames(
  problemThemes: string[],
  curated: ProblemThemeInfo[],
): string[] {
  return curated.filter((t) => problemThemes.includes(t.id)).map((t) => t.name)
}

/** "a fork", "a discovered attack", "a fork and a pin" — article-aware list. */
function motifPhrase(names: string[]): string {
  const items = names.map((name) => {
    const lower = name.toLowerCase()
    const article = /^[aeiou]/.test(lower) ? 'an' : 'a'
    return `${article} ${lower}`
  })
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export interface SolvedOpts {
  /** Did the attempt go wrong at least once along the way? */
  hadStops: boolean
  /**
   * Curated motif display names (from `curatedMotifNames`). Revealed only
   * NOW, as the learning payoff — never before or during the attempt.
   */
  motifNames?: string[]
  /**
   * Did the user ask to see the answer after a wrong move (stop-and-explain),
   * or did they retry with it still hidden? Only meaningful with `hadStops`.
   */
  sawAnswer?: boolean
}

/** Wrap-up when the whole solution line has been played out. */
export function solvedMessage(opts: SolvedOpts): string {
  const motifs = opts.motifNames ?? []
  if (opts.hadStops) {
    const reveal = motifs.length > 0 ? ` That was ${motifPhrase(motifs)}.` : ''
    if (opts.sawAnswer === false) {
      return (
        `Solved — you went wrong once and then found it yourself, without seeing the answer.` +
        `${reveal} Run another problem until the line comes first time.`
      )
    }
    return (
      `Solved — it took a stop-and-explain on the way, but you got there.${reveal} ` +
      `Run another problem until the line comes without a stop.`
    )
  }
  const reveal =
    motifs.length > 0
      ? ` That was ${motifPhrase(motifs)} — you found it with no hints.`
      : ' You found it with no hints.'
  return `Solved in one clean line — you read it, you reasoned it, you proved it.${reveal}`
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/** Shown while/after the opponent's setup move is auto-played on load. */
export function setupMoveNotice(setupSan: string): string {
  return `Your opponent just played ${setupSan}. Read the position before you touch a piece.`
}

/**
 * Reason-phase scratch-board hint: the board is a scratchpad here, and a tried
 * line can be pasted into the notes so the user only writes the "why".
 */
export function exploreHint(): string {
  return (
    'Try moves on the board to test a line — take it back or clear it anytime. ' +
    'Nothing here counts as your answer. Add a line to your notes, then say why it works.'
  )
}

/** Reason-phase fallback when there is no BYOK key (engine-only self-check). */
export function selfCheckNotice(): string {
  return (
    'No API key set, so no reasoning coach — you self-check instead: once the attempt ' +
    "is over, compare what you wrote against the engine lines. What did you see, what didn't? " +
    'Add your own Anthropic key in settings (⚙) for written feedback; it stays in this browser.'
  )
}

/**
 * Reason-phase note on when the verdict arrives. The grading happens as the
 * user submits — so nobody waits for it — but it names solution moves, so it
 * is held until the attempt is over (ADR-0007). Saying so up front keeps the
 * silence during phase 3 from reading as something being broken.
 */
export function answerHeldNotice(): string {
  return (
    'Once you submit, the board is yours alone: no feedback, no engine lines, no eval ' +
    'until the attempt is over. Write down everything you saw — that is what gets graded.'
  )
}

/** Anti-guessing rule reminder for the solve phase (PLAN §8.1). */
export function oneLineAttemptNotice(): string {
  return (
    'One committed line — no move-by-move guessing. Play it out in full, commit it, ' +
    'and then you choose whether to try again or see the answer.'
  )
}
