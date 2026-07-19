import { describe, expect, it } from 'vitest'

import type { Opening, TrickLine } from '../types'
import { createBook } from './index'

// ---------------------------------------------------------------------------
// Fixtures — small fake openings. Move legality is NOT this module's concern.
// ---------------------------------------------------------------------------

const trap: TrickLine = {
  severity: 'losing',
  // Shares the ["e4","e5"] prefix with the mainline, then diverges with Qh5
  // (bait move: after `moves` it is the user's turn).
  moves: ['e4', 'e5', 'Qh5'],
  name: 'Scholar Trap Line',
  ideas: { 2: 'Eyes the f7 square' },
  trapId: 'scholars-mate',
  wrongReply: 'Nf6',
  punishment: ['Qxe5+', 'Be7', 'Qxg7'],
  explanation: 'Nf6 attacks the queen but drops e5 and then the rook.',
  fix: 'Nc6 defends e5 while developing.',
  fixMove: 'Nc6',
}

const italianish: Opening = {
  id: 'italianish',
  name: 'Italian-ish',
  eco: 'C50',
  userColor: 'white',
  description: 'Fixture opening',
  mainlines: [
    {
      moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
      name: 'Main Line A',
      ideas: { 0: 'Grab the center', 2: 'Develop and hit e5', 4: 'Aim at f7' },
    },
    {
      moves: ['e4', 'e5', 'Nf3', 'Nf6'],
      name: 'Petroff Sideline',
    },
  ],
  trickLines: [trap],
}

const other: Opening = {
  id: 'other',
  name: 'Other Opening',
  eco: 'A00',
  userColor: 'black',
  description: 'Second fixture',
  mainlines: [{ moves: ['d4', 'd5'], name: 'Queen Pawn' }],
  trickLines: [],
}

const book = createBook([italianish, other])

// ---------------------------------------------------------------------------

describe('createBook', () => {
  it('exposes openings and getOpening', () => {
    expect(book.openings).toEqual([italianish, other])
    expect(book.getOpening('other')).toBe(other)
    expect(book.getOpening('nope')).toBeUndefined()
  })

  describe('continuations', () => {
    it('returns the first moves at the empty history', () => {
      const moves = book.continuations('italianish', [])
      expect(moves).toHaveLength(1)
      expect(moves[0]).toMatchObject({
        san: 'e4',
        kind: 'mainline',
        weight: 3,
        idea: 'Grab the center',
      })
    })

    it('returns deduped known moves mid-line, including divergences', () => {
      const moves = book.continuations('italianish', ['e4', 'e5'])
      const sans = moves.map((m) => m.san).sort()
      expect(sans).toEqual(['Nf3', 'Qh5'])

      const nf3 = moves.find((m) => m.san === 'Nf3')!
      expect(nf3).toMatchObject({ kind: 'mainline', weight: 3, idea: 'Develop and hit e5' })
      // Nf3 appears in two mainlines but is deduped to one option.

      const qh5 = moves.find((m) => m.san === 'Qh5')!
      expect(qh5).toMatchObject({
        kind: 'trick',
        weight: 2,
        idea: 'Eyes the f7 square',
        trapId: 'scholars-mate',
      })
    })

    it('keeps mainline kind and weight 3 when a move is both mainline and trick, but keeps trick metadata', () => {
      // e4 and e5 are shared by the mainlines and the trick line's prefix.
      const first = book.continuations('italianish', [])
      expect(first[0]).toMatchObject({
        san: 'e4',
        kind: 'mainline',
        weight: 3,
        trapId: 'scholars-mate', // noted from the trick line
      })
    })

    it('returns empty past the end of a line, for unknown histories, and for unknown openings', () => {
      expect(book.continuations('italianish', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])).toEqual([])
      expect(book.continuations('italianish', ['a3'])).toEqual([])
      expect(book.continuations('ghost', [])).toEqual([])
    })

    it('does not leak lines across openings', () => {
      const moves = book.continuations('other', [])
      expect(moves.map((m) => m.san)).toEqual(['d4'])
    })
  })

  describe('check', () => {
    it('finds an in-book move with its idea and line name', () => {
      expect(book.check('italianish', ['e4', 'e5', 'Nf3', 'Nc6'], 'Bc4')).toEqual({
        inBook: true,
        idea: 'Aim at f7',
        lineName: 'Main Line A',
      })
    })

    it('finds in-book moves without ideas', () => {
      expect(book.check('italianish', ['e4', 'e5', 'Nf3'], 'Nf6')).toEqual({
        inBook: true,
        lineName: 'Petroff Sideline',
      })
    })

    it('rejects out-of-book moves and unknown openings', () => {
      expect(book.check('italianish', ['e4', 'e5'], 'f4')).toEqual({ inBook: false })
      expect(book.check('italianish', ['h4'], 'e5')).toEqual({ inBook: false })
      expect(book.check('ghost', [], 'e4')).toEqual({ inBook: false })
    })
  })

  describe('matchTrap', () => {
    it('matches moves + [wrongReply] exactly', () => {
      expect(book.matchTrap('italianish', ['e4', 'e5', 'Qh5', 'Nf6'])).toBe(trap)
    })

    it('does not match the bait prefix without the wrong reply', () => {
      expect(book.matchTrap('italianish', ['e4', 'e5', 'Qh5'])).toBeUndefined()
    })

    it('does not match when the last move differs from wrongReply', () => {
      expect(book.matchTrap('italianish', ['e4', 'e5', 'Qh5', 'Nc6'])).toBeUndefined()
    })

    it('does not match a longer history or an unknown opening', () => {
      expect(
        book.matchTrap('italianish', ['e4', 'e5', 'Qh5', 'Nf6', 'Qxe5+']),
      ).toBeUndefined()
      expect(book.matchTrap('ghost', ['e4', 'e5', 'Qh5', 'Nf6'])).toBeUndefined()
    })
  })
})
