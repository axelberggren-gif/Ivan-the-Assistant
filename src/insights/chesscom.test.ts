import { describe, expect, it, vi } from 'vitest'

import type { ChesscomGame, FetchProgress, KVStore } from './types'
import { InsightsError } from './types'
import { createMemoryStore } from './cache'
import { createChesscomClient } from './chesscom'

// ---------------------------------------------------------------------------
// Fixtures — canned Response-returning fetch. No real network.
// ---------------------------------------------------------------------------

const BASE = 'https://api.chess.com/pub/player'

/** Fixed clock: July 20, 2026 UTC → current calendar month is "2026/07" */
const now = () => new Date(Date.UTC(2026, 6, 20, 12, 0, 0))

function game(url: string, endTime: number): ChesscomGame {
  return {
    url,
    end_time: endTime,
    rated: true,
    time_class: 'rapid',
    rules: 'chess',
    time_control: '600',
    white: { username: 'testuser', rating: 1000, result: 'win' },
    black: { username: 'opponent', rating: 990, result: 'resigned' },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Route table keyed by full URL; unknown URLs 404. Returns a spying fetch. */
function fakeFetch(routes: Record<string, () => Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const route = routes[url]
    return route ? route() : json({ message: 'not found' }, 404)
  })
  return { fn, fetchFn: fn as unknown as typeof fetch }
}

function archivesOf(user: string, months: string[]): Record<string, () => Response> {
  return {
    [`${BASE}/${user}/games/archives`]: () =>
      json({ archives: months.map((m) => `${BASE}/${user}/games/${m}`) }),
  }
}

/** Standard two-month fixture: June (past) + July (current), 2 games each. */
function twoMonthRoutes() {
  const juneGames = [game('june-1', 100), game('june-2', 200)]
  const julyGames = [game('july-1', 300), game('july-2', 400)]
  return {
    juneGames,
    julyGames,
    routes: {
      ...archivesOf('testuser', ['2026/06', '2026/07']),
      [`${BASE}/testuser/games/2026/06`]: () => json({ games: juneGames }),
      [`${BASE}/testuser/games/2026/07`]: () => json({ games: julyGames }),
      [`${BASE}/testuser/stats`]: () =>
        json({ chess_rapid: { last: { rating: 1000, date: 1 } } }),
    },
  }
}

function client(routes: Record<string, () => Response>, store: KVStore = createMemoryStore()) {
  const { fn, fetchFn } = fakeFetch(routes)
  return { fn, store, client: createChesscomClient({ fetchFn, store, now }) }
}

// ---------------------------------------------------------------------------

