## What
<!-- One sentence describing the change. -->

## Why
<!-- 1–3 bullets on motivation. -->

## How (only if non-obvious)
<!-- Brief notes on the approach. -->

## Checklist
- [ ] `npm run typecheck && npm test && npm run build` passes locally
- [ ] No secrets, accounts, or backend calls added (this app is browser-only)
- [ ] New logic in `src/coach|engine|book|store|insights` has a test (or the PR says why not)
- [ ] New/edited opening data in `src/data/` has the legality test and is registered in `index.ts`
- [ ] If an architectural seam changed (`src/types.ts`, engine protocol, new dependency): ADR added in `docs/decisions/`
- [ ] `CHANGELOG.md` updated (newest first); touched dirs' `CLAUDE.md` "Recent changes" updated
- [ ] Vocabulary matches `CONTEXT.md` (and `CONTEXT.md` updated if a term evolved)

## Test steps
<!-- How to verify this works locally. -->
1.
