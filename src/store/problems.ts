/**
 * Problems store: orchestrates the read → reason → solve loop for tactics
 * problems (PLAN.md §8, Milestone 6b/6c).
 *
 * Built strictly against the contracts in ../types.ts, mirroring ./session.ts:
 * a zustand vanilla store created once with injected deps (engine, problem
 * source, llm) so it is testable with fakes. The store orchestrates and does
 * not compute — move legality goes to chess.js, evaluation to the engine,
 * read/solve logic and prose to src/problems.
 */
import { Chess } from 'chess.js'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  Color,
  EngineAnalysis,
  EngineLineSummary,
  Problem,
  ProblemManifest,
  ProblemsDeps,
  ProblemSessionStatus,
  ReadCheckAnswer,
  ReadCheckReport,
  ReasoningFeedback,
} from '../types'
import {
  analysisCpWhite,
  checkRead,
  engineLineSummaries,
  fixReminder,
  isSolutionMove,
  sanLineFromUci,
  solvedMessage,
  uciToSan,
  wrongMoveExplanation,
} from '../problems'

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export interface ProblemsState {
  status: ProblemSessionStatus
  manifest: ProblemManifest | null
  manifestError: string | null
  themeId: string | null
  themeName: string | null
  problem: Problem | null
  /** Side to move AFTER the setup move — the side the user solves for. */
  userColor: Color
  /** Live board position. */
  fen: string
  /** Position after the setup move (the position the user reasons about). */
  solveFen: string | null
  /** SAN moves played from the problem position (starts with the setup move). */
  historySan: string[]
  /** Centipawns, White's perspective (mate mapped to ±10000). For the eval bar. */
  evalCp: number
  readReport: ReadCheckReport | null
  /** The user's typed reasoning (CONTEXT.md: "Reasoning"). */
  reasoning: string
  /** Engine ground truth revealed in the reason phase. */
  engineLines: EngineLineSummary[]
  /** Reasoning-coach feedback (BYOK); null without a key or before grading. */
  feedback: ReasoningFeedback | null
  /** User-readable grading failure — the phase degrades to engine lines. */
  gradeError: string | null
  llmAvailable: boolean
  /** Index into problem.moves of the NEXT expected move. */
  solveStep: number
  /** When set, the next user move must be this UCI (fix-move-gated retry). */
  requiredFixUci: string | null
  /** Transient coach note: fix reminder or solved message. */
  notice: string | null
  /** Long-form stop-and-explain text after a wrong move. */
  stopExplanation: string | null
  /** Refutation being animated after a wrong move (SAN, opponent first). */
  refutationSan: string[]
  /** Index of the refutation move currently shown (-1 = none yet). */
  refutationStep: number
  /** True once any wrong attempt happened on this problem. */
  hadStops: boolean
  /** Problems solved this session. */
  solvedCount: number
  /** Problems that reached a terminal state (solved or stopped) this session. */
  attemptedCount: number
  error: string | null
  /** True while engine.init() is in flight after picking a theme. */
  engineInitializing: boolean

  // Actions
  loadManifest: () => void
  pickTheme: (themeId: string) => void
  nextProblem: () => void
  submitReadCheck: (answer: ReadCheckAnswer) => void
  setReasoning: (text: string) => void
  submitReasoning: () => void
  /** Returns false for illegal/out-of-turn/fix-bounced moves (board snaps back). */
  userMove: (from: string, to: string, promotion?: string) => boolean
  retryFromStop: () => void
  backToPicker: () => void
  clearError: () => void
  /** Re-read deps.llm.hasKey() (after the user edits the key in settings). */
  refreshLlm: () => void
}

