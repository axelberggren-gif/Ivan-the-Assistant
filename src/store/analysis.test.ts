import { describe, expect, it, vi } from 'vitest'
import { Chess } from 'chess.js'
import type { AnalyzeOptions, EngineAnalysis, EngineAPI } from '../types'
import type { AnalysisCache, SelectableGame } from '../analysis'
import { createAnalysisStore, MAX_GAMES_CHOICES } from './analysis'

// ---------------------------------------------------------------------------
// Fakes — same seam as session.test.ts / problems.test.ts
// ---------------------------------------------------------------------------

interface FakeEngine extends EngineAPI {
  analyzeCalls: number
  disposeCalls: number
}

function makeEngine(cp = 20): FakeEngine {
  const engine: FakeEngine = {
    analyzeCalls: 0,
    disposeCalls: 0,
    init: vi.fn(async () => {}),
    analyze: vi.fn(async (fen: string, opts?: AnalyzeOptions): Promise<EngineAnalysis> => {
      engine.analyzeCalls++
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

function makeCache(): AnalysisCache {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined
    },
    async set<T>(key: string, value: T) {
      map.set(key, value)
    },
  }
}

const PGN = `[Event "Live Chess"]
[Result "0-1"]

1. e4 {[%clk 0:10:00]} e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. O-O Nf6 0-1`

function game(overrides: Partial<SelectableGame> = {}): SelectableGame {
  return {
    url: 'https://chess.com/1',
    pgn: PGN,
    endTimeMs: 1_000,
    userColor: 'white',
    rated: true,
    timeClass: 'blitz',
    result: 'loss',
    ...overrides,
  }
}

/** Resolve once the store leaves 'running'. */
function settled(store: ReturnType<typeof createAnalysisStore>): Promise<void> {
  return new Promise((resolve) => {
    if (store.getState().status !== 'running') {
      resolve()
      return
    }
    const unsubscribe = store.subscribe((state) => {
      if (state.status !== 'running') {
        unsubscribe()
        resolve()
      }
    })
  })
}

function makeStore(engine = makeEngine()) {
  const store = createAnalysisStore({ createEngine: () => engine, cache: makeCache() })
  return { store, engine }
}

// ---------------------------------------------------------------------------

describe('createAnalysisStore', () => {
  it('starts idle and never auto-starts a run', () => {
    const { store, engine } = makeStore()
    expect(store.getState().status).toBe('idle')
    expect(store.getState().report).toBeNull()
    expect(store.getState().running).toBe(false)
    expect(engine.analyzeCalls).toBe(0)
  })

  it('runs to ready and builds a report, then disposes the batch engine', async () => {
    const { store, engine } = makeStore()
    store.getState().analyse([game({ url: 'a' }), game({ url: 'b', endTimeMs: 2_000 })])
    expect(store.getState().status).toBe('running')
    expect(store.getState().running).toBe(true)
    await settled(store)

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.running).toBe(false)
    expect(state.games.map((g) => g.id)).toEqual(['b', 'a']) // newest first
    expect(state.report?.gamesAnalysed).toBe(2)
    expect(state.report?.headline).toBeTruthy()
    expect(state.progress?.phase).toBe('done')
    expect(engine.disposeCalls).toBe(1)
  })

  it('grows the report game by game rather than at the end', async () => {
    const { store } = makeStore()
    const seen: number[] = []
    const unsubscribe = store.subscribe((s) => {
      if (s.report) seen.push(s.report.gamesAnalysed)
    })
    store.getState().analyse([
      game({ url: 'a' }),
      game({ url: 'b', endTimeMs: 2_000 }),
      game({ url: 'c', endTimeMs: 3_000 }),
    ])
    await settled(store)
    unsubscribe()
    expect(seen[0]).toBe(1) // a report existed before the run finished
    expect(seen[seen.length - 1]).toBe(3)
  })

  it('reports progress while running', async () => {
    const { store } = makeStore()
    const phases: string[] = []
    const unsubscribe = store.subscribe((s) => {
      if (s.progress) phases.push(s.progress.phase)
    })
    store.getState().analyse([game()])
    await settled(store)
    unsubscribe()
    expect(phases).toContain('analysing')
    expect(phases).toContain('verifying')
    expect(phases[phases.length - 1]).toBe('done')
  })

  it('cancelling keeps the games already committed', async () => {
    const { store } = makeStore()
    const unsubscribe = store.subscribe((s) => {
      if (s.games.length === 1 && s.status === 'running') store.getState().cancel()
    })
    store.getState().analyse([
      game({ url: 'a', endTimeMs: 3_000 }),
      game({ url: 'b', endTimeMs: 2_000 }),
      game({ url: 'c', endTimeMs: 1_000 }),
    ])
    await settled(store)
    unsubscribe()

    const state = store.getState()
    expect(state.status).toBe('cancelled')
    expect(state.running).toBe(false)
    expect(state.games).toHaveLength(1)
    expect(state.games[0].id).toBe('a') // the newest game, which the user cares most about
    expect(state.report?.gamesAnalysed).toBe(1)
  })

  it('ignores a second analyse() while a run is in flight', async () => {
    const { store } = makeStore()
    store.getState().analyse([game({ url: 'a' })])
    store.getState().analyse([game({ url: 'b' }), game({ url: 'c' })])
    await settled(store)
    expect(store.getState().games.map((g) => g.id)).toEqual(['a'])
  })

  it('explains itself when no game can be analysed', () => {
    const { store, engine } = makeStore()
    store.getState().analyse([game({ rated: false }), game({ pgn: undefined })])
    const state = store.getState()
    expect(state.status).toBe('error')
    expect(state.error).toContain('rated games')
    expect(engine.analyzeCalls).toBe(0)
  })

  it('surfaces an engine failure but keeps whatever landed first', async () => {
    const engine = makeEngine()
    let calls = 0
    engine.analyze = vi.fn(async (fen: string) => {
      calls++
      if (calls > 12) throw new Error('worker died')
      const legal = new Chess(fen).moves()
      return {
        fen,
        depth: 12,
        bestMoveSan: legal[0] ?? '',
        bestMoveUci: '',
        lines: [{ pvSan: legal.slice(0, 1), pvUci: [], cp: 20 }],
      }
    })
    const { store } = makeStore(engine)
    store.getState().analyse([game({ url: 'a', endTimeMs: 2_000 }), game({ url: 'b' })])
    await settled(store)

    const state = store.getState()
    expect(state.status).toBe('error')
    expect(state.error).toContain('worker died')
    expect(state.games.map((g) => g.id)).toEqual(['a'])
    expect(state.report?.gamesAnalysed).toBe(1)
    expect(engine.disposeCalls).toBe(1)
  })

  it('honours maxGames, and refuses to change it mid-run', async () => {
    const { store } = makeStore()
    store.getState().setMaxGames(1)
    expect(store.getState().maxGames).toBe(1)

    store.getState().analyse([game({ url: 'a', endTimeMs: 2_000 }), game({ url: 'b' })])
    store.getState().setMaxGames(50)
    expect(store.getState().maxGames).toBe(1)
    await settled(store)
    expect(store.getState().games).toHaveLength(1)
  })

  it('reset clears the report, and is a no-op mid-run', async () => {
    const { store } = makeStore()
    store.getState().analyse([game()])
    store.getState().reset()
    expect(store.getState().status).toBe('running')
    await settled(store)

    store.getState().reset()
    expect(store.getState().status).toBe('idle')
    expect(store.getState().report).toBeNull()
    expect(store.getState().games).toEqual([])
  })

  it('offers 25 as the default scope', () => {
    const { store } = makeStore()
    expect(store.getState().maxGames).toBe(25)
    expect(MAX_GAMES_CHOICES).toContain(25)
  })
})
