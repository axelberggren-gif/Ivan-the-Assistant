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
  curatedMotifNames,
  engineLineSummaries,
  fixReminder,
  formatSanLine,
  gradeLine,
  isSolutionMove,
  sanLineFromUci,
  solvedMessage,
  tryAgainNotice,
  uciToSan,
  wrongDefenceExplanation,
  wrongLineVerdict,
  wrongMoveExplanation,
  type LineDeviation,
} from '../problems'

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export interface ProblemsState {
  status: ProblemSessionStatus
  manifest: ProblemManifest | null
  manifestError: string | null
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
  /**
   * SAN of the line the user is trying out on the scratch board during the
   * reason phase. Purely exploratory — never counts as a solve attempt; the
   * user commits it into `reasoning` with `commitExploreToReasoning`.
   */
  exploreSan: string[]
  /** Engine ground truth revealed in the reason phase. */
  engineLines: EngineLineSummary[]
  /** Reasoning-coach feedback (BYOK); null without a key or before grading. */
  feedback: ReasoningFeedback | null
  /** User-readable grading failure — the phase degrades to engine lines. */
  gradeError: string | null
  llmAvailable: boolean
  /**
   * How many plies of this problem have been played, i.e. the index into
   * problem.moves of the NEXT expected ply (1 = the solve position).
   */
  solveStep: number
  /**
   * True when the line played out from the solve position can be graded: every
   * authored ply is on the board, or the game ended. Gates "Commit my line".
   */
  lineComplete: boolean
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
  /**
   * True once the user chose "show answer" after a wrong move on this problem.
   * A retry taken with the answer still hidden leaves it false, which is what
   * the solved message reports on.
   */
  answerRevealed: boolean
  /** Problems solved this session. */
  solvedCount: number
  /** Problems that reached a terminal state (solved or stopped) this session. */
  attemptedCount: number
  error: string | null
  /** True while engine.init() is in flight after picking a theme. */
  engineInitializing: boolean

  // Actions
  loadManifest: () => void
  /**
   * Start a uniformly random problem across ALL themes: theme file picked
   * weighted by its manifest count, then a random problem within it. No motif
   * is shown before or during the attempt (owner decision, 2026-07-22).
   */
  startProblem: () => void
  /** A fresh random problem from anywhere — same draw as startProblem. */
  nextProblem: () => void
  submitReadCheck: (answer: ReadCheckAnswer) => void
  setReasoning: (text: string) => void
  submitReasoning: () => void
  /**
   * Reason-phase scratch board: play any legal move on a throwaway line from
   * the solve position. Returns false for illegal/out-of-phase moves (board
   * snaps back). Does NOT touch the real game — nothing here is a solve attempt.
   */
  exploreMove: (from: string, to: string, promotion?: string) => boolean
  /** Take back the last scratch move. */
  undoExplore: () => void
  /** Clear the scratch line back to the solve position. */
  resetExplore: () => void
  /** Paste the scratch line (as numbered SAN) into `reasoning`, then clear it. */
  commitExploreToReasoning: () => void
  /**
   * Play the next ply of the line — the user's own move OR the reply they
   * expect, since they play both sides here. Nothing is judged: the move just
   * joins the line. Returns false for illegal/fix-bounced moves (board snaps
   * back).
   */
  userMove: (from: string, to: string, promotion?: string) => boolean
  /** Take back the last ply of the line (never past the attempt's start). */
  undoLineMove: () => void
  /** Clear the line back to the start of this attempt. */
  clearLine: () => void
  /**
   * Submit the line as the answer — the ONLY point at which anything is
   * checked (PLAN.md §8.1). Correct ⇒ solved; wrong ⇒ the `wrong_move` gate.
   * No-op until `lineComplete`.
   */
  commitLine: () => void
  /**
   * From the `wrong_move` gate: clear the line and try again with the answer
   * still hidden. No fix-move gate — the user never saw the solution, so this
   * is a genuine second attempt.
   */
  retryWrongMove: () => void
  /**
   * From the `wrong_move` gate: give up on this attempt and see the answer —
   * stop-and-explain at the ply that actually failed (refutation animated for
   * the user's own move, the missed defence named when it was the reply), after
   * which retry is fix-move-gated as before.
   */
  revealAnswer: () => void
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

/**
 * Pick a theme file weighted by its manifest `count`, so that a subsequent
 * uniform pick within the file is a uniform pick across the WHOLE problem set
 * (theme files are just storage; problems are served unlabeled).
 */
function pickWeightedThemeId(manifest: ProblemManifest, exclude?: ReadonlySet<string>): string | null {
  const themes = manifest.themes.filter((t) => t.count > 0 && !exclude?.has(t.id))
  const total = themes.reduce((sum, t) => sum + t.count, 0)
  if (total === 0) return null
  let r = Math.random() * total
  for (const t of themes) {
    r -= t.count
    if (r < 0) return t.id
  }
  return themes[themes.length - 1].id
}

/**
 * How many theme files a single draw may try before giving up. One unloadable
 * file (bad data, a failed fetch) must not dead-end problems mode — we draw
 * again from the remaining themes. Bounded so a full outage fails fast instead
 * of hammering every file in the manifest.
 */
const MAX_THEME_DRAW_ATTEMPTS = 4

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createProblemsStore(deps: ProblemsDeps): ProblemsStore {
  /** Single source of truth for the live board position. */
  const chess = new Chess()

  /**
   * Throwaway board for the reason-phase scratchpad. Always sits at the solve
   * position plus whatever exploratory moves are in `exploreSan`; the real
   * `chess` above is never mutated by exploration.
   */
  const scratch = new Chess()

  /** engine.init() guard — runs at most once (retried if it failed). */
  let initPromise: Promise<void> | null = null

  /** manifest fetch guard — idempotent; cleared on failure so retry works. */
  let manifestPromise: Promise<void> | null = null

  /** fen → in-flight/settled analysis (same pattern as session.ts). */
  const analysisCache = new Map<string, Promise<EngineAnalysis>>()

  /** Bumped on every problem (re)start; async continuations check it. */
  let epoch = 0

  let timers: ReturnType<typeof setTimeout>[] = []

  /** UCI/SAN moves applied since problem.fen (setup move included). */
  let playedUci: string[] = []
  /** Snapshot before the failing ply, for the fix-gated retry after a reveal. */
  let preStopUci: string[] = []
  let preStopSan: string[] = []
  /**
   * Where the current attempt starts: `playedUci.length` at that point (1 is
   * the solve position, more after a post-reveal retry) plus the matching SAN
   * history and the fix move the attempt is gated on, if any. "Take back",
   * "Clear" and "Try again?" all stop here.
   */
  let attemptFloor = 1
  let attemptFloorSan: string[] = []
  let pendingFixUci: string | null = null
  /**
   * The ply where the committed line left the solution, held back at the
   * `wrong_move` gate until the user asks for the answer.
   */
  let pendingDeviation: LineDeviation | null = null
  /** attemptedCount is bumped once per problem, on the first terminal state. */
  let attemptCounted = false

  function clearTimers(): void {
    for (const t of timers) clearTimeout(t)
    timers = []
  }

  /** Record where the current attempt starts (see `attemptFloor`). */
  function setFloor(length: number, san: string[], fixUci: string | null): void {
    attemptFloor = length
    attemptFloorSan = [...san]
    pendingFixUci = fixUci
  }

  /**
   * Is the line gradeable? Either every authored ply is on the board, or the
   * game ended early (a mate found sooner, or the user's line getting mated).
   */
  function lineIsComplete(problem: Problem): boolean {
    return playedUci.length >= problem.moves.length || chess.isGameOver()
  }

  /** Rebuild the board at the attempt floor; false if the rebuild failed. */
  function rewindToFloor(problem: Problem): boolean {
    const prefix = playedUci.slice(0, attemptFloor)
    try {
      chess.load(problem.fen)
      for (const uci of prefix) chess.move(uciParts(uci))
    } catch {
      return false
    }
    playedUci = [...prefix]
    return true
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
    function beginProblem(problem: Problem, myEpoch: number): void {
      try {
        chess.load(problem.fen)
      } catch (e) {
        set({ status: 'picking', error: errMsg(e, 'This problem has an invalid position') })
        return
      }
      playedUci = []
      preStopUci = []
      preStopSan = []
      pendingDeviation = null
      setFloor(1, [], null)
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
        exploreSan: [],
        engineLines: [],
        feedback: null,
        gradeError: null,
        llmAvailable: deps.llm.hasKey(),
        solveStep: 0,
        lineComplete: false,
        requiredFixUci: null,
        notice: null,
        stopExplanation: null,
        refutationSan: [],
        refutationStep: -1,
        hadStops: false,
        answerRevealed: false,
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
            // Every retry on this problem rewinds to here: the solve position.
            setFloor(playedUci.length, [mv.san], null)
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

    /**
     * Start a fresh uniformly random problem across the whole set: theme file
     * weighted by manifest count, then a random problem within it. Theme
     * files are cached by the loader after the first fetch, so repeat draws
     * stay cheap. Backs both startProblem and nextProblem.
     */
    function startRandomProblem(): void {
      const manifest = get().manifest
      if (!manifest) return // the start button only renders once the manifest is loaded
      if (pickWeightedThemeId(manifest) === null) {
        set({ error: 'No problems available — try reloading' })
        return
      }
      epoch++
      const myEpoch = epoch
      clearTimers()
      set({ status: 'loading', problem: null, error: null })
      void (async () => {
        // A theme file that won't load is skipped and the draw retried from
        // the remaining themes — one broken file costs a few puzzles, not the
        // whole mode. The last failure is what the user sees if all tries fail.
        const tried = new Set<string>()
        let lastError: unknown = null
        for (let attempt = 0; attempt < MAX_THEME_DRAW_ATTEMPTS; attempt++) {
          const themeId = pickWeightedThemeId(manifest, tried)
          if (themeId === null) break
          tried.add(themeId)
          try {
            const problems = await deps.problems.theme(themeId)
            if (epoch !== myEpoch) return
            if (problems.length === 0) continue
            beginProblem(pickRandom(problems), myEpoch)
            return
          } catch (e) {
            if (epoch !== myEpoch) return
            lastError = e
          }
        }
        if (epoch !== myEpoch) return
        set({
          status: 'picking',
          error:
            lastError === null
              ? 'No problems available — try reloading'
              : errMsg(lastError, 'Could not load a problem'),
        })
      })()
    }

    // -- Public API -----------------------------------------------------------

    return {
      status: 'picking',
      manifest: null,
      manifestError: null,
      problem: null,
      userColor: 'white',
      fen: START_FEN,
      solveFen: null,
      historySan: [],
      evalCp: 0,
      readReport: null,
      reasoning: '',
      exploreSan: [],
      engineLines: [],
      feedback: null,
      gradeError: null,
      llmAvailable: deps.llm.hasKey(),
      solveStep: 0,
      lineComplete: false,
      requiredFixUci: null,
      notice: null,
      stopExplanation: null,
      refutationSan: [],
      refutationStep: -1,
      hadStops: false,
      answerRevealed: false,
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

      startProblem: () => startRandomProblem(),

      nextProblem: () => startRandomProblem(),

      submitReadCheck: (answer: ReadCheckAnswer) => {
        const st = get()
        if (st.status !== 'read' || !st.solveFen) return
        const solveFen = st.solveFen
        const myEpoch = epoch
        void (async () => {
          try {
            const analysis = await analyzeCached(solveFen)
            if (epoch !== myEpoch) return
            // Arm the scratch board at the solve position for the reason phase.
            scratch.load(solveFen)
            set({
              status: 'reason',
              readReport: checkRead(answer, solveFen, analysis, get().userColor),
              evalCp: analysisCpWhite(analysis),
              engineLines: engineLineSummaries(analysis, get().userColor),
              exploreSan: [],
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
        // Discard any scratch exploration and put the board back at the solve
        // position — the real game (`chess`) was never moved, so this just
        // realigns the display before the solve phase takes over.
        scratch.load(st.solveFen)
        // Empty reasoning is allowed (the user self-checks against the engine
        // lines); there is nothing to grade, so skip the LLM either way.
        if (!llmAvailable || !st.reasoning.trim()) {
          set({
            status: 'solve',
            solveStep: 1,
            lineComplete: false,
            llmAvailable,
            fen: st.solveFen,
            exploreSan: [],
          })
          return
        }
        set({ status: 'grading', llmAvailable, fen: st.solveFen, exploreSan: [] })
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
            set({ status: 'solve', solveStep: 1, lineComplete: false, feedback })
          } catch (e) {
            if (epoch !== myEpoch) return
            // Degrade gracefully: the engine lines are already on screen.
            set({
              status: 'solve',
              solveStep: 1,
              lineComplete: false,
              gradeError: errMsg(e, 'The reasoning coach is unavailable — check yourself against the engine lines'),
            })
          }
        })()
      },

      exploreMove: (from: string, to: string, promotion?: string): boolean => {
        const st = get()
        if (st.status !== 'reason' || !st.solveFen) return false
        let mv
        try {
          // Any legal move for whichever side is to move — the user plays the
          // whole line out (their move, the reply, the follow-up, …).
          mv = scratch.move({ from, to, promotion: promotion ?? 'q' })
        } catch {
          return false // illegal — board snaps back
        }
        set({ exploreSan: [...st.exploreSan, mv.san], fen: scratch.fen() })
        return true
      },

      undoExplore: () => {
        const st = get()
        if (st.status !== 'reason' || st.exploreSan.length === 0) return
        scratch.undo()
        set({ exploreSan: st.exploreSan.slice(0, -1), fen: scratch.fen() })
      },

      resetExplore: () => {
        const st = get()
        if (st.status !== 'reason' || !st.solveFen) return
        scratch.load(st.solveFen)
        set({ exploreSan: [], fen: st.solveFen })
      },

      commitExploreToReasoning: () => {
        const st = get()
        if (st.status !== 'reason' || !st.solveFen || st.exploreSan.length === 0) return
        const line = formatSanLine(st.solveFen, st.exploreSan)
        const current = st.reasoning
        // Paste the notation, then leave a trailing space so the user can go
        // straight to the "why" — they motivate the line, not transcribe it.
        const separator = current.trim().length === 0 ? '' : current.endsWith('\n') ? '' : '\n'
        const reasoning = `${current}${separator}${line} `
        scratch.load(st.solveFen)
        set({ reasoning, exploreSan: [], fen: st.solveFen })
      },

      userMove: (from: string, to: string, promotion?: string): boolean => {
        const st = get()
        if (st.status !== 'solve' || !st.problem) return false

        const fenBefore = chess.fen()
        let mv
        try {
          // BOTH sides are played by the user here: they play their move and
          // the reply they expect, proving they saw it in advance (PLAN §8.1).
          mv = chess.move({ from, to, promotion: promotion ?? 'q' })
        } catch {
          return false // illegal — board snaps back
        }
        const moveUci = mv.from + mv.to + (mv.promotion ?? '')

        // Fix-move gate: after the answer was shown, the lesson move (the
        // user's or the defence they got wrong) must be played first.
        if (st.requiredFixUci && !isSolutionMove(fenBefore, moveUci, st.requiredFixUci)) {
          chess.undo()
          const fixSan = uciToSan(fenBefore, st.requiredFixUci) ?? st.requiredFixUci
          set({ notice: fixReminder(fixSan) })
          return false
        }

        // No judgement here — nothing is checked until the line is committed.
        playedUci = [...playedUci, moveUci]
        set({
          fen: chess.fen(),
          historySan: [...st.historySan, mv.san],
          solveStep: playedUci.length,
          requiredFixUci: null,
          notice: null,
          lineComplete: lineIsComplete(st.problem),
        })
        return true
      },

      undoLineMove: () => {
        const st = get()
        if (st.status !== 'solve' || !st.problem) return
        if (playedUci.length <= attemptFloor) return
        chess.undo()
        playedUci = playedUci.slice(0, -1)
        set({
          fen: chess.fen(),
          historySan: st.historySan.slice(0, -1),
          solveStep: playedUci.length,
          // Back at the start of a post-reveal retry, the fix gate is back too.
          requiredFixUci: playedUci.length === attemptFloor ? pendingFixUci : null,
          notice: null,
          lineComplete: lineIsComplete(st.problem),
        })
      },

      clearLine: () => {
        const st = get()
        if (st.status !== 'solve' || !st.problem) return
        if (playedUci.length <= attemptFloor) return
        if (!rewindToFloor(st.problem)) {
          set({ error: 'Could not rewind the position' })
          return
        }
        set({
          fen: chess.fen(),
          historySan: [...attemptFloorSan],
          solveStep: playedUci.length,
          requiredFixUci: pendingFixUci,
          notice: null,
          lineComplete: lineIsComplete(st.problem),
        })
      },

      commitLine: () => {
        const st = get()
        if (st.status !== 'solve' || !st.problem || !st.solveFen) return
        // The button is disabled until the line is playable; belt and braces.
        if (!st.lineComplete) return
        const myEpoch = epoch
        const grade = gradeLine(st.solveFen, st.problem.moves.slice(1), playedUci.slice(1))

        if (grade.correct) {
          countAttempt()
          set({
            status: 'solved',
            notice: solvedMessage({
              hadStops: st.hadStops,
              // A retry taken without seeing the answer is a different
              // achievement from a stop-and-explain — say which it was.
              sawAnswer: st.answerRevealed,
              // The motif reveal is the learning payoff — shown ONLY here,
              // never before or during the attempt (owner decision).
              motifNames: curatedMotifNames(st.problem.themes, get().manifest?.themes ?? []),
            }),
            requiredFixUci: null,
            lineComplete: false,
            solvedCount: get().solvedCount + 1,
          })
          refreshEval(myEpoch)
          return
        }

        if (!grade.deviation) {
          // Wrong, but nothing deviated: the position ended before the authored
          // line did, which only happens if the problem's own data is
          // inconsistent. Say so instead of offering an answer we don't have.
          set({ error: 'This problem could not be graded — try another one' })
          return
        }

        // WRONG LINE: say only that it failed. Nothing is revealed here — not
        // which ply broke, no refutation, no solution move, not even a fresh
        // eval (no engine call at all) — because the user now chooses between
        // another attempt (retryWrongMove) and the answer (revealAnswer).
        pendingDeviation = grade.deviation
        set({
          status: 'wrong_move',
          hadStops: true,
          notice: wrongLineVerdict(),
          stopExplanation: null,
          refutationSan: [],
          refutationStep: -1,
        })
      },

      retryWrongMove: () => {
        const st = get()
        if (st.status !== 'wrong_move' || !st.problem) return
        clearTimers()
        epoch++
        // Back to the start of the line. Rewinding only to the ply that failed
        // would itself be the answer, so the whole line is replayed.
        if (!rewindToFloor(st.problem)) {
          set({ error: 'Could not rewind the position' })
          return
        }
        pendingDeviation = null
        set({
          status: 'solve',
          fen: chess.fen(),
          historySan: [...attemptFloorSan],
          solveStep: playedUci.length,
          // The fix gate only exists after a reveal; a hidden-answer retry
          // re-arms whatever gate this attempt started with (usually none).
          requiredFixUci: pendingFixUci,
          notice: tryAgainNotice(),
          stopExplanation: null,
          refutationSan: [],
          refutationStep: -1,
          lineComplete: lineIsComplete(st.problem),
        })
      },

      revealAnswer: () => {
        const st = get()
        if (st.status !== 'wrong_move' || !st.problem || !pendingDeviation) return
        const dev = pendingDeviation
        pendingDeviation = null
        clearTimers()
        epoch++
        const myEpoch = epoch
        // Rewind to the ply that failed and put that move back on the board,
        // so the explanation is about the position it actually went wrong in.
        const keep = dev.plyIndex + 1 // playedUci is offset by the setup move
        const wrongUci = playedUci[keep]
        try {
          chess.load(st.problem.fen)
          for (const uci of playedUci.slice(0, keep)) chess.move(uciParts(uci))
        } catch (e) {
          set({ error: errMsg(e, 'Could not rewind the position') })
          return
        }
        preStopUci = playedUci.slice(0, keep)
        preStopSan = st.historySan.slice(0, keep)
        playedUci = [...preStopUci]
        // The failing ply's expected move is what a retry will be gated on.
        setFloor(preStopUci.length, preStopSan, dev.expectedUci)
        try {
          chess.move(uciParts(wrongUci))
        } catch (e) {
          set({ error: errMsg(e, 'Could not replay the move') })
          return
        }
        set({
          fen: chess.fen(),
          historySan: [...preStopSan, dev.playedSan],
          solveStep: keep,
          answerRevealed: true,
          notice: null,
          requiredFixUci: null,
          refutationSan: [],
          refutationStep: -1,
          lineComplete: false,
        })
        if (dev.side === 'user') {
          set({ status: 'showing_refutation' })
          void startStop(myEpoch, dev.fenBefore, dev.playedSan, dev.expectedUci)
          return
        }
        // The user's own moves were fine — they calculated against a defence
        // the opponent doesn't have to play. No refutation animation: the
        // engine's continuation after a bad defence teaches the wrong lesson.
        countAttempt()
        set({
          status: 'stopped',
          stopExplanation: wrongDefenceExplanation({
            playedSan: dev.playedSan,
            expectedSan: dev.expectedSan,
          }),
        })
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
        // Fix-move semantics: the authored move for the failing ply is required
        // to continue — the user's own move, or the defence they mispredicted.
        const fixUci = st.problem.moves[st.solveStep] ?? null
        const fixSan = fixUci ? (uciToSan(chess.fen(), fixUci) ?? fixUci) : null
        // This attempt restarts at the failing ply, not at the solve position:
        // the rest of the line is already proven, so replaying it is busywork.
        setFloor(preStopUci.length, preStopSan, fixUci)
        set({
          status: 'solve',
          fen: chess.fen(),
          historySan: [...preStopSan],
          solveStep: playedUci.length,
          requiredFixUci: fixUci,
          notice: fixSan ? fixReminder(fixSan) : null,
          stopExplanation: null,
          refutationSan: [],
          refutationStep: -1,
          lineComplete: lineIsComplete(st.problem),
        })
        refreshEval(myEpoch)
      },

      backToPicker: () => {
        epoch++
        clearTimers()
        chess.reset()
        scratch.reset()
        playedUci = []
        preStopUci = []
        preStopSan = []
        pendingDeviation = null
        setFloor(1, [], null)
        attemptCounted = false
        set({
          status: 'picking',
          problem: null,
          userColor: 'white',
          fen: START_FEN,
          solveFen: null,
          historySan: [],
          evalCp: 0,
          readReport: null,
          reasoning: '',
          exploreSan: [],
          engineLines: [],
          feedback: null,
          gradeError: null,
          llmAvailable: deps.llm.hasKey(),
          solveStep: 0,
          lineComplete: false,
          requiredFixUci: null,
          notice: null,
          stopExplanation: null,
          refutationSan: [],
          refutationStep: -1,
          hadStops: false,
          answerRevealed: false,
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
