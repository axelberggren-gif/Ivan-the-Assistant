> **Canon** — current source of truth for any AI agent working in this repo. If reality and
> this file disagree, fix this file in the same PR.

# Ivan the Assistant (Chess Coach) — root brief for AI agents

This is the canonical entry point for any AI coding agent (Claude Code, Codex, Cursor, Aider,
Copilot, …) working in this repo. Claude Code loads it via the `@AGENTS.md` import in
`CLAUDE.md`. Other agents should read it directly.

The owner (Axel) is **non-technical**. The guardrails in this repo exist so that AI agents can
do the work while the *important technical decisions are recorded and automatically enforced*.
Respect them strictly — they are not optional style preferences.

## Project at a glance

- **Stack**: Vite + React 18 + TypeScript 5 · zustand · chess.js · react-chessboard ·
  Stockfish 18 WASM (Web Worker, UCI). **Browser-only SPA — no backend, no secrets.**
- **Purpose**: an interactive chess coach that teaches openings by playing them against you,
  commenting on every move, and stopping the game when you've thrown it. Personal training
  tool first, product later.
- **Domain language**: `CONTEXT.md` is the ubiquitous language (Opening, Line, Trap, Bait,
  Book move, Blunder, Stop-and-explain, Fix move, …). Use exactly those terms in code, UI
  copy, and docs — and update `CONTEXT.md` in the same PR when a term evolves.
- **Roadmap**: `PLAN.md` (milestones). Don't silently deviate from it; propose changes there.

## Session-start ritual (every session, in order)

1. Read this file (Claude Code auto-loads it via `CLAUDE.md`).
2. Read `CONTEXT.md` — the domain glossary you must speak.
3. `tail -n 40 CHANGELOG.md` — what changed recently.
4. `git log --oneline -10 && git status` — what's in flight.
5. Read `docs/decisions/` (the ADR log) for accepted technical decisions you must honour.
6. Read the per-directory `CLAUDE.md` for the area you'll touch (map below).

## Per-directory CLAUDE.md map

@src/data/CLAUDE.md
@src/book/CLAUDE.md
@src/engine/CLAUDE.md
@src/coach/CLAUDE.md
@src/store/CLAUDE.md
@src/insights/CLAUDE.md

## Global invariants (do NOT break — the `claude-review` bot blocks PRs that violate these)

1. **`src/types.ts` is the module contract.** It is the interface boundary between modules
   (data, book, engine, coach, store, UI). Never change an existing signature in place —
   extend with new optional fields or module-local types. A breaking contract change needs
   an ADR in `docs/decisions/` in the same PR.
2. **Centipawns are always White-perspective** in shared state and `EngineAnalysis`. Convert
   to the user's perspective only via `toUserCp` / `bestLineUserCp` (`src/coach/eval.ts`).
   Mate scores map to ±(`MATE_CP` − distance). Never introduce a second convention.
3. **Trap semantics are fixed** (see `CONTEXT.md`): a `severity: 'losing'` trap stops the
   session (stop-and-explain); a `'minor'` trap delivers its explanation inline and play
   continues. Retry after a blunder requires the authored `fixMove` — any other move is
   bounced with a hint.
4. **Opening data must prove itself.** Every opening file in `src/data/` ships with a test
   (same pattern as the existing ones) that replays every mainline and trick line through
   chess.js: all moves legal from the start position, `wrongReply` and `fixMove` legal in
   the bait position, `punishment` legal after the wrong reply. New openings register in
   `src/data/index.ts`.
5. **All engine access goes through `src/engine/`.** UI, coach, and store never talk to the
   Stockfish worker or parse UCI directly. Pure protocol helpers live in `src/engine/uci.ts`
   (Node-testable, no DOM); the worker wrapper lives in `src/engine/index.ts`.
6. **No secrets, no accounts, no personal data.** The chess.com integration uses the public
   unauthenticated API only. Anything that would need an API key, login, or backend is an
   architecture change: write an ADR first and get the owner's OK before building it.
7. **CI must pass**: `npm run typecheck && npm test && npm run build` — locally green before
   opening a PR; the `ci` workflow runs the same three steps.
8. **Git identity**: never run `git config user.name` / `user.email` — impersonating the
   owner is not allowed. Every commit you author ends with your agent's co-author trailer,
   e.g. `Co-authored-by: Claude <noreply@anthropic.com>`.

## Workflow

### Branches
`<type>/<short-kebab>` where `<type>` ∈ `feat fix chore docs refactor perf ci test`.
Examples: `feat/london-system`, `fix/retry-hint-arrow`. (Auto-generated `claude/…` branches
from remote sessions are fine too.) Branch off `main`; never commit directly to `main`.

### Commits & PR titles
[Conventional Commits](https://www.conventionalcommits.org). The PR title becomes the squash
commit on `main`, so it must be valid (enforced by `pr-title-lint`). Examples:
`feat(data): add london system opening`, `fix(coach): clamp cp loss at zero`.

### Pull requests (the only path to `main`)
1. Push your branch; open a PR against `main`; fill in the template.
2. Update `CHANGELOG.md` (newest first) in the same PR.
3. If you touched a directory with a `CLAUDE.md`, update its "Recent changes" list.
4. If you changed an **architectural seam** (`src/types.ts`, the engine worker protocol, a
   new runtime dependency, anything needing a backend), add an ADR in `docs/decisions/`.
5. Checks must pass: **`ci`** (typecheck/test/build), **`claude-review`** (the AI gate),
   **`pr-title-lint`**. Then **Axel presses Merge** — the bot reviews and can block, but a
   human is always the final gate. Squash-merge only.

## Required commands

- `npm run dev` — local dev server (Vite).
- `npm run typecheck` — `tsc --noEmit`.
- `npm test` — Vitest, single run.
- `npm run build` — typecheck + production build.
- Run all three checks before opening a PR: **"green locally" == "green in CI"**.
