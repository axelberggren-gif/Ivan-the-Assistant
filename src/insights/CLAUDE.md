# src/insights — chess.com stats & train-what-you-lose recommendations

- `chesscom.ts` — client for the **public, unauthenticated** chess.com API
  (`https://api.chess.com/pub/...`). Browsers forbid setting `User-Agent` on fetch; the API
  works without it — never attempt to set request headers.
- `cache.ts` — IndexedDB-backed `KVStore` so monthly archives are fetched once.
- `stats.ts` / `recommend.ts` — pure aggregation + opening recommendations from losses.
- `types.ts` — module-local types (client, cache, stats shapes).

## Invariants

- **No auth, ever.** If a feature seems to need a chess.com login or API key, stop — that's
  an architecture change (AGENTS.md invariant 6): ADR + owner approval first.
- Immutable archive months are cached forever; the current month is re-fetched. Don't
  invalidate the cache wholesale.
- Failures surface as `InsightsError` with a user-readable message — the insights screen
  must degrade gracefully offline (cache-only).
- `stats.ts`/`recommend.ts` stay pure (no fetch, no IndexedDB) so they're unit-testable.

## Recent changes

- Initial insights: stats dashboard + train-what-you-lose recommendations (Milestone 5).
