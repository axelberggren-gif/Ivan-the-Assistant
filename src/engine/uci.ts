/**
 * Pure UCI-protocol helpers for the Stockfish engine module.
 *
 * No Worker/DOM dependencies — everything here is unit-testable in Node.
 */
import { Chess } from 'chess.js'
import type { EngineLine } from '../types'

/** A parsed `info ... pv ...` line, scores still from the side-to-move view. */
export interface ParsedInfo {
  depth: number
  multiPv: number
  /** Score as reported by the engine (side-to-move perspective) */
  score: { type: 'cp' | 'mate'; value: number }
  /** Principal variation as UCI moves */
  pvUci: string[]
}

/**
 * Parse a UCI `info` line into its useful parts.
 * Returns null for lines that are not eval lines (no `score` + `pv`),
 * e.g. `info string ...`, currmove updates, or `bestmove ...`.
 */
export function parseInfoLine(line: string): ParsedInfo | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'info') return null

  let depth = 0
  let multiPv = 1
  let score: ParsedInfo['score'] | null = null
  let pvUci: string[] | null = null

  for (let i = 1; i < tokens.length; i++) {
    switch (tokens[i]) {
      case 'depth':
        depth = parseInt(tokens[++i], 10)
        break
      case 'multipv':
        multiPv = parseInt(tokens[++i], 10)
        break
      case 'score': {
        const kind = tokens[++i]
        const value = parseInt(tokens[++i], 10)
        if ((kind === 'cp' || kind === 'mate') && Number.isFinite(value)) {
          score = { type: kind, value }
        }
        break
      }
      case 'pv':
        // Everything after `pv` is the move list.
        pvUci = tokens.slice(i + 1)
        i = tokens.length
        break
      default:
        break
    }
  }

  if (!score || !pvUci || pvUci.length === 0) return null
  if (!Number.isFinite(depth) || !Number.isFinite(multiPv)) return null
  return { depth, multiPv, score, pvUci }
}

/** Parse the `bestmove <uci> [ponder <uci>]` line. Returns null otherwise. */
export function parseBestMoveLine(line: string): string | null {
  const m = line.trim().match(/^bestmove\s+(\S+)/)
  if (!m || m[1] === '(none)') return null
  return m[1]
}

/** Side to move from a FEN string ('w' or 'b'). Defaults to 'w' if malformed. */
export function sideToMove(fen: string): 'w' | 'b' {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'
}

/**
 * Convert an engine score (side-to-move perspective) to White's perspective,
 * as required by the EngineLine contract.
 */
export function scoreToWhitePerspective(
  score: { type: 'cp' | 'mate'; value: number },
  fen: string,
): { cp?: number; mate?: number } {
  const sign = sideToMove(fen) === 'b' ? -1 : 1
  if (score.type === 'cp') return { cp: sign * score.value }
  return { mate: sign * score.value }
}

/**
 * Convert a single UCI move (e.g. "e2e4", "e7e8q", "e1g1") to SAN by playing
 * it on `chess`. Returns null (without mutating on failure) if illegal.
 */
export function applyUciMove(chess: Chess, uci: string): string | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null
  try {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length === 5 ? uci[4] : undefined,
    })
    return move ? move.san : null
  } catch {
    return null
  }
}

/**
 * Convert a PV of UCI moves to SAN, replaying from `fen`.
 * Stops cleanly at the first illegal move; the returned arrays are truncated
 * consistently so pvSan[i] always corresponds to pvUci[i].
 */
export function pvToSan(fen: string, pvUci: string[]): { pvSan: string[]; pvUci: string[] } {
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return { pvSan: [], pvUci: [] }
  }
  const pvSan: string[] = []
  for (const uci of pvUci) {
    const san = applyUciMove(chess, uci)
    if (san === null) break
    pvSan.push(san)
  }
  return { pvSan, pvUci: pvUci.slice(0, pvSan.length) }
}

/** Convert one UCI move in `fen` to SAN, or null if illegal. */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    return applyUciMove(new Chess(fen), uci)
  } catch {
    return null
  }
}

/**
 * Build a contract-conformant EngineLine from a parsed info line:
 * SAN conversion plus perspective flip to White's point of view.
 */
export function infoToEngineLine(fen: string, info: ParsedInfo): EngineLine {
  const { pvSan, pvUci } = pvToSan(fen, info.pvUci)
  return { pvSan, pvUci, ...scoreToWhitePerspective(info.score, fen) }
}

/**
 * Reduce a stream of parsed info lines to the best (deepest, latest) entry
 * per MultiPV index. Later entries at equal-or-greater depth win.
 */
export function keepDeepestPerMultiPv(
  best: Map<number, ParsedInfo>,
  info: ParsedInfo,
): void {
  const prev = best.get(info.multiPv)
  if (!prev || info.depth >= prev.depth) best.set(info.multiPv, info)
}
