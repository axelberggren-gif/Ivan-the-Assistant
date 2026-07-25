# 0005 — Deep analysis: a background engine queue over your real games

- **Status:** Proposed — awaiting the owner's decision on the three questions in
  "Open questions" below. Written as the spec for PLAN.md §5.2 (Milestone 5's
  unbuilt half).
- **Date:** 2026-07-25

## Context

Milestone 5 shipped only its cheap half. `src/insights/` reads chess.com PGN *metadata* —
results, ECO codes, terminations — and turns it into a dashboard plus the
"train what you lose" opening banner. PLAN.md §5.2 promised the other half: run your
actual games through Stockfish to produce a **blunder timeline**, an **opening-phase
diagnosis** using the coach's development heuristics, and **recurring mistakes** clustered
by reason code. None of that exists — `src/insights/` has no engine access at all.

It is also a blocker, not just a gap. Milestone 6d ("recommend problems by the motifs and
openings you actually lose to", PLAN.md §8.5) can only do the *opening* half today, because
nothing in the app knows which tactical motifs the user actually falls for.

Building it forces four decisions:

1. **The engine is single-threaded and serialized.** `createEngine()` runs one Web Worker
   and chains every search so only one `go` is in flight (`src/engine/index.ts`). Annotating
   25 games is ~1,500 searches — several minutes of continuous WASM compute. Sharing the
   one engine would park every interactive move behind that queue. But `src/App.tsx`
   deliberately shares a single engine across the trainer and problems mode, with a comment
   saying "a second worker would waste memory". This ADR has to either honour that
   convention or knowingly break it.
2. **The coach's thresholds are private.** `GOOD_MAX` / `INACCURACY_MAX` / `MISTAKE_MAX` and
   the collapse rule are module-local constants in `src/coach/index.ts`, and
   `src/coach/CLAUDE.md` says they live "here and only here". The only way in is
   `assessMove`, which is trainer-shaped: it demands a `BookCheckResult`, and it emits
   stop-and-explain prose and a refutation that a post-game report does not want.
3. **Where the code lives.** `src/insights/CLAUDE.md` requires `stats.ts` / `recommend.ts`
   to stay pure — no fetch, no IndexedDB. An engine-driven batch loop is the opposite of
   pure, and it is not really chess.com-specific: Phase 5 (post-game review of games you
   play *in* the app) needs the identical "annotate a game" primitive.
4. **Cost has to be bounded honestly.** A full-strength pass over a year of blitz is tens of
   minutes on a laptop and worse on a phone. The feature is worthless if it cannot be
   stopped, resumed, or cached.

## Decision

### 1. A dedicated batch engine instance, not a priority queue

Deep analysis creates its **own** `createEngine()` instance, owned by the analysis queue,
started lazily on the user's explicit "Analyse my games" click and disposed when the run
ends or the screen unmounts. The interactive engine is never touched, and `src/engine/`
needs no changes at all — a second instance is ordinary use of the module's public API.

This is a deliberate, scoped exception to the App.tsx "share one engine" convention. That
convention is right for the trainer and problems mode, which are *both interactive, never
simultaneously active, and always want the next search to be theirs*. Batch analysis is the
opposite: it is long-running, it does not care about latency, and it must never make a user
move wait. The alternative — a priority lane inside `src/engine/index.ts`'s `searchChain` —
was rejected: it complicates the most delicate code in the repo, cannot preempt an in-flight
`go` without adding UCI `stop` handling, and still leaves interactive moves waiting behind
whatever batch search is running.

Guards on the memory cost: exactly **one** batch instance ever, never auto-started, disposed
as soon as the run finishes or is cancelled.

### 2. Extract the coach's classification, don't duplicate it

Two pure functions are **added** to `src/coach/` (no existing signature changes):

```ts
// src/coach/index.ts
export interface MoveClassification {
  classification: Exclude<Classification, 'book'>
  cpLoss: number
  /** Eval collapsed a holdable position (the coach's "threw it" rule). */
  threwPosition: boolean
}
export function classifyMove(
  evalBefore: EngineAnalysis, evalAfter: EngineAnalysis, userColor: Color,
): MoveClassification

export function deriveReasonCodes(
  input: { historySan: string[]; fenAfter: string; san: string;
           evalBefore: EngineAnalysis; evalAfter: EngineAnalysis;
           userColor: Color; cpLoss: number; threwPosition: boolean },
): ReasonCode[]
```

`assessMove` is refactored to call both, so its behaviour is unchanged and `coach.test.ts`
proves the parity. The thresholds stay in `src/coach/index.ts` — single-sourced, exactly as
`src/coach/CLAUDE.md` requires. Analysis calls these directly and **does not** call
`assessMove`: it wants the verdict, not the trainer's stop-and-explain prose.

### 3. A new `src/analysis/` module

Not `src/insights/` (which must stay pure) and not `src/coach/` (which must stay
engine-free). The primitive "annotate a game from its SAN moves" is reusable by Phase 5's
post-game review, so it earns its own module:

| File | Job | Purity |
|---|---|---|
| `types.ts` | Module-local contracts (`AnnotatedMove`, `AnnotatedGame`, `WeaknessReport`, `AnalysisQueue`) — same precedent as `src/insights/types.ts` | types |
| `pgn.ts` | `parseGameMoves(pgn): string[]` — PGN movetext → SAN, clock/eval annotations stripped | pure (chess.js) |
| `annotate.ts` | One game → `AnnotatedGame`, driving the injected engine | impure (engine) |
| `queue.ts` | Batch scheduler: cache lookup, progress, cancel, incremental commit | impure (engine + KVStore) |
| `aggregate.ts` | `AnnotatedGame[]` → `WeaknessReport` | pure |
| `motifs.ts` | Tactical motif detection from the refutation PV (the 6d bridge) | pure (chess.js) |
| `templates.ts` | All analysis-report prose — mirror of the `src/coach/templates.ts` rule | pure |

`src/types.ts` is **not** touched. State lives in a new `createAnalysisStore(deps)` with
injected deps (`engine`, `cache`), following the `SessionDeps` / `ProblemsDeps` seam so it
is testable with a fake engine.

### 4. A bounded, cached, resumable budget

- **One search per position, not two.** The eval after move *N* is the eval before move
  *N+1*, so a 40-move game costs ~81 searches, not 162. MultiPV 3 only where the user is to
  move (needed to name a better move); MultiPV 1 elsewhere.
- **Time-boxed, not depth-boxed**: `movetimeMs: 150` per position, so a game costs a
  predictable ~12s regardless of position complexity.
- **Default scope: the 25 most recent rated standard games**, newest first (configurable to
  100). Skip games with no PGN and games under 10 plies.
- **Ply cap 60** (move 30). The coach's competence is the opening and early middlegame;
  endgame analysis is explicitly out of scope for this milestone.
- **Decided-position cutoff**: stop analysing a game once the eval has stayed beyond ±800cp
  for 6 consecutive plies. Blunders in an already-won or already-lost game are not lessons.
- **Cache forever, per game**: annotations go in the existing IndexedDB `KVStore`
  (`createIndexedDbStore`, db `chess-coach-insights`) under
  `analysis:v<ANALYSIS_VERSION>:<gameUrl>`. A game is never analysed twice; bumping
  `ANALYSIS_VERSION` (or changing the budget signature) invalidates. The 5-minute first run
  is a one-time cost, and the dashboard then works offline.
- **Cancellable and incremental**: an `AbortSignal` (same pattern as `LoadOptions.signal`)
  plus per-game commit, so cancelling keeps completed work and the report grows visibly from
  the third game rather than appearing at the twenty-fifth.
- **Deep re-check of the worst moments**: after the scan, the ~10 worst moves are re-analysed
  at full depth before being shown, so the headline findings are not artefacts of a 150ms
  search.

### 5. `InsightsGame` gains an optional `pgn`

`src/insights/types.ts` gets `pgn?: string` on `InsightsGame` (additive, optional — the file
header's rule allows it) so the analysis queue can work from the same normalized game list
the dashboard already has, instead of a second parallel list of raw games.

## Open questions for the owner

1. **Second WASM instance while analysing.** It roughly doubles engine memory for the
   duration of a run — the honest cost of not freezing the app. Acceptable, or should
   analysis instead refuse to start while a training session is live and reuse the one
   engine?
2. **Default scope of 25 games** (~5 minutes on a laptop, longer on a phone). Too slow for a
   first run, or is a visible progress bar with results appearing as they land enough?
3. **Motif detection** (decision 4 of the build plan, PLAN.md §5.2e). The coach's reason
   codes (`hangs_piece`, `misses_tactic`, …) do not map onto Lichess motifs — `misses_tactic`
   never says *fork* or *pin*. To make 6d recommend problems by motif, `motifs.ts` has to
   detect a small, honest set from the refutation line (hanging piece, fork, back-rank mate,
   forced mate) and leave the rest unlabelled. Worth building, or should 6d stay
   opening-only?

## Consequences

- **Insights stops being a dashboard.** The screen gains findings drawn from the same coach
  that runs the trainer, so "you drift at move 9" is measured on real games, not asserted.
- **Phase 5 gets its engine for free.** `annotate.ts` takes SAN moves and a colour — it does
  not know or care that they came from chess.com, so post-game review of in-app games reuses
  it unchanged.
- **6d becomes buildable in full** once `motifs.ts` exists; without it, 6d can still ship the
  opening half via the existing `recommendTraining`.
- **The coach refactor is load-bearing.** `classifyMove` / `deriveReasonCodes` become the
  single source of classification for both the live trainer and the report. A future agent
  must not fork these thresholds into `src/analysis/` — that is the exact duplication
  `src/coach/CLAUDE.md` forbids.
- **Still no backend, no accounts, no secrets.** Analysis is browser-local Stockfish over
  public chess.com data, cached in the user's own IndexedDB. Invariant 6 is untouched, and
  the service worker needs no new rules (ADR-0004) — the engine WASM is already cached.
- **A slow, opt-in feature enters the app.** It must never auto-start, must always be
  cancellable, and must never block the trainer. If a future change makes analysis start on
  page load, that is a regression, not an optimisation.
- **New seams to document when the code lands**: `src/analysis/CLAUDE.md` and its entry in
  the AGENTS.md per-directory map; a note in `src/engine/CLAUDE.md` that a second instance is
  reserved for batch analysis; the extracted exports in `src/coach/CLAUDE.md`.
