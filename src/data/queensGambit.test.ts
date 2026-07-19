import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { queensGambit } from './queensGambit'

/** Replay SAN moves from the start; throws (failing the test) on an illegal move. */
function replay(moves: string[]): Chess {
  const chess = new Chess()
  for (const san of moves) {
    expect(() => chess.move(san), `illegal move '${san}' after: ${chess.history().join(' ')}`).not.toThrow()
  }
  return chess
}

describe('queensGambit opening data', () => {
  it('has the expected identity', () => {
    expect(queensGambit.id).toBe('queens-gambit')
    expect(queensGambit.userColor).toBe('white')
    expect(queensGambit.mainlines.length).toBeGreaterThanOrEqual(5)
    expect(queensGambit.trickLines.length).toBeGreaterThanOrEqual(3)
  })

  describe('mainlines', () => {
    for (const line of queensGambit.mainlines) {
      it(`${line.name ?? 'unnamed'} replays legally from the start`, () => {
        replay(line.moves)
      })

      it(`${line.name ?? 'unnamed'} idea indices point at real moves`, () => {
        for (const key of Object.keys(line.ideas ?? {})) {
          const idx = Number(key)
          expect(Number.isInteger(idx)).toBe(true)
          expect(idx).toBeGreaterThanOrEqual(0)
          expect(idx).toBeLessThan(line.moves.length)
        }
      })
    }
  })

  describe('trickLines', () => {
    for (const trap of queensGambit.trickLines) {
      describe(trap.trapId, () => {
        it('moves are legal and leave the user (White) to move', () => {
          const chess = replay(trap.moves)
          expect(chess.turn()).toBe('w')
        })

        it('wrongReply is legal in the bait position', () => {
          replay([...trap.moves, trap.wrongReply])
        })

        it('punishment is legal after moves + wrongReply', () => {
          replay([...trap.moves, trap.wrongReply, ...trap.punishment])
        })

        it('punishment starts with the opponent (Black) moving', () => {
          const chess = replay([...trap.moves, trap.wrongReply])
          expect(chess.turn()).toBe('b')
          expect(trap.punishment.length).toBeGreaterThan(0)
        })

        it('fixMove is legal in the bait position and differs from wrongReply', () => {
          replay([...trap.moves, trap.fixMove])
          expect(trap.fixMove).not.toBe(trap.wrongReply)
        })

        it('has coaching text', () => {
          expect(trap.explanation.length).toBeGreaterThan(40)
          expect(trap.fix.startsWith(trap.fixMove)).toBe(true)
        })
      })
    }
  })
})
