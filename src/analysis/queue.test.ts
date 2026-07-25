import { describe, expect, it, vi } from 'vitest'
import { Chess } from 'chess.js'
import type { AnalyzeOptions, EngineAnalysis, EngineAPI } from '../types'
import { budgetSignature, resolveBudget } from './annotate'
import { createAnalysisQueue } from './queue'
import type {
  AnalysisCache,
  AnalysisGameInput,
  AnalysisProgress,
  AnnotatedGame,
} from './types'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeEngine extends EngineAPI {
  calls: Array<{ fen: string; opts?: AnalyzeOptions }>
  initCalls: number
  disposeCalls: number
}

/** Every position evaluates to `cp`; each analyze() advances the fake clock. */
function makeEngine(cp = 20, clock?: { ms: number }, tickMs = 10): FakeEngine {
  const engine: FakeEngine = {
    calls: [],
    initCalls: 0,
    disposeCalls: 0,
    init: vi.fn(async () => {
      engine.initCalls++
    }),
    analyze: vi.fn(async (fen: string, opts?: AnalyzeOptions): Promise<EngineAnalysis> => {
      engine.calls.push({ fen, opts })
      if (clock) clock.ms += tickMs
      const legal = new Chess(fen).moves()
      return {
        fen,
        depth: opts?.depth ?? 12,
        bestMoveSan: legal[0] ?? '',
        bestMoveUci: '',
        lines: [{ pvSan: legal.slice(0, 1), pvUci: [], cp }],
      }
    }),
    opponentMove: vi.fn(async () => ({ san: 'a3', uci: 'a2a3' })),
    dispose: vi.fn(() => {
      engine.disposeCalls++
    }),
  }
  return engine
}

function makeCache(): AnalysisCache & { map: Map<string, unknown>; writes: string[] } {
  const map = new Map<string, unknown>()
  const writes: string[] = []
  return {
    map,
    writes,
    async get<T>(key: string) {
      return map.get(key) as T | undefined
    },
    async set<T>(key: string, value: T) {
      writes.push(key)
      map.set(key, value)
    },
  }
}

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'd6']

function game(id: string, endTimeMs = 1): AnalysisGameInput {
  return { id, movesSan: ITALIAN, userColor: 'white', meta: { url: id, endTimeMs } }
}

/** No deep re-check unless a test asks for it — it doubles the search count. */
const NO_VERIFY = { verifyTopN: 0 }

