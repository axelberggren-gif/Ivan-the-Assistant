# src/store — session state (zustand vanilla stores)

- `session.ts` — the play → assess → respond training loop. Built **strictly against the
  contracts in `src/types.ts`**, with `SessionDeps` (book, engine, coach) injected at
  creation so the store is testable with fakes (`session.test.ts`).
- `problems.ts` — the read → reason → solve problems loop (Milestone 6). Same seam:
  `ProblemsDeps` (engine, problems, llm) injected at creation, faked in `problems.test.ts`.
- `context.ts` / `problemsContext.ts` / `insightsContext.ts` — React wiring (`useStore`);
  keep React out of the store files themselves.
- `insights.ts` — chess.com insights state, separate store from the training session.

## Invariants

- The store orchestrates; it does not compute. Move legality → chess.js, evaluation →
  engine, classification/prose → coach, known moves → book. If you find chess logic in the
  store, it's in the wrong place.
- `evalCp` in state is White-perspective (mate mapped to ±10000) — feed the eval bar
  directly, convert per-user only at the coach boundary.
- Status transitions follow CONTEXT.md: blunder → stopped (stop-and-explain) → retry
  requires the fix move; minor trap → inline explanation, play continues; out-of-book →
  play continues engine-only to the middlegame cap (~move 25).
- Session deps are injected, never imported concretely — tests rely on this seam.

- Problems-mode transitions follow PLAN.md §8.1: read check gates reasoning, reasoning
  gates solving; a wrong solve move → stop-and-explain → fix-gated retry; the reasoning
  coach failing (or no key) degrades to the engine-line reveal, never blocks the phase.

## Recent changes

- `activity.ts` (+ `activity.test.ts`): tiny localStorage tracker for the Today screen —
  day-streak + puzzles-solved-today. The date maths (`advance`, `withSolved`, `dateKey`)
  is pure and Node-testable; `loadActivity`/`persistActivity` wrap storage. No backend,
  no accounts (AGENTS.md invariant 6). App records solves by watching the problems store's
  `solvedCount`.
- Problems served unlabeled: `startProblem`/`nextProblem` draw a weighted-random problem
  across all theme files (no `pickTheme`); the motif is revealed only in the solved notice.
- Problems session store: read → reason → solve loop with injected deps (Milestone 6).
- Fix-gated retry + notice/hint-arrow handling.
- Initial session store with injected deps.
