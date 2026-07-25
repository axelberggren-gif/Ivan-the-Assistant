# src/analysis — deep analysis of real games (batch, background)

The engine-driven half of Milestone 5 (PLAN.md §5.2, ADR-0005): run your real games through
the same Stockfish and the same coach the trainer uses, and turn the result into a weakness
report. Deliberately **chess.com-agnostic** — everything works from SAN moves and a colour,
so Phase 5's post-game review of in-app games reuses `annotate.ts` unchanged.

- `types.ts` — module-local contracts (`AnnotatedMove`, `AnnotatedGame`, `WeaknessReport`,
  `AnalysisQueue`, …). Same precedent as `src/insights/types.ts`: **`src/types.ts` is not
  touched**.
- `pgn.ts` — `parseGameMoves` (PGN movetext → SAN, clock/eval annotations stripped) and
  `selectGamesForAnalysis` (rated, standard, has a PGN, ≥ `minPlies`, newest first). Pure.
- `annotate.ts` — one game → `AnnotatedGame`, driving the injected engine. Also owns
  `DEFAULT_BUDGET`, `ANALYSIS_VERSION`, `budgetSignature`, and `verifyMove` (the full-depth
  re-check of one move).
- `queue.ts` — the batch scheduler: cache lookup, progress + ETA, cancel, per-game commit,
  and the deep re-check pass.
- `aggregate.ts` — `AnnotatedGame[]` → `WeaknessReport`. Pure. Owns the phase boundary
  (`phaseForMoveNumber`, `OPENING_LAST_FULL_MOVE`).
- `templates.ts` — ALL report prose. Pure.
- `index.ts` — the public surface the store and UI import from.

## Invariants

- **Classification is never re-implemented here.** `classifyMove` / `deriveReasonCodes` come
  from `src/coach` — the thresholds live there and only there (`src/coach/CLAUDE.md`).
  Analysis deliberately does *not* call `assessMove`: it wants the verdict, not the trainer's
  stop-and-explain prose.
- **All report prose lives in `templates.ts`** — mirror of the `src/coach/templates.ts` rule.
  Logic returns strings from there; components render them.
- `pgn.ts`, `aggregate.ts` and `templates.ts` are **pure and Node-testable**: no fetch, no
  engine, no DOM, no IndexedDB. `annotate.ts` and `queue.ts` are impure but take their
  engine and cache injected, so both are tested against fakes.
- **Its own engine instance, never the interactive one** (ADR-0005 decision 1). The queue
  creates one via `deps.createEngine`, lazily on the first genuinely uncached game, and
  disposes it the moment the run ends or is cancelled — each instance commits ~128 MB of
  WASM linear memory. A fully-cached run starts no worker at all.
- **Opt-in, cancellable, never blocking.** The run must never auto-start. If a future change
  makes analysis begin on page load, that is a regression, not an optimisation.
- Centipawns are **White-perspective** everywhere (repo invariant); the user's perspective
  only ever comes from `src/coach/eval` (`toUserCp`, `lineCpWhite`, `MATE_CP`).
- **Budget changes invalidate the cache.** Anything that alters what an annotation *says*
  belongs in `budgetSignature`; bump `ANALYSIS_VERSION` when the shape of `AnnotatedGame`
  changes.
- Scope is the **opening and early middlegame** (ply cap 60 = move 30). `GamePhase` has two
  members on purpose — endgame analysis is out of scope for this milestone.
- No new dependency on `src/insights`: the queue consumes a structural `SelectableGame`
  that `InsightsGame` happens to satisfy, and an `AnalysisCache` that the insights
  `KVStore` happens to satisfy.

## Recent changes

- Initial deep-analysis module: PGN parsing, per-game annotation, the batch queue with
  cache/progress/cancel, the weakness report, and the report prose (PLAN.md §5.2a–5.2d).