describe('createChesscomClient', () => {
  it('throws InsightsError not_found when the archives endpoint 404s', async () => {
    const { client: c } = client({})
    await expect(c.load('ghostuser')).rejects.toMatchObject({
      name: 'InsightsError',
      kind: 'not_found',
    })
  })

  it('throws InsightsError network on fetch rejection (TypeError)', async () => {
    const fetchFn = (async () => {
      throw new TypeError('failed to fetch')
    }) as unknown as typeof fetch
    const c = createChesscomClient({ fetchFn, store: createMemoryStore(), now })
    await expect(c.load('testuser')).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws InsightsError bad_response on non-OK statuses and malformed JSON', async () => {
    const { client: serverError } = client({
      [`${BASE}/testuser/games/archives`]: () => json({}, 500),
    })
    await expect(serverError.load('testuser')).rejects.toMatchObject({ kind: 'bad_response' })

    const { client: malformed } = client({
      [`${BASE}/testuser/games/archives`]: () => new Response('not json {'),
    })
    await expect(malformed.load('testuser')).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('throws InsightsError aborted when the signal is already aborted', async () => {
    const { client: c } = client(twoMonthRoutes().routes)
    const controller = new AbortController()
    controller.abort()
    await expect(c.load('testuser', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    })
  })

  it('loads two months: trims + lowercases the username, orders newest month first, reports progress', async () => {
    const { juneGames, julyGames, routes } = twoMonthRoutes()
    const { client: c } = client(routes)
    const events: FetchProgress[] = []

    const result = await c.load('  TestUser ', { onProgress: (p) => events.push(p) })

    expect(result.username).toBe('testuser')
    // Newest month first; within each month in API order (oldest → newest).
    expect(result.games).toEqual([...julyGames, ...juneGames])
    expect(result.cachedMonths).toEqual([])
    expect(result.stats).toEqual({ chess_rapid: { last: { rating: 1000, date: 1 } } })

    expect(events.map((e) => e.phase)).toEqual(['archives', 'months', 'months', 'stats', 'done'])
    const [, july, june, stats, done] = events
    expect(july).toMatchObject({
      monthsTotal: 2,
      monthsDone: 1,
      gamesSoFar: 2,
      currentMonth: '2026/07',
    })
    expect(june).toMatchObject({
      monthsTotal: 2,
      monthsDone: 2,
      gamesSoFar: 4,
      currentMonth: '2026/06',
    })
    expect(stats).toMatchObject({ monthsDone: 2, gamesSoFar: 4 })
    expect(done).toMatchObject({ phase: 'done', gamesSoFar: 4 })
  })

  it('keeps only the newest maxGames games, dropping the oldest', async () => {
    const { juneGames, julyGames, routes } = twoMonthRoutes()
    const { client: c } = client(routes)

    const result = await c.load('testuser', { maxGames: 3 })

    // July's 2 games + only the newest of June's 2 (last in API order).
    expect(result.games).toEqual([...julyGames, juneGames[1]])
  })

  it('stops fetching older months once maxGames is already collected', async () => {
    const { routes } = twoMonthRoutes()
    const { fn, client: c } = client(routes)

    const result = await c.load('testuser', { maxGames: 2 })

    expect(result.games).toHaveLength(2)
    const urls = fn.mock.calls.map((call) => String(call[0]))
    expect(urls).not.toContain(`${BASE}/testuser/games/2026/06`)
  })

  it('looks back at most maxMonths archives, newest first', async () => {
    const months = ['2026/04', '2026/05', '2026/06', '2026/07']
    const routes: Record<string, () => Response> = {
      ...archivesOf('testuser', months),
      [`${BASE}/testuser/stats`]: () => json({}),
    }
    for (const m of months) {
      routes[`${BASE}/testuser/games/${m}`] = () => json({ games: [game(m, 1)] })
    }
    const { fn, client: c } = client(routes)
    const events: FetchProgress[] = []

    const result = await c.load('testuser', { maxMonths: 2, onProgress: (p) => events.push(p) })

    expect(result.games.map((g) => g.url)).toEqual(['2026/07', '2026/06'])
    const urls = fn.mock.calls.map((call) => String(call[0]))
    expect(urls).not.toContain(`${BASE}/testuser/games/2026/05`)
    expect(urls).not.toContain(`${BASE}/testuser/games/2026/04`)
    expect(events.find((e) => e.phase === 'months')?.monthsTotal).toBe(2)
  })

  it('serves past months from cache on a second load but always refetches the current month', async () => {
    const { routes } = twoMonthRoutes()
    const store = createMemoryStore()
    const { fn, client: c } = client(routes, store)

    const first = await c.load('testuser')
    expect(first.cachedMonths).toEqual([])

    const second = await c.load('testuser')
    expect(second.cachedMonths).toEqual(['2026/06'])
    expect(second.games).toEqual(first.games)

    const urls = fn.mock.calls.map((call) => String(call[0]))
    const juneCalls = urls.filter((u) => u === `${BASE}/testuser/games/2026/06`)
    const julyCalls = urls.filter((u) => u === `${BASE}/testuser/games/2026/07`)
    expect(juneCalls).toHaveLength(1) // past month: fetched once, then cached
    expect(julyCalls).toHaveLength(2) // current month: always fresh
  })

  it('tolerates a stats fetch failure and returns {} for stats', async () => {
    const { routes } = twoMonthRoutes()
    routes[`${BASE}/testuser/stats`] = () => json({ error: 'oops' }, 500)
    const { client: c } = client(routes)

    const result = await c.load('testuser')

    expect(result.stats).toEqual({})
    expect(result.games).toHaveLength(4)
  })

  it('is unaffected by a KVStore whose get/set reject', async () => {
    const brokenStore: KVStore = {
      get: () => Promise.reject(new Error('idb exploded')),
      set: () => Promise.reject(new Error('idb exploded')),
    }
    const { routes } = twoMonthRoutes()
    const { client: c } = client(routes, brokenStore)

    const result = await c.load('testuser')

    expect(result.games).toHaveLength(4)
    expect(result.cachedMonths).toEqual([])
  })

  it('exposes InsightsError instances with friendly messages', async () => {
    const { client: c } = client({})
    const err = await c.load('ghostuser').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InsightsError)
    expect((err as InsightsError).message).toContain('ghostuser')
  })
})
