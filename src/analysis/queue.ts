/**
 * The batch scheduler: cache lookup, progress + ETA, cancel, incremental
 * commit, and the deep re-check of the worst moments.
 *
 * Owns its own engine instance (ADR-0005 decision 1): created lazily on the
 * first genuinely uncached game, disposed the moment the run ends or is
 * cancelled, so the interactive engine is never parked behind a batch. A
 * fully-cached run never starts a worker at all.
 */
import type { EngineAPI } from '../types'
import { annotateGame, budgetSignature, resolveBudget, verifyMove } from './annotate'
import type {
  AnalysisCache,
  AnalysisDeps,
  AnalysisGameInput,
  AnalysisProgress,
  AnalysisQueue,
  AnalysisRunResult,
  AnnotatedGame,
  RunOptions,
} from './types'

/** Cached annotations live forever under a budget-signed key. */
function cacheKey(signature: string, gameId: string): string {
  return `analysis:${signature}:${gameId}`
}

/** A cached value is only trusted when it still matches the current budget. */
function isUsableCacheHit(value: unknown, signature: string): value is AnnotatedGame {
  if (typeof value !== 'object' || value === null) return false
  const game = value as Partial<AnnotatedGame>
  return (
    game.signature === signature &&
    Array.isArray(game.moves) &&
    typeof game.id === 'string' &&
    typeof game.development === 'object' &&
    game.development !== null
  )
}

async function readCache(
  cache: AnalysisCache,
  key: string,
  signature: string,
): Promise<AnnotatedGame | undefined> {
  try {
    const value = await cache.get<unknown>(key)
    return isUsableCacheHit(value, signature) ? value : undefined
  } catch {
    return undefined // the cache is an optimization, never a failure source
  }
}

async function writeCache(cache: AnalysisCache, key: string, game: AnnotatedGame): Promise<void> {
  try {
    await cache.set(key, game)
  } catch {
    /* storage full / private mode — the run is still valid, just not cached */
  }
}

