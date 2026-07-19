/**
 * Session store: orchestrates the play → assess → respond training loop.
 *
 * Built strictly against the contracts in ../types.ts. The store is a zustand
 * vanilla store so it can be created once with injected deps and consumed from
 * React via `useStore` (see ./context.ts).
 */
import { Chess } from 'chess.js'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  Classification,
  Color,
  DevelopmentScore,
  EngineAnalysis,
  MoveAssessment,
  MoveFeedback,
  Opening,
  SessionDeps,
  SessionStatus,
} from '../types'

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export interface SessionSummary {
  /** Coach's friendly out-of-book wrap-up */
  message: string
  /** User-move counts per classification */
  counts: Record<Classification, number>
  trapsAvoided: number
  trapsHit: number
  /** Total user moves assessed this session */
  userMoves: number
}

export interface HintArrow {
  from: string
  to: string
}

export interface SessionState {
  status: SessionStatus
  openingId: string | null
  /** Resolved opening (convenience for the UI; sourced from book.getOpening) */
  opening: Opening | null
  /** All openings available to pick from */
  openings: Opening[]
  userColor: Color
  fen: string
  historySan: string[]
  feedback: MoveFeedback[]
  /** Centipawns, White's perspective (mate mapped to ±10000). For the eval bar. */
  evalCp: number
  devScore: DevelopmentScore | null
  lastAssessment: MoveAssessment | null
  /** Best-move arrow shown after an inaccuracy/mistake */
  hintArrow: HintArrow | null
  error: string | null
  /** True while engine.init() is in flight after picking an opening */
  engineInitializing: boolean
  /** Index of the refutation move currently shown (-1 = none yet) */
  refutationStep: number
  /** Position before the game-losing move (for retry) */
  preBlunderFen: string | null
  sessionSummary: SessionSummary | null

  // Actions
  pickOpening: (id: string) => void
  /** Returns false for illegal/out-of-turn moves so the board snaps back. */
  userMove: (from: string, to: string, promotion?: string) => boolean
  retryFromBlunder: () => void
  restartOpening: () => void
  backToPicker: () => void
  clearError: () => void
}

export type SessionStore = StoreApi<SessionState>

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const START_FEN = new Chess().fen()
/** Past this many plies with an empty book we end the session rather than free-play. */
const OUT_OF_BOOK_PLY = 20
const REFUTATION_MOVE_MS = 900
const ANALYZE_OPTS = { depth: 12, multiPv: 3, movetimeMs: 900 } as const
const OPPONENT_OPTS = { skillLevel: 6, movetimeMs: 600 } as const
const ANALYSIS_CACHE_MAX = 60

