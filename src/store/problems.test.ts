import { Chess } from 'chess.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EngineAnalysis,
  EngineAPI,
  LlmAPI,
  Problem,
  ProblemManifest,
  ProblemSource,
  ProblemsDeps,
  ReadCheckAnswer,
  ReasoningFeedback,
  ReasoningGradeInput,
} from '../types'
import { createProblemsStore, type ProblemsStore } from './problems'

// ---------------------------------------------------------------------------
// Hand-verified real problems (replayed through chess.js below to stay honest)
// ---------------------------------------------------------------------------

/**
 * Back-rank two-mover. Position before the setup move (Black to move):
 * White Qa1, Rb2, Kg1 — Black Kg8. Setup 1...Kh8, then 2.Rb7+ (discovered
 * check from the a1 queen) Kg8 3.Qa8#.
 */
const P1: Problem = {
  id: 'p1',
  fen: '6k1/8/8/8/8/8/1R6/Q5K1 b - - 0 1',
  moves: ['g8h8', 'b2b7', 'h8g8', 'a1a8'],
  rating: 1500,
  themes: ['backRankMate'],
}

/**
 * Deflection two-mover with TWO mating moves at the end. Setup 1...Rb4??,
 * then 2.Ra8+ Rb8 (forced block) 3.Qxb8# — but 3.Rxb8# also mates, which
 * must count as correct (Lichess semantics).
 */
const P2: Problem = {
  id: 'p2',
  fen: '1r4k1/5ppp/8/8/8/8/1Q6/R5K1 b - - 0 1',
  moves: ['b8b4', 'a1a8', 'b4b8', 'b2b8'],
  rating: 1500,
  themes: ['deflection'],
}

function fenAfter(fen: string, ucis: string[]): string {
  const c = new Chess(fen)
  for (const uci of ucis) {
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
  }
  return c.fen()
}

/** Position after P1's setup move — White (the user) to move, mate in 2. */
const SOLVE_FEN_1 = fenAfter(P1.fen, ['g8h8'])
/** Position after the user's wrong move 2.Qa2?? in P1. */
const WRONG_FEN_1 = fenAfter(P1.fen, ['g8h8', 'a1a2'])
const START_FEN = new Chess().fen()

