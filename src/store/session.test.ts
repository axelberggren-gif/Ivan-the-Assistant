import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AssessMoveInput,
  BookMoveOption,
  CoachAPI,
  EngineAnalysis,
  EngineAPI,
  MoveAssessment,
  Opening,
  OpeningBook,
  SessionDeps,
} from '../types'
import { createSessionStore } from './session'

// ---------------------------------------------------------------------------
// Hand-rolled mock deps
// ---------------------------------------------------------------------------

const OPENING: Opening = {
  id: 'test-italian',
  name: 'Test Italian',
  eco: 'C50',
  userColor: 'white',
  description: 'Test opening',
  mainlines: [{ moves: ['e4', 'e5', 'Nf3', 'Nc6'] }],
  trickLines: [],
}

function fakeAnalysis(fen: string, cp = 30): EngineAnalysis {
  return {
    fen,
    depth: 12,
    bestMoveSan: 'e4',
    bestMoveUci: 'e2e4',
    lines: [{ pvSan: ['e4'], pvUci: ['e2e4'], cp }],
  }
}

function makeEngine(): EngineAPI & { initCalls: number } {
  const engine = {
    initCalls: 0,
    init: vi.fn(async () => {
      engine.initCalls++
    }),
    analyze: vi.fn(async (fen: string) => fakeAnalysis(fen)),
    opponentMove: vi.fn(async () => ({ san: 'a6', uci: 'a7a6' })),
    dispose: vi.fn(),
  }
  return engine
}

/**
 * Book scripted by "history joined with spaces" → next-move options.
 * Line: 1.e4 e5 2.Nf3 (then out of book for Black → session ends).
 */
function makeBook(continuationsMap: Record<string, BookMoveOption[]>): OpeningBook {
  return {
    openings: [OPENING],
    getOpening: (id) => (id === OPENING.id ? OPENING : undefined),
    continuations: (_id, historySan) => continuationsMap[historySan.join(' ')] ?? [],
    check: (_id, historySan, san) => {
      const opts = continuationsMap[historySan.join(' ')] ?? []
      return { inBook: opts.some((o) => o.san === san) }
    },
    matchTrap: () => undefined,
  }
}

function makeCoach(
  assessOverride?: (input: AssessMoveInput) => Partial<MoveAssessment>,
): CoachAPI {
  return {
    assessMove: (input) => ({
      san: input.san,
      classification: input.book.inBook ? 'book' : 'good',
      cpLoss: 0,
      reasonCodes: input.book.inBook ? ['book_move'] : ['ok'],
      bestMoveSan: input.evalBefore.bestMoveSan,
      comment: 'ok',
      stopGame: false,
      ...assessOverride?.(input),
    }),
    developmentScore: () => ({
      developedMinors: 1,
      castled: false,
      earlyQueen: false,
      centerPawns: 1,
      tempoLoss: 0,
      score: 40,
    }),
    outOfBookSummary: () => 'Nice work, you are out of book in a healthy position.',
  }
}

function flush(times = 6): Promise<void> {
  let p = Promise.resolve()
  for (let i = 0; i < times; i++) p = p.then(() => {})
  return p
}

// ---------------------------------------------------------------------------

