/**
 * Solve-phase move logic: UCI↔SAN conversion for problem lines and the
 * Lichess solution-matching rule (PLAN §8.1) — the authored solution move is
 * required, but any move that delivers immediate checkmate also counts.
 *
 * Pure and Node-testable: chess.js only, no fetch, no DOM, no engine calls.
 * Centipawns stay White-perspective; user-perspective conversion happens
 * only via src/coach/eval helpers.
 */
import { Chess } from 'chess.js'
import type { Color, EngineAnalysis, EngineLine, EngineLineSummary } from '../types'
import { toUserCp } from '../coach/eval'

/** Plies of principal variation kept in an EngineLineSummary. */
const SUMMARY_MAX_PLIES = 6

interface UciParts {
  from: string
  to: string
  promotion?: string
}

/** "e7e8q" → { from: 'e7', to: 'e8', promotion: 'q' } (case-normalized). */
function parseUci(uci: string): UciParts {
  const normalized = uci.trim().toLowerCase()
  const parts: UciParts = { from: normalized.slice(0, 2), to: normalized.slice(2, 4) }
  if (normalized.length > 4) parts.promotion = normalized.slice(4, 5)
  return parts
}

/** Canonical form for equality checks (lowercase, incl. promotion piece). */
function normalizeUci(uci: string): string {
  const { from, to, promotion } = parseUci(uci)
  return from + to + (promotion ?? '')
}

/**
 * Format a SAN line as numbered chess notation, starting from `fen` so the
 * move numbers and the leading side-to-move are correct — e.g. from a Black-to-
 * move position at move 23, ['Nxe5','Nxe5','Qxe5'] → "23...Nxe5 24.Nxe5 Qxe5".
 *
 * Pure string work over the FEN header (side to move + fullmove number); the
 * SAN tokens are taken as-is (the caller produced them from chess.js, so they
 * are already legal and canonical). Used to paste a tried line into the user's
 * reasoning notes so they only have to add the "why".
 */
export function formatSanLine(fen: string, sanMoves: string[]): string {
  if (sanMoves.length === 0) return ''
  const fields = fen.split(' ')
  let whiteToMove = fields[1] !== 'b'
  let fullmove = Number.parseInt(fields[5] ?? '1', 10)
  if (!Number.isFinite(fullmove) || fullmove < 1) fullmove = 1

  const out: string[] = []
  let first = true
  for (const san of sanMoves) {
    if (whiteToMove) {
      out.push(`${fullmove}.${san}`)
    } else {
      // A Black move that opens the line needs the "23..." ellipsis; a Black
      // move following White's just trails it.
      out.push(first ? `${fullmove}...${san}` : san)
      fullmove++
    }
    whiteToMove = !whiteToMove
    first = false
  }
  return out.join(' ')
}

/** Apply a UCI move in `fen` and return its SAN; null if illegal (or bad FEN). */
export function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen)
    return chess.move(parseUci(uci)).san
  } catch {
    return null
  }
}

/**
 * Convert a UCI sequence starting from `fen` to SAN, stopping at the first
 * illegal move (the returned array may be shorter than the input).
 */
export function sanLineFromUci(fen: string, ucis: string[]): string[] {
  const sans: string[] = []
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return sans
  }
  for (const uci of ucis) {
    try {
      sans.push(chess.move(parseUci(uci)).san)
    } catch {
      break
    }
  }
  return sans
}

/**
 * Lichess matching semantics (PLAN §8.1): the played move is correct when it
 * is the authored solution move, OR when it delivers immediate checkmate —
 * any mate counts. Promotion-piece case is normalized before comparing.
 */
export function isSolutionMove(fen: string, playedUci: string, expectedUci: string): boolean {
  if (normalizeUci(playedUci) === normalizeUci(expectedUci)) return true
  try {
    const chess = new Chess(fen)
    chess.move(parseUci(playedUci))
    return chess.isCheckmate()
  } catch {
    return false
  }
}

/** "mate in 2" / "gets mated in 3" / "+2.3" / "-0.5" — user's perspective. */
function evalTextForUser(line: EngineLine, userColor: Color): string {
  if (line.mate !== undefined) {
    const userMate = toUserCp(line.mate, userColor)
    return userMate > 0 ? `mate in ${userMate}` : `gets mated in ${Math.abs(userMate)}`
  }
  const userPawns = toUserCp(line.cp ?? 0, userColor) / 100
  const sign = userPawns >= 0 ? '+' : '-'
  return `${sign}${Math.abs(userPawns).toFixed(1)}`
}

/**
 * Summarize the engine's top lines for prose feedback (reasoning-coach input
 * and the no-key self-check reveal): trimmed pv + eval text from the USER's
 * perspective.
 */
export function engineLineSummaries(
  analysis: EngineAnalysis,
  userColor: Color,
  max = 3,
): EngineLineSummary[] {
  return analysis.lines.slice(0, max).map((line) => ({
    san: line.pvSan.slice(0, SUMMARY_MAX_PLIES),
    evalText: evalTextForUser(line, userColor),
  }))
}
