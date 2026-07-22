# src/store — session state (zustand vanilla stores)

- `session.ts` — the play → assess → respond training loop. Built **strictly against the
  contracts in `src/types.ts`**, with `SessionDeps` (book, engine, coach) injected at
  creation so the store is testable with fakes (`session.test.ts`).
- `context.ts` / `insightsContext.ts` — React wiring (`useStore`); keep React out of the
  store files themselves.
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

## Recent changes

- Fix-gated retry + notice/hint-arrow handling.
- Initial session store with injected deps.
