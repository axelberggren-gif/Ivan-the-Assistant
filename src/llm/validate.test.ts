import { describe, expect, it } from 'vitest'
import {
  MAX_COMMENT_LENGTH,
  MAX_ITEM_LENGTH,
  MAX_ITEMS,
  parseReasoningFeedback,
} from './validate'

const VALID = {
  goodPoints: ['You saw that f7 is the weak point.'],
  missed: ['The immediate Qxf7# is mate — no need for the bishop first.'],
  wrong: [],
  comment: 'Good instinct — now look for the fastest win.',
}

describe('parseReasoningFeedback', () => {
  it('accepts a valid feedback object', () => {
    const result = parseReasoningFeedback(JSON.stringify(VALID))
    expect(result).toEqual(VALID)
  })

  it('trims strings and drops items that trim to empty', () => {
    const result = parseReasoningFeedback(
      JSON.stringify({ ...VALID, goodPoints: ['  padded  ', '   '], comment: '  ok  ' }),
    )
    expect(result?.goodPoints).toEqual(['padded'])
    expect(result?.comment).toBe('ok')
  })

  it('caps overlong strings instead of rejecting them', () => {
    const result = parseReasoningFeedback(
      JSON.stringify({
        ...VALID,
        missed: ['x'.repeat(MAX_ITEM_LENGTH + 50)],
        comment: 'y'.repeat(MAX_COMMENT_LENGTH + 50),
      }),
    )
    expect(result?.missed[0].length).toBeLessThanOrEqual(MAX_ITEM_LENGTH)
    expect(result?.comment.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH)
  })

  it('returns null on non-JSON text', () => {
    expect(parseReasoningFeedback('not json at all')).toBeNull()
    expect(parseReasoningFeedback('')).toBeNull()
  })

  it('returns null on JSON that is not an object', () => {
    expect(parseReasoningFeedback('"a string"')).toBeNull()
    expect(parseReasoningFeedback('42')).toBeNull()
    expect(parseReasoningFeedback('null')).toBeNull()
    expect(parseReasoningFeedback('[1, 2]')).toBeNull()
  })

  it('returns null when a field is missing', () => {
    for (const field of ['goodPoints', 'missed', 'wrong', 'comment']) {
      const broken: Record<string, unknown> = { ...VALID }
      delete broken[field]
      expect(parseReasoningFeedback(JSON.stringify(broken))).toBeNull()
    }
  })

  it('returns null on wrong field types', () => {
    expect(
      parseReasoningFeedback(JSON.stringify({ ...VALID, goodPoints: 'not an array' })),
    ).toBeNull()
    expect(parseReasoningFeedback(JSON.stringify({ ...VALID, missed: [1, 2, 3] }))).toBeNull()
    expect(parseReasoningFeedback(JSON.stringify({ ...VALID, wrong: [{}] }))).toBeNull()
    expect(
      parseReasoningFeedback(JSON.stringify({ ...VALID, comment: ['array comment'] })),
    ).toBeNull()
  })

  it('returns null on oversized arrays', () => {
    const oversized = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `item ${i}`)
    expect(
      parseReasoningFeedback(JSON.stringify({ ...VALID, missed: oversized })),
    ).toBeNull()
  })

  it('accepts arrays exactly at the cap', () => {
    const atCap = Array.from({ length: MAX_ITEMS }, (_, i) => `item ${i}`)
    const result = parseReasoningFeedback(JSON.stringify({ ...VALID, missed: atCap }))
    expect(result?.missed).toEqual(atCap)
  })
})
