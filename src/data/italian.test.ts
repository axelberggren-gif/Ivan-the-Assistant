import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import { italianGame } from './italian'

/** Replay SAN moves from the start; fails the test on the first illegal move. */
function replay(moves: string[]): Chess {
  const chess = new Chess()
  for (const san of moves) {
    expect(() => chess.move(san), `illegal move '${san}' after: ${chess.history().join(' ')}`).not.toThrow()
  }
  return chess
}

describe('italianGame opening data', () => {
  it('has the expected identity', () => {
    expect(italianGame.id).toBe('italian-game')
    expect(italianGame.eco).toBe('C50')
    expect(italianGame.userColor).toBe('white')
    expect(italianGame.mainlines.length).toBeGreaterThanOrEqual(5)
    expect(italianGame.trickLines.length).toBeGreaterThanOrEqual(3)
  })

  describe('mainlines', () => {
    for (const line of italianGame.mainlines) {
      it(`${line.name ?? 'unnamed'} replays legally from the start`, () => {
        const chess = replay(line.moves)
        expect(chess.history()).toHaveLength(line.moves.length)
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
    for (const trap of italianGame.trickLines) {
      describe(trap.trapId, () => {
        it('bait line replays legally and leaves White (the user) to move', () => {
          const chess = replay(trap.moves)
          expect(chess.turn()).toBe('w')
        })

        it('wrongReply is legal in the bait position', () => {
          const chess = replay(trap.moves)
          expect(() => chess.move(trap.wrongReply)).not.toThrow()
        })

        it('punishment replays legally after moves + wrongReply, starting with Black', () => {
          const chess = replay([...trap.moves, trap.wrongReply])
          expect(chess.turn()).toBe('b')
          for (const san of trap.punishment) {
            expect(() => chess.move(san), `illegal punishment move '${san}'`).not.toThrow()
          }
        })

        it('fixMove is legal in the bait position and differs from wrongReply', () => {
          const chess = replay(trap.moves)
          expect(trap.fixMove).not.toBe(trap.wrongReply)
          expect(() => chess.move(trap.fixMove)).not.toThrow()
        })

        it('has coaching text', () => {
          expect(trap.explanation.length).toBeGreaterThan(40)
          expect(trap.fix.startsWith(trap.fixMove.replace(/[+#]$/, '').slice(0, 2))).toBe(true)
        })
      })
    }
  })
})
