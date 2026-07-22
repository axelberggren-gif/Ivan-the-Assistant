# src/book — history-keyed opening book

Builds an index over every prefix of every line (mainlines and trick lines) so a lookup at
any point along a known line returns the known next moves with weights
(`WEIGHT_MAINLINE` > `WEIGHT_TRICK`).

## Invariants

- Index key is `openingId + ' ' + historySan.join(' ')` — book state is derived purely from
  SAN history, never from FEN (transpositions are out of scope for v1; see PLAN.md).
- The book is **read-only at runtime**: built once from `src/data` openings via
  `createBook(openings)`. No mutation after construction.
- "Out of book" (no known continuation for either side) does **not** end coaching — the
  session continues engine-only (see CONTEXT.md).

## Recent changes

- Initial opening book with weighted mainline/trick sampling.
