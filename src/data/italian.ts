import type { Opening, Line, TrickLine } from '../types'

const mainlines: Line[] = [
  {
    name: 'Giuoco Piano, main line with 4.c3 Nf6 5.d4',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Nc3', 'Nxe4'],
    ideas: {
      4: 'The Italian bishop takes aim at f7, the weakest square in Black’s camp.',
      6: 'c3 prepares d4: White wants the full pawn center.',
      8: 'Strike in the center before Black is fully developed.',
      12: 'The Greco/Møller gambit: give up e4 for a lead in development and open lines.',
    },
  },
  {
    name: 'Giuoco Piano, 4.c3 d6 5.d4',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'd6', 'd4', 'exd4', 'cxd4', 'Bb6', 'Nc3', 'Nf6'],
    ideas: {
      6: 'Again c3 supports the d4 break.',
      8: 'Open the center; with ...d6 played, Black cannot meet d4 with ...Bb4+ tricks as easily.',
      10: 'Recapture toward the center — White owns the ideal d4/e4 pawn duo.',
      12: 'Develop with tempo-free harmony; d5 pushes and Be3 are the plans.',
    },
  },
  {
    name: 'Giuoco Pianissimo, 4.d3',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'Nf6', 'c3', 'd6', 'O-O', 'O-O', 'Re1', 'a6'],
    ideas: {
      6: 'The "very quiet" system: keep the tension, develop, and maneuver slowly.',
      8: 'c3 keeps the option of d4 later and gives the c2-square to the bishop via b3/c2.',
      10: 'King safety first; the fight starts only in the middlegame.',
      12: 'A typical regrouping square: the rook supports a delayed d4 or e-file play.',
    },
  },
  {
    name: 'Two Knights Defense, 4.Ng5 main line',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5', 'Bb5+', 'c6', 'dxc6', 'bxc6'],
    ideas: {
      6: 'The most critical try: two pieces hit f7 and Black must react to the threat of Nxf7.',
      8: 'Take the pawn — 5...Nxd5? would run into the Fried Liver Attack 6.Nxf7!.',
      10: 'Check first; after ...c6 White grabs a pawn while Black gets activity.',
      12: 'White is a pawn up but must weather Black’s initiative (Be2 and h3 come next).',
    },
  },
  {
    name: 'Two Knights Defense, 4.d3 quiet system',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3', 'Be7', 'O-O', 'O-O', 'Re1', 'd6', 'a4', 'a6'],
    ideas: {
      6: 'Decline the sharp stuff: protect e4, develop, and play a long strategic game.',
      10: 'Re1 guards e4 once more and prepares the standard c3/Nbd2/Nf1/Ng3 regrouping.',
      12: 'Gain queenside space and stop ...b5 hitting the c4-bishop.',
    },
  },
  {
    name: 'Evans Gambit Accepted, main line',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4', 'Bxb4', 'c3', 'Ba5', 'd4', 'exd4', 'O-O', 'd6'],
    ideas: {
      6: 'The Evans Gambit: a wing pawn buys two tempi to build the big center with c3 and d4.',
      8: 'Hit the bishop and prepare d4 — the whole point of b4.',
      10: 'The center comes with tempo; White is a pawn down but far ahead in development.',
      12: 'Castle and keep the initiative; cxd4 and Qb3 hitting f7 are the standard follow-ups.',
    },
  },
]