function emptyCounts(): Record<Classification, number> {
  return { book: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

/** White-perspective centipawns from an analysis (mate mapped to ±10000). */
function whiteCp(analysis: EngineAnalysis): number {
  const line = analysis.lines[0]
  if (!line) return 0
  if (typeof line.cp === 'number') return line.cp
  if (typeof line.mate === 'number') return line.mate >= 0 ? 10000 : -10000
  return 0
}

function weightedSample<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((sum, it) => sum + Math.max(0, it.weight), 0)
  let r = Math.random() * total
  for (const it of items) {
    r -= Math.max(0, it.weight)
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

/** Resolve a SAN move to from/to squares in the given position. */
function arrowFor(fen: string, san: string): HintArrow | null {
  try {
    const c = new Chess(fen)
    const mv = c.move(san)
    return { from: mv.from, to: mv.to }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createSessionStore(deps: SessionDeps): SessionStore {
  /** Single source of truth for the live game position. */
  const chess = new Chess()

  /** engine.init() guard — runs at most once (retried if it failed). */
  let initPromise: Promise<void> | null = null

  /** fen → in-flight/settled analysis, so evalBefore is usually pre-computed. */
  const analysisCache = new Map<string, Promise<EngineAnalysis>>()

  /** Bumped on every session (re)start; async continuations check it. */
  let epoch = 0

  let timers: ReturnType<typeof setTimeout>[] = []

  /** trapIds baited by the opponent's last move, awaiting the user's reply. */
  let pendingTrapIds = new Set<string>()
  let trapsAvoided = 0
  let trapsHit = 0

  /** History (from the start position) before the game-losing move. */
  let preBlunderHistory: string[] = []

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

  const store = createStore<SessionState>()((set, get) => {
    // -- Async flow helpers (closures over set/get) -------------------------

    /** Kick off a background analysis so evals are warm; never throws. */
    function prefetch(fen: string, myEpoch: number): void {
      analyzeCached(fen).catch(() => {
        /* surfaced later if actually needed */
        void myEpoch
      })
    }

    async function endOutOfBook(myEpoch: number): Promise<void> {
      let message: string
      let cp = get().evalCp
      try {
        const evalNow = await analyzeCached(chess.fen())
        if (epoch !== myEpoch) return
        cp = whiteCp(evalNow)
        message = deps.coach.outOfBookSummary(get().historySan, get().userColor, evalNow)
      } catch (e) {
        if (epoch !== myEpoch) return
        message =
          'You have reached the end of the book line. Nice work — review your moves in the log.'
        set({ error: errMsg(e, 'Final position analysis failed') })
      }
      const counts = emptyCounts()
      for (const f of get().feedback) counts[f.classification]++
      set({
        status: 'out_of_book',
        evalCp: cp,
        sessionSummary: {
          message,
          counts,
          trapsAvoided,
          trapsHit,
          userMoves: get().feedback.length,
        },
      })
    }

    async function opponentTurn(myEpoch: number): Promise<void> {
      const { openingId } = get()
      if (!openingId || epoch !== myEpoch) return
      set({ status: 'engine_thinking' })
      const history = get().historySan
      try {
        const options = deps.book.continuations(openingId, history)
        let san: string
        let baitedTrapId: string | undefined
        if (options.length > 0) {
          const pick = weightedSample(options)
          san = pick.san
          if (pick.kind === 'trick' && pick.trapId) baitedTrapId = pick.trapId
        } else if (history.length >= OUT_OF_BOOK_PLY) {
          await endOutOfBook(myEpoch)
          return
        } else {
          const reply = await deps.engine.opponentMove(chess.fen(), OPPONENT_OPTS)
          if (epoch !== myEpoch) return
          san = reply.san
        }

        const mv = chess.move(san)
        if (baitedTrapId) pendingTrapIds.add(baitedTrapId)
        const newHistory = [...history, mv.san]
        set({ fen: chess.fen(), historySan: newHistory })

        // Warm the analysis of the position the user is about to move from.
        prefetch(chess.fen(), myEpoch)

        // Both sides out of theory? End politely rather than free-play (v1).
        const userOptions = deps.book.continuations(openingId, newHistory)
        if (userOptions.length === 0) {
          await endOutOfBook(myEpoch)
          return
        }

        if (epoch !== myEpoch) return
        set({ status: 'playing' })
      } catch (e) {
        if (epoch !== myEpoch) return
        set({ error: errMsg(e, 'The opponent move failed'), status: 'playing' })
      }
    }

    function startRefutation(myEpoch: number, refutation: string[]): void {
      set({ status: 'showing_refutation', refutationStep: -1 })
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
          set({ status: 'stopped_blunder' })
        },
        REFUTATION_MOVE_MS * (refutation.length + 1),
      )
      timers.push(done)
    }

    async function assessUserMove(
      myEpoch: number,
      historyBefore: string[],
      fenBefore: string,
      fenAfter: string,
      san: string,
    ): Promise<void> {
      const { openingId, userColor } = get()
      if (!openingId) return
      const historyAfter = [...historyBefore, san]
      try {
        // book.check takes the history BEFORE the move; matchTrap includes it.
        const book = deps.book.check(openingId, historyBefore, san)
        const trap = deps.book.matchTrap(openingId, historyAfter)

        // Trap bookkeeping: baits presented by the opponent's previous move.
        if (pendingTrapIds.size > 0) {
          if (trap) {
            trapsHit++
            trapsAvoided += Math.max(0, pendingTrapIds.size - 1)
          } else {
            trapsAvoided += pendingTrapIds.size
          }
          pendingTrapIds = new Set()
        } else if (trap) {
          trapsHit++
        }

        const [evalBefore, evalAfter] = await Promise.all([
          analyzeCached(fenBefore),
          analyzeCached(fenAfter),
        ])
        if (epoch !== myEpoch) return

        const assessment = deps.coach.assessMove({
          openingId,
          userColor,
          historySan: historyAfter,
          fenBefore,
          fenAfter,
          san,
          book,
          trap,
          evalBefore,
          evalAfter,
        })
        const devScore = deps.coach.developmentScore(historyAfter, userColor)
        const feedbackItem: MoveFeedback = {
          ...assessment,
          moveNumber: Math.floor(historyBefore.length / 2) + 1,
          color: userColor,
        }
        const showHint =
          assessment.classification === 'mistake' ||
          assessment.classification === 'inaccuracy'
        set({
          feedback: [...get().feedback, feedbackItem],
          devScore,
          lastAssessment: assessment,
          evalCp: whiteCp(evalAfter),
          hintArrow: showHint ? arrowFor(fenBefore, assessment.bestMoveSan) : null,
        })

        if (assessment.stopGame) {
          preBlunderHistory = historyBefore
          set({ preBlunderFen: fenBefore })
          startRefutation(myEpoch, assessment.refutationSan ?? [])
        } else {
          await opponentTurn(myEpoch)
        }
      } catch (e) {
        if (epoch !== myEpoch) return
        // Surface the problem but keep the game flowing: the user's move is
        // already on the board, so let the opponent reply (book moves need no
        // engine) rather than dead-locking with the wrong side to move.
        set({ error: errMsg(e, 'Move assessment failed') })
        await opponentTurn(myEpoch)
      }
    }

    // -- Public API ----------------------------------------------------------

    return {
      status: 'picking',
      openingId: null,
      opening: null,
      openings: deps.book.openings,
      userColor: 'white',
      fen: START_FEN,
      historySan: [],
      feedback: [],
      evalCp: 0,
      devScore: null,
      lastAssessment: null,
      hintArrow: null,
      error: null,
      engineInitializing: false,
      refutationStep: -1,
      preBlunderFen: null,
      sessionSummary: null,

      pickOpening: (id: string) => {
        const opening = deps.book.getOpening(id)
        if (!opening) {
          set({ error: `Unknown opening: ${id}` })
          return
        }
        epoch++
        const myEpoch = epoch
        clearTimers()
        chess.reset()
        pendingTrapIds = new Set()
        trapsAvoided = 0
        trapsHit = 0
        preBlunderHistory = []
        set({
          status: 'playing',
          openingId: id,
          opening,
          userColor: opening.userColor,
          fen: chess.fen(),
          historySan: [],
          feedback: [],
          evalCp: 0,
          devScore: null,
          lastAssessment: null,
          hintArrow: null,
          error: null,
          engineInitializing: true,
          refutationStep: -1,
          preBlunderFen: null,
          sessionSummary: null,
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
          prefetch(chess.fen(), myEpoch)
          if (opening.userColor === 'black') {
            await opponentTurn(myEpoch)
          }
        })()
      },

      userMove: (from: string, to: string, promotion?: string): boolean => {
        const st = get()
        if (st.status !== 'playing' || !st.openingId) return false
        const sideToMove: Color = chess.turn() === 'w' ? 'white' : 'black'
        if (sideToMove !== st.userColor) return false

        const historyBefore = [...st.historySan]
        const fenBefore = chess.fen()
        let mv
        try {
          mv = chess.move({ from, to, promotion: promotion ?? 'q' })
        } catch {
          return false // illegal — board snaps back
        }
        const fenAfter = chess.fen()
        const myEpoch = epoch
        set({
          status: 'assessing',
          fen: fenAfter,
          historySan: [...historyBefore, mv.san],
          hintArrow: null,
        })
        void assessUserMove(myEpoch, historyBefore, fenBefore, fenAfter, mv.san)
        return true
      },

      retryFromBlunder: () => {
        const st = get()
        if (st.status !== 'stopped_blunder' && st.status !== 'showing_refutation') return
        clearTimers()
        epoch++
        const myEpoch = epoch
        // Replay from the start so the internal game stays consistent.
        chess.reset()
        for (const san of preBlunderHistory) chess.move(san)
        const restoredHistory = [...preBlunderHistory]
        let devScore: DevelopmentScore | null = null
        try {
          devScore = deps.coach.developmentScore(restoredHistory, st.userColor)
        } catch {
          devScore = st.devScore
        }
        set({
          status: 'playing',
          fen: chess.fen(),
          historySan: restoredHistory,
          feedback: get().feedback.slice(0, -1), // pop the bad move's feedback
          lastAssessment: null,
          hintArrow: null,
          refutationStep: -1,
          preBlunderFen: null,
          devScore,
        })
        analyzeCached(chess.fen())
          .then((a) => {
            if (epoch === myEpoch) set({ evalCp: whiteCp(a) })
          })
          .catch(() => {})
      },

      restartOpening: () => {
        const id = get().openingId
        if (id) get().pickOpening(id)
      },

      backToPicker: () => {
        epoch++
        clearTimers()
        chess.reset()
        pendingTrapIds = new Set()
        trapsAvoided = 0
        trapsHit = 0
        preBlunderHistory = []
        set({
          status: 'picking',
          openingId: null,
          opening: null,
          userColor: 'white',
          fen: START_FEN,
          historySan: [],
          feedback: [],
          evalCp: 0,
          devScore: null,
          lastAssessment: null,
          hintArrow: null,
          error: null,
          engineInitializing: false,
          refutationStep: -1,
          preBlunderFen: null,
          sessionSummary: null,
        })
      },

      clearError: () => set({ error: null }),
    }
  })

  return store
}
