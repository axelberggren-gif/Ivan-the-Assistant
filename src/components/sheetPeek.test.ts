import { describe, expect, it } from 'vitest'
import {
  PHASES,
  phaseIndex,
  problemPeek,
  solveStatusText,
  trainerPeek,
  TRAINER_STATUS_TEXT,
} from './sheetPeek'
import type { ProblemSessionStatus } from '../types'

/** Defaults for the solve-phase fields the other statuses ignore. */
function peek(status: ProblemSessionStatus, over: Partial<Parameters<typeof problemPeek>[0]> = {}) {
  return problemPeek({
    status,
    lineComplete: false,
    yourTurn: true,
    userColor: 'white',
    ...over,
  })
}

describe('phaseIndex', () => {
  it('maps every solve-side status to the last phase', () => {
    for (const s of [
      'solve',
      'wrong_move',
      'showing_refutation',
      'stopped',
      'solved',
    ] as ProblemSessionStatus[]) {
      expect(phaseIndex(s)).toBe(2)
    }
  })

  it('puts grading with reasoning, not solving', () => {
    expect(phaseIndex('read')).toBe(0)
    expect(phaseIndex('reason')).toBe(1)
    expect(phaseIndex('grading')).toBe(1)
  })
})

describe('solveStatusText', () => {
  it('asks for the user’s own move, then the reply they predict', () => {
    expect(solveStatusText({ lineComplete: false, yourTurn: true, userColor: 'white' })).toMatch(
      /Your move/,
    )
    // The predicted reply is the OTHER side — that is the whole point of
    // committing a line rather than a move (ADR-0006).
    expect(solveStatusText({ lineComplete: false, yourTurn: false, userColor: 'white' })).toMatch(
      /Black move/,
    )
    expect(solveStatusText({ lineComplete: false, yourTurn: false, userColor: 'black' })).toMatch(
      /White move/,
    )
  })

  it('a complete line asks to be committed', () => {
    expect(solveStatusText({ lineComplete: true, yourTurn: false, userColor: 'white' })).toMatch(
      /commit/i,
    )
  })
})

describe('problemPeek', () => {
  it('names the phase the user is in', () => {
    expect(peek('read').title).toBe(`Step 1 of ${PHASES.length} · Read`)
    expect(peek('reason').title).toBe(`Step 2 of ${PHASES.length} · Reason`)
    expect(peek('solve').title).toBe(`Step 3 of ${PHASES.length} · Solve`)
  })

  it('gates the commit button on a complete line', () => {
    expect(peek('solve').action).toEqual({
      label: 'Commit my line',
      kind: 'commitLine',
      disabled: true,
    })
    expect(peek('solve', { lineComplete: true }).action?.disabled).toBe(false)
  })

  it('mirrors the solve panel’s status line', () => {
    expect(peek('solve', { yourTurn: false, userColor: 'black' }).sub).toBe(
      solveStatusText({ lineComplete: false, yourTurn: false, userColor: 'black' }),
    )
  })

  it('offers the phase’s own control where the panel holds a form', () => {
    // A verdict to pick and prose to write cannot be a single button, so the
    // peek button just opens the sheet.
    expect(peek('read').action?.kind).toBe('expand')
    expect(peek('reason').action?.kind).toBe('expand')
  })

  it('surfaces the store action that moves the attempt on', () => {
    expect(peek('wrong_move').action?.kind).toBe('retryWrongMove')
    expect(peek('stopped').action?.kind).toBe('retryFromStop')
    expect(peek('solved').action?.kind).toBe('nextProblem')
  })

  it('reveals nothing at the wrong-line gate beyond the verdict', () => {
    // ADR-0006: a failed line is named as failed and nothing more. The peek
    // must not leak the failing ply, and must not offer "Show answer" as the
    // one-tap action — asking for the answer stays a deliberate choice.
    const p = peek('wrong_move')
    expect(p.title).toBe('Not correct')
    expect(p.sub).toBeUndefined()
    expect(p.action?.kind).toBe('retryWrongMove')
  })

  it('carries the coach’s notice as the second line where there is one', () => {
    expect(peek('stopped', { notice: 'You hung the rook.' }).sub).toBe('You hung the rook.')
  })

  it('only auto-expands on the statuses that exist to be read', () => {
    // Covering the board during the read check or mid-line would defeat both.
    expect(peek('read').expandOn).toBeNull()
    expect(peek('reason').expandOn).toBeNull()
    expect(peek('solve').expandOn).toBeNull()
    expect(peek('showing_refutation').expandOn).toBeNull()

    expect(peek('wrong_move').expandOn).toBe('wrong_move')
    expect(peek('stopped').expandOn).toBe('stopped')
    expect(peek('solved').expandOn).toBe('solved')
  })

  it('collapses when the board becomes the thing again', () => {
    // The user opens the sheet to answer the read check and to write their
    // reasoning; the phase that follows is played out on the board.
    expect(peek('solve').collapseOn).toBe('solve')
    expect(peek('read').collapseOn).toBe('read')
    expect(peek('showing_refutation').collapseOn).toBe('showing_refutation')
    expect(peek('reason').collapseOn).toBeNull()
  })

  it('never asks to expand and collapse at once', () => {
    const statuses: ProblemSessionStatus[] = [
      'read',
      'reason',
      'grading',
      'solve',
      'wrong_move',
      'showing_refutation',
      'stopped',
      'solved',
    ]
    for (const s of statuses) {
      const p = peek(s)
      expect(p.expandOn === null || p.collapseOn === null).toBe(true)
    }
  })
})

describe('trainerPeek', () => {
  it('leads with the session status', () => {
    expect(trainerPeek({ status: 'playing' }).title).toBe(TRAINER_STATUS_TEXT.playing)
  })

  it('falls back to the opening name when the status has no text', () => {
    expect(trainerPeek({ status: 'picking', openingName: 'Italian Game' }).title).toBe(
      'Italian Game',
    )
    expect(trainerPeek({ status: 'picking' }).title).toBe('Training')
  })

  it('expands when the coach says something new', () => {
    expect(trainerPeek({ status: 'playing' }).expandOn).toBeNull()
    expect(trainerPeek({ status: 'playing', notice: 'That drops a pawn.' }).expandOn).toBe(
      'notice:That drops a pawn.',
    )
  })

  it('does not cover the board while the refutation is playing out', () => {
    expect(
      trainerPeek({ status: 'showing_refutation', notice: 'Watch this.' }).expandOn,
    ).toBeNull()
  })

  it('expands at the ends of the line', () => {
    expect(trainerPeek({ status: 'out_of_book' }).expandOn).toBe('out_of_book')
    expect(trainerPeek({ status: 'complete' }).expandOn).toBe('complete')
  })

  it('has no peek button — the trainer panel is something to read, not press', () => {
    expect(trainerPeek({ status: 'playing' }).action).toBeNull()
  })

  it('gives the board back the moment the user has moved', () => {
    expect(trainerPeek({ status: 'assessing' }).collapseOn).toBe('assessing')
    expect(trainerPeek({ status: 'showing_refutation' }).collapseOn).toBe('showing_refutation')
    expect(trainerPeek({ status: 'playing' }).collapseOn).toBeNull()
  })

  it('a new notice wins over the collapse', () => {
    // Otherwise the coach's inline comment on the move you just played would
    // be collapsed away by that same move.
    const p = trainerPeek({ status: 'assessing', notice: 'That drops a pawn.' })
    expect(p.expandOn).toBe('notice:That drops a pawn.')
    expect(p.collapseOn).toBeNull()
  })
})