describe('createSessionStore', () => {
  let engine: ReturnType<typeof makeEngine>

  beforeEach(() => {
    engine = makeEngine()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeDeps(continuations: Record<string, BookMoveOption[]>, coach?: CoachAPI): SessionDeps {
    return { engine, book: makeBook(continuations), coach: coach ?? makeCoach() }
  }

  it('runs the pick → userMove → assess → opponent-reply flow', async () => {
    const deps = makeDeps({
      '': [{ san: 'e4', kind: 'mainline', weight: 1 }],
      e4: [{ san: 'e5', kind: 'mainline', weight: 1 }],
      'e4 e5': [{ san: 'Nf3', kind: 'mainline', weight: 1 }],
      // No continuation after "e4 e5 Nf3" → opponent out of book quickly.
    })
    const store = createSessionStore(deps)

    store.getState().pickOpening(OPENING.id)
    expect(store.getState().status).toBe('playing')
    await flush()
    expect(engine.initCalls).toBe(1)
    expect(store.getState().engineInitializing).toBe(false)

    const accepted = store.getState().userMove('e2', 'e4')
    expect(accepted).toBe(true)
    expect(store.getState().historySan).toEqual(['e4'])

    await flush(12)

    const st = store.getState()
    // Feedback recorded for the user's move.
    expect(st.feedback).toHaveLength(1)
    expect(st.feedback[0].san).toBe('e4')
    expect(st.feedback[0].classification).toBe('book')
    expect(st.feedback[0].moveNumber).toBe(1)
    // Opponent replied from the book and it is the user's turn again.
    expect(st.historySan).toEqual(['e4', 'e5'])
    expect(st.status).toBe('playing')
    expect(st.devScore?.score).toBe(40)
  })

  it('rejects illegal and out-of-turn moves', async () => {
    const deps = makeDeps({ '': [{ san: 'e4', kind: 'mainline', weight: 1 }] })
    const store = createSessionStore(deps)
    store.getState().pickOpening(OPENING.id)
    await flush()

    expect(store.getState().userMove('e2', 'e5')).toBe(false) // illegal
    expect(store.getState().userMove('e7', 'e5')).toBe(false) // opponent's piece
    expect(store.getState().historySan).toEqual([])
  })

  it('ends out_of_book with a summary when the book runs dry', async () => {
    const deps = makeDeps({
      e4: [{ san: 'e5', kind: 'mainline', weight: 1 }],
      '': [{ san: 'e4', kind: 'mainline', weight: 1 }],
      // Nothing after "e4 e5" for the user → both sides out of theory... but
      // the user check happens for the coming user move; leave it non-empty
      // then dry for the opponent's next turn:
      'e4 e5': [{ san: 'Nf3', kind: 'mainline', weight: 1 }],
      // After Nf3, opponent has no options and history < 20, so the engine
      // fallback plays; then the user has no book options → out_of_book.
    })
    const store = createSessionStore(deps)
    store.getState().pickOpening(OPENING.id)
    await flush()

    store.getState().userMove('e2', 'e4')
    await flush(12)
    expect(store.getState().status).toBe('playing')

    store.getState().userMove('g1', 'f3')
    await flush(16)

    const st = store.getState()
    expect(st.status).toBe('out_of_book')
    expect(engine.opponentMove).toHaveBeenCalledTimes(1)
    expect(st.sessionSummary).not.toBeNull()
    expect(st.sessionSummary?.message).toMatch(/out of book/)
    expect(st.sessionSummary?.counts.book).toBe(2)
    expect(st.sessionSummary?.userMoves).toBe(2)
  })

  it('stops the game on a blunder, animates the refutation, and supports retry', async () => {
    vi.useFakeTimers()
    const coach = makeCoach((input) =>
      input.san === 'Ke2'
        ? {
            classification: 'blunder',
            cpLoss: 500,
            stopGame: true,
            refutationSan: ['Qh4'],
            explanation: 'The king walks into the open.',
            fix: 'Develop a piece instead.',
          }
        : {},
    )
    const deps = makeDeps(
      {
        '': [{ san: 'e4', kind: 'mainline', weight: 1 }],
        e4: [{ san: 'e5', kind: 'mainline', weight: 1 }],
        'e4 e5': [{ san: 'Nf3', kind: 'mainline', weight: 1 }],
      },
      coach,
    )
    const store = createSessionStore(deps)
    store.getState().pickOpening(OPENING.id)
    await vi.advanceTimersByTimeAsync(0)

    store.getState().userMove('e2', 'e4')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('playing')

    // The losing move: 2.Ke2??
    store.getState().userMove('e1', 'e2')
    await vi.advanceTimersByTimeAsync(0)

    let st = store.getState()
    expect(st.status).toBe('showing_refutation')
    expect(st.preBlunderFen).not.toBeNull()
    expect(st.feedback[st.feedback.length - 1]?.classification).toBe('blunder')
    const preBlunderFen = st.preBlunderFen

    // Refutation move animates in after ~900ms.
    await vi.advanceTimersByTimeAsync(900)
    st = store.getState()
    expect(st.historySan).toEqual(['e4', 'e5', 'Ke2', 'Qh4'])
    expect(st.refutationStep).toBe(0)

    // Then the stop-and-explain modal state.
    await vi.advanceTimersByTimeAsync(900)
    expect(store.getState().status).toBe('stopped_blunder')

    // Retry restores the pre-blunder position and pops the bad feedback.
    store.getState().retryFromBlunder()
    st = store.getState()
    expect(st.status).toBe('playing')
    expect(st.fen).toBe(preBlunderFen)
    expect(st.historySan).toEqual(['e4', 'e5'])
    expect(st.feedback).toHaveLength(1)
    expect(st.lastAssessment).toBeNull()
  })

  it('surfaces engine init failures and returns to the picker', async () => {
    engine.init = vi.fn(async () => {
      throw new Error('wasm failed to load')
    })
    const deps = makeDeps({ '': [{ san: 'e4', kind: 'mainline', weight: 1 }] })
    const store = createSessionStore(deps)
    store.getState().pickOpening(OPENING.id)
    await flush()

    const st = store.getState()
    expect(st.status).toBe('picking')
    expect(st.error).toBe('wasm failed to load')
    expect(st.engineInitializing).toBe(false)
  })

  it('plays the opponent first move when the user is black', async () => {
    const blackOpening: Opening = { ...OPENING, id: 'test-black', userColor: 'black' }
    const book: OpeningBook = {
      openings: [blackOpening],
      getOpening: (id) => (id === blackOpening.id ? blackOpening : undefined),
      continuations: (_id, historySan) => {
        const key = historySan.join(' ')
        if (key === '') return [{ san: 'e4', kind: 'mainline', weight: 1 }]
        if (key === 'e4') return [{ san: 'c5', kind: 'mainline', weight: 1 }]
        return []
      },
      check: () => ({ inBook: true }),
      matchTrap: () => undefined,
    }
    const store = createSessionStore({ engine, book, coach: makeCoach() })
    store.getState().pickOpening(blackOpening.id)
    await flush(12)

    const st = store.getState()
    expect(st.historySan).toEqual(['e4'])
    expect(st.status).toBe('playing')
    expect(st.userColor).toBe('black')
  })
})