const trickLines: TrickLine[] = [
  {
    trapId: 'blackburne-shilling',
    name: 'Blackburne Shilling Gambit',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'],
    ideas: {
      5: 'A provocative knight leap that "hangs" the e5-pawn. It is pure bait.',
    },
    wrongReply: 'Nxe5',
    punishment: ['Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+', 'Be2', 'Nf3#'],
    explanation:
      'After 3...Nd4 the e5-pawn is poisoned: 4.Nxe5? runs into 4...Qg5!, forking the e5-knight and g2. If White grabs more with 5.Nxf7, then 5...Qxg2 6.Rf1 Qxe4+ 7.Be2 Nf3# is a picture-perfect smothered mate — the e2-bishop is pinned and White’s own pieces block every escape square.',
    fix: 'Nxd4 — simply trade off the offside knight; after 4...exd4 White has easy development and the better game.',
    fixMove: 'Nxd4',
  },
  {
    trapId: 'traxler-counterattack',
    name: 'Two Knights, Traxler Counterattack',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'Bc5'],
    ideas: {
      7: 'Black ignores the threat to f7 and offers f7 (and often f2) for a violent attack.',
    },
    wrongReply: 'Nxf7',
    punishment: ['Bxf2+', 'Kxf2', 'Nxe4+', 'Kg1', 'Qh4', 'g3', 'Nxg3', 'hxg3', 'Qxg3+'],
    explanation:
      'The Traxler is a famous piece sacrifice: after 5.Nxf7? Bxf2+! the natural 6.Kxf2 Nxe4+ 7.Kg1?? Qh4 gives Black a crushing attack — 8.g3 Nxg3! 9.hxg3 Qxg3+ and White’s king is stripped bare while the f7-knight sits offside. The greedy fork on d8/h8 never gets cashed in.',
    fix: 'Bxf7+ — take with the bishop instead: 5...Ke7 6.Bd5 (or 6.Bb3) keeps an extra pawn and Black’s king stuck in the center, with no counterattack.',
    fixMove: 'Bxf7+',
  },
  {
    trapId: 'moeller-wrong-recapture',
    name: 'Giuoco Piano, wrong recapture on c3',
    moves: [
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4',
      'cxd4', 'Bb4+', 'Nc3', 'Nxe4', 'O-O', 'Bxc3',
    ],
    ideas: {
      15: 'Black wins a piece for the moment and hopes White recaptures on autopilot.',
    },
    wrongReply: 'bxc3',
    punishment: ['d5', 'Bd3', 'O-O'],
    explanation:
      'After 8...Bxc3 the reflex 9.bxc3? lets Black consolidate with 9...d5! — the e4-knight gets permanent support, the c4-bishop is pushed back, and Black simply remains a healthy pawn up with the better structure. White’s gambit play evaporates.',
    fix: 'd5! — the Møller Attack: 9...Bf6 10.Re1 Ne7 11.Rxe4 regains the piece with a strong initiative for the pawn.',
    fixMove: 'd5',
  },
  {
    trapId: 'pseudo-legal-bg4',
    name: 'Semi-Italian, fake Légal trap with ...Bg4',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'd6', 'Nc3', 'Bg4'],
    ideas: {
      7: 'The pin looks like an invitation to the famous Légal mate — but here it does not work.',
    },
    wrongReply: 'Nxe5',
    punishment: ['Nxe5', 'Qxg4', 'Nxg4'],
    explanation:
      'Légal’s mate (Nxe5! Bxd1?? Bxf7+ and Nd5#) only works when Black must recapture on e5 with a pawn. Here Black has 5...Nxe5!, guarding f7 and hitting the queen’s rescuer: after 6.Qxg4 Nxg4 White has lost a queen for a bishop. The pin was a trap for White, not for Black.',
    fix: 'h3 — put the question to the bishop; after 5...Bxf3 6.Qxf3 White keeps the bishop pair, or 5...Bh5 leaves g4 ideas of g4 and Nxe5 for later, under the right conditions.',
    fixMove: 'h3',
  },
]

export const italianGame: Opening = {
  id: 'italian-game',
  name: 'Italian Game',
  eco: 'C50',
  userColor: 'white',
  description:
    'A classical 1.e4 e5 opening where White develops the bishop to c4, eyeing f7, and fights for the center with c3 and d4 — or maneuvers patiently in the Pianissimo. Rich in early tactics, so White must know the traps Black can set.',
  mainlines,
  trickLines,
}
