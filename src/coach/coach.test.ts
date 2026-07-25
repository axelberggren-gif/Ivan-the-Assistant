import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import type {
  AssessMoveInput,
  BookCheckResult,
  EngineAnalysis,
  EngineLine,
  TrickLine,
} from '../types'
import { classifyMove, createCoach, deriveReasonCodes } from './index'

const coach = createCoach()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function line(cp: number | undefined, pvSan: string[] = [], mate?: number): EngineLine {
  return { pvSan, pvUci: [], ...(cp !== undefined ? { cp } : {}), ...(mate !== undefined ? { mate } : {}) }
}

function analysis(fen: string, bestMoveSan: string, lines: EngineLine[]): EngineAnalysis {
  return { fen, depth: 16, bestMoveSan, bestMoveUci: '', lines }
}

function fenAfterMoves(moves: string[]): string {
  const chess = new Chess()
  for (const san of moves) chess.move(san)
  return chess.fen()
}

const notInBook: BookCheckResult = { inBook: false }

/** Standard input: user is White, just played 2.Nf3 in 1.e4 e5 2.Nf3. */
function baseInput(overrides: Partial<AssessMoveInput> = {}): AssessMoveInput {
  const historySan = ['e4', 'e5', 'Nf3']
  return {
    openingId: 'italian',
    userColor: 'white',
    historySan,
    fenBefore: fenAfterMoves(['e4', 'e5']),
    fenAfter: fenAfterMoves(historySan),
    san: 'Nf3',
    book: notInBook,
    evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(50, ['d4', 'exd4'])]),
    evalAfter: analysis(fenAfterMoves(historySan), 'Nc6', [line(40, ['Nc6', 'Bc4'])]),
    ...overrides,
  }
}

function inputWithCpLoss(loss: number): AssessMoveInput {
  return baseInput({
    evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(50, ['d4'])]),
    evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(50 - loss, ['d6', 'd4', 'Be7', 'c3'])]),
  })
}

// ---------------------------------------------------------------------------
// Classification boundaries
// ---------------------------------------------------------------------------

describe('classification boundaries (cpLoss)', () => {
  const cases: Array<[number, string]> = [
    [29, 'good'],
    [30, 'inaccuracy'],
    [90, 'inaccuracy'],
    [91, 'mistake'],
    [200, 'mistake'],
    [201, 'blunder'],
  ]
  for (const [loss, expected] of cases) {
    it(`cpLoss ${loss} → ${expected}`, () => {
      const result = coach.assessMove(inputWithCpLoss(loss))
      expect(result.classification).toBe(expected)
      expect(result.cpLoss).toBe(loss)
    })
  }

  it('stopGame only for blunders', () => {
    expect(coach.assessMove(inputWithCpLoss(200)).stopGame).toBe(false)
    expect(coach.assessMove(inputWithCpLoss(201)).stopGame).toBe(true)
  })

  it('comment mentions the best move for inaccuracy and worse', () => {
    for (const loss of [30, 91, 201]) {
      const result = coach.assessMove(inputWithCpLoss(loss))
      expect(result.comment).toContain('d4')
    }
  })
})

// ---------------------------------------------------------------------------
// Perspective conversion (Black user) and mate scores
// ---------------------------------------------------------------------------

