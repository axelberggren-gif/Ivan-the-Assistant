# Changelog

Newest first. One line per PR, added in the same PR. This file is the session-to-session
memory for AI agents — `tail -n 40 CHANGELOG.md` is part of the session-start ritual.

## 2026-07

- docs(plan): spec deep analysis (PLAN.md §5.2, ADR-0005) — the unbuilt half of Milestone 5
  and the blocker on 6d's motif half. A background queue annotates your real chess.com games
  with Stockfish on its **own** engine instance (a scoped exception to App.tsx's shared-engine
  rule, so a 5-minute batch never parks an interactive move), reusing the coach's thresholds
  via new exported `classifyMove` / `deriveReasonCodes` rather than duplicating them. Bounded
  and resumable: 150ms/position, ply cap 60, decided-position cutoff, per-game IndexedDB cache,
  cancellable, results committed game by game. Lands as a new `src/analysis/` module (Phase 5's
  post-game review reuses the same primitive) across five PRs, 5.2a–5.2e. Three decisions need
  the owner's call — see the ADR's "Open questions". Docs only; no code yet.
- fix(problems): accept 4-move (`veryLong`) solutions in the runtime loader. The
  loader's structural validator still only allowed 4/6-ply solutions, so every
  regenerated theme file (which now contains 8-ply lines) failed validation and
  problems mode was dead at runtime — while CI stayed green because nothing ran the
  bundled data through the loader. The allowed lengths are now exported from
  `loader.ts` (`SOLUTION_MOVES_LENGTHS`) and imported by `data.test.ts` so data and
  validator can't drift again, and a new `loader.test.ts` covers the loader with a
  stubbed fetch (including the 8-ply regression case).
- feat(problems): harder, more varied problem set + reason-phase scratch board.
  The build pipeline now curates a wide difficulty spread (~1400–2500, balanced across
  four bands), a broad motif mix (adds doubleCheck, trappedPiece, deflection, attraction,
  sacrifice, intermezzo, advancedPawn, and the defensive `defensiveMove` so the read-check
  verdict isn't always "you're winning"), and 4-move (`veryLong`) lines alongside 2–3
  movers. In the reason phase the board is now a scratchpad: try candidate lines, take
  back/clear, and paste the numbered notation into your notes with one click — you motivate
  the line instead of transcribing it. The `refresh-problems` workflow regenerates the
  bundled data from the Lichess dump; `data.test.ts` no longer pins the exact rating band
  so it stays green across regenerations
- feat(pwa): make Ivan an installable, offline-capable PWA — web manifest + Workbox
  service worker via vite-plugin-pwa (autoUpdate), knight-on-meadow icons (192/512/
  maskable/apple-touch/favicon), light-precache app shell with runtime caching for the
  Stockfish WASM, problem JSON, and fonts; base-URL aware for the GitHub Pages deploy.
  The BYOK Anthropic API is intentionally never cached (ADR-0004, ADR-0003, invariant 6)
- feat(ui): Ivan · Meadow redesign — sage-green light theme (Nunito/Manrope, pill nav,
  gradient hero cards, rounded white panels, green board), rebrand to "Ivan", a new
  "Today" home screen with a real localStorage streak + daily-goal, problems phase
  stepper, and a mobile bottom nav
- feat(problems): serve problems without motif hints — random start, motif revealed after
  the solve
- ci(deploy): publish the app to GitHub Pages on every push to main; runtime asset
  paths (engine worker, bundled problems) now respect Vite's base URL (Milestone 4 deploy)
- feat(problems): Problems mode — three-phase solving (read → reason → solve) on bundled
  Lichess CC0 problems with a BYOK reasoning coach and CI data-refresh workflow
  (Milestone 6a–6c, PLAN.md §8, ADR-0003); 6d (insights hookup) is a follow-up
- docs(plan): Problems mode solution plan — three gated phases (read → reason → solve),
  bundled Lichess CC0 problems, BYOK reasoning coach (PLAN.md §8, ADR-0003)
- chore(repo): adopt AI-first guardrails — AGENTS.md canon, per-directory CLAUDE.md files,
  ADR log, CI + AI-review + PR-title workflows, PR template, onboarding guide (ADR-0002)
- feat(insights): chess.com stats dashboard + train-what-you-lose recommendations (Milestone 5)

## 2026-06 and earlier (prototype phase, pre-changelog)

- feat(data): Caro-Kann Defense module for Black's repertoire
- feat(coach): trap severity, play-on coaching for minor traps, fix-gated retry
- docs: CONTEXT.md domain glossary from grilling session
- feat: engine (Stockfish WASM worker), coach, opening book, session store, UI modules
- feat(data): opening data — Italian, Queen's Gambit, Sicilian
