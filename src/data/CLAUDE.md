# src/data — opening definitions (authored content)

One file per opening (`italian.ts`, `queensGambit.ts`, `sicilian.ts`, `caroKann.ts`), each
exporting an `Opening` (see `src/types.ts`) and registered in `index.ts`'s `openings` array
(array order = display order in the picker).

## Authoring rules

- Moves are **SAN from the standard start position, White first** — no FEN offsets.
- `Line.ideas` is keyed by index into `moves`; write ideas for the **user's side**.
- A `TrickLine.moves` **ends with the opponent's bait move** (after it, it is the user's
  turn). `wrongReply` is the natural losing reply; `punishment` alternates from the
  opponent's move; `fixMove` is the single correct reply (SAN, legal in the bait position).
- `severity: 'losing'` stops the session; `'minor'` (e.g. loses a pawn) coaches inline and
  play continues. Pick honestly — an over-marked 'losing' trap is a bug.
- `explanation` / `fix` are hand-written coaching prose — use `CONTEXT.md` vocabulary.

## Testing (non-negotiable)

Every opening file has a sibling `.test.ts` (copy the pattern from `italian.test.ts`) that
replays every mainline and trick line through chess.js and asserts legality of `moves`,
`wrongReply`, `fixMove`, and `punishment`. A new opening without this test will be blocked
in review.

## Recent changes

- Added Caro-Kann Defense module (Black repertoire).
- Initial openings: Italian, Queen's Gambit, Sicilian.
