import type { Color, EngineAnalysis, EngineLine } from '../types'

/** Mate scores are mapped to ±(MATE_CP - distance) centipawns. */
export const MATE_CP = 10000

/**
 * Centipawn value of an engine line from WHITE's perspective.
 * Mate in N for White → MATE_CP - N; mate in N against White → -(MATE_CP - N).
 */
export function lineCpWhite(line: EngineLine): number {
  if (line.mate !== undefined) {
    return line.mate > 0 ? MATE_CP - line.mate : -(MATE_CP - Math.abs(line.mate))
  }
  return line.cp ?? 0
}

/** Convert a White-perspective cp value to the user's perspective. */
export function toUserCp(cpWhite: number, userColor: Color): number {
  return userColor === 'white' ? cpWhite : -cpWhite
}

/** Best line's evaluation from the user's perspective (0 if no lines). */
export function bestLineUserCp(analysis: EngineAnalysis, userColor: Color): number {
  const line = analysis.lines[0]
  if (!line) return 0
  return toUserCp(lineCpWhite(line), userColor)
}

/**
 * Centipawns lost by the user's move: best eval before the move minus eval
 * after the move, both converted to the user's perspective, clamped at >= 0.
 */
export function computeCpLoss(
  evalBefore: EngineAnalysis,
  evalAfter: EngineAnalysis,
  userColor: Color,
): number {
  const before = bestLineUserCp(evalBefore, userColor)
  const after = bestLineUserCp(evalAfter, userColor)
  return Math.max(0, before - after)
}