export function createAnalysisQueue(deps: AnalysisDeps): AnalysisQueue {
  const now = deps.now ?? (() => Date.now())

  return {
    async run(games: AnalysisGameInput[], opts: RunOptions = {}): Promise<AnalysisRunResult> {
      const budget = resolveBudget(opts.budget)
      const signature = budgetSignature(budget)
      // Newest first is the caller's ordering (see selectGamesForAnalysis) —
      // preserved here so a cancel leaves the most recent games analysed.
      const scoped = games.slice(0, budget.maxGames)

      const results: AnnotatedGame[] = []
      /** Wall-clock per GENUINELY analysed game — cached games must not skew the ETA. */
      const durations: number[] = []
      let aborted = false

      const progress: AnalysisProgress = {
        phase: 'analysing',
        gamesTotal: scoped.length,
        gamesDone: 0,
        gamesCached: 0,
        pliesDone: 0,
        pliesTotal: 0,
        etaMs: null,
      }
      const emit = () => opts.onProgress?.({ ...progress })

      /**
       * Remaining time from the rolling mean of analysed games, refined by how
       * far into the current game we are. Null until one game has actually been
       * analysed — a re-run over a warm cache must not promise "12 seconds" and
       * then take four minutes (ADR-0005 decision 4b).
       */
      const estimate = (): number | null => {
        if (durations.length === 0) return null
        const meanMs = durations.reduce((sum, d) => sum + d, 0) / durations.length
        const remaining = progress.gamesTotal - progress.gamesDone
        if (remaining <= 0) return 0
        // `pliesTotal` is zeroed between games, so a finished game's progress
        // never counts toward the next one.
        const currentFraction =
          progress.pliesTotal > 0 ? Math.min(1, progress.pliesDone / progress.pliesTotal) : 0
        return meanMs * (remaining - currentFraction)
      }

      /** Between games there is no game in flight — clear the ply counters. */
      const finishGame = () => {
        progress.gamesDone++
        progress.pliesDone = 0
        progress.pliesTotal = 0
        progress.etaMs = estimate()
        emit()
      }

      // Held in an object rather than a plain `let` so the assignment inside
      // ensureEngine() is visible to the type checker in the finally block.
      const batch: { engine: EngineAPI | null } = { engine: null }
      const ensureEngine = async (): Promise<EngineAPI> => {
        if (!batch.engine) {
          const created = deps.createEngine()
          await created.init()
          batch.engine = created
        }
        return batch.engine
      }

      const commit = (game: AnnotatedGame) => {
        results.push(game)
        opts.onGame?.(game)
      }

      try {
        for (const game of scoped) {
          if (opts.signal?.aborted) {
            aborted = true
            break
          }

          progress.currentGameId = game.id
          progress.pliesDone = 0
          progress.pliesTotal = Math.min(game.movesSan.length, budget.plyCap) + 1
          emit()

          const key = cacheKey(signature, game.id)
          const cached = await readCache(deps.cache, key, signature)
          if (cached) {
            progress.gamesCached++
            commit(cached)
            finishGame()
            continue
          }

          const startedAt = now()
          const annotated = await annotateGame(game, await ensureEngine(), {
            budget,
            signal: opts.signal,
            onPly: (done, total) => {
              progress.pliesDone = done
              progress.pliesTotal = total
              progress.etaMs = estimate()
              emit()
            },
          })

          if (annotated.truncated === 'aborted') {
            // Keep whatever it managed to judge, but never cache a partial game.
            aborted = true
            if (annotated.moves.length > 0) commit(annotated)
            break
          }

          durations.push(now() - startedAt)
          await writeCache(deps.cache, key, annotated)
          commit(annotated)
          finishGame()
        }

        // Deep re-check: the headline findings must not be artefacts of a 150ms
        // search, so the worst moves are re-judged at full depth before they
        // are shown.
        if (!aborted && !opts.signal?.aborted && budget.verifyTopN > 0) {
          progress.phase = 'verifying'
          progress.etaMs = null
          emit()
          const changed = await verifyWorstMoments(results, scoped, await ensureEngine(), {
            depth: budget.verifyDepth,
            multiPv: budget.multiPv,
            topN: budget.verifyTopN,
            signal: opts.signal,
          })
          for (const game of changed) {
            await writeCache(deps.cache, cacheKey(signature, game.id), game)
            opts.onGame?.(game)
          }
        }
      } finally {
        // +128 MB of WASM linear memory goes back the moment this runs.
        batch.engine?.dispose()
      }

      progress.phase = 'done'
      progress.etaMs = 0
      emit()
      return { games: results, aborted: aborted || Boolean(opts.signal?.aborted) }
    },
  }
}

/**
 * Re-judge the `topN` worst mistakes/blunders across the run at full depth,
 * mutating the annotated games in place. Returns the games that changed so the
 * caller can re-cache and re-commit them.
 */
async function verifyWorstMoments(
  results: AnnotatedGame[],
  inputs: AnalysisGameInput[],
  engine: EngineAPI,
  opts: { depth: number; multiPv: number; topN: number; signal?: AbortSignal },
): Promise<AnnotatedGame[]> {
  const candidates = results
    .flatMap((game) =>
      game.moves
        .filter(
          (move) =>
            !move.verified &&
            (move.classification === 'mistake' || move.classification === 'blunder'),
        )
        .map((move) => ({ game, move })),
    )
    .sort((a, b) => b.move.cpLoss - a.move.cpLoss)
    .slice(0, opts.topN)

  const movesById = new Map(inputs.map((input) => [input.id, input.movesSan]))
  const changed = new Set<AnnotatedGame>()

  for (const { game, move } of candidates) {
    if (opts.signal?.aborted) break
    const history = movesById.get(game.id)?.slice(0, move.ply + 1)
    const verified = await verifyMove(move, engine, {
      depth: opts.depth,
      multiPv: opts.multiPv,
      signal: opts.signal,
      ...(history ? { historySan: history } : {}),
    })
    const index = game.moves.indexOf(move)
    if (index >= 0) {
      game.moves[index] = verified
      changed.add(game)
    }
  }

  return [...changed]
}
