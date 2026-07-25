# src/coach — coaching brain (classification, heuristics, feedback text)

- `eval.ts` — cp math: `MATE_CP` mapping, `toUserCp`, `computeCpLoss` (clamped ≥ 0).
- `index.ts` — `assessMove`: classification thresholds + reason codes. The thresholds
  (`GOOD_MAX`, `INACCURACY_MAX`, `MISTAKE_MAX`, collapse detection) live **here and only
  here** — never duplicate them in UI, store, or `src/analysis`. The reusable core is
  exported as `classifyMove` (verdict + cpLoss + `threwPosition`) and `deriveReasonCodes`;
  `assessMove` is those two plus book/trap handling and prose.
- `development.ts` — the 0–100 development score heuristic (minors out, castling, center
  pawns, tempi lost).
- `position.ts` — board-fact helpers (hanging pieces, last-move facts).
- `templates.ts` — all coach-visible prose. Tone: encouraging, concrete, uses `CONTEXT.md`
  vocabulary (blunder vs mistake, trap, fix move, …).

## Invariants

- Classification is a pure function of engine analysis before/after + book/trap info. No
  randomness, no DOM, no engine calls from this module — it receives `EngineAnalysis`.
- A blunder is: cpLoss > `MISTAKE_MAX`, an eval collapse of a holdable position, or a
  game-losing trap — and **always** triggers stop-and-explain (CONTEXT.md).
- Coach text comes from `templates.ts` only; components render it, they don't compose it.
- `classifyMove` / `deriveReasonCodes` are the single source of classification for both the
  live trainer and the post-game report (ADR-0005). Changing a threshold changes both —
  which is the point. A future agent must not fork them into `src/analysis`.

## Recent changes

- Extracted `classifyMove` + `deriveReasonCodes` (ADR-0005 decision 2) so batch analysis can
  reuse the coach's verdict without its trainer-shaped prose. `assessMove` is refactored to
  call both; `coach.test.ts` proves the parity case by case.
- Trap severity handling: play-on coaching for minor traps, fix-gated retry.
- Initial coach: thresholds, reason codes, development score, templates.
