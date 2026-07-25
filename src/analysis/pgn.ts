/**
 * PGN movetext → SAN moves, and the "which games are worth analysing" filter.
 *
 * Pure (chess.js only): no fetch, no engine, no DOM.
 */
import { Chess } from 'chess.js'
import type { AnalysisGameInput, AnalysisBudget, SelectableGame } from './types'

/**
 * SAN moves from a full PGN (headers optional), start position, White first.
 *
 * chess.js's own PGN loader is the source of truth for legality, so clock and
 * eval annotations (`{[%clk 0:02:31.9]}`), NAGs and variations are stripped
 * before it runs. Returns `[]` when the movetext cannot be replayed — an
 * unparseable game is skipped, never a thrown error at the UI.
 */
export function parseGameMoves(pgn: string): string[] {
  const cleaned = stripAnnotations(pgn)
  try {
    const chess = new Chess()
    chess.loadPgn(cleaned)
    return chess.history()
  } catch {
    return []
  }
}

/**
 * Remove everything chess.js does not need from a PGN: comments (chess.com
 * puts per-move clocks there), recursive variations, and NAGs. Headers are
 * kept — a SetUp/FEN header would otherwise be lost.
 */
function stripAnnotations(pgn: string): string {
  const lines = pgn.split('\n')
  const headers: string[] = []
  const movetext: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('[') && line.endsWith(']')) headers.push(line)
    else movetext.push(raw)
  }
  const body = movetext
    .join(' ')
    .replace(/\{[^}]*\}/g, ' ') // comments (clock/eval annotations)
    .replace(/;[^\n]*/g, ' ') // rest-of-line comments
    .replace(/\([^()]*\)/g, ' ') // variations (one level is all chess.com emits)
    .replace(/\$\d+/g, ' ') // NAGs
    .replace(/\s+/g, ' ')
    .trim()
  return `${headers.join('\n')}\n\n${body}`
}

/**
 * Pick the games to analyse: rated standard games with a replayable PGN of at
 * least `minPlies`, newest first, capped at `maxGames`.
 *
 * Newest first matters — cancelling a run then leaves the user with the games
 * they care most about (ADR-0005 decision 4b).
 */
export function selectGamesForAnalysis(
  games: SelectableGame[],
  budget: Pick<AnalysisBudget, 'maxGames' | 'minPlies'>,
): AnalysisGameInput[] {
  const newestFirst = [...games].sort((a, b) => b.endTimeMs - a.endTimeMs)
  const picked: AnalysisGameInput[] = []

  for (const game of newestFirst) {
    if (picked.length >= budget.maxGames) break
    if (!game.rated) continue
    if (game.timeClass === 'daily') continue // correspondence: not how you actually play
    if (!game.pgn) continue
    const movesSan = parseGameMoves(game.pgn)
    if (movesSan.length < budget.minPlies) continue
    picked.push({
      id: game.url,
      movesSan,
      userColor: game.userColor,
      meta: {
        endTimeMs: game.endTimeMs,
        result: game.result,
        url: game.url,
        openingFamily: game.openingFamily,
        eco: game.eco,
        opponentUsername: game.opponentUsername,
      },
    })
  }

  return picked
}