export type ProblemsStore = StoreApi<ProblemsState>

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const START_FEN = new Chess().fen()
const SETUP_MOVE_MS = 600
const OPPONENT_MOVE_MS = 700
const REFUTATION_MOVE_MS = 900
/** How many plies of the engine's punishment line to animate on a stop. */
const REFUTATION_PLIES = 4
const ANALYZE_OPTS = { depth: 14, multiPv: 3, movetimeMs: 1500 } as const
const ANALYSIS_CACHE_MAX = 60

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function uciParts(uci: string): { from: string; to: string; promotion?: string } {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createProblemsStore(deps: ProblemsDeps): ProblemsStore {
  /** Single source of truth for the live board position. */
  const chess = new Chess()

  /** engine.init() guard — runs at most once (retried if it failed). */
  let initPromise: Promise<void> | null = null

  /** manifest fetch guard — idempotent; cleared on failure so retry works. */
  let manifestPromise: Promise<void> | null = null

  /** fen → in-flight/settled analysis (same pattern as session.ts). */
  const analysisCache = new Map<string, Promise<EngineAnalysis>>()

  /** Bumped on every problem (re)start; async continuations check it. */
  let epoch = 0

  let timers: ReturnType<typeof setTimeout>[] = []

  /** Problems of the currently picked theme (for nextProblem). */
  let themeProblems: Problem[] = []

  /** UCI/SAN moves applied since problem.fen (setup move included). */
  let playedUci: string[] = []
  /** Snapshot before the wrong move, for fix-gated retry. */
  let preStopUci: string[] = []
  let preStopSan: string[] = []
  /** attemptedCount is bumped once per problem, on the first terminal state. */
  let attemptCounted = false

  function clearTimers(): void {
    for (const t of timers) clearTimeout(t)
    timers = []
  }

  function analyzeCached(fen: string): Promise<EngineAnalysis> {
    let p = analysisCache.get(fen)
    if (!p) {
      p = deps.engine.analyze(fen, ANALYZE_OPTS)
      // Drop failed analyses so they can be retried.
      p.catch(() => analysisCache.delete(fen))
      analysisCache.set(fen, p)
      if (analysisCache.size > ANALYSIS_CACHE_MAX) {
        const oldest = analysisCache.keys().next().value
        if (oldest !== undefined && oldest !== fen) analysisCache.delete(oldest)
      }
    }
    return p
  }

  function ensureEngine(): Promise<void> {
    if (!initPromise) initPromise = deps.engine.init()
    return initPromise
  }

  function pickRandom(problems: Problem[]): Problem {
    return problems[Math.floor(Math.random() * problems.length)]
  }

  const store = createStore<ProblemsState>()((set, get) => {
    // -- Async flow helpers (closures over set/get) --------------------------

    /** Kick off a background analysis so evals are warm; never throws. */
    function prefetch(fen: string): void {
      analyzeCached(fen).catch(() => {
        /* surfaced later if actually needed */
      })
    }

    /** Refresh evalCp from the current position; non-blocking, never throws. */
    function refreshEval(myEpoch: number): void {
      analyzeCached(chess.fen())
        .then((a) => {
          if (epoch === myEpoch) set({ evalCp: analysisCpWhite(a) })
        })
        .catch(() => {})
    }

    /**
     * Reset to a fresh problem: load its FEN, init the engine, auto-play the
     * setup move after a short delay, then open the read check.
     * Caller must have bumped `epoch` and cleared timers already.
     */
    function startProblem(problem: Problem, myEpoch: number): void {
      try {
        chess.load(problem.fen)
      } catch (e) {
        set({ status: 'picking', error: errMsg(e, 'This problem has an invalid position') })
        return
      }
      playedUci = []
      preStopUci = []
      preStopSan = []
      attemptCounted = false
      set({
        status: 'loading',
        problem,
        fen: chess.fen(),
        solveFen: null,
        historySan: [],
        evalCp: 0,
        readReport: null,
        reasoning: '',
        engineLines: [],
        feedback: null,
        gradeError: null,
        llmAvailable: deps.llm.hasKey(),
        solveStep: 0,
        requiredFixUci: null,
        notice: null,
        stopExplanation: null,
        refutationSan: [],
        refutationStep: -1,
        hadStops: false,
        error: null,
        engineInitializing: true,
      })
      void (async () => {
        try {
          await ensureEngine()
        } catch (e) {
          if (epoch !== myEpoch) return
          initPromise = null // allow retry on the next pick
          set({
            engineInitializing: false,
            status: 'picking',
            error: errMsg(e, 'The chess engine failed to start'),
          })
          return
        }
        if (epoch !== myEpoch) return
        set({ engineInitializing: false })
        // Auto-play the setup move (problem.moves[0]) after a short beat so
        // the user sees the opponent's move happen.
        const t = setTimeout(() => {
          if (epoch !== myEpoch) return
          try {
            const mv = chess.move(uciParts(problem.moves[0]))
            playedUci = [problem.moves[0]]
            const solveFen = chess.fen()
            const userColor: Color = chess.turn() === 'w' ? 'white' : 'black'
            set({
              status: 'read',
              fen: solveFen,
              solveFen,
              historySan: [mv.san],
              userColor,
            })
            prefetch(solveFen)
          } catch (e) {
            set({ status: 'picking', error: errMsg(e, 'This problem has an invalid setup move') })
          }
        }, SETUP_MOVE_MS)
        timers.push(t)
      })()
    }

    /** Reach a terminal state ('solved' | 'stopped'): count the attempt once. */
    function countAttempt(): void {
      if (attemptCounted) return
      attemptCounted = true
      set({ attemptedCount: get().attemptedCount + 1 })
    }

    /**
     * Stop-and-explain after a wrong move: analyze the refuted position, build
     * the explanation (referencing the user's written reasoning), animate the
     * engine's punishment line, then land in 'stopped'.
     */
    async function startStop(
      myEpoch: number,
      fenBefore: string,
      playedSan: string,
      expectedUci: string,
    ): Promise<void> {
      const expectedSan = uciToSan(fenBefore, expectedUci) ?? expectedUci
      const reasoning = get().reasoning.trim() ? get().reasoning : null
      try {
        const analysis = await analyzeCached(chess.fen())
        if (epoch !== myEpoch) return
        const refutation = (analysis.lines[0]?.pvSan ?? []).slice(0, REFUTATION_PLIES)
        set({
          evalCp: analysisCpWhite(analysis),
          refutationSan: refutation,
          stopExplanation: wrongMoveExplanation({
            playedSan,
            expectedSan,
            refutationSan: refutation,
            reasoning,
          }),
        })
        refutation.forEach((san, i) => {
          const t = setTimeout(() => {
            if (epoch !== myEpoch) return
            try {
              const mv = chess.move(san)
              set({
                fen: chess.fen(),
                historySan: [...get().historySan, mv.san],
                refutationStep: i,
              })
            } catch {
              // Malformed refutation SAN — skip the move, keep the sequence going.
            }
          }, REFUTATION_MOVE_MS * (i + 1))
          timers.push(t)
        })
        const done = setTimeout(
          () => {
            if (epoch !== myEpoch) return
            countAttempt()
            set({ status: 'stopped' })
          },
          REFUTATION_MOVE_MS * (refutation.length + 1),
        )
        timers.push(done)
      } catch {
        if (epoch !== myEpoch) return
        // Engine failed: skip the animation, still stop-and-explain.
        countAttempt()
        set({
          status: 'stopped',
          stopExplanation: wrongMoveExplanation({
            playedSan,
            expectedSan,
            refutationSan: [],
            reasoning,
          }),
        })
      }
    }

    // -- Public API -----------------------------------------------------------

    return {
      status: 'picking',
      manifest: null,
      manifestError: null,
      themeId: null,
      themeName: null,
      problem: null,
      userColor: 'white',
      fen: START_FEN,
      solveFen: null,
      historySan: [],
      evalCp: 0,
      readReport: null,
      reasoning: '',
      engineLines: [],
      feedback: null,
      gradeError: null,
      llmAvailable: deps.llm.hasKey(),
      solveStep: 0,
      requiredFixUci: null,
      notice: null,
      stopExplanation: null,
      refutationSan: [],
      refutationStep: -1,
      hadStops: false,
      solvedCount: 0,
      attemptedCount: 0,
      error: null,
      engineInitializing: false,

      loadManifest: () => {
        if (manifestPromise) return
        manifestPromise = (async () => {
          try {
            const manifest = await deps.problems.manifest()
            set({ manifest, manifestError: null })
          } catch (e) {
            manifestPromise = null // allow a later retry
            set({ manifestError: errMsg(e, 'Could not load the problem sets') })
          }
        })()
      },

      pickTheme: (themeId: string) => {
        epoch++
        const myEpoch = epoch
        clearTimers()
        const info = get().manifest?.themes.find((t) => t.id === themeId)
        set({
          themeId,
          themeName: info?.name ?? themeId,
          status: 'loading',
          problem: null,
          error: null,
        })
        void (async () => {
          try {
            const problems = await deps.problems.theme(themeId)
            if (epoch !== myEpoch) return
            if (problems.length === 0) {
              set({ status: 'picking', error: 'No problems available for this theme' })
              return
            }
            themeProblems = problems
            startProblem(pickRandom(problems), myEpoch)
          } catch (e) {
            if (epoch !== myEpoch) return
            set({ status: 'picking', error: errMsg(e, 'Could not load problems for this theme') })
          }
        })()
      },

      nextProblem: () => {
        const { themeId } = get()
        if (!themeId) return
        if (themeProblems.length === 0) {
          // Theme list not cached (shouldn't happen) — go through pickTheme.
          get().pickTheme(themeId)
          return
        }
        epoch++
        clearTimers()
        startProblem(pickRandom(themeProblems), epoch)
      },

      submitReadCheck: (answer: ReadCheckAnswer) => {
        const st = get()
        if (st.status !== 'read' || !st.solveFen) return
        const solveFen = st.solveFen
        const myEpoch = epoch
        void (async () => {
          try {
            const analysis = await analyzeCached(solveFen)
            if (epoch !== myEpoch) return
            set({
              status: 'reason',
              readReport: checkRead(answer, solveFen, analysis, get().userColor),
              evalCp: analysisCpWhite(analysis),
              engineLines: engineLineSummaries(analysis, get().userColor),
            })
          } catch (e) {
            if (epoch !== myEpoch) return
            set({ error: errMsg(e, 'Position analysis failed — try again') })
          }
        })()
      },

      setReasoning: (text: string) => {
        if (get().status !== 'reason') return
        set({ reasoning: text })
      },

      submitReasoning: () => {
        const st = get()
        if (st.status !== 'reason' || !st.problem || !st.solveFen) return
        const myEpoch = epoch
        const llmAvailable = deps.llm.hasKey()
        // Empty reasoning is allowed (the user self-checks against the engine
        // lines); there is nothing to grade, so skip the LLM either way.
        if (!llmAvailable || !st.reasoning.trim()) {
          set({ status: 'solve', solveStep: 1, llmAvailable })
          return
        }
        set({ status: 'grading', llmAvailable })
        const { problem, solveFen, reasoning, engineLines } = st
        void (async () => {
          try {
            const feedback = await deps.llm.gradeReasoning({
              fen: solveFen,
              userColor: get().userColor,
              reasoning,
              solutionSan: sanLineFromUci(solveFen, problem.moves.slice(1)),
              engineLines,
            })
            if (epoch !== myEpoch) return
            set({ status: 'solve', solveStep: 1, feedback })
          } catch (e) {
            if (epoch !== myEpoch) return
            // Degrade gracefully: the engine lines are already on screen.
            set({
              status: 'solve',
              solveStep: 1,
              gradeError: errMsg(e, 'The reasoning coach is unavailable — check yourself against the engine lines'),
            })
          }
        })()
      },

      userMove: (from: string, to: string, promotion?: string): boolean => {
        const st = get()
        if (st.status !== 'solve' || !st.problem) return false
        const sideToMove: Color = chess.turn() === 'w' ? 'white' : 'black'
        if (sideToMove !== st.userColor) return false

        const fenBefore = chess.fen()
        let mv
        try {
          mv = chess.move({ from, to, promotion: promotion ?? 'q' })
        } catch {
          return false // illegal — board snaps back
        }
        const moveUci = mv.from + mv.to + (mv.promotion ?? '')

        // Fix-move gate: after a stop, the lesson must be played first.
        if (st.requiredFixUci && !isSolutionMove(fenBefore, moveUci, st.requiredFixUci)) {
          chess.undo()
          const fixSan = uciToSan(fenBefore, st.requiredFixUci) ?? st.requiredFixUci
          set({ notice: fixReminder(fixSan) })
          return false
        }

        const expectedUci = st.problem.moves[st.solveStep]
        const myEpoch = epoch
        const historyAfter = [...st.historySan, mv.san]

        // Lichess semantics: the authored move is required, but any immediate
        // checkmate also counts as correct.
        const correct =
          isSolutionMove(fenBefore, moveUci, expectedUci) || chess.isCheckmate()

        if (correct) {
          playedUci = [...playedUci, moveUci]
          const isLast = st.solveStep >= st.problem.moves.length - 1
          if (isLast || chess.isCheckmate()) {
            countAttempt()
            set({
              status: 'solved',
              fen: chess.fen(),
              historySan: historyAfter,
              notice: solvedMessage({
                hadStops: st.hadStops,
                themeName: st.themeName ?? undefined,
              }),
              requiredFixUci: null,
              solvedCount: get().solvedCount + 1,
            })
            refreshEval(myEpoch)
            return true
          }
          const replyUci = st.problem.moves[st.solveStep + 1]
          set({
            status: 'opponent_replying',
            fen: chess.fen(),
            historySan: historyAfter,
            notice: null,
            requiredFixUci: null,
            solveStep: st.solveStep + 1,
          })
          const t = setTimeout(() => {
            if (epoch !== myEpoch) return
            try {
              const reply = chess.move(uciParts(replyUci))
              playedUci = [...playedUci, replyUci]
              set({
                status: 'solve',
                fen: chess.fen(),
                historySan: [...get().historySan, reply.san],
                solveStep: get().solveStep + 1,
              })
              prefetch(chess.fen())
            } catch (e) {
              set({ status: 'solve', error: errMsg(e, 'This problem has an invalid reply move') })
            }
          }, OPPONENT_MOVE_MS)
          timers.push(t)
          return true
        }

        // WRONG MOVE (legal, not the solution, not mate): keep it on the board
        // and run stop-and-explain, referencing the written reasoning.
        preStopUci = playedUci
        preStopSan = st.historySan
        set({
          status: 'showing_refutation',
          fen: chess.fen(),
          historySan: historyAfter,
          hadStops: true,
          notice: null,
          refutationSan: [],
          refutationStep: -1,
        })
        void startStop(myEpoch, fenBefore, mv.san, expectedUci)
        return true
      },

      retryFromStop: () => {
        const st = get()
        if (st.status !== 'stopped' && st.status !== 'showing_refutation') return
        if (!st.problem) return
        clearTimers()
        epoch++
        const myEpoch = epoch
        // Rewind to the position before the wrong move (rebuild from the
        // problem FEN so the internal game stays consistent).
        try {
          chess.load(st.problem.fen)
          for (const uci of preStopUci) chess.move(uciParts(uci))
        } catch (e) {
          set({ error: errMsg(e, 'Could not rewind the position') })
          return
        }
        playedUci = [...preStopUci]
        // Fix-move semantics: the authored solution move is required to continue.
        const fixUci = st.problem.moves[st.solveStep] ?? null
        const fixSan = fixUci ? (uciToSan(chess.fen(), fixUci) ?? fixUci) : null
        set({
          status: 'solve',
          fen: chess.fen(),
          historySan: [...preStopSan],
          requiredFixUci: fixUci,
          notice: fixSan ? fixReminder(fixSan) : null,
          stopExplanation: null,
          refutationSan: [],
          refutationStep: -1,
        })
        refreshEval(myEpoch)
      },

      backToPicker: () => {
        epoch++
        clearTimers()
        chess.reset()
        playedUci = []
        preStopUci = []
        preStopSan = []
        attemptCounted = false
        themeProblems = []
        set({
          status: 'picking',
          themeId: null,
          themeName: null,
          problem: null,
          userColor: 'white',
          fen: START_FEN,
          solveFen: null,
          historySan: [],
          evalCp: 0,
          readReport: null,
          reasoning: '',
          engineLines: [],
          feedback: null,
          gradeError: null,
          llmAvailable: deps.llm.hasKey(),
          solveStep: 0,
          requiredFixUci: null,
          notice: null,
          stopExplanation: null,
          refutationSan: [],
          refutationStep: -1,
          hadStops: false,
          error: null,
          engineInitializing: false,
        })
      },

      clearError: () => set({ error: null }),

      refreshLlm: () => set({ llmAvailable: deps.llm.hasKey() }),
    }
  })

  return store
}
