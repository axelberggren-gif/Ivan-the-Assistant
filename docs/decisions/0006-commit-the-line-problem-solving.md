# 0006 — Problems mode grades a committed line, not single moves

- **Status:** Accepted — owner decision, 2026-07-27.
- **Date:** 2026-07-27

## Context

Phase 3 of problems mode (PLAN.md §8.1) used to judge every move the instant it was played:
a correct move triggered the opponent's authored reply, and a wrong move immediately ran
stop-and-explain — the refutation animated and the coach named the solution move. Two things
were wrong with that, and the owner called both:

1. **The answer was spent by accident.** A single misclick handed over the solution to a
   problem the user could have found on a second look. (Fixed first, in the commit before
   this ADR: a wrong move is now only *named* as wrong, and the user chooses between
   "Try again?" and "Show answer".)
2. **Per-move judging is still a guessing game.** Being told "correct" after move 1 is a
   hint — it confirms the idea before the user has had to see the whole line through. The
   habit the mode exists to build is *commit to a full line, then check it*.

Deferring the verdict to a commit forces one structural consequence. If the app keeps
auto-playing the opponent's authored reply after each user move, then a wrong user move
leaves that authored reply illegal often enough to matter (it may capture a piece that just
moved, or block a check that no longer exists). Falling back to "stop replying" or to an
engine reply would leak exactly what the commit gate is meant to hide: whether the move was
right. So the replies have to come from the user.

That is not a workaround — it is the exercise. PLAN.md §8 already says every problem is a
2–4 move line "where the user must see the opponent's replies in advance". Playing those
replies is how they prove it, and the reason phase already works this way (the scratch
board).

## Decision

1. **The solve phase builds a line; committing it is the only checkpoint.** The user plays
   out the whole line from the solve position — their own moves *and* the replies they
   expect — with "Take back" / "Clear" while they do. No move is confirmed, refuted,
   evaluated, or answered on its own. "Commit my line" is enabled once the line is
   gradeable (every authored ply played, or the game ended earlier — a mate found sooner
   counts, per Lichess semantics).
2. **Grading is pure and lives in `src/problems/solve.ts`** (`gradeLine`), not in the store:
   the user's own moves follow the existing `isSolutionMove` rule (authored move or any
   immediate mate); a predicted reply must be the authored reply, because a line that only
   beats a weaker defence proves nothing.
3. **A failed line is named as failed and nothing more** — not even which ply broke it. From
   the `wrong_move` gate, "Try again?" clears the line with the answer still hidden;
   "Show answer" reveals it. Retrying costs nothing but time.
4. **The reveal is targeted at the ply that actually failed.** If it was one of the user's
   own moves, that is the existing stop-and-explain (rewind, replay the move, animate the
   engine's refutation, quote the user's written reasoning). If it was a *predicted reply*,
   there is no refutation animation — the engine's continuation after a bad defence would
   teach the wrong lesson — just the missed defence named. Either way the retry afterwards is
   fix-move-gated on the authored move for that ply, and restarts from there rather than from
   the top of the line.
5. **`ProblemSessionStatus` loses `'opponent_replying'`** (nothing auto-replies any more) and
   keeps `'wrong_move'`. This is a narrowing of a `src/types.ts` union, i.e. the breaking
   contract change that AGENTS.md invariant 1 asks an ADR for. It is safe here because the
   status is problems-mode-local and `tsc` proves every consumer was updated; the trainer's
   own `SessionStatus` is untouched.

## Consequences

- **Do not re-add per-move verdicts to phase 3.** "Correct!" after move 1 is a hint. If a
  future agent wants to soften the mode, the lever is what the *reveal* shows, not when the
  check happens.
- **Do not re-add auto-played opponent replies in the solve phase.** They cannot coexist with
  a deferred verdict without leaking it (see Context). The setup move is still auto-played —
  that one is not part of the answer.
- The user now plays both colours in phase 3, so `userMove` no longer filters by side and the
  board is draggable for both. Move legality is still chess.js's job; the store only records
  plies.
- A wrong prediction of the opponent's reply now fails the line. That is intended — it is the
  most common real-game calculation error — but it means the *defence* is a thing the mode
  teaches, and `wrongDefenceExplanation` is its prose.
- Harder problems cost more clicks: a 4-mover is 7 plies before you can commit. Accepted; the
  "Take back"/"Clear" controls and the notation readout keep it manageable.
- `hadStops` / `answerRevealed` still drive the solved message, so the three outcomes stay
  distinguishable: clean line, self-corrected miss, answer shown.
