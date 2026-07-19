import type { Opening, Line, TrickLine } from '../types'

/**
 * Caro-Kann Defense repertoire, trained from BLACK's side.
 * All move arrays are SAN from the standard starting position, White first.
 */

const mainlines: Line[] = [
  {
    name: 'Classical main line (4...Bf5)',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Nf3', 'Nd7'],
    ideas: {
      1: 'Prepare ...d5 with a pawn, not a piece: Black challenges e4 while keeping a rock-solid structure.',
      5: 'Capture toward the center. Unlike the French, the c8-bishop gets out BEFORE ...e6 locks it in.',
      7: 'The point of the Caro-Kann: develop the light-squared bishop to its best diagonal with tempo on the e4-knight.',
      11: 'Essential housekeeping: ...h6 gives the bishop the h7 retreat, so h4-h5 never traps it.',
      13: 'Develop and prepare ...Ngf6 without allowing Nxf6+ to wreck the kingside pawns.',
    },
  },
  {
    name: 'Advance, Short System (3...Bf5)',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6', 'Be2', 'c5', 'O-O', 'Nc6', 'c3', 'Nge7'],
    ideas: {
      5: 'First things first: the bishop leaves the pawn chain before ...e6 closes the door behind it.',
      7: 'Now build the wall: with the bishop already outside, this French-style chain has no bad bishop.',
      9: 'Strike at the base of White\'s chain: ...c5 is Black\'s main source of counterplay in the Advance.',
      11: 'Pile on d4; White must spend time holding the center together.',
      13: 'The flexible route: from e7 the knight can go to f5 or g6, hitting d4 and e5 respectively.',
    },
  },
  {
    name: 'Exchange Variation (4.Bd3)',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6', 'c3', 'Qc7', 'Ne2', 'Bg4', 'O-O', 'e6'],
    ideas: {
      5: 'Recapture with the c-pawn: Black gets a healthy symmetrical center and easy development.',
      7: 'Develop with a small threat (...Nb4 ideas against the d3-bishop) and prepare ...Bg4 or ...g6.',
      9: 'The key finesse: ...Qc7 takes the f4-square away from White\'s bishop before it gets there.',
      11: 'The bishop goes active before ...e6 — the same golden rule as everywhere in the Caro-Kann.',
      13: 'Complete the structure; ...Bd6, ...Nf6 and ...O-O follow with fully comfortable play.',
    },
  },
  {
    name: 'Panov-Botvinnik Attack (4.c4)',
    moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6', 'Nc3', 'e6', 'Nf3', 'Be7', 'cxd5', 'Nxd5'],
    ideas: {
      7: 'Develop and keep the tension: White\'s isolated-pawn ambitions are met with solid piece play.',
      9: 'Blunt the pressure on d5; the c8-bishop stays home for now, but the position is very solid.',
      11: 'Modest and strong: ...Be7 and ...O-O first, counterplay against the isolated d-pawn later.',
      13: 'Recapture with the knight toward the center; ...Nxc3 or ...Nf6 and pressure on d4 come next.',
    },
  },
  {
    name: 'Two Knights (3...Bg4 main line)',
    moves: ['e4', 'c6', 'Nc3', 'd5', 'Nf3', 'Bg4', 'h3', 'Bxf3', 'Qxf3', 'e6', 'd3', 'Nf6', 'Be2', 'Bb4'],
    ideas: {
      3: 'Same plan against every setup: challenge e4 with the d-pawn immediately.',
      5: 'Pin the knight that guards e4 — the most principled answer to the Two Knights.',
      7: 'Give up the bishop, not the plan: after ...Bxf3 White cannot comfortably hold e4 and d4 together.',
      9: 'Solidify. White\'s queen looks active on f3 but bites on the granite e6/d5 chain.',
      13: 'Pin the other knight: Black completes development while White\'s doubled ambitions go nowhere.',
    },
  },
  {
    name: 'Fantasy Variation (3.f3 e6)',
    moves: ['e4', 'c6', 'd4', 'd5', 'f3', 'e6', 'Nc3', 'Bb4', 'Bf4', 'Ne7', 'Qd2', 'b6', 'O-O-O', 'Ba6'],
    ideas: {
      5: 'Decline the invitation: ...e6 keeps the center closed, and f3 becomes a hole in White\'s own position.',
      7: 'Pin the knight and highlight the drawback of f3: White\'s king has lost its natural shelter plans.',
      9: 'Develop behind the pawn chain; ...Ne7-g6 or ...Nf5 will harass White\'s dark-squared bishop.',
      11: 'The thematic fix for the hemmed-in bishop: prepare ...Ba6 to trade it off directly.',
      13: 'Swap the problem bishop for White\'s good one — Black\'s position is solid and easier to play.',
    },
  },
]

