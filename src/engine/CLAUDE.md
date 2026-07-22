# src/engine — Stockfish WASM wrapper (Web Worker, UCI)

Two layers, keep them separate:

- `uci.ts` — **pure** UCI-protocol helpers (parse `info`/`bestmove`, UCI↔SAN). No Worker,
  no DOM: everything here is unit-testable in Node (`uci.test.ts`).
- `index.ts` — the Worker lifecycle + `EngineAPI` implementation. Serializes searches (one
  `go` in flight at a time), single-threaded "lite" Stockfish 18 build from
  `/engine/stockfish-18-lite-single.js` (no COOP/COEP headers needed).

## Invariants

- Raw engine scores are **side-to-move perspective**; this module converts them so that
  everything leaving `src/engine` is **White-perspective** (`EngineLine.cp`/`mate`).
  Downstream code must never re-interpret perspective — that's `src/coach/eval.ts`'s job.
- Only this module touches the Worker or the UCI byte stream. If another module needs
  engine data, extend `EngineAPI` in `src/types.ts` (optional fields) instead.
- Opponent strength is bounded (`Skill Level` + movetime); full-strength search is reserved
  for assessment, not for the opponent's replies.
- Anything DOM/Worker-dependent stays out of `uci.ts` so the tests keep running in Node.

## Recent changes

- Initial engine module: worker wrapper, UCI parsing, serialized search queue.
