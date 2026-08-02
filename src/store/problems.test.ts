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
 * Fixture with a FREE choice of reply — P1 and P2 are both forcing, so neither
 * can exercise a mispredicted defence. Setup 1...Kf8, then 2.Qd8+ and Black
 * picks between Kf7 (authored) and Kg7, then 3.Qd7+.
 */
const P3: Problem = {
  id: 'p3',
  fen: '4k3/8/8/8/8/8/3Q4/4K3 b - - 0 1',
  moves: ['e8f8', 'd2d8', 'f8f7', 'd8d7'],
  rating: 1500,
  themes: ['deflection'],
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
    { id: 'backRankMate', name: 'Back-Rank Mate', description: 'Weak back rank', file: 'backRankMate.json', count: 1 },
    { id: 'deflection', name: 'Deflection', description: 'Pull the defender away', file: 'deflection.json', count: 1 },
  ],
}

function makeProblems(): ProblemSource & { manifestCalls: number; themeCalls: string[] } {
  const src = {
    manifestCalls: 0,
    themeCalls: [] as string[],
    manifest: async () => {
      src.manifestCalls++
      return MANIFEST
    },
    theme: async (themeId: string): Promise<Problem[]> => {
      src.themeCalls.push(themeId)
      if (themeId === 'backRankMate') return [P1]
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
    vi.restoreAllMocks() // un-spy Math.random between tests
  })

  /**
   * startProblem draws randomly across the whole set (theme weighted by
   * manifest count, then uniform within the file). With two count-1 themes,
   * Math.random() → 0 lands on P1 (backRankMate), → 0.9 lands on P2
   * (deflection); the same mocked value then picks index 0 in the 1-problem
   * file either way.
   */
  function rigRandom(problem: 'p1' | 'p2'): void {
    vi.spyOn(Math, 'random').mockReturnValue(problem === 'p1' ? 0 : 0.9)
  }

  /** Drive the store to the read check (setup move auto-played). */
  async function toRead(problem: 'p1' | 'p2' = 'p1'): Promise<void> {
    store.getState().loadManifest() // idempotent; startProblem needs the manifest
    await vi.advanceTimersByTimeAsync(0)
    rigRandom(problem)
    store.getState().startProblem()
    expect(store.getState().status).toBe('loading')
    await vi.advanceTimersByTimeAsync(0) // theme fetch + engine init
    await vi.advanceTimersByTimeAsync(600) // setup-move delay
    expect(store.getState().status).toBe('read')
  }

  async function toReason(
    problem: 'p1' | 'p2' = 'p1',
    answer: ReadCheckAnswer = { materialDiff: 14, verdict: 'white_winning' },
  ): Promise<void> {
    await toRead(problem)
    store.getState().submitReadCheck(answer)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('reason')
  }

  async function toSolve(
    problem: 'p1' | 'p2' = 'p1',
    answer?: ReadCheckAnswer,
  ): Promise<void> {
    await toReason(problem, answer)
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')
  }

  /** Solve phase on P3 — the fixture where Black's reply is a real choice. */
  async function toSolveP3(): Promise<void> {
    problems.theme = async (themeId: string): Promise<Problem[]> => {
      problems.themeCalls.push(themeId)
      return [P3]
    }
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    rigRandom('p1')
    store.getState().startProblem()
    await vi.advanceTimersByTimeAsync(600)
    expect(store.getState().status).toBe('read')
    store.getState().submitReadCheck({ materialDiff: 9, verdict: 'white_winning' })
    await vi.advanceTimersByTimeAsync(0)
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')
  }

  /** Play a line of UCI moves as the user (both sides — ADR-0006). */
  function playLine(...ucis: string[]): void {
    for (const uci of ucis) {
      expect(store.getState().userMove(uci.slice(0, 2), uci.slice(2, 4))).toBe(true)
    }
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

  it('startProblem inits the engine and auto-plays the setup move', async () => {
    await toRead()

    const st = store.getState()
    expect(engine.initCalls).toBe(1)
    expect(st.engineInitializing).toBe(false)
    expect(st.problem?.id).toBe('p1')
    expect(st.historySan).toEqual(['Kh8'])
    expect(st.fen).toBe(SOLVE_FEN_1)
    expect(st.solveFen).toBe(SOLVE_FEN_1)
    expect(st.userColor).toBe('white') // side to move AFTER the setup move
  })

  it('startProblem draws across ALL theme files, weighted by manifest count', async () => {
    // Rigged high, the weighted draw must land in the SECOND theme file.
    await toRead('p2')
    expect(problems.themeCalls).toEqual(['deflection'])
    expect(store.getState().problem?.id).toBe('p2')
  })

  it('skips a theme file that fails to load and draws from another', async () => {
    // Regression: one unloadable theme file (bad data, failed fetch) used to
    // dead-end the draw with an error; now the draw retries elsewhere.
    problems.theme = async (themeId: string): Promise<Problem[]> => {
      problems.themeCalls.push(themeId)
      if (themeId === 'backRankMate') {
        throw new Error('Problem file "backRankMate.json" contains no usable problems.')
      }
      return themeId === 'deflection' ? [P2] : []
    }
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    rigRandom('p1') // draws backRankMate first, which throws
    store.getState().startProblem()
    await vi.advanceTimersByTimeAsync(600)

    const st = store.getState()
    expect(st.status).toBe('read')
    expect(st.problem?.id).toBe('p2')
    expect(st.error).toBeNull()
    expect(problems.themeCalls).toEqual(['backRankMate', 'deflection'])
  })

  it('surfaces the load error when every theme file fails', async () => {
    problems.theme = async (themeId: string): Promise<Problem[]> => {
      problems.themeCalls.push(themeId)
      throw new Error('The problem set failed to load — try reloading.')
    }
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    rigRandom('p1')
    store.getState().startProblem()
    await vi.advanceTimersByTimeAsync(600)

    const st = store.getState()
    expect(st.status).toBe('picking')
    expect(st.error).toMatch(/failed to load/)
    // Both themes tried once each — bounded, no infinite retry.
    expect(problems.themeCalls.sort()).toEqual(['backRankMate', 'deflection'])
  })

  it('startProblem is a no-op until the manifest is loaded', () => {
    store.getState().startProblem()
    expect(store.getState().status).toBe('picking')
    expect(problems.themeCalls).toEqual([])
  })

  it('nextProblem draws a fresh random problem from anywhere, not the same theme', async () => {
    await toSolve() // p1, from the backRankMate file
    rigRandom('p2')
    store.getState().nextProblem()
    expect(store.getState().status).toBe('loading')
    await vi.advanceTimersByTimeAsync(600)
    const st = store.getState()
    expect(st.status).toBe('read')
    expect(st.problem?.id).toBe('p2')
    expect(problems.themeCalls).toEqual(['backRankMate', 'deflection'])
  })

  it('read check: correct answers are confirmed by the report', async () => {
    // White is up Q+R = 14 pawns and the engine says mate for White.
    await toReason('p1', { materialDiff: 14, verdict: 'white_winning' })

    const st = store.getState()
    expect(st.readReport).not.toBeNull()
    expect(st.readReport?.materialCorrect).toBe(true)
    expect(st.readReport?.actualMaterialDiff).toBe(14)
    expect(st.readReport?.verdictCorrect).toBe(true)
    expect(st.readReport?.actualVerdict).toBe('white_winning')
    expect(st.readReport?.comment).toBeTruthy()
    // Eval bar is White-perspective; mate for White maps near +10000.
    expect(st.evalCp).toBeGreaterThan(9000)
    // The engine's lines are computed here but NOT published — line one is the
    // solution and the attempt has not happened yet (ADR-0007).
    expect(st.engineLines).toEqual([])
  })

  it('read check: wrong answers are called out', async () => {
    await toReason('p1', { materialDiff: 0, verdict: 'black_winning' })

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

    let st = store.getState()
    expect(llm.gradeReasoning).not.toHaveBeenCalled()
    expect(st.status).toBe('solve')
    expect(st.solveStep).toBe(1)
    expect(st.llmAvailable).toBe(false)
    expect(st.feedback).toBeNull()
    expect(st.gradeError).toBeNull()
    expect(st.engineLines).toEqual([]) // sealed until the attempt is over

    // The self-check material is still there — it just waits for the solve.
    playLine('b2b7', 'h8g8', 'a1a8')
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.engineLines.length).toBeGreaterThan(0)
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
    // Graded on submit so nobody waits later — but held, not published.
    expect(st.feedback).toBeNull()
    expect(st.gradeError).toBeNull()

    expect(llm.gradeReasoning).toHaveBeenCalledTimes(1)
    const input = llm.gradeReasoning.mock.calls[0][0] as ReasoningGradeInput
    expect(input.fen).toBe(SOLVE_FEN_1)
    expect(input.userColor).toBe('white')
    expect(input.reasoning).toMatch(/discovered check/)
    // Authored solution as SAN (user + opponent moves, user first).
    expect(input.solutionSan).toEqual(['Rb7+', 'Kg8', 'Qa8#'])
    // The coach still gets the engine lines even though the user cannot see them.
    expect(input.engineLines.length).toBeGreaterThan(0)
  })

  it('grading failure is held too, and surfaces once the attempt is over', async () => {
    llm.setKey('sk-test')
    llm.gradeReasoning.mockRejectedValueOnce(new Error('rate limited'))
    await toReason()
    store.getState().setReasoning('Deflect and mate.')
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)

    let st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.feedback).toBeNull()
    expect(st.gradeError).toBeNull() // held: it points at sealed engine lines

    playLine('b2b7', 'h8g8', 'a1a8')
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.gradeError).toBe('rate limited')
  })

  /**
   * ADR-0007. The panel used to show the reasoning coach's feedback (which
   * names the moves the reasoning missed) and an engine-lines toggle (whose
   * first line IS the solution) for the whole solve phase — including at the
   * wrong-line gate, right next to "Try again?". The rule now: while an attempt
   * is live, nothing derived from the solution is in state at all.
   */
  it('seals the answer material for as long as an attempt is live (ADR-0007)', async () => {
    llm.setKey('sk-test')
    await toReason()
    store.getState().setReasoning('Rb7+ discovers check and Qa8 mates.')
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)

    /** Nothing about the answer may be in state right now. */
    function expectSealed(): void {
      const st = store.getState()
      expect(st.feedback).toBeNull()
      expect(st.gradeError).toBeNull()
      expect(st.engineLines).toEqual([])
    }

    // Building the line.
    expectSealed()
    playLine('a1a2')
    expectSealed()
    playLine('h8h7', 'a2a3')
    expectSealed()

    // The wrong-line gate: verdict and two buttons, nothing else.
    store.getState().commitLine()
    expect(store.getState().status).toBe('wrong_move')
    expectSealed()

    // "Try again?" — a fresh attempt, still sealed.
    store.getState().retryWrongMove()
    expect(store.getState().status).toBe('solve')
    expectSealed()

    // Commit another wrong line and ask for the answer this time.
    playLine('a1a2', 'h8h7', 'a2a3')
    store.getState().commitLine()
    store.getState().revealAnswer()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('showing_refutation')
    expectSealed() // still sealed while the refutation animates

    // Landing in 'stopped' is what opens it.
    await vi.advanceTimersByTimeAsync(900 * 3)
    let st = store.getState()
    expect(st.status).toBe('stopped')
    expect(st.feedback).toEqual(FEEDBACK)
    expect(st.engineLines.length).toBeGreaterThan(0)

    // Retrying after the reveal is a live attempt again — it re-seals.
    store.getState().retryFromStop()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')
    expectSealed()

    // …and solving publishes it for good.
    playLine('b2b7', 'h8g8', 'a1a8')
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.feedback).toEqual(FEEDBACK)
    expect(st.engineLines.length).toBeGreaterThan(0)
  })

  it('a fresh problem starts sealed again', async () => {
    llm.setKey('sk-test')
    await toSolve()
    playLine('b2b7', 'h8g8', 'a1a8')
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().engineLines.length).toBeGreaterThan(0)

    rigRandom('p2')
    store.getState().nextProblem()
    await vi.advanceTimersByTimeAsync(600)
    const st = store.getState()
    expect(st.status).toBe('read')
    expect(st.engineLines).toEqual([])
    expect(st.feedback).toBeNull()
  })

  it('solve happy path: the whole line is played out, then committed', async () => {
    await toSolve()

    // The user plays their move AND the reply they expect (ADR-0006) — the
    // store records plies and says nothing about them.
    playLine('b2b7')
    let st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.historySan).toEqual(['Kh8', 'Rb7+'])
    expect(st.solveStep).toBe(2)

    playLine('h8g8')
    st = store.getState()
    expect(st.historySan).toEqual(['Kh8', 'Rb7+', 'Kg8'])
    expect(st.solveStep).toBe(3)

    playLine('a1a8') // 3.Qa8#
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.historySan).toEqual(['Kh8', 'Rb7+', 'Kg8', 'Qa8#'])
    // The motif is revealed ONLY now, as the learning payoff (curated display
    // name from the manifest, matched against the problem's theme tags).
    expect(st.notice).toContain('back-rank mate')
    expect(st.hadStops).toBe(false)
    expect(st.solvedCount).toBe(1)
    expect(st.attemptedCount).toBe(1)
  })

  it('rejects illegal and out-of-phase moves', async () => {
    await toReason()
    // Not in the solve phase yet.
    expect(store.getState().userMove('b2', 'b7')).toBe(false)

    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().userMove('g1', 'g4')).toBe(false) // illegal king move
    // Both colours are the user's to move here, but only when it is that
    // colour's turn — Black cannot move while White is to play.
    expect(store.getState().userMove('h8', 'h7')).toBe(false)
    expect(store.getState().historySan).toEqual(['Kh8'])
  })

  it('reason phase: scratch moves build a line without touching the real game', async () => {
    await toReason() // p1, solveFen = SOLVE_FEN_1 (White to move, fullmove 2)

    // Play a candidate line on the scratch board.
    expect(store.getState().exploreMove('b2', 'b7')).toBe(true) // Rb7+
    let st = store.getState()
    expect(st.exploreSan).toEqual(['Rb7+'])
    expect(st.fen).not.toBe(SOLVE_FEN_1) // scratch position is shown

    expect(store.getState().exploreMove('h8', 'g8')).toBe(true) // ...Kg8
    expect(store.getState().exploreSan).toEqual(['Rb7+', 'Kg8'])

    // Take back the last move, then clear the rest.
    store.getState().undoExplore()
    expect(store.getState().exploreSan).toEqual(['Rb7+'])
    store.getState().resetExplore()
    st = store.getState()
    expect(st.exploreSan).toEqual([])
    expect(st.fen).toBe(SOLVE_FEN_1) // board is back at the solve position

    // Illegal scratch moves are rejected (board snaps back).
    expect(store.getState().exploreMove('a1', 'a4')).toBe(true) // Qa4 is legal
    store.getState().resetExplore()
    expect(store.getState().exploreMove('g1', 'g4')).toBe(false) // illegal king jump
    expect(store.getState().exploreSan).toEqual([])
  })

  it('reason phase: committing a scratch line pastes numbered notation into the reasoning', async () => {
    await toReason()
    store.getState().exploreMove('b2', 'b7') // Rb7+
    store.getState().exploreMove('h8', 'g8') // ...Kg8
    store.getState().exploreMove('a1', 'a8') // Qa8#

    store.getState().commitExploreToReasoning()
    let st = store.getState()
    // Numbered from the solve position (White to move, fullmove 2), trailing
    // space so the user goes straight to the "why".
    expect(st.reasoning).toBe('2.Rb7+ Kg8 3.Qa8# ')
    expect(st.exploreSan).toEqual([]) // scratch cleared
    expect(st.fen).toBe(SOLVE_FEN_1) // board reset

    // A second committed line appends on a new line, preserving prior notes.
    store.getState().setReasoning('2.Rb7+ Kg8 3.Qa8# mates.')
    store.getState().exploreMove('a1', 'a2') // Qa2 (a different try)
    store.getState().commitExploreToReasoning()
    st = store.getState()
    expect(st.reasoning).toBe('2.Rb7+ Kg8 3.Qa8# mates.\n2.Qa2 ')
  })

  it('reason phase: uncommitted exploration does not corrupt the solve', async () => {
    await toReason()
    // Explore a line but do NOT commit it.
    store.getState().exploreMove('b2', 'b7')
    store.getState().exploreMove('h8', 'g8')
    expect(store.getState().fen).not.toBe(SOLVE_FEN_1)

    // Submitting realigns the board and the real game is intact.
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')
    expect(store.getState().fen).toBe(SOLVE_FEN_1)
    expect(store.getState().exploreSan).toEqual([])

    // The genuine solve still works from the real position.
    expect(store.getState().userMove('b2', 'b7')).toBe(true)
    expect(store.getState().historySan).toEqual(['Kh8', 'Rb7+'])
  })

  it('exploreMove is a no-op outside the reason phase', async () => {
    await toSolve() // now in 'solve'
    expect(store.getState().exploreMove('b2', 'b7')).toBe(false)
    expect(store.getState().exploreSan).toEqual([])
    // The solve board is untouched by the rejected scratch move.
    expect(store.getState().historySan).toEqual(['Kh8'])
  })

  it('judges nothing until the line is committed (ADR-0006)', async () => {
    await toSolve()

    // 2.Rb7+ — right move, but the user is told nothing about it.
    playLine('b2b7')
    let st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.notice).toBeNull()
    expect(st.lineComplete).toBe(false)
    expect(st.historySan).toEqual(['Kh8', 'Rb7+'])

    // The reply is the user's to play too — no auto-reply, no timers.
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.getState().historySan).toEqual(['Kh8', 'Rb7+'])
    playLine('h8g8', 'a1a8') // ...Kg8 3.Qa8#
    st = store.getState()
    expect(st.status).toBe('solve') // still silent, even after mate
    expect(st.notice).toBeNull()
    expect(st.lineComplete).toBe(true)
    expect(st.solveStep).toBe(4)

    // Committing is the only checkpoint.
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.hadStops).toBe(false)
    expect(st.notice).toContain('clean line')
    expect(st.notice).toContain('back-rank') // motif revealed only now
    expect(st.solvedCount).toBe(1)
    expect(st.attemptedCount).toBe(1)
  })

  it('commit is a no-op until the line is playable', async () => {
    await toSolve()
    store.getState().commitLine()
    expect(store.getState().status).toBe('solve')

    playLine('b2b7') // one ply of three
    store.getState().commitLine()
    expect(store.getState().status).toBe('solve')
    expect(store.getState().lineComplete).toBe(false)
  })

  it('take back and clear rewind the line without judging it', async () => {
    await toSolve()
    playLine('b2b7', 'h8g8')
    expect(store.getState().historySan).toEqual(['Kh8', 'Rb7+', 'Kg8'])

    store.getState().undoLineMove()
    let st = store.getState()
    expect(st.historySan).toEqual(['Kh8', 'Rb7+'])
    expect(st.solveStep).toBe(2)
    expect(st.status).toBe('solve')

    store.getState().clearLine()
    st = store.getState()
    expect(st.historySan).toEqual(['Kh8'])
    expect(st.fen).toBe(SOLVE_FEN_1)
    expect(st.solveStep).toBe(1)

    // Neither control can rewind past the start of the attempt.
    store.getState().undoLineMove()
    store.getState().clearLine()
    expect(store.getState().historySan).toEqual(['Kh8'])
    expect(store.getState().fen).toBe(SOLVE_FEN_1)

    // And the line replays cleanly from there.
    playLine('b2b7', 'h8g8', 'a1a8')
    store.getState().commitLine()
    expect(store.getState().status).toBe('solved')
  })

  it('wrong line: the gate reveals nothing; the answer explains the failing move', async () => {
    await toReason()
    const REASONING = 'I think the queen is safe on a2 and I still mate later.'
    store.getState().setReasoning(REASONING)
    store.getState().submitReasoning()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getState().status).toBe('solve')

    // A wrong first move, played out to the end of the line: 2.Qa2?? Kg8 3.Qa3.
    playLine('a1a2', 'h8h7', 'a2a3')
    expect(store.getState().status).toBe('solve') // not judged on the way
    store.getState().commitLine()

    let st = store.getState()
    // The gate: the line is called wrong, and that is all it says.
    expect(st.status).toBe('wrong_move')
    expect(st.hadStops).toBe(true)
    expect(st.answerRevealed).toBe(false)
    expect(st.notice).toBeTruthy()
    expect(st.notice).not.toContain('Rb7') // no solution move
    expect(st.notice).not.toContain('Qa2') // not even which move failed
    expect(st.stopExplanation).toBeNull()
    expect(st.refutationSan).toEqual([])
    // The whole line stays on the board, untouched.
    expect(st.historySan).toEqual(['Kh8', 'Qa2', 'Kh7', 'Qa3'])
    // No engine call at all, so not even the eval bar hints at the verdict.
    expect(engine.analyze).not.toHaveBeenCalledWith(WRONG_FEN_1, expect.anything())
    // Nothing pending: the answer waits on the user, not on a timer.
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.getState().status).toBe('wrong_move')

    // Ask for the answer: rewound to the ply that failed, then stop-and-explain.
    store.getState().revealAnswer()
    st = store.getState()
    expect(st.status).toBe('showing_refutation')
    expect(st.answerRevealed).toBe(true)
    expect(st.historySan).toEqual(['Kh8', 'Qa2'])

    // Analysis of the refuted position lands: explanation + punishment line.
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.refutationSan).toEqual(['Kh7', 'Rb7+'])
    expect(st.stopExplanation).toBeTruthy()
    expect(st.stopExplanation).toContain(REASONING) // PLAN §8.1
    expect(st.stopExplanation).toContain('Rb7')
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
    // The stopped state must NOT leak the motif — it is revealed only on a solve.
    expect(st.stopExplanation?.toLowerCase()).not.toContain('back-rank')
    expect(st.notice ?? '').not.toContain('back-rank')

    // Retry rewinds to the failing ply and demands the fix move.
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

    // The fix move is accepted; the rest of the line still has to be played.
    playLine('b2b7')
    expect(store.getState().requiredFixUci).toBeNull()
    playLine('h8g8', 'a1a8')
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.hadStops).toBe(true)
    expect(st.notice).toContain('stop-and-explain')
    expect(st.solvedCount).toBe(1)
    expect(st.attemptedCount).toBe(1) // counted once per problem, at the stop
  })

  it('wrong line: "try again" clears it with the answer still hidden and nothing gated', async () => {
    await toSolve()

    playLine('a1a2', 'h8h7', 'a2a3') // 2.Qa2?? Kh7 3.Qa3
    store.getState().commitLine()
    expect(store.getState().status).toBe('wrong_move')

    store.getState().retryWrongMove()
    let st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.fen).toBe(SOLVE_FEN_1)
    expect(st.historySan).toEqual(['Kh8'])
    expect(st.solveStep).toBe(1)
    // The answer was never shown, so nothing is gated and nothing is revealed.
    expect(st.requiredFixUci).toBeNull()
    expect(st.answerRevealed).toBe(false)
    expect(st.stopExplanation).toBeNull()
    expect(st.refutationSan).toEqual([])
    expect(st.notice).not.toContain('Rb7')
    expect(engine.analyze).not.toHaveBeenCalledWith(WRONG_FEN_1, expect.anything())

    // A second wrong line is gated the same way — retries are never fix-gated.
    playLine('a1a3', 'h8g8', 'a3a4')
    store.getState().commitLine()
    expect(store.getState().status).toBe('wrong_move')
    store.getState().retryWrongMove()
    expect(store.getState().historySan).toEqual(['Kh8'])

    // Solving it yourself after a miss says exactly that.
    playLine('b2b7', 'h8g8', 'a1a8')
    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.hadStops).toBe(true)
    expect(st.answerRevealed).toBe(false)
    expect(st.notice).toContain('without seeing the answer')
    expect(st.solvedCount).toBe(1)
    expect(st.attemptedCount).toBe(1)
  })

  it('a mispredicted reply fails the line and names the defence, with no refutation', async () => {
    await toSolveP3()

    // 2.Qd8+ is right, but Black is not obliged to play 2...Kg7.
    playLine('d2d8', 'f8g7', 'd8d7')
    expect(store.getState().status).toBe('solve')
    store.getState().commitLine()

    let st = store.getState()
    expect(st.status).toBe('wrong_move')
    expect(st.notice).not.toContain('Kf7') // the defence is not given away yet

    store.getState().revealAnswer()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    // Straight to stopped: an engine line after a bad defence is not a lesson.
    expect(st.status).toBe('stopped')
    expect(st.refutationSan).toEqual([])
    expect(st.stopExplanation).toContain('Kf7')
    expect(st.stopExplanation).toContain('Kg7')
    expect(st.historySan).toEqual(['Kf8', 'Qd8+', 'Kg7'])
    expect(st.attemptedCount).toBe(1)

    // The retry restarts at the mispredicted ply and demands the real defence.
    store.getState().retryFromStop()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solve')
    expect(st.historySan).toEqual(['Kf8', 'Qd8+'])
    expect(st.requiredFixUci).toBe('f8f7')
    expect(store.getState().userMove('f8', 'g7')).toBe(false) // bounced
    playLine('f8f7', 'd8d7')
    store.getState().commitLine()
    expect(store.getState().status).toBe('solved')
  })

  it('an unlisted immediate mate counts as correct (Lichess semantics)', async () => {
    // P2 ends 3.Qxb8# — but 3.Rxb8# also mates and must be accepted.
    await toSolve('p2', { materialDiff: 6, verdict: 'white_winning' })

    playLine('a1a8', 'b4b8') // 2.Ra8+ ...Rb8 (the only legal block)
    expect(store.getState().historySan).toEqual(['Rb4', 'Ra8+', 'Rb8'])

    playLine('a8b8') // 3.Rxb8#, not the authored b2b8
    let st = store.getState()
    expect(st.status).toBe('solve') // mate is still not announced by itself
    expect(st.lineComplete).toBe(true) // …but the line is gradeable early

    store.getState().commitLine()
    await vi.advanceTimersByTimeAsync(0)
    st = store.getState()
    expect(st.status).toBe('solved')
    expect(st.historySan).toEqual(['Rb4', 'Ra8+', 'Rb8', 'Rxb8#'])
    expect(st.solvedCount).toBe(1)
  })

  it('backToPicker mid-animation clears timers and leaves clean state', async () => {
    await toSolve()
    playLine('a1a2', 'h8h7', 'a2a3') // wrong line
    store.getState().commitLine() // → gate
    store.getState().revealAnswer() // → refutation pending
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

  it('surfaces engine init failures and returns to the start screen', async () => {
    engine.init.mockRejectedValueOnce(new Error('wasm failed to load'))
    store.getState().loadManifest()
    await vi.advanceTimersByTimeAsync(0)
    rigRandom('p1')
    store.getState().startProblem()
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
