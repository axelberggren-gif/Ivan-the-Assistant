import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { caroKann } from './caroKann'

/** Replay SAN moves from the start; throws (failing the test) on an illegal move. */
function replay(moves: string[]): Chess {
  const chess = new Chess()
  for (const san of moves) {
    expect(() => chess.move(san), `illegal move '${san}' after: ${chess.history().join(' ')}`).not.toThrow()
  }
  return chess
}

describe('caroKann opening data', () => {
  it('has the expected identity', () => {
    expect(caroKann.id).toBe('caro-kann')
    expect(caroKann.userColor).toBe('black')
    expect(caroKann.mainlines.length).toBeGreaterThanOrEqual(6)
    expect(caroKann.trickLines.length).toBeGreaterThanOrEqual(3)
  })

  describe('mainlines', () => {
    for (const line of caroKann.mainlines) {
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
    for (const trap of caroKann.trickLines) {
      describe(trap.trapId, () => {
        it('moves are legal and leave the user (Black) to move', () => {
          const chess = replay(trap.moves)
          expect(chess.turn()).toBe('b')
        })

        it('wrongReply is legal in the bait position', () => {
          replay([...trap.moves, trap.wrongReply])
        })

        it('punishment is legal after moves + wrongReply', () => {
          replay([...trap.moves, trap.wrongReply, ...trap.punishment])
        })

        it('punishment starts with the opponent (White) moving', () => {
          const chess = replay([...trap.moves, trap.wrongReply])
          expect(chess.turn()).toBe('w')
          expect(trap.punishment.length).toBeGreaterThan(0)
        })

        it('mating punishments actually end in checkmate', () => {
          const last = trap.punishment[trap.punishment.length - 1]
          if (last.endsWith('#')) {
            const chess = replay([...trap.moves, trap.wrongReply, ...trap.punishment])
            expect(chess.isCheckmate()).toBe(true)
          }
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
