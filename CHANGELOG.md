# Changelog

Newest first. One line per PR, added in the same PR. This file is the session-to-session
memory for AI agents — `tail -n 40 CHANGELOG.md` is part of the session-start ritual.

## 2026-07

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
