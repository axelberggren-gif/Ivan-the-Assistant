# Changelog

Newest first. One line per PR, added in the same PR. This file is the session-to-session
memory for AI agents — `tail -n 40 CHANGELOG.md` is part of the session-start ritual.

## 2026-08

- fix(problems): stop giving the answer away while you are still solving (ADR-0007).
  ADR-0006 sealed the commit gate but not the panel around it: the reasoning coach's
  feedback — which is generated from the authored solution and lists the moves you missed,
  in notation — was published the moment grading finished and rendered for the whole solve
  phase, sitting directly under "Try again? / Show answer"; the engine lines, whose first
  line *is* the solution, were one click away behind a toggle the entire time; and the app
  nudged you toward them ("Reveal engine lines & solve", "check yourself against the engine
  lines"). Now: while an attempt is live, the only thing on screen about the answer is what
  you played. The wrong-line gate is the verdict and two buttons, full stop. Everything else
  arrives together when the attempt ends — solved, or stopped after you asked — and a retry
  re-seals it. The store enforces this by holding the data in closures rather than state
  (provable in `problems.test.ts`; the panel guards are a second lock), so grading still
  happens on submit and nobody waits for it later. The eval bar is masked for the whole
  attempt too, which also fixes a wrong number: no engine runs during the solve phase, so
  the bar had been showing the starting position's eval next to a board several plies on

## 2026-07

- feat(problems): the solve phase now grades a **committed line**, not single moves
  (ADR-0006). You play the whole thing out — your moves *and* the replies you expect, with
  take-back and clear while you do — and "Commit my line" is the only checkpoint. Nothing is
  judged on the way: no move is confirmed, refuted or evaluated on its own, because
  "correct" after move 1 is a hint. A failed line is named as failed **and nothing else** —
  not even which ply broke it — on a new `wrong_move` status, and you pick: **"Try again?"**
  clears the line with the answer still hidden (a genuine second attempt, not fix-gated), or
  **"Show answer"** reveals it. The reveal is aimed at the ply that actually failed: one of
  your own moves gets the existing stop-and-explain (refutation animated, your written
  reasoning quoted), a mispredicted *reply* names the defence you missed with no refutation
  animation, and either way the retry afterwards is fix-gated on that ply and resumes from
  there. The solved message says which route you took, so self-correcting a miss reads
  differently from a stop-and-explain. Opponent replies are no longer auto-played in the
  solve phase (they cannot be, without leaking the verdict), so
  `ProblemSessionStatus` drops `'opponent_replying'`. Owner decisions, 2026-07-27; PLAN.md
  §8.1, CONTEXT.md "Committed line" / "Answer reveal"
- feat(ui): click-to-move on both boards — click a piece to highlight it, then click the
  square it should land on, as an alternative to dragging. An illegal move does nothing at
  all: the board is unchanged and the piece is simply unselected. Clicking the highlighted
  piece again puts it down, clicking another of your own pieces re-aims the selection, and
  clicking anywhere outside the board unselects. Works in the trainer, in the solve phase,
  and on the reason-phase scratch board (where either side can be moved, as with dragging);
  the read phase stays hands-off. The decision logic is pure and Node-tested
  (`src/components/clickToMove.ts`); selection is transient UI state in a shared hook
  (`useClickToMove`), never in the store
- feat(analysis): deep analysis — run your real games through Stockfish and the coach
  (PLAN.md §5.2a–5.2d, ADR-0005 now accepted). Milestone 5's unbuilt half: a new
  `src/analysis/` module annotates your chess.com games move by move, and the insights screen
  gains a weakness panel — blunder timeline, cost per phase, opening-phase diagnosis from the
  coach's own development heuristics, recurring mistakes clustered by reason code, and your
  worst moments linking back to the game. The coach's classification core is now exported as
  `classifyMove` / `deriveReasonCodes` (5.2a) so the report and the live trainer share one set
  of thresholds instead of forking them; `coach.test.ts` proves the parity case by case. The
  run is opt-in, bounded (150ms/position, ply cap 60 = move 30, decided-position cutoff, 25
  games by default), cached forever per game in IndexedDB, cancellable without losing
  completed work, and it commits game by game so the panel fills in as it goes. It runs on its
  **own** engine instance created lazily and disposed the moment it ends (ADR-0005 decision 1,
  +128 MB while running) and lives at `App` level, so you can train or solve problems while it
  works — progress and cancel follow you across screens via a nav chip, with an ETA averaged
  over genuinely analysed games so a warm cache never promises seconds and then takes minutes.
  The ~10 worst moves are re-run at full depth before being shown. `InsightsGame` gains an
  optional `pgn`; `createEngine` gains an optional `{ hashMb }`; `src/types.ts` is untouched
- docs(plan): spec deep analysis (PLAN.md §5.2, ADR-0005) — the unbuilt half of Milestone 5
  and the blocker on 6d's motif half. A background queue annotates your real chess.com games
  with Stockfish on its **own** engine instance (a scoped exception to App.tsx's shared-engine
  rule, so a 5-minute batch never parks an interactive move), reusing the coach's thresholds
  via new exported `classifyMove` / `deriveReasonCodes` rather than duplicating them. Bounded
  and resumable: 150ms/position, ply cap 60, decided-position cutoff, per-game IndexedDB cache,
  cancellable, results committed game by game. The run lives at `App` level so it continues
  while you train, reporting "Game 7 of 25 · ~3 min left" from any screen. Lands as a new
  `src/analysis/` module (Phase 5's post-game review reuses the same primitive) across four
  PRs, 5.2a–5.2d. Owner decisions on 2026-07-25: background-with-progress accepted; motif
  detection dropped, so **6d is opening-only and no longer blocked**; the second engine
  instance (measured at +128 MB while running, freed on dispose) is still open. Docs only;
  no code yet.
- fix(problems): stop one bad problem file from killing problems mode. Reported as
  `Problem file "backRankMate.json" contains a malformed problem` across several files —
  the bundled data is in fact valid (all 8315 problems pass the loader and the chess.js
  replay test); the error came from an *installed PWA still running the pre-fix bundle*,
  whose old validator rejected the 8-ply `veryLong` lines. Three changes so neither half
  can recur: the loader now **drops** entries that fail structural validation and only
  errors when a file has nothing usable left; a failed theme draw **retries another theme**
  (bounded at 4) instead of dead-ending the mode; and the service worker registration moved
  to `virtual:pwa-register` in `src/main.tsx` so an updated worker **reloads the page**
  instead of leaving an open tab on stale code (ADR-0004 amended).
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
