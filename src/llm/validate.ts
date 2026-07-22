/**
 * Structural validation of the reasoning coach's JSON reply (ADR-0003:
 * "structured JSON validated before rendering").
 *
 * Pure module: no SDK, no DOM — unit-testable in Node (validate.test.ts).
 * Even with structured outputs the model's text is untrusted; anything that
 * does not match ReasoningFeedback exactly returns null, and the caller
 * degrades to the engine-line reveal.
 */
import type { ReasoningFeedback } from '../types'

/** Max items kept per feedback array — more than this is an unusable answer. */
export const MAX_ITEMS = 6
/** Max length of a single goodPoints/missed/wrong item (truncated, not rejected). */
export const MAX_ITEM_LENGTH = 400
/** Max length of the closing comment (truncated, not rejected). */
export const MAX_COMMENT_LENGTH = 2000

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Returns the cleaned string array, or null if the value is not one. */
function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null
  if (!value.every((item): item is string => typeof item === 'string')) return null
  return value.map((item) => truncate(item, MAX_ITEM_LENGTH)).filter((item) => item.length > 0)
}

/**
 * JSON.parse + structural validation of the model's reply.
 * Null on anything invalid — the caller falls back to engine-only feedback.
 */
export function parseReasoningFeedback(text: string): ReasoningFeedback | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>

  const goodPoints = cleanStringArray(record.goodPoints)
  const missed = cleanStringArray(record.missed)
  const wrong = cleanStringArray(record.wrong)
  if (goodPoints === null || missed === null || wrong === null) return null

  if (typeof record.comment !== 'string') return null
  const comment = truncate(record.comment, MAX_COMMENT_LENGTH)

  return { goodPoints, missed, wrong, comment }
}