describe('perspective and mate handling', () => {
  it('converts White-perspective cp to the Black user perspective', () => {
    // Black just played 1...e5. White-persp evals: before -30 (Black is
    // +30 from their side), after +50 (Black is -50) → cpLoss = 80.
    const input = baseInput({
      userColor: 'black',
      historySan: ['e4', 'e5'],
      san: 'e5',
      fenBefore: fenAfterMoves(['e4']),
      fenAfter: fenAfterMoves(['e4', 'e5']),
      evalBefore: analysis(fenAfterMoves(['e4']), 'c5', [line(-30, ['c5'])]),
      evalAfter: analysis(fenAfterMoves(['e4', 'e5']), 'Nf3', [line(50, ['Nf3'])]),
    })
    const result = coach.assessMove(input)
    expect(result.cpLoss).toBe(80)
    expect(result.classification).toBe('inaccuracy')
  })

  it('a naive White-perspective subtraction would misclassify the same move', () => {
    // Sanity companion to the previous test: white-persp diff is -30-50=-80
    // which clamped would be 0 ("good"); the coach must say inaccuracy.
    const result = coach.assessMove(
      baseInput({
        userColor: 'black',
        historySan: ['e4', 'e5'],
        san: 'e5',
        fenBefore: fenAfterMoves(['e4']),
        fenAfter: fenAfterMoves(['e4', 'e5']),
        evalBefore: analysis(fenAfterMoves(['e4']), 'c5', [line(-30)]),
        evalAfter: analysis(fenAfterMoves(['e4', 'e5']), 'Nf3', [line(50)]),
      }),
    )
    expect(result.classification).not.toBe('good')
  })

  it('treats mate scores as ±10000 minus distance', () => {
    // Before: White (user) had mate in 5 (→ 9995). After: White gets mated
    // in 2 (→ -9998). cpLoss = 19993 → blunder, stopGame.
    const input = baseInput({
      evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(undefined, ['d4'], 5)]),
      evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'Qh4', [
        line(undefined, ['Qh4', 'g3', 'Qxe4'], -2),
      ]),
    })
    const result = coach.assessMove(input)
    expect(result.cpLoss).toBe(19993)
    expect(result.classification).toBe('blunder')
    expect(result.stopGame).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Trap short-circuit
// ---------------------------------------------------------------------------

describe('trap handling', () => {
  const trap: TrickLine = {
    trapId: 'fishing-pole',
    severity: 'losing',
    name: 'the Fishing Pole trap',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Ng4'],
    wrongReply: 'h3',
    punishment: ['h5', 'hxg4', 'hxg4'],
    explanation: 'The knight is bait: taking it rips open the h-file toward your king.',
    fix: 'd3 — decline the bait and complete development.',
    fixMove: 'd3',
  }

  it('authored trap content wins over engine text', () => {
    const historySan = [...trap.moves, trap.wrongReply]
    const input = baseInput({
      historySan,
      san: 'h3',
      fenBefore: fenAfterMoves(trap.moves),
      fenAfter: fenAfterMoves(historySan),
      trap,
      evalBefore: analysis(fenAfterMoves(trap.moves), 'd3', [line(20)]),
      evalAfter: analysis(fenAfterMoves(historySan), 'h5', [line(-400, ['h5', 'hxg4', 'hxg4'])]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('blunder')
    expect(result.stopGame).toBe(true)
    expect(result.reasonCodes).toEqual(['falls_for_trap'])
    expect(result.refutationSan).toEqual(trap.punishment)
    expect(result.explanation).toBe(trap.explanation)
    expect(result.fix).toBe(trap.fix)
    expect(result.comment).toContain('bait')
    expect(result.comment).toContain('Fishing Pole')
  })

  it('minor-severity traps teach inline without stopping the game', () => {
    const minorTrap: TrickLine = { ...trap, severity: 'minor' }
    const historySan = [...minorTrap.moves, minorTrap.wrongReply]
    const input = baseInput({
      historySan,
      san: 'h3',
      fenBefore: fenAfterMoves(minorTrap.moves),
      fenAfter: fenAfterMoves(historySan),
      trap: minorTrap,
      evalBefore: analysis(fenAfterMoves(minorTrap.moves), 'd3', [line(20)]),
      evalAfter: analysis(fenAfterMoves(historySan), 'h5', [line(-100, ['h5'])]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('mistake')
    expect(result.stopGame).toBe(false)
    expect(result.reasonCodes).toEqual(['falls_for_trap'])
    expect(result.refutationSan).toBeUndefined()
    // The authored coaching arrives inline via the comment instead.
    expect(result.comment).toContain(minorTrap.explanation)
    expect(result.comment).toContain(minorTrap.fix)
    expect(result.bestMoveSan).toBe(minorTrap.fixMove)
  })
})

// ---------------------------------------------------------------------------
// Book moves
// ---------------------------------------------------------------------------

describe('book handling', () => {
  it('classifies an in-book move as book and mentions the line name', () => {
    const input = baseInput({
      book: { inBook: true, lineName: 'Italian Game', idea: 'Develops and eyes f7' },
      evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'Nf3', [line(30)]),
      evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'Nc6', [line(28)]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('book')
    expect(result.reasonCodes).toEqual(['book_move'])
    expect(result.stopGame).toBe(false)
    expect(result.comment).toContain('Italian Game')
  })

  it('falls through to normal classification when a "book" move loses > 90cp', () => {
    const input = baseInput({
      book: { inBook: true, lineName: 'Italian Game' },
      evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(50)]),
      evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-70, ['d6'])]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('mistake')
    expect(result.reasonCodes).not.toContain('book_move')
  })
})

// ---------------------------------------------------------------------------
// Thrown-position rule
// ---------------------------------------------------------------------------

describe('thrown-position rule', () => {
  it('blunder when eval collapses below -250 from better than -100, even at mistake-range cpLoss', () => {
    // cpLoss 180 (mistake range) but -90 → -270 is a thrown position.
    const input = baseInput({
      evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(-90)]),
      evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-270, ['d6', 'd4'])]),
    })
    const result = coach.assessMove(input)
    expect(result.cpLoss).toBe(180)
    expect(result.classification).toBe('blunder')
    expect(result.stopGame).toBe(true)
  })

  it('no thrown-position blunder when the position was already lost before', () => {
    const input = baseInput({
      evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(-200)]),
      evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-300, ['d6'])]),
    })
    expect(coach.assessMove(input).classification).toBe('mistake')
  })
})

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------