const trickLines: TrickLine[] = [
  {
    trapId: 'caro-smothered-mate',
    severity: 'losing',
    name: 'Classical, the 5.Qe2 smothered mate',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Qe2'],
    wrongReply: 'Ngf6',
    punishment: ['Nd6#'],
    explanation:
      'The most famous trap in the Caro-Kann: 5.Qe2 looks like a harmless developing move, but it pins the e7-pawn. ' +
      'After 5...Ngf6?? the knight on d7 blocks the queen\'s path to d6, exd6 is illegal because of the pin, ' +
      'and 6.Nd6# is smothered mate — every escape square is covered or occupied by Black\'s own pieces.',
    fix: 'Ndf6 develops the OTHER knight: with d7 vacated, 6.Nd6+?? now simply loses to 6...Qxd6, so White has nothing better than trading on f6.',
    fixMove: 'Ndf6',
  },
  {
    trapId: 'caro-two-knights-bxf7-mate',
    severity: 'losing',
    name: 'Two Knights, the Qh5/Bc4 queen "gift"',
    moves: ['e4', 'c6', 'Nc3', 'd5', 'Nf3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6', 'Ne5', 'Bh7', 'Qh5', 'g6', 'Bc4'],
    wrongReply: 'gxh5',
    punishment: ['Bxf7#'],
    explanation:
      'A classic miniature pattern: after 7.Ne5 and 8.Qh5, Black must play 8...g6 to cover f7, and now 9.Bc4!? ' +
      'appears to leave the queen hanging on h5. Taking it with 9...gxh5?? allows 10.Bxf7# — the bishop is ' +
      'protected by the e5-knight, d7 is covered, and Black\'s own queen and bishop seal the king\'s escape squares.',
    fix: 'e6 blocks the c4-bishop\'s path to f7 first; only then is the queen really attacked, and after 10.Qe2 Black has survived the assault with a fine position.',
    fixMove: 'e6',
  },
  {
    trapId: 'caro-reti-tartakower',
    severity: 'losing',
    name: 'Reti-Tartakower queen sacrifice',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Qd3', 'e5', 'dxe5', 'Qa5+', 'Bd2', 'Qxe5', 'O-O-O'],
    wrongReply: 'Nxe4',
    punishment: ['Qd8+', 'Kxd8', 'Bg5+', 'Kc7', 'Bd8#'],
    explanation:
      'From Reti-Tartakower, Vienna 1910. After 8.O-O-O the e4-knight looks free because White\'s queen is ' +
      'attacked — but 8...Nxe4?? runs into 9.Qd8+!! Kxd8 10.Bg5+, a double check from bishop and rook that ' +
      'forces the king forward, and 10...Kc7 11.Bd8# ends the game. Never grab material while your king sits on an open central file.',
    fix: 'Be7 breaks the coming pin on the g5-d8 diagonal and prepares ...O-O; Black is slightly worse after the greedy ...Qxe5 excursion but very much alive.',
    fixMove: 'Be7',
  },
  {
    trapId: 'caro-advance-h4-bishop-trap',
    severity: 'losing',
    name: 'Advance, 4.h4 bishop hunt',
    moves: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4'],
    wrongReply: 'e6',
    punishment: ['g4', 'Bg6', 'h5', 'Be4', 'f3', 'Bxc2', 'Qxc2'],
    explanation:
      'Against 4.h4 the natural developing move 4...e6?? walls in your own bishop: its retreat path through e6 ' +
      'to d7 is now blocked by your pawn. White plays 5.g4! and after 5...Bg6 6.h5 Be4 7.f3 the bishop has no ' +
      'square left — every flight square is covered by a pawn or leads to 7...Bxc2 8.Qxc2, losing a full piece for a pawn.',
    fix: 'h5! stops g4 in its tracks and permanently secures the bishop on f5; the weakening of g5 is a fair price, and this is the main line of theory.',
    fixMove: 'h5',
  },
  {
    trapId: 'caro-two-knights-bh5',
    severity: 'minor',
    name: 'Two Knights, the 4...Bh5 retreat',
    moves: ['e4', 'c6', 'Nc3', 'd5', 'Nf3', 'Bg4', 'h3'],
    wrongReply: 'Bh5',
    punishment: ['exd5', 'cxd5', 'Bb5+', 'Nc6', 'g4', 'Bg6', 'Ne5'],
    explanation:
      'Keeping the pin with 4...Bh5?! feels natural, but White gets a ready-made sequence: 5.exd5 cxd5 6.Bb5+ Nc6 ' +
      '7.g4 Bg6 8.Ne5 piles on the pinned c6-knight and the g6-bishop at once. Black survives, but concedes the ' +
      'bishop pair, a damaged structure or a pawn — a lasting concession for no compensation.',
    fix: 'Bxf3 is the point of the whole line: give up the bishop, let White\'s queen come to f3, and strike back with ...e6 and ...Nf6 against the loosened center.',
    fixMove: 'Bxf3',
  },
]

export const caroKann: Opening = {
  id: 'caro-kann',
  name: 'Caro-Kann Defense',
  eco: 'B10',
  userColor: 'black',
  description:
    'Black\'s most solid answer to 1.e4: support ...d5 with the c-pawn, develop the light-squared bishop ' +
    'outside the pawn chain, and build a resilient structure that gives White few targets and no easy attack.',
  mainlines,
  trickLines,
}
