import type { Opening, Line, TrickLine } from '../types'

const mainlines: Line[] = [
  {
    name: 'QGD Orthodox, main line',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'Nbd7', 'Rc1', 'c6'],
    ideas: {
      2: 'Offer the c-pawn to deflect Black from the center. It is not really a sacrifice — White regains it comfortably.',
      4: 'Develop toward the center and add pressure against d5.',
      6: 'Pin the f6-knight, indirectly increasing pressure on d5.',
      8: 'A modest but solid center: e3 supports d4 and opens the f1-bishop.',
      12: 'Put the rook on the file that will open after cxd5 or ...dxc4.',
    },
  },
  {
    name: 'QGD Exchange Variation',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'cxd5', 'exd5', 'Bg5', 'c6', 'e3', 'Be7', 'Bd3', 'O-O'],
    ideas: {
      6: 'Fix the pawn structure early: Black gets a d5-pawn, White gets the minority-attack plan with b4-b5.',
      8: 'Pin the knight before Black can develop smoothly.',
      12: 'The bishop eyes h7; White often follows with Qc2 and Nge2 or Nf3.',
    },
  },
  {
    name: 'Slav, main line with 4...dxc4 5.a4',
    moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'dxc4', 'a4', 'Bf5', 'e3', 'e6', 'Bxc4', 'Bb4'],
    ideas: {
      8: 'Stop ...b5, which would let Black keep the extra c4-pawn.',
      10: 'e3 prepares to recapture on c4 with the bishop.',
      12: 'Regain the pawn with a healthy, slightly freer game.',
    },
  },
  {
    name: 'Semi-Slav, Meran setup',
    moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6', 'e3', 'Nbd7', 'Bd3', 'dxc4', 'Bxc4', 'b5'],
    ideas: {
      8: 'The quiet Meran move order: develop first, keep the tension.',
      10: 'Natural development; the bishop will often recapture on c4 after ...dxc4.',
      12: 'Recapture and prepare e4; Black counterattacks on the queenside with ...b5 and ...a6.',
    },
  },
  {
    name: 'Queen’s Gambit Accepted, 3.Nf3 and e3',
    moves: ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6', 'Bxc4', 'c5', 'O-O', 'a6'],
    ideas: {
      4: 'Do not rush to regain c4 — develop first and stop ...e5.',
      6: 'Open the diagonal so the bishop can simply take back on c4.',
      8: 'Pawn regained. White has easy development and a small central edge.',
      10: 'Castle before deciding between Qe2/Rd1 or a4 setups.',
    },
  },
  {
    name: 'Tarrasch Defense, main line with g3',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'c5', 'cxd5', 'exd5', 'Nf3', 'Nc6', 'g3', 'Nf6', 'Bg2', 'Be7'],
    ideas: {
      6: 'Exchange to saddle Black with an isolated d-pawn after a later dxc5 or ...cxd4.',
      10: 'The Réti/Schlechter plan: the g2-bishop presses the isolated d5-pawn for the rest of the game.',
      12: 'Complete the fianchetto; long-term play against d5 is White’s whole strategy here.',
    },
  },
]

const trickLines: TrickLine[] = [
  {
    trapId: 'elephant-trap',
    name: 'Elephant Trap (QGD)',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Nbd7', 'cxd5', 'exd5'],
    ideas: {
      7: 'Black’s 4...Nbd7 looks like it leaves d5 underdefended — that is the bait.',
      9: 'Black calmly recaptures. The d5-pawn still looks free because the f6-knight is pinned... or is it?',
    },
    wrongReply: 'Nxd5',
    punishment: ['Nxd5', 'Bxd8', 'Bb4+', 'Qd2', 'Bxd2+', 'Kxd2', 'Kxd8'],
    explanation:
      'The pin on f6 is an illusion: after 6.Nxd5?? Nxd5! Black really does give up the queen to 7.Bxd8, but 7...Bb4+! is a zwischenzug that forces 8.Qd2 Bxd2+ 9.Kxd2, and after 9...Kxd8 Black has won a whole piece. Count the material before "winning" a pawn against a pinned piece — the pin only works if there is no check to break it.',
    fix: 'e3 — just keep developing. The d5-pawn is not actually hanging, so reinforce the center and prepare Bd3 and Nf3.',
    fixMove: 'e3',
  },
  {
    trapId: 'lasker-trap-albin',
    name: 'Lasker Trap (Albin Countergambit)',
    moves: ['d4', 'd5', 'c4', 'e5', 'dxe5', 'd4'],
    ideas: {
      3: 'The Albin Countergambit: Black gives a pawn for an annoying advanced d4-pawn.',
      5: 'This wedge pawn is the bait. The "natural" 4.e3 to dissolve it walks into a famous disaster.',
    },
    wrongReply: 'e3',
    punishment: ['Bb4+', 'Bd2', 'dxe3', 'Bxb4', 'exf2+', 'Ke2', 'fxg1=N+'],
    explanation:
      'After 4.e3?? Bb4+ 5.Bd2 dxe3! the threats explode: 6.Bxb4?? exf2+ 7.Ke2 (7.Kxf2 loses the queen to ...Qxd1) fxg1=N+! — an underpromotion with check, since promoting to a queen would allow Rxg1. White ends up hopelessly behind in material and king safety. Never try to dissolve the d4-wedge with e3; develop around it instead.',
    fix: 'Nf3 — the main line. Develop, keep the extra e5-pawn, and let Black prove compensation for the gambit.',
    fixMove: 'Nf3',
  },
  {
    trapId: 'cambridge-springs-trap',
    name: 'Cambridge Springs Trap (QGD)',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Nbd7', 'e3', 'c6', 'Nf3', 'Qa5'],
    ideas: {
      11: 'The Cambridge Springs: the queen pins your c3-knight against the king along the a5–e1 diagonal. Routine development now loses material.',
    },
    wrongReply: 'Bd3',
    punishment: ['Ne4', 'Bxe4', 'dxe4', 'Nd2', 'Qxg5'],
    explanation:
      'With the c3-knight pinned by ...Qa5, the "natural" 7.Bd3?? allows 7...Ne4!, hitting both the g5-bishop and the pinned knight. After 8.Bxe4 dxe4 the f3-knight must move (9.Nd2), and then 9...Qxg5 simply takes the bishop — its defender left. 8.Bh4 or 8.Bf4 instead lose a piece to ...Nxc3 followed by ...Qxc3+ ideas. When your c3-knight gets pinned by ...Qa5, deal with the pin before developing further.',
    fix: 'Nd2 — the main answer to the Cambridge Springs. It unpins by blocking the a5–e1 diagonal and covers e4 against ...Ne4 tricks.',
    fixMove: 'Nd2',
  },
]

export const queensGambit: Opening = {
  id: 'queens-gambit',
  name: "Queen's Gambit",
  eco: 'D06',
  userColor: 'white',
  description:
    'White offers the c-pawn to pry Black’s d5-pawn away from the center, then builds a strong pawn duo and free development. It is the most classical of all closed openings — and full of traps Black can set if White grabs material too greedily.',
  mainlines,
  trickLines,
}
