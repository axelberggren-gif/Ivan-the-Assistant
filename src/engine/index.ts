/**
 * Stockfish WASM engine wrapper (Web Worker, UCI protocol).
 *
 * Uses the single-threaded "lite" Stockfish 18 build served from
 * /engine/stockfish-18-lite-single.js (no COOP/COEP headers required).
 */
import type { AnalyzeOptions, EngineAnalysis, EngineAPI } from '../types'
import {
  infoToEngineLine,
  keepDeepestPerMultiPv,
  parseBestMoveLine,
  parseInfoLine,
  uciToSan,
  type ParsedInfo,
} from './uci'

const WORKER_URL = '/engine/stockfish-18-lite-single.js'

const DEFAULT_DEPTH = 14
const DEFAULT_MULTIPV = 3
const DEFAULT_OPPONENT_SKILL = 6
const DEFAULT_OPPONENT_MOVETIME_MS = 500
const FULL_STRENGTH_SKILL = 20

type LineListener = (line: string) => void

export function createEngine(): EngineAPI {
  let worker: Worker | null = null
  let initPromise: Promise<void> | null = null
  let disposed = false
  /** Serializes searches: one `go` in flight at a time. */
  let searchChain: Promise<unknown> = Promise.resolve()
  const listeners = new Set<LineListener>()

  function handleMessage(event: MessageEvent): void {
    const data = event.data
    if (typeof data !== 'string') return
    // Copy so a listener removing itself mid-dispatch is safe.
    for (const listener of [...listeners]) listener(data)
  }

  function send(command: string): void {
    if (!worker) throw new Error('engine not initialized (call init() first)')
    worker.postMessage(command)
  }

  /** Resolve when a worker line matches `predicate`. */
  function waitForLine(predicate: (line: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      if (disposed) {
        reject(new Error('engine disposed'))
        return
      }
      const listener: LineListener = (line) => {
        if (predicate(line)) {
          listeners.delete(listener)
          resolve(line)
        }
      }
      listeners.add(listener)
    })
  }

  function assertUsable(): void {
    if (disposed) throw new Error('engine disposed')
  }

  async function init(): Promise<void> {
    assertUsable()
    if (initPromise) return initPromise
    initPromise = (async () => {
      worker = new Worker(WORKER_URL) // classic worker — the build is not an ES module
      worker.onmessage = handleMessage
      const uciok = waitForLine((l) => l === 'uciok' || l.startsWith('uciok'))
      send('uci')
      await uciok
      const readyok = waitForLine((l) => l === 'readyok' || l.startsWith('readyok'))
      send('isready')
      await readyok
    })()
    initPromise.catch(() => {
      // Allow a retry after a failed init.
      initPromise = null
    })
    return initPromise
  }

  /** Queue a search job so only one `go` runs at a time. */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = searchChain.then(job, job)
    searchChain = run.catch(() => undefined)
    return run
  }

  /** Send `position` + `go`, collect info lines, resolve on `bestmove`. */
  async function runSearch(
    fen: string,
    goCommand: string,
  ): Promise<{ bestMoveUci: string; infos: Map<number, ParsedInfo> }> {
    const infos = new Map<number, ParsedInfo>()
    let bestMoveUci: string | null = null

    const done = waitForLine((line) => {
      const info = parseInfoLine(line)
      if (info) {
        keepDeepestPerMultiPv(infos, info)
        return false
      }
      const best = parseBestMoveLine(line)
      if (best !== null) {
        bestMoveUci = best
        return true
      }
      // `bestmove (none)` — no legal move (mate/stalemate position).
      return line.startsWith('bestmove')
    })

    send(`position fen ${fen}`)
    send(goCommand)
    await done

    if (bestMoveUci === null) {
      throw new Error(`engine returned no best move for fen: ${fen}`)
    }
    return { bestMoveUci, infos }
  }

  async function analyze(fen: string, opts: AnalyzeOptions = {}): Promise<EngineAnalysis> {
    assertUsable()
    await init()
    const depth = opts.depth ?? DEFAULT_DEPTH
    const multiPv = opts.multiPv ?? DEFAULT_MULTIPV

    return enqueue(async () => {
      assertUsable()
      send(`setoption name MultiPV value ${multiPv}`)
      const go =
        opts.movetimeMs !== undefined
          ? `go movetime ${Math.max(1, Math.round(opts.movetimeMs))}`
          : `go depth ${depth}`
      const { bestMoveUci, infos } = await runSearch(fen, go)

      const sorted = [...infos.values()].sort((a, b) => a.multiPv - b.multiPv)
      const lines = sorted.map((info) => infoToEngineLine(fen, info))
      const reachedDepth = sorted.reduce((max, i) => Math.max(max, i.depth), 0)

      return {
        fen,
        depth: reachedDepth || depth,
        bestMoveSan: uciToSan(fen, bestMoveUci) ?? '',
        bestMoveUci,
        lines,
      }
    })
  }

  async function opponentMove(
    fen: string,
    opts: { skillLevel?: number; movetimeMs?: number } = {},
  ): Promise<{ san: string; uci: string }> {
    assertUsable()
    await init()
    const skillLevel = opts.skillLevel ?? DEFAULT_OPPONENT_SKILL
    const movetimeMs = opts.movetimeMs ?? DEFAULT_OPPONENT_MOVETIME_MS

    return enqueue(async () => {
      assertUsable()
      send(`setoption name Skill Level value ${skillLevel}`)
      // Skill Level relies on MultiPV internally; a plain single-PV search is fine.
      send('setoption name MultiPV value 1')
      try {
        const { bestMoveUci } = await runSearch(
          fen,
          `go movetime ${Math.max(1, Math.round(movetimeMs))}`,
        )
        const san = uciToSan(fen, bestMoveUci)
        if (san === null) {
          throw new Error(`engine suggested illegal move ${bestMoveUci} for fen: ${fen}`)
        }
        return { san, uci: bestMoveUci }
      } finally {
        // Restore full strength so subsequent analyze() calls are accurate.
        if (!disposed && worker) send(`setoption name Skill Level value ${FULL_STRENGTH_SKILL}`)
      }
    })
  }

  function dispose(): void {
    disposed = true
    listeners.clear()
    if (worker) {
      worker.terminate()
      worker = null
    }
    initPromise = null
  }

  return { init, analyze, opponentMove, dispose }
}
