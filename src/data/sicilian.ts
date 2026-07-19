import type { Opening, Line, TrickLine } from '../types'

/**
 * Sicilian Defense repertoire, trained from BLACK's side.
 * All move arrays are SAN from the standard starting position, White first.
 */

const mainlines: Line[] = [
  {
    name: 'Najdorf, 6.Be3 English Attack setup',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6'],
    ideas: {
      1: 'Fight for the center asymmetrically: trade the c-pawn for White\'s d-pawn and get the half-open c-file.',
      3: 'Control e5 and prepare ...Nf6 without allowing an early e5 push.',
      9: 'The Najdorf move: cover b5 against Nb5/Bb5 ideas and prepare ...e5 or ...b5.',
      11: 'Strike in the center. The backward d6-pawn is a fair price for the strong e5 stake and active pieces.',
      13: 'Develop while eyeing d5 — Black fights for the d5-square before White can occupy it.',
    },
  },
  {
    name: 'Najdorf, 6.Bg5 main line',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Bg5', 'e6', 'f4', 'Be7'],
    ideas: {
      9: 'The Najdorf: a useful waiting/expanding move that keeps every central option open.',
      11: 'Break the pin plan calmly: ...e6 blunts Bc4 ideas and prepares ...Be7 and ...Nbd7.',
      13: 'Unpin the knight first; ...Qc7, ...Nbd7 and ...b5 complete the classical Najdorf setup.',
    },
  },
  {
    name: 'Classical Variation (Richter-Rauzer)',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Bg5', 'e6', 'Qd2', 'Be7'],
    ideas: {
      7: 'Recapture in the center is White\'s; Black gets fast piece play and the c-file in return.',
      9: 'The Classical: both knights out before committing the e- or g-pawn.',
      11: 'Meet the Rauzer pin with ...e6: solid, and ...a6/...Qc7/...Bd7 will follow.',
      13: 'Develop and prepare ...O-O or the thematic ...a6 and ...b5 queenside expansion.',
    },
  },
  {
    name: 'Alapin (2.c3), 2...Nf6 main line',
    moves: ['e4', 'c5', 'c3', 'Nf6', 'e5', 'Nd5', 'd4', 'cxd4', 'Nf3', 'Nc6', 'cxd4', 'd6', 'Bc4', 'Nb6'],
    ideas: {
      3: 'The standard antidote to 2.c3: attack e4 at once, since c3 took the natural square from White\'s knight.',
      5: 'A fine outpost — with c3 played, White cannot kick the knight with Nc3.',
      11: 'Chip at White\'s big center immediately; after exd6 or exchanges Black is very comfortable.',
      13: 'Hit the bishop and keep pressure on d4; ...dxe5 and ...Bg4 are coming.',
    },
  },
  {
    name: 'Closed Sicilian, ...g6 setup',
    moves: ['e4', 'c5', 'Nc3', 'Nc6', 'g3', 'g6', 'Bg2', 'Bg7', 'd3', 'd6', 'f4', 'e6', 'Nf3', 'Nge7'],
    ideas: {
      3: 'Against the Closed Sicilian there is no d4 to fear yet — develop naturally toward ...g6.',
      5: 'Mirror the fianchetto: the g7-bishop watches the long diagonal and the d4-square.',
      11: '...e6 restrains f4-f5 and prepares ...Nge7, keeping the f-pawn free for ...f5 later.',
      13: 'The flexible square: from e7 the knight supports ...d5 and ...f5 and never blocks the g7-bishop.',
    },
  },
  {
    name: 'Smith-Morra Accepted, safe ...a6 setup',
    moves: ['e4', 'c5', 'd4', 'cxd4', 'c3', 'dxc3', 'Nxc3', 'Nc6', 'Nf3', 'd6', 'Bc4', 'e6', 'O-O', 'a6'],
    ideas: {
      5: 'Taking the pawn is fine — what matters is the move order that follows.',
      11: 'The key move: blunt the c4-bishop and take the sting out of Bxf7+/Nd5 tricks before developing the king\'s knight.',
      13: 'Cover b5 so Nb5 never lands; ...Nge7, ...b5 and ...Bb7 give Black a healthy extra pawn.',
    },
  },
]

