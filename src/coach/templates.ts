/**
 * Small deterministic template library for coach comments.
 *
 * Structure: classification "frames" (2-3 variants each, with {san}/{best}/
 * {reason}/{detail} slots) combined with per-reason-code phrases (2 variants
 * each). The variant is picked by `seed % variants.length`, where seed is the
 * history length — deterministic but varies across a game.
 */
import type { BookCheckResult, Classification, ReasonCode } from '../types'

const FRAMES: Record<string, string[]> = {
  book: [
    'Book move — {detail}',
    '{san} is theory here — {detail}',
    'Right on track: {san} is a known move — {detail}',
  ],
  good_ok: [
    'Solid — {reason}.',
    'Good move. {reason}.',
    '{san} works well; {reason}.',
  ],
  good_warn: [
    'Playable, but be careful — {reason}.',
    '{san} holds up, though {reason}.',
    'No damage done yet, but {reason}.',
  ],
  inaccuracy: [
    'A small slip: {reason}. {best} was more accurate.',
    '{san} is slightly imprecise — {reason}. Prefer {best}.',
    'Not the best — {reason}. {best} kept more for you.',
  ],
  mistake: [
    "That's a mistake: {reason}. {best} was the move.",
    '{san} really hurts — {reason}. You needed {best}.',
    'A clear error: {reason}. {best} was much stronger.',
  ],
  blunder: [
    'That loses: {reason}. {best} was required.',
    '{san} is a blunder — {reason}. {best} was the way to stay in the game.',
  ],
}

const REASON_PHRASES: Partial<Record<ReasonCode, string[]>> = {
  ok: ['you keep your position sound', 'your setup stays on course'],
  hangs_piece: ['it leaves a piece hanging', 'a piece is left undefended'],
  misses_tactic: [
    'there was a much stronger tactical shot available',
    'you missed a far stronger resource',
  ],
  loses_tempo: [
    "it wastes time you can't afford in the opening",
    'it hands your opponent a free tempo',
  ],
  moves_piece_twice: [
    'moving the same piece again costs development time',
    'that piece has already moved — bring out a new one instead',
  ],
  early_queen: [
    'the queen is out too early and becomes a target',
    'an early queen sortie lets your opponent develop with tempo by attacking it',
  ],
  blocks_development: [
    'it blocks one of your own pieces from developing',
    'it gets in the way of your own development',
  ],
  neglects_center: [
    'it ignores the fight for the center',
    'the center is going uncontested',
  ],
  weakens_king: [
    'it loosens the pawns around your king',
    'pawn moves like that expose your king',
  ],
  wrong_move_order: [
    'the move order gives your opponent extra options',
    'right idea, wrong order',
  ],
}

function pick(variants: string[], seed: number): string {
  return variants[Math.abs(seed) % variants.length]
}

function fill(template: string, slots: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function reasonPhrase(code: ReasonCode, seed: number): string {
  const variants = REASON_PHRASES[code] ?? REASON_PHRASES.ok!
  return pick(variants, seed)
}

/** Inline comment for a classified (non-book, non-trap) move. */
export function buildComment(
  classification: Exclude<Classification, 'book'>,
  primaryReason: ReasonCode,
  ctx: { san: string; best: string },
  seed: number,
): string {
  const frameKey =
    classification === 'good' ? (primaryReason === 'ok' ? 'good_ok' : 'good_warn') : classification
  const frame = pick(FRAMES[frameKey], seed)
  return fill(frame, {
    san: ctx.san,
    best: ctx.best,
    reason: reasonPhrase(primaryReason, seed),
  })
}

/** Inline comment for a book move, weaving in line name / idea when known. */
export function buildBookComment(san: string, book: BookCheckResult, seed: number): string {
  let detail: string
  if (book.lineName && book.idea) detail = `${book.lineName}: ${book.idea}`
  else if (book.lineName) detail = `that keeps you in the ${book.lineName}`
  else if (book.idea) detail = book.idea
  else detail = 'a solid theoretical choice'
  if (!/[.!?]$/.test(detail)) detail += '.'
  return fill(pick(FRAMES.book, seed), { san, detail })
}