describe('createAnalysisQueue', () => {
  it('annotates every game, commits incrementally and disposes the engine', async () => {
    const engine = makeEngine()
    const cache = makeCache()
    const committed: string[] = []
    const queue = createAnalysisQueue({ createEngine: () => engine, cache })

    const result = await queue.run([game('a'), game('b')], {
      budget: NO_VERIFY,
      onGame: (g) => committed.push(g.id),
    })

    expect(result.aborted).toBe(false)
    expect(result.games.map((g) => g.id)).toEqual(['a', 'b'])
    expect(committed).toEqual(['a', 'b'])
    expect(engine.initCalls).toBe(1)
    expect(engine.disposeCalls).toBe(1)
  })

  it('creates exactly one batch engine, lazily, and never for a fully cached run', async () => {
    const cache = makeCache()
    const signature = budgetSignature(resolveBudget(NO_VERIFY))
    const first = makeEngine()
    await createAnalysisQueue({ createEngine: () => first, cache }).run([game('a')], {
      budget: NO_VERIFY,
    })
    expect(first.initCalls).toBe(1)
    expect(cache.map.has(`analysis:${signature}:a`)).toBe(true)

    const second = makeEngine()
    const createEngine = vi.fn(() => second)
    const result = await createAnalysisQueue({ createEngine, cache }).run([game('a')], {
      budget: NO_VERIFY,
    })
    expect(createEngine).not.toHaveBeenCalled()
    expect(result.games[0].id).toBe('a')
  })

  it('re-analyses when the budget signature changes', async () => {
    const cache = makeCache()
    const first = makeEngine()
    await createAnalysisQueue({ createEngine: () => first, cache }).run([game('a')], {
      budget: NO_VERIFY,
    })

    const second = makeEngine()
    await createAnalysisQueue({ createEngine: () => second, cache }).run([game('a')], {
      budget: { ...NO_VERIFY, movetimeMs: 400 },
    })
    expect(second.initCalls).toBe(1)
    expect(second.calls.length).toBeGreaterThan(0)
  })

  it('ignores a cache entry whose shape it does not recognise', async () => {
    const cache = makeCache()
    const signature = budgetSignature(resolveBudget(NO_VERIFY))
    cache.map.set(`analysis:${signature}:a`, { id: 'a', signature, moves: 'not an array' })
    const engine = makeEngine()
    await createAnalysisQueue({ createEngine: () => engine, cache }).run([game('a')], {
      budget: NO_VERIFY,
    })
    expect(engine.calls.length).toBeGreaterThan(0)
  })

  it('survives a cache that throws on read and on write', async () => {
    const broken: AnalysisCache = {
      get: async () => {
        throw new Error('IndexedDB is having a day')
      },
      set: async () => {
        throw new Error('quota exceeded')
      },
    }
    const engine = makeEngine()
    const result = await createAnalysisQueue({ createEngine: () => engine, cache: broken }).run(
      [game('a')],
      { budget: NO_VERIFY },
    )
    expect(result.games).toHaveLength(1)
  })

  it('reports progress with games, plies and cache hits', async () => {
    const cache = makeCache()
    const seen: AnalysisProgress[] = []
    const first = makeEngine()
    await createAnalysisQueue({ createEngine: () => first, cache }).run([game('a')], {
      budget: NO_VERIFY,
    })

    const second = makeEngine()
    await createAnalysisQueue({ createEngine: () => second, cache }).run(
      [game('a'), game('b')],
      { budget: NO_VERIFY, onProgress: (p) => seen.push(p) },
    )

    const last = seen[seen.length - 1]
    expect(last.phase).toBe('done')
    expect(last.gamesTotal).toBe(2)
    expect(last.gamesDone).toBe(2)
    expect(last.gamesCached).toBe(1)
    expect(seen.some((p) => p.pliesDone > 0 && p.pliesTotal === ITALIAN.length + 1)).toBe(true)
  })

  it('estimates the ETA from analysed games only, never from cache hits', async () => {
    const cache = makeCache()
    const clock = { ms: 0 }
    const now = () => clock.ms

    // Warm the cache for 'a' so the second run mixes a hit with real work.
    const warm = makeEngine(20, clock)
    await createAnalysisQueue({ createEngine: () => warm, cache, now }).run([game('a')], {
      budget: NO_VERIFY,
    })

    const seen: AnalysisProgress[] = []
    const engine = makeEngine(20, clock)
    await createAnalysisQueue({ createEngine: () => engine, cache, now }).run(
      [game('a'), game('b'), game('c')],
      { budget: NO_VERIFY, onProgress: (p) => seen.push(p) },
    )

    // While the cached game is the only one done, there is no honest estimate.
    const afterCacheHit = seen.find((p) => p.gamesDone === 1)!
    expect(afterCacheHit.gamesCached).toBe(1)
    expect(afterCacheHit.etaMs).toBeNull()

    // Once a game has genuinely been analysed, one game's duration is the
    // estimate for the one game still to go.
    const afterRealGame = seen.find((p) => p.gamesDone === 2)!
    const perGameMs = (ITALIAN.length + 1) * 10
    expect(afterRealGame.etaMs).toBe(perGameMs)

    // ...and it winds down to zero as that last game finishes.
    const finalAnalysing = seen.filter((p) => p.phase === 'analysing').pop()!
    expect(finalAnalysing.etaMs).toBe(0)
  })

  it('cancels between games and keeps the games already committed', async () => {
    const controller = new AbortController()
    const engine = makeEngine()
    const committed: AnnotatedGame[] = []
    const queue = createAnalysisQueue({ createEngine: () => engine, cache: makeCache() })

    const result = await queue.run([game('a'), game('b'), game('c')], {
      budget: NO_VERIFY,
      signal: controller.signal,
      onGame: (g) => {
        committed.push(g)
        if (g.id === 'a') controller.abort()
      },
    })

    expect(result.aborted).toBe(true)
    expect(result.games.map((g) => g.id)).toEqual(['a'])
    expect(committed).toHaveLength(1)
    expect(engine.disposeCalls).toBe(1)
  })

  it('cancels mid-game, keeps the partial verdicts, and does not cache them', async () => {
    const controller = new AbortController()
    const cache = makeCache()
    const engine = makeEngine()
    // Abort once the first game is a few positions in.
    engine.analyze = vi.fn(async (fen: string, opts?: AnalyzeOptions) => {
      engine.calls.push({ fen, opts })
      if (engine.calls.length === 4) controller.abort()
      const legal = new Chess(fen).moves()
      return {
        fen,
        depth: 12,
        bestMoveSan: legal[0] ?? '',
        bestMoveUci: '',
        lines: [{ pvSan: legal.slice(0, 1), pvUci: [], cp: 20 }],
      }
    })

    const result = await createAnalysisQueue({ createEngine: () => engine, cache }).run(
      [game('a'), game('b')],
      { budget: NO_VERIFY, signal: controller.signal },
    )

    expect(result.aborted).toBe(true)
    expect(result.games).toHaveLength(1)
    expect(result.games[0].truncated).toBe('aborted')
    expect(result.games[0].moves.length).toBeGreaterThan(0)
    expect(cache.writes).toEqual([]) // a partial game is never cached
  })

  it('never starts an engine when the run is cancelled before it begins', async () => {
    const controller = new AbortController()
    controller.abort()
    const createEngine = vi.fn(() => makeEngine())
    const result = await createAnalysisQueue({ createEngine, cache: makeCache() }).run(
      [game('a')],
      { budget: NO_VERIFY, signal: controller.signal },
    )
    expect(createEngine).not.toHaveBeenCalled()
    expect(result).toEqual({ games: [], aborted: true })
  })

  it('caps the run at the budget’s maxGames', async () => {
    const engine = makeEngine()
    const result = await createAnalysisQueue({
      createEngine: () => engine,
      cache: makeCache(),
    }).run([game('a'), game('b'), game('c')], { budget: { ...NO_VERIFY, maxGames: 2 } })
    expect(result.games.map((g) => g.id)).toEqual(['a', 'b'])
  })

  it('re-checks the worst moves at full depth and re-caches the result', async () => {
    // Shallow pass: −900 from the position after White's first move, so 1.e4
    // reads as a blunder. Deep pass: flat, so the re-check clears it.
    const cache = makeCache()
    let deep = false
    const engine = makeEngine()
    engine.analyze = vi.fn(async (fen: string, opts?: AnalyzeOptions) => {
      engine.calls.push({ fen, opts })
      const isDeep = opts?.depth !== undefined
      if (isDeep) deep = true
      const chess = new Chess(fen)
      const legal = chess.moves()
      const startPosition = fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP')
      const cp = isDeep ? 20 : startPosition ? 20 : -900
      return {
        fen,
        depth: opts?.depth ?? 12,
        bestMoveSan: legal[0] ?? '',
        bestMoveUci: '',
        lines: [{ pvSan: legal.slice(0, 1), pvUci: [], cp }],
      }
    })

    const committed: AnnotatedGame[] = []
    const result = await createAnalysisQueue({ createEngine: () => engine, cache }).run(
      [game('a')],
      {
        budget: { verifyTopN: 3, verifyDepth: 18, decidedPlies: 99 },
        onGame: (g) => committed.push(g),
      },
    )

    expect(deep).toBe(true)
    const first = result.games[0].moves[0]
    expect(first.verified).toBe(true)
    expect(first.classification).toBe('good')
    // Committed twice: once from the scan, once after the deep re-check.
    expect(committed).toHaveLength(2)
    const signature = result.games[0].signature
    expect(cache.writes).toEqual([`analysis:${signature}:a`, `analysis:${signature}:a`])
  })

  it('skips the deep re-check entirely when the run was cancelled', async () => {
    const controller = new AbortController()
    const engine = makeEngine(-900)
    await createAnalysisQueue({ createEngine: () => engine, cache: makeCache() }).run(
      [game('a'), game('b')],
      {
        budget: { verifyTopN: 5, decidedPlies: 99 },
        signal: controller.signal,
        onGame: () => controller.abort(),
      },
    )
    expect(engine.calls.every((c) => c.opts?.depth === undefined)).toBe(true)
  })

  it('disposes the engine even when a search throws', async () => {
    const engine = makeEngine()
    engine.analyze = vi.fn(async () => {
      throw new Error('worker died')
    })
    const queue = createAnalysisQueue({ createEngine: () => engine, cache: makeCache() })
    await expect(queue.run([game('a')], { budget: NO_VERIFY })).rejects.toThrow('worker died')
    expect(engine.disposeCalls).toBe(1)
  })
})
