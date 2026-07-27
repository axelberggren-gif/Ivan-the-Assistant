# src/store — session state (zustand vanilla stores)

- `session.ts` — the play → assess → respond training loop. Built **strictly against the
  contracts in `src/types.ts`**, with `SessionDeps` (book, engine, coach) injected at
  creation so the store is testable with fakes (`session.test.ts`).
- `problems.ts` — the read → reason → solve problems loop (Milestone 6). Same seam:
  `ProblemsDeps` (engine, problems, llm) injected at creation, faked in `problems.test.ts`.
- `context.ts` / `problemsContext.ts` / `insightsContext.ts` — React wiring (`useStore`);
  keep React out of the store files themselves.
- `insights.ts` — chess.com insights state, separate store from the training session.
- `analysis.ts` — the deep-analysis run (PLAN.md §5.2). Same seam: `AnalysisDeps`
  (`createEngine` factory, cache, clock) injected at creation, faked in `analysis.test.ts`.

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

- Deep analysis is **created at App level**, not inside the insights screen, so a run
  survives navigation (ADR-0005 decision 4b). It never auto-starts, is always cancellable,
  commits game by game, and owns a batch engine instance that is disposed when the run ends.

- Problems-mode transitions follow PLAN.md §8.1: read check gates reasoning, reasoning
  gates solving; the solve phase records plies for **both** sides and judges nothing until
  `commitLine` (ADR-0006) → wrong ⇒ `wrong_move` (verdict only, nothing revealed) → either
  `retryWrongMove` (clear the line, answer still hidden, **no** fix gate) or `revealAnswer`
  → stop-and-explain at the failing ply → fix-gated retry; the reasoning coach failing (or
  no key) degrades to the engine-line reveal, never blocks the phase.

## Recent changes

- Commit-the-line solve loop in `problems.ts` (ADR-0006): `userMove` no longer filters by
  side or judges anything — it appends a ply — and `undoLineMove` / `clearLine` /
  `commitLine` drive the rest. `lineComplete` (state) gates the commit button;
  `attemptFloor` + `attemptFloorSan` + `pendingFixUci` (closures) mark where the current
  attempt starts, so take-back, clear and "Try again?" all stop there and a post-reveal fix
  gate is re-armed when the user rewinds onto it. `commitLine` calls the pure `gradeLine`
  and, on failure, parks the deviation in `pendingDeviation` while the `wrong_move` status
  shows the verdict alone (no engine call, so not even the eval bar moves). `revealAnswer`
  rewinds to the failing ply, replays it, and either runs stop-and-explain (the user's own
  move) or names the missed defence (a mispredicted reply — no refutation animation);
  `answerRevealed` is what the solved message reports via `sawAnswer`.
- `analysis.ts` (+ `analysis.test.ts`) and `analysisContext.ts`: the background deep-analysis
  store — select → annotate → aggregate, with progress/ETA, cancel that keeps completed work,
  and a report rebuilt on every per-game commit so the panel fills in as the run proceeds.
- Resilient problem draw: `startRandomProblem` skips a theme file that fails to load and
  re-draws from the remaining themes (`MAX_THEME_DRAW_ATTEMPTS = 4`, bounded so an offline
  client fails fast). One broken file costs a few puzzles, not the whole mode; the last
  failure's message is what surfaces if every attempt fails.
- Reason-phase scratch board: `problems.ts` gains `exploreSan` state and `exploreMove` /
  `undoExplore` / `resetExplore` / `commitExploreToReasoning` actions. Exploration runs on a
  throwaway `scratch` chess instance (the real `chess` is never touched), so trying lines
  never counts as a solve attempt; committing pastes the numbered notation into `reasoning`.
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
