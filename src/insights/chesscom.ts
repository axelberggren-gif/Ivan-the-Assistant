import { InsightsError } from './types'
import type {
  ArchiveMonth,
  ChesscomClient,
  ChesscomGame,
  ChesscomMonth,
  ChesscomStats,
  FetchProgress,
  KVStore,
  LoadOptions,
  LoadResult,
} from './types'
import { createIndexedDbStore } from './cache'

/**
 * chess.com public API client (https://api.chess.com/pub/... — no auth).
 *
 * NOTE: browsers forbid setting the User-Agent header on fetch; the API
 * works from the browser without it, so we never attempt to set headers.
 *
 * Returned games are ordered newest month first; within each month they
 * stay in the API's order (oldest → newest), matching the LoadResult
 * contract. When maxGames truncates the list, the OLDEST games are dropped.
 */

const API_BASE = 'https://api.chess.com/pub/player'

const DEFAULT_MAX_GAMES = 300
const DEFAULT_MAX_MONTHS = 12

interface ClientDeps {
  fetchFn?: typeof fetch
  store?: KVStore
  now?: () => Date
}

interface MonthChunk {
  month: ArchiveMonth
  games: ChesscomGame[]
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** "https://.../games/2026/07" → "2026/07" (undefined when malformed) */
function monthOfArchiveUrl(url: string): ArchiveMonth | undefined {
  const match = /(\d{4}\/\d{2})\/?$/.exec(url)
  return match?.[1]
}

/** The current calendar month per `now`, in UTC, as "YYYY/MM" */
function currentMonthUtc(now: Date): ArchiveMonth {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}/${month}`
}

/** Create a chess.com API client. All deps are injectable for tests. */
export function createChesscomClient(deps: ClientDeps = {}): ChesscomClient {
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis)
  const store = deps.store ?? createIndexedDbStore()
  const now = deps.now ?? (() => new Date())

  /** Cache access is best-effort — a broken store must never fail a load. */
  const cacheGet = async <T>(key: string): Promise<T | undefined> => {
    try {
      return await store.get<T>(key)
    } catch {
      return undefined
    }
  }
  const cacheSet = async <T>(key: string, value: T): Promise<void> => {
    try {
      await store.set(key, value)
    } catch {
      // caching is an optimization, never a failure source
    }
  }

  const fetchJson = async (
    url: string,
    signal: AbortSignal | undefined,
    notFoundMessage?: string,
  ): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchFn(url, { signal })
    } catch (err) {
      if (isAbortError(err)) {
        throw new InsightsError('aborted', 'The request was cancelled.')
      }
      throw new InsightsError(
        'network',
        'Could not reach chess.com — check your connection and try again.',
      )
    }
    if (response.status === 404 && notFoundMessage) {
      throw new InsightsError('not_found', notFoundMessage)
    }
    if (!response.ok) {
      throw new InsightsError(
        'bad_response',
        `chess.com responded with an unexpected status (${response.status}).`,
      )
    }
    try {
      return await response.json()
    } catch {
      throw new InsightsError('bad_response', 'chess.com returned malformed data.')
    }
  }

  const load = async (username: string, opts: LoadOptions = {}): Promise<LoadResult> => {
    const user = username.trim().toLowerCase()
    const maxGames = opts.maxGames ?? DEFAULT_MAX_GAMES
    const maxMonths = opts.maxMonths ?? DEFAULT_MAX_MONTHS
    const { onProgress, signal } = opts

    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new InsightsError('aborted', 'The request was cancelled.')
      }
    }
    const progress = (p: FetchProgress) => onProgress?.(p)

    // -- archives ------------------------------------------------------------
    throwIfAborted()
    progress({ phase: 'archives', monthsTotal: 0, monthsDone: 0, gamesSoFar: 0 })
    const archivesJson = (await fetchJson(
      `${API_BASE}/${user}/games/archives`,
      signal,
      `No chess.com player named "${user}" was found — check the spelling.`,
    )) as { archives?: unknown }
    if (!archivesJson || !Array.isArray(archivesJson.archives)) {
      throw new InsightsError('bad_response', 'chess.com returned malformed data.')
    }

    // Archive URLs come oldest → newest; iterate newest first.
    const months = (archivesJson.archives as string[])
      .map(monthOfArchiveUrl)
      .filter((m): m is ArchiveMonth => m !== undefined)
      .reverse()
      .slice(0, maxMonths)

    // -- months --------------------------------------------------------------
    const currentMonth = currentMonthUtc(now())
    const monthsTotal = months.length
    const chunks: MonthChunk[] = []
    const cachedMonths: ArchiveMonth[] = []
    let gamesSoFar = 0
    let monthsDone = 0

    for (const month of months) {
      if (gamesSoFar >= maxGames) break
      throwIfAborted()

      const cacheKey = `games:${user}:${month}`
      let games: ChesscomGame[] | undefined

      // Months strictly before the current calendar month are immutable.
      if (month !== currentMonth) {
        games = await cacheGet<ChesscomGame[]>(cacheKey)
        if (games) cachedMonths.push(month)
      }

      if (!games) {
        const monthJson = (await fetchJson(
          `${API_BASE}/${user}/games/${month}`,
          signal,
        )) as ChesscomMonth | null
        if (!monthJson || !Array.isArray(monthJson.games)) {
          throw new InsightsError('bad_response', 'chess.com returned malformed data.')
        }
        games = monthJson.games
        await cacheSet(cacheKey, games)
      }

      chunks.push({ month, games })
      gamesSoFar += games.length
      monthsDone += 1
      progress({ phase: 'months', monthsTotal, monthsDone, gamesSoFar, currentMonth: month })
    }

    // Keep only the newest maxGames games. Chunks are newest month first and
    // each month's games are oldest → newest, so trim from the tail of the
    // oldest kept chunk and drop anything older.
    const kept: MonthChunk[] = []
    let budget = maxGames
    for (const chunk of chunks) {
      if (budget <= 0) break
      const games =
        chunk.games.length <= budget ? chunk.games : chunk.games.slice(chunk.games.length - budget)
      kept.push({ month: chunk.month, games })
      budget -= games.length
    }
    const games = kept.flatMap((chunk) => chunk.games)

    // -- stats ---------------------------------------------------------------
    throwIfAborted()
    progress({ phase: 'stats', monthsTotal, monthsDone, gamesSoFar: games.length })
    let stats: ChesscomStats = {}
    try {
      const statsJson = await fetchJson(`${API_BASE}/${user}/stats`, signal)
      if (statsJson && typeof statsJson === 'object') stats = statsJson as ChesscomStats
    } catch (err) {
      if (err instanceof InsightsError && err.kind === 'aborted') throw err
      // Stats are display-only garnish — games are the core payload.
    }

    progress({ phase: 'done', monthsTotal, monthsDone, gamesSoFar: games.length })
    return { username: user, games, stats, cachedMonths }
  }

  return { load }
}
