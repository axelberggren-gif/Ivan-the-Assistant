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

**The memory cost, measured.** Read straight out of the shipped binary's memory section
(`public/engine/stockfish-18-lite-single.wasm`):

| | Per engine instance |
|---|---|
| WASM linear memory, **initial** | 2048 pages = **128 MB**, committed at instantiation |
| WASM linear memory, max it may grow to | 32768 pages = 2048 MB (never approached here) |
| Compiled module (7.0 MB `.wasm` on disk) | may be shared between workers by the browser's compiled-module cache; the 128 MB linear memory is **not** shared |

So a second instance costs a flat **+128 MB resident while a run is in progress**, not a
percentage of something small. Two things bound it: the 128 MB is a fixed reservation this
build makes regardless of workload, and 150ms searches with a small transposition table
never push it to grow; and `dispose()` terminates the worker, returning the whole allocation
the moment the run ends or is cancelled.

Context for that number: a desktop or a current phone will not notice. The devices where it
could matter are old, low-RAM phones — mobile browsers cap per-tab memory (roughly a
gigabyte-and-a-bit on recent iOS Safari, device-dependent, and less on older hardware), and
a tab that crosses the cap is killed outright rather than slowed. At 2 × 128 MB plus the app
itself we stay well clear of that, but it is the failure mode to watch, and it is why the
run is opt-in and disposed eagerly rather than kept warm.

Guards on the memory cost: exactly **one** batch instance ever, never auto-started, disposed
as soon as the run finishes or is cancelled. The batch engine also pins a small hash
(`setoption name Hash value 16`) — at 150ms per search a large transposition table buys
nothing and only invites the allocation to grow.

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

### 4b. It runs in the background, and it always says where it's up to

A five-minute job the user has to sit and watch is a five-minute job they cancel. Two
requirements, both load-bearing rather than polish:

- **The run survives navigation.** The analysis store is created once at `App` level
  alongside the other stores — not inside the insights screen — so switching to Train or
  Problems mid-run does not unmount or cancel it. This is also what makes the dedicated
  batch engine (decision 1) non-negotiable rather than merely tidy: the moment the user can
  train while analysis runs, the two genuinely need separate engines.
- **Progress is always visible and always honest.** `AnalysisProgress` carries
  `gamesDone / gamesTotal`, the current game, `pliesDone / pliesTotal` within it, and an
  `etaMs`. The insights screen shows the full bar ("Game 7 of 25 · ~3 min left"); a compact
  chip in the nav shows the same run from any other screen, with cancel available from
  either.

Two details the ETA has to get right, or it lies. Cached games complete instantly, so the
estimate is computed from a rolling mean of *actually analysed* games only — otherwise a
re-run reports "12 seconds left" and then takes four minutes on the first uncached game.
And games are analysed newest first, so a cancel at any point leaves the user with the
games they care most about.
- **Deep re-check of the worst moments**: after the scan, the ~10 worst moves are re-analysed
  at full depth before being shown, so the headline findings are not artefacts of a 150ms
  search.

### 5. `InsightsGame` gains an optional `pgn`

`src/insights/types.ts` gets `pgn?: string` on `InsightsGame` (additive, optional — the file
header's rule allows it) so the analysis queue can work from the same normalized game list
the dashboard already has, instead of a second parallel list of raw games.

## Owner decisions (2026-07-25)

1. **Second WASM instance — open.** Measured cost is +128 MB resident for the duration of a
   run (see decision 1), freed on dispose. Awaiting the owner's call, but note that decision
   2 below effectively settles it: analysis running in the background while the user trains
   requires two engines. Reusing the single engine is only viable if analysis is allowed to
   block the rest of the app.
2. **Background + progress — accepted.** 25 games stands as the default, with the run
   surviving navigation and reporting `gamesDone / gamesTotal` plus an ETA from any screen
   (decision 4b).
3. **Motif detection — dropped.** The coach's reason codes do not carry a motif
   (`misses_tactic` never says *fork* or *pin*), so mapping them onto Lichess problem themes
   would mean building a detector on top of the refutation line. Not worth it for now:
   **6d stays opening-only**, served by the existing `recommendTraining`. `motifs.ts` and the
   5.2e step are cut from this spec. This does *not* touch §5.2's own "recurring mistakes"
   finding, which clusters by the coach's reason codes and needs no motif detection — what
   is dropped is only the bridge from those codes to problem recommendations.

## Consequences

- **Insights stops being a dashboard.** The screen gains findings drawn from the same coach
  that runs the trainer, so "you drift at move 9" is measured on real games, not asserted.
- **Phase 5 gets its engine for free.** `annotate.ts` takes SAN moves and a colour — it does
  not know or care that they came from chess.com, so post-game review of in-app games reuses
  it unchanged.
- **6d is unblocked as scoped**: opening-only, via the existing `recommendTraining`, and no
  longer waiting on anything in §5.2. Recommending problems *by motif* stays possible later
  — the annotated games are cached, so a future `motifs.ts` could mine them without
  re-running the engine — but it is out of scope and no code should anticipate it.
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