describe('reason codes', () => {
  it('detects hangs_piece from a PV that wins a knight', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Ng5?? and 3...Qxg5 just takes the knight.
    const historySan = ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5']
    const fenBefore = fenAfterMoves(historySan.slice(0, 4))
    const fenAfter = fenAfterMoves(historySan)
    const input = baseInput({
      historySan,
      san: 'Ng5',
      fenBefore,
      fenAfter,
      evalBefore: analysis(fenBefore, 'Bc4', [line(30, ['Bc4', 'Bc5'])]),
      evalAfter: analysis(fenAfter, 'Qxg5', [line(-280, ['Qxg5', 'Nc3', 'Nf6', 'd3'])]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('blunder')
    expect(result.reasonCodes).toContain('hangs_piece')
    expect(result.reasonCodes).toContain('moves_piece_twice')
    expect(result.refutationSan?.[0]).toBe('Qxg5')
    expect(result.explanation).toBeTruthy()
    expect(result.fix).toContain('Bc4')
  })

  it('does not report hangs_piece when the PV recaptures the material back', () => {
    // 1.e4 e5 2.d4: the PV starts with a capture (exd4) but Qxd4 restores
    // material, so the net swing is 0 and no hang should be reported.
    const historySan = ['e4', 'e5', 'd4']
    const fenBefore = fenAfterMoves(['e4', 'e5'])
    const fenAfter = fenAfterMoves(historySan)
    const input = baseInput({
      historySan,
      san: 'd4',
      fenBefore,
      fenAfter,
      evalBefore: analysis(fenBefore, 'Nf3', [line(140)]),
      evalAfter: analysis(fenAfter, 'exd4', [line(40, ['exd4', 'Qxd4', 'Nc6', 'Qd1'])]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('mistake')
    expect(result.reasonCodes).not.toContain('hangs_piece')
  })

  it('flags misses_tactic when a move >=150cp better existed', () => {
    const result = coach.assessMove(inputWithCpLoss(160))
    expect(result.classification).toBe('mistake')
    expect(result.reasonCodes).toContain('misses_tactic')
  })

  it('flags early_queen for 2.Qh5', () => {
    const historySan = ['e4', 'e5', 'Qh5']
    const input = baseInput({
      historySan,
      san: 'Qh5',
      fenBefore: fenAfterMoves(['e4', 'e5']),
      fenAfter: fenAfterMoves(historySan),
      evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'Nf3', [line(30)]),
      evalAfter: analysis(fenAfterMoves(historySan), 'Nc6', [line(-10, ['Nc6'])]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('inaccuracy')
    expect(result.reasonCodes).toContain('early_queen')
  })

  it('flags weakens_king for an early g4 push', () => {
    const historySan = ['f4', 'e5', 'g4']
    const input = baseInput({
      historySan,
      san: 'g4',
      fenBefore: fenAfterMoves(['f4', 'e5']),
      fenAfter: fenAfterMoves(historySan),
      evalBefore: analysis(fenAfterMoves(['f4', 'e5']), 'fxe5', [line(20)]),
      evalAfter: analysis(fenAfterMoves(historySan), 'Qh4#', [line(undefined, ['Qh4#'], -1)]),
    })
    const result = coach.assessMove(input)
    expect(result.classification).toBe('blunder')
    expect(result.reasonCodes).toContain('weakens_king')
  })

  it('defaults to ok when there is no evidence for anything else', () => {
    const result = coach.assessMove(inputWithCpLoss(0))
    expect(result.classification).toBe('good')
    expect(result.reasonCodes).toEqual(['ok'])
  })
})

// ---------------------------------------------------------------------------
// Extracted classification (ADR-0005) — parity with assessMove
// ---------------------------------------------------------------------------

describe('classifyMove / deriveReasonCodes (extracted)', () => {
  /** Inputs that between them exercise every branch assessMove classifies. */
  const cases: Array<[string, AssessMoveInput]> = [
    ['good', inputWithCpLoss(0)],
    ['inaccuracy boundary', inputWithCpLoss(30)],
    ['mistake boundary', inputWithCpLoss(91)],
    ['blunder boundary', inputWithCpLoss(201)],
    ['missed tactic', inputWithCpLoss(160)],
    [
      'thrown position at mistake-range cpLoss',
      baseInput({
        evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(-90)]),
        evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-270, ['d6', 'd4'])]),
      }),
    ],
    [
      'already lost before the move',
      baseInput({
        evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(-200)]),
        evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-300, ['d6'])]),
      }),
    ],
    [
      'hangs a knight',
      (() => {
        const historySan = ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5']
        const fenBefore = fenAfterMoves(historySan.slice(0, 4))
        const fenAfter = fenAfterMoves(historySan)
        return baseInput({
          historySan,
          san: 'Ng5',
          fenBefore,
          fenAfter,
          evalBefore: analysis(fenBefore, 'Bc4', [line(30, ['Bc4', 'Bc5'])]),
          evalAfter: analysis(fenAfter, 'Qxg5', [line(-280, ['Qxg5', 'Nc3', 'Nf6', 'd3'])]),
        })
      })(),
    ],
    [
      'early queen',
      (() => {
        const historySan = ['e4', 'e5', 'Qh5']
        return baseInput({
          historySan,
          san: 'Qh5',
          fenBefore: fenAfterMoves(['e4', 'e5']),
          fenAfter: fenAfterMoves(historySan),
          evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'Nf3', [line(30)]),
          evalAfter: analysis(fenAfterMoves(historySan), 'Nc6', [line(-10, ['Nc6'])]),
        })
      })(),
    ],
    [
      'black user, perspective converted',
      baseInput({
        userColor: 'black',
        historySan: ['e4', 'e5'],
        san: 'e5',
        fenBefore: fenAfterMoves(['e4']),
        fenAfter: fenAfterMoves(['e4', 'e5']),
        evalBefore: analysis(fenAfterMoves(['e4']), 'c5', [line(-30, ['c5'])]),
        evalAfter: analysis(fenAfterMoves(['e4', 'e5']), 'Nf3', [line(50, ['Nf3'])]),
      }),
    ],
    [
      'mate scores',
      baseInput({
        evalBefore: analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(undefined, ['d4'], 5)]),
        evalAfter: analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'Qh4', [
          line(undefined, ['Qh4', 'g3', 'Qxe4'], -2),
        ]),
      }),
    ],
  ]

  for (const [name, input] of cases) {
    it(`agrees with assessMove: ${name}`, () => {
      const assessment = coach.assessMove(input)
      const verdict = classifyMove(input.evalBefore, input.evalAfter, input.userColor)

      expect(verdict.classification).toBe(assessment.classification)
      expect(verdict.cpLoss).toBe(assessment.cpLoss)

      const codes = deriveReasonCodes({
        historySan: input.historySan,
        fenAfter: input.fenAfter,
        san: input.san,
        evalBefore: input.evalBefore,
        evalAfter: input.evalAfter,
        userColor: input.userColor,
        cpLoss: verdict.cpLoss,
        threwPosition: verdict.threwPosition,
      })
      expect(codes).toEqual(assessment.reasonCodes)
    })
  }

  it('reports threwPosition only for a collapse from a holdable position', () => {
    const thrown = classifyMove(
      analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(-90)]),
      analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-270)]),
      'white',
    )
    expect(thrown).toMatchObject({ classification: 'blunder', threwPosition: true })

    const alreadyLost = classifyMove(
      analysis(fenAfterMoves(['e4', 'e5']), 'd4', [line(-200)]),
      analysis(fenAfterMoves(['e4', 'e5', 'Nf3']), 'd6', [line(-300)]),
      'white',
    )
    expect(alreadyLost).toMatchObject({ classification: 'mistake', threwPosition: false })
  })

  it('never returns an empty reason-code list', () => {
    const codes = deriveReasonCodes({
      historySan: [],
      fenAfter: fenAfterMoves([]),
      san: 'e4',
      evalBefore: analysis(fenAfterMoves([]), 'e4', [line(20)]),
      evalAfter: analysis(fenAfterMoves(['e4']), 'e5', [line(20)]),
      userColor: 'white',
      cpLoss: 0,
      threwPosition: false,
    })
    expect(codes).toEqual(['ok'])
  })
})