const trickLines: TrickLine[] = [
  {
    trapId: 'sicilian-wayward-queen',
    name: 'Early Qh5 cheese',
    moves: ['e4', 'c5', 'Qh5'],
    wrongReply: 'g6',
    punishment: ['Qxc5', 'Nc6', 'Qe3'],
    explanation:
      'Against 1.e4 e5 the kick ...g6 is normal, but here the queen on h5 sits on the same rank as your c5-pawn. ' +
      'After 2...g6?? 3.Qxc5 White simply pockets a clean pawn, and the loosened dark squares around g7 and h8 ' +
      'will hurt for the rest of the game.',
    fix: 'Nf6! develops with tempo — the knight attacks the queen, and if 3.Qxc5 then 3...Nxe4 hits it again and regains the pawn with a big lead in development.',
    fixMove: 'Nf6',
  },
  {
    trapId: 'sicilian-morra-nf6-e5',
    name: 'Smith-Morra, premature ...Nf6',
    moves: ['e4', 'c5', 'd4', 'cxd4', 'c3', 'dxc3', 'Nxc3', 'Nc6', 'Nf3', 'd6', 'Bc4'],
    wrongReply: 'Nf6',
    punishment: ['e5', 'dxe5', 'Qxd8+', 'Nxd8', 'Nb5', 'Rb8', 'Nxe5'],
    explanation:
      'In the Morra the d-file is already open, so the natural developing move 6...Nf6?? runs into 7.e5!. ' +
      'After 7...dxe5 8.Qxd8+ Nxd8 9.Nb5 the fork Nc7+ costs material, and 7...Nxe5 loses to 8.Nxe5 dxe5 9.Bxf7+! Kxf7 10.Qxd8. ' +
      'Gambit players bank on exactly this move order slip.',
    fix: 'e6 blunts the c4-bishop and covers d5 first; only after ...e6 and ...a6 is ...Nf6 safe against the e5 push and the d-file tricks.',
    fixMove: 'e6',
  },
  {
    trapId: 'sicilian-magnus-smith',
    name: 'Magnus Smith trap (Sozin vs ...g6)',
    moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'd6', 'Bc4', 'g6', 'Nxc6', 'bxc6', 'e5'],
    wrongReply: 'dxe5',
    punishment: ['Bxf7+', 'Kxf7', 'Qxd8'],
    explanation:
      'The classic Magnus Smith trap: with the bishop on c4, 6...g6?! invites 7.Nxc6 bxc6 8.e5!, and the natural ' +
      'recapture 8...dxe5?? opens the d-file with f7 undefended — 9.Bxf7+! Kxf7 10.Qxd8 wins the queen. ' +
      'When Bc4 stares at f7, always check what happens on the d-file before opening it.',
    fix: 'Ng4 sidesteps and keeps the d-file closed; White keeps some initiative after 9.e6, which is why 6...g6 itself is the move to avoid against the Sozin bishop.',
    fixMove: 'Ng4',
  },
  {
    trapId: 'sicilian-alapin-qa4-fork',
    name: 'Alapin, poisoned d4-pawn',
    moves: ['e4', 'c5', 'c3', 'd5', 'exd5', 'Qxd5', 'd4', 'Nc6', 'Nf3', 'Bg4', 'Be2', 'cxd4', 'cxd4'],
    wrongReply: 'Nxd4',
    punishment: ['Nxd4', 'Bxe2', 'Qa4+', 'Qd7', 'Qxd7+', 'Kxd7', 'Kxe2'],
    explanation:
      'The d4-pawn looks free because 8.Nxd4 Bxe2 seems to win a piece back — but 9.Qa4+! is the point of White\'s setup. ' +
      'The check forces a block, and after 9...Qd7 10.Qxd7+ Kxd7 11.Kxe2 White has won a whole knight for a pawn. ' +
      'A well-known Alapin trap: an "isolated" central pawn guarded by tactics is not really hanging.',
    fix: 'e6 keeps developing calmly; the d4-pawn is tactically defended, so complete development with ...e6, ...Nf6 and ...Be7 and play against it later.',
    fixMove: 'e6',
  },
]

export const sicilianDefense: Opening = {
  id: 'sicilian-defense',
  name: 'Sicilian Defense',
  eco: 'B20',
  userColor: 'black',
  description:
    'Black\'s most combative answer to 1.e4: trade the c-pawn for White\'s d-pawn to unbalance the game, ' +
    'then counterattack with the half-open c-file, ...a6/...b5 expansion and central breaks like ...d5 and ...e5.',
  mainlines,
  trickLines,
}

