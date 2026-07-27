# src/problems — problems-mode logic (read check, solve matching, loader)

The Milestone 6 logic layer between the bundled problem data (`public/problems/`) and the
problems store/UI. Phases per PLAN.md §8: read → reason → solve.

- `loader.ts` — `createProblemSource(baseUrl)`: fetches + structurally validates
  `manifest.json` and per-theme problem files, caches both in memory.
- `read.ts` — Read check math: `materialDiff` (from the FEN board field), `verdictFromCp`
  (5-bucket verdict), `analysisCpWhite`, `checkRead`.
- `solve.ts` — UCI↔SAN helpers (`uciToSan`, `sanLineFromUci`), `isSolutionMove` (Lichess
  matching: authored move OR any immediate checkmate), `engineLineSummaries`.
- `templates.ts` — ALL problems-mode prose (read-check comments, stop-and-explain text,
  fix-move reminders, solved messages, notices).
- `index.ts` — the public surface the store and UI import from.

## Invariants

- **All user-visible problems-mode prose lives in `templates.ts`** — mirror of the
  `src/coach/templates.ts` rule. Logic returns strings from there; components render them.
- `read.ts` and `solve.ts` are **pure and Node-testable**: no fetch, no DOM, no engine or
  worker access. `solve.ts` may use chess.js; `read.ts` parses FENs directly.
- **`loader.ts` is the only fetch point** in this module. Runtime validation is structural
  only — chess.js replay of the bundled data is the data test's job (proven at build time).
- The verdict **thresholds live in `read.ts` only** (`VERDICT_BETTER_MIN`,
  `VERDICT_WINNING_MIN`) — never duplicate them in UI or store.
- Centipawns are **White-perspective** everywhere (repo invariant); convert to the user's
  perspective only via `src/coach/eval` (`lineCpWhite`, `toUserCp`, `MATE_CP`).
- Problem data follows the Lichess convention: `moves[0]` is the opponent's **setup move**;
  the user's solution starts at `moves[1]` (see CONTEXT.md and PLAN.md §8.2).

## Recent changes

- Whole-line grading (ADR-0006): `solve.ts` gains **`gradeLine`** — pure, the single source
  of solve-phase truth — which walks a committed line against the authored one and returns
  either `correct` or the **first** `LineDeviation` (ply index, whose ply, position before,
  what was played, what was expected). Even plies are the user's own moves and keep Lichess
  matching (`isSolutionMove`); odd plies are the replies the user predicted and must be the
  authored reply. Never grade move by move again — that is the hint the mode exists to avoid.
- Answer reveal is opt-in (CONTEXT.md, PLAN.md §8.1): `templates.ts` gains
  `wrongLineVerdict` (says the line failed and reveals NOTHING else — not the failing ply,
  no refutation, no solution move; it is what the user reads while choosing),
  `buildingLineNotice`, `tryAgainNotice`, `wrongDefenceExplanation` (for a mispredicted
  reply — no engine line, since the continuation after a bad defence teaches the wrong
  lesson), and an optional `SolvedOpts.sawAnswer` so the solved message distinguishes a
  self-corrected miss from a stop-and-explain. `wrongMoveExplanation` is unchanged and is
  now only rendered once the user asks for the answer.
- Loader degrades instead of dying: an entry that fails structural validation is **dropped**
  (never served, warned about on the console) and the file's remaining problems are
  returned; only a file with *no* usable entries throws. All-or-nothing validation meant a
  single bad entry — or an app bundle whose validator had drifted from the data, as with the
  8-ply regression — took the whole mode down.
- Loader fix: `SOLUTION_MOVES_LENGTHS = [4, 6, 8]` is exported from `loader.ts` and is the
  single source of truth for allowed solution lengths — `data.test.ts` imports it, and the
  new `loader.test.ts` proves the loader accepts every length the pipeline produces (the
  old `[4, 6]` validator rejected the 8-ply `veryLong` lines and broke problems mode).
- Harder + more varied set: build pipeline now spans ~1400–2500 across four bands, a broad
  motif mix (adds doubleCheck/trappedPiece/deflection/attraction/sacrifice/intermezzo/
  advancedPawn + the defensive `defensiveMove`), and 4-move (`veryLong`) lines. `solve.ts`
  gains `formatSanLine` (pure): numbered SAN from a FEN, used to paste a tried line into the
  reasoning notes. `templates.ts` gains `exploreHint`. Problems are still served unlabeled.
- No motif hints (owner decision, 2026-07-22): `solvedMessage` + `curatedMotifNames` reveal
  the motif only after the solve; theme files are storage only, problems serve unlabeled.
- Initial problems-mode logic: loader, read check, solve matching, templates (Milestone 6b).