it('the test problems themselves replay legally and end in mate', () => {
  for (const p of [P1, P2]) {
    const c = new Chess(p.fen)
    for (const uci of p.moves) {
      expect(() =>
        c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }),
      ).not.toThrow()
    }
    expect(c.isCheckmate()).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// Fake deps
// ---------------------------------------------------------------------------

const DEFAULT_ANALYSIS: Omit<EngineAnalysis, 'fen'> = {
  depth: 14,
  bestMoveSan: '',
  bestMoveUci: '',
  lines: [{ pvSan: [], pvUci: [], cp: 50 }],
}

/** fen → canned analysis; anything else gets the boring default. */
function cannedAnalyses(): Record<string, EngineAnalysis> {
  return {
    [SOLVE_FEN_1]: {
      fen: SOLVE_FEN_1,
      depth: 14,
      bestMoveSan: 'Rb7+',
      bestMoveUci: 'b2b7',
      lines: [
        { pvSan: ['Rb7+', 'Kg8', 'Qa8#'], pvUci: ['b2b7', 'h8g8', 'a1a8'], mate: 2 },
        { pvSan: ['Qa2'], pvUci: ['a1a2'], mate: 3 },
      ],
    },
    [WRONG_FEN_1]: {
      fen: WRONG_FEN_1,
      depth: 14,
      bestMoveSan: 'Kh7',
      bestMoveUci: 'h8h7',
      // Punishment line starts with the opponent's move (Black to move here).
      lines: [{ pvSan: ['Kh7', 'Rb7+'], pvUci: ['h8h7', 'b2b7'], cp: 800 }],
    },
  }
}

function makeEngine(analyses: Record<string, EngineAnalysis> = cannedAnalyses()) {
  const engine = {
    initCalls: 0,
    init: vi.fn(async () => {
      engine.initCalls++
    }),
    analyze: vi.fn(async (fen: string): Promise<EngineAnalysis> => {
      return analyses[fen] ?? { fen, ...DEFAULT_ANALYSIS }
    }),
    opponentMove: vi.fn(async () => ({ san: 'a6', uci: 'a7a6' })),
    dispose: vi.fn(),
  }
  return engine satisfies EngineAPI & { initCalls: number }
}

const MANIFEST: ProblemManifest = {
  source: 'lichess-puzzles',
  sourceDate: '2026-06-01',
  generatedAt: '2026-06-02T00:00:00Z',
  license: 'CC0',
  ratingMin: 1200,
  ratingMax: 1900,
  total: 2,
  themes: [
    { id: 'backRank', name: 'Back-rank mate', description: 'Weak back rank', file: 'backRank.json', count: 1 },
    { id: 'deflection', name: 'Deflection', description: 'Pull the defender away', file: 'deflection.json', count: 1 },
  ],
}

function makeProblems(): ProblemSource & { manifestCalls: number } {
  const src = {
    manifestCalls: 0,
    manifest: async () => {
      src.manifestCalls++
      return MANIFEST
    },
    theme: async (themeId: string): Promise<Problem[]> => {
      if (themeId === 'backRank') return [P1]
      if (themeId === 'deflection') return [P2]
      return []
    },
  }
  return src
}

const FEEDBACK: ReasoningFeedback = {
  goodPoints: ['You saw the deflection idea.'],
  missed: [],
  wrong: [],
  comment: 'Solid calculation.',
}

function makeLlm(): LlmAPI & { key: string | null; gradeReasoning: ReturnType<typeof vi.fn> } {
  const llm = {
    key: null as string | null,
    hasKey: () => llm.key !== null,
    setKey: (key: string | null) => {
      llm.key = key
    },
    gradeReasoning: vi.fn(async (_input: ReasoningGradeInput) => FEEDBACK),
  }
  return llm
}

// ---------------------------------------------------------------------------

describe('createProblemsStore', () => {
  let engine: ReturnType<typeof makeEngine>
  let problems: ReturnType<typeof makeProblems>
  let llm: ReturnType<typeof makeLlm>
  let store: ProblemsStore

  beforeEach(() => {
    vi.useFakeTimers()
    engine = makeEngine()
    problems = makeProblems()
    llm = makeLlm()
    const deps: ProblemsDeps = { engine, problems, llm }
    store = createProblemsStore(deps)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Drive the store to the read check (setup move auto-played). */
  async function toRead(themeId = 'backRank'): Promise<void> {
    store.getState().pickTheme(themeId)
    expect(store.getState().status).toBe('loading')
    await vi.advanceTimersByTimeAsync(0) // theme fetch + engine init
    await vi.advanceTimersByTimeAsync(600) // setup-move delay
    expect(store.getState().status).toBe('read')
  }

  async function toReason(
    themeId = 'backRank',
    answer: ReadCheckAnswer = { materialDiff: 14, verdict: 'white_winning' },
  ): Promise<void> {
    await toRead(themeId)
    store.getState().submitReadCheck(answer)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('reason')
  }

  async function toSolve(
    themeId = 'backRank',
    answer?: ReadCheckAnswer,
  ): Promise<void> {
    await toReason(themeId, answer)
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')
  }

  it('loads the manifest once (idempotent)', async () => {
    store.getState().loadManifest()
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    expect(problems.manifestCalls).toBe(1)
    expect(store.getState().manifest).toEqual(MANIFEST)
    expect(store.getState().manifestError).toBeNull()
  })

  it('picks a theme, inits the engine, and auto-plays the setup move', async () => {
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    await toRead()

    const st = store.getState()
    expect(engine.initCalls).toBe(1)
    expect(st.engineInitializing).toBe(false)
    expect(st.themeId).toBe('backRank')
    expect(st.themeName).toBe('Back-rank mate')
    expect(st.problem?.id).toBe('p1')
    expect(st.historySan).toEqual(['Kh8'])
    expect(st.fen).toBe(SOLVE_FEN_1)
    expect(st.solveFen).toBe(SOLVE_FEN_1)
    expect(st.userColor).toBe('white') // side to move AFTER the setup move
  })

  it('read check: correct answers are confirmed by the report', async () => {
    // White is up Q+R = 14 pawns and the engine says mate for White.
    await toReason('backRank', { materialDiff: 14, verdict: 'white_winning' })

    const st = store.getState()
    expect(st.readReport).not.toBeNull()
    expect(st.readReport?.materialCorrect).toBe(true)
    expect(st.readReport?.actualMaterialDiff).toBe(14)
    expect(st.readReport?.verdictCorrect).toBe(true)
    expect(st.readReport?.actualVerdict).toBe('white_winning')
    expect(st.readReport?.comment).toBeTruthy()
    // Eval bar is White-perspective; mate for White maps near +10000.
    expect(st.evalCp).toBeGreaterThan(9000)
    // Ground-truth engine lines are revealed for the reason phase.
    expect(st.engineLines.length).toBeGreaterThan(0)
  })

  it('read check: wrong answers are called out', async () => {
    await toReason('backRank', { materialDiff: 0, verdict: 'black_winning' })

    const st = store.getState()
    expect(st.readReport?.materialCorrect).toBe(false)
    expect(st.readReport?.actualMaterialDiff).toBe(14)
    expect(st.readReport?.verdictCorrect).toBe(false)
    expect(st.readReport?.actualVerdict).toBe('white_winning')
  })

  it('reasoning without a key skips the LLM and degrades to engine lines', async () => {
    await toReason()
    store.getState().setReasoning('Rook to b7 discovers check, then the queen mates on a8.')
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)

    const st = store.getState()
    expect(llm.gradeReasoning).not.toHaveBeenCalled()
    expect(st.status).toBe('solve')
    expect(st.solveStep).toBe(1)
    expect(st.llmAvailable).toBe(false)
    expect(st.feedback).toBeNull()
    expect(st.gradeError).toBeNull()
    expect(st.engineLines.length).toBeGreaterThan(0) // self-check material
  })

  it('reasoning with a key grades the prose against the solution line', async () => {
    llm.setKey('sk-test')
    await toReason()
    store.getState().setReasoning('I play Rb7 with discovered check, then Qa8 mate.')
    store.getState().submitReasoning()
    expect(store.getState().status).toBe('grading')
    await vi.advanceTimersByTimeAsync(0)

    const st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.solveStep).toBe(1)
    expect(st.llmAvailable).toBe(true)
    expect(st.feedback).toEqual(FEEDBACK)
    expect(st.gradeError).toBeNull()

    expect(llm.gradeReasoning).toHaveBeenCalledTimes(1)
    const input = llm.gradeReasoning.mock.calls[0][0] as ReasoningGradeInput
    expect(input.fen).toBe(SOLVE_FEN_1)
    expect(input.userColor).toBe('white')
    expect(input.reasoning).toMatch(/discovered check/)
    // Authored solution as SAN (user + opponent moves, user first).
    expect(input.solutionSan).toEqual(['Rb7+', 'Kg8', 'Qa8#'])
    expect(input.engineLines).toEqual(store.getState().engineLines)
  })

  it('grading failure sets a user-readable error and still reaches solve', async () => {
    llm.setKey('sk-test')
    llm.gradeReasoning.mockRejectedValueOnce(new Error('rate limited'))
    await toReason()
    store.getState().setReasoning('Deflect and mate.')
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)

    const st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.feedback).toBeNull()
    expect(st.gradeError).toBe('rate limited')
  })

  it('solve happy path: user moves, opponent auto-replies, ends solved', async () => {
    await toSolve()

    // First solution move.
    expect(store.getState().userMove('b2', 'b7')).toBe(true)
    let st = store.getState()
    expect(st.status).toBe('opponent_replying')
    expect(st.historySan).toEqual(['Kh8', 'Rb7+'])

    // Opponent's forced reply animates in after ~700ms.
    await vi.advanceTimersByTimeAsync(700)
    st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.historySan).toEqual(['Kh8', 'Rb7+', 'Kg8'])
    expect(st.solveStep).toBe(3)

    // Final solution move mates.
    expect(store.getState().userMove('a1', 'a8')).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.historySan).toEqual(['Kh8', 'Rb7+', 'Kg8', 'Qa8#'])
    expect(st.notice).toBeTruthy() // solvedMessage
    expect(st.hadStops).toBe(false)
    expect(st.solvedCount).toBe(1)
    expect(st.attemptedCount).toBe(1)
  })

  it('rejects illegal, out-of-turn, and out-of-phase moves', async () => {
    await toReason()
    // Not in the solve phase yet.
    expect(store.getState().userMove('b2', 'b7')).toBe(false)

    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().userMove('g1', 'g4')).toBe(false) // illegal king move
    expect(store.getState().userMove('h8', 'h7')).toBe(false) // opponent's piece
    expect(store.getState().historySan).toEqual(['Kh8'])
  })

  it('wrong move: stop-and-explain references the written reasoning, retry is fix-gated', async () => {
    await toReason()
    const REASONING = 'I think the queen is safe on a2 and I still mate later.'
    store.getState().setReasoning(REASONING)
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')

    // Legal, not the solution, not mate: 2.Qa2??
    expect(store.getState().userMove('a1', 'a2')).toBe(true)
    let st = store.getState()
    expect(st.status).toBe('showing_refutation')
    expect(st.hadStops).toBe(true)
    expect(st.historySan).toEqual(['Kh8', 'Qa2'])

    // Analysis of the refuted position lands: explanation + punishment line.
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.refutationSan).toEqual(['Kh7', 'Rb7+'])
    expect(st.stopExplanation).toBeTruthy()
    expect(st.stopExplanation).toContain(REASONING) // PLAN §8.1
    expect(st.evalCp).toBe(800)

    // Refutation animates move by move (~900ms steps).
    await vi.advanceTimersByTimeAsync(900)
    st = store.getState()
    expect(st.refutationStep).toBe(0)
    expect(st.historySan).toEqual(['Kh8', 'Qa2', 'Kh7'])
    await vi.advanceTimersByTimeAsync(900)
    st = store.getState()
    expect(st.refutationStep).toBe(1)
    expect(st.historySan).toEqual(['Kh8', 'Qa2', 'Kh7', 'Rb7+'])
    await vi.advanceTimersByTimeAsync(900)
    st = store.getState()
    expect(st.status).toBe('stopped')
    expect(st.attemptedCount).toBe(1)

    // Retry rewinds to before the wrong move and demands the fix move.
    store.getState().retryFromStop()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.fen).toBe(SOLVE_FEN_1)
    expect(st.historySan).toEqual(['Kh8'])
    expect(st.requiredFixUci).toBe('b2b7')
    expect(st.notice).toContain('Rb7')
    expect(st.stopExplanation).toBeNull()

    // Any other move is bounced with a reminder.
    expect(store.getState().userMove('a1', 'a2')).toBe(false)
    st = store.getState()
    expect(st.historySan).toEqual(['Kh8']) // move was undone
    expect(st.fen).toBe(SOLVE_FEN_1)
    expect(st.notice).toContain('Rb7')

    // The fix move is accepted and the solve continues to the end.
    expect(store.getState().userMove('b2', 'b7')).toBe(true)
    st = store.getState()
    expect(st.requiredFixUci).toBeNull()
    expect(st.status).toBe('opponent_replying')
    await vi.advanceTimersByTimeAsync(700)
    expect(store.getState().userMove('a1', 'a8')).toBe(true)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.hadStops).toBe(true)
    expect(st.solvedCount).toBe(1)
    expect(st.attemptedCount).toBe(1) // counted once per problem, at the stop
  })

  it('an unlisted immediate mate counts as correct (Lichess semantics)', async () => {
    // P2 ends 3.Qxb8# — but 3.Rxb8# also mates and must be accepted.
    await toSolve('deflection', { materialDiff: 6, verdict: 'white_winning' })

    expect(store.getState().userMove('a1', 'a8')).toBe(true) // 2.Ra8+
    await vi.advanceTimersByTimeAsync(700) // ...Rb8 (forced block)
    expect(store.getState().historySan).toEqual(['Rb4', 'Ra8+', 'Rb8'])

    expect(store.getState().userMove('a8', 'b8')).toBe(true) // 3.Rxb8#, not b2b8
    await vi.advanceTimersByTimeAsync(0)
    const st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.historySan).toEqual(['Rb4', 'Ra8+', 'Rb8', 'Rxb8#'])
    expect(st.solvedCount).toBe(1)
  })

  it('backToPicker mid-animation clears timers and leaves clean state', async () => {
    await toSolve()
    store.getState().userMove('a1', 'a2') // wrong move → refutation pending
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('showing_refutation')

    store.getState().backToPicker()
    const before = store.getState()
    expect(before.status).toBe('picking')

    // Stale timers/continuations must not fire into the reset state.
    await vi.advanceTimersByTimeAsync(10000)
    const st = store.getState()
    expect(st.status).toBe('picking')
    expect(st.fen).toBe(START_FEN)
    expect(st.historySan).toEqual([])
    expect(st.problem).toBeNull()
    expect(st.stopExplanation).toBeNull()
    expect(st.refutationSan).toEqual([])
    expect(st.error).toBeNull()

    // And the store is still fully usable afterwards.
    await toRead()
    expect(store.getState().historySan).toEqual(['Kh8'])
  })

  it('surfaces engine init failures and returns to the picker', async () => {
    engine.init.mockRejectedValueOnce(new Error('wasm failed to load'))
    store.getState().pickTheme('backRank')
    await vi.advanceTimersByTimeAsync(0)

    const st = store.getState()
    expect(st.status).toBe('picking')
    expect(st.error).toBe('wasm failed to load')
    expect(st.engineInitializing).toBe(false)
  })

  it('refreshLlm re-reads key availability', () => {
    expect(store.getState().llmAvailable).toBe(false)
    llm.setKey('sk-test')
    store.getState().refreshLlm()
    expect(store.getState().llmAvailable).toBe(true)
  })
})
