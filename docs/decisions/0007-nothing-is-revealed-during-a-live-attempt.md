# 0007 — Nothing derived from the solution is visible during a live attempt

- **Status:** Accepted — owner decision, 2026-08-02.
- **Date:** 2026-08-02

## Context

ADR-0006 sealed the *commit gate* in problems mode: a failed line is named as failed and
nothing more, and the user chooses between "Try again?" and "Show answer". Nobody sealed the
*panel around it*.

Three things were on screen for the whole of phase 3, the wrong-line gate included:

1. **The reasoning coach's feedback.** `submitReasoning` published it into state the moment
   grading finished, and `SolvePanel` rendered it whenever it was non-null — i.e. from the
   first second of the solve phase. That feedback is generated from a prompt that is handed
   the authored solution (`src/llm/prompt.ts`) and explicitly asked for `missed` = "concrete
   tactics or moves in the engine lines the student did not mention", in SAN. It names the
   solution. It sat directly under the "Try again? / Show answer" buttons, which is what the
   owner reported: the verdict says nothing, and then the block below it says everything.
2. **The engine lines.** Published at read-check submit and rendered behind a collapsed
   toggle throughout the attempt. Line one *is* the solution — a one-click hint.
3. **Two nudges toward them.** The keyless submit button read "Reveal engine lines & solve",
   and the degraded-coach message read "check yourself against the engine lines" — both
   inviting the user to open the answer mid-attempt.

PLAN.md §8.1 was itself part of the problem: it specified that phase 2 tells the user what
they missed ("after Bxe4, Re8 pins the rook"). That predates ADR-0006. Once committing a
line became a real test, handing over the answer beforehand made phase 3 a typing exercise.

A fourth, smaller thing: the eval bar was masked only during the read check. The store
deliberately runs no engine during the solve phase, so while the user played their line the
bar kept displaying the *solve position's* eval next to a board several plies further on —
a wrong number, and a leak the moment anything refreshed it.

## Decision

1. **While an attempt is live (`solve`, `wrong_move`), the only thing on screen about the
   answer is what the user played.** No coach feedback, no engine lines, no eval. The
   wrong-line gate is the verdict plus two buttons, and nothing else.
2. **The answer material is published at a terminal status only** — `solved`, or `stopped`
   once the user has asked for the answer. Both the coach's feedback and the engine lines
   appear there, together, as the payoff.
3. **A retry re-seals it**, whether it is a hidden-answer "Try again?" or a fix-gated retry
   after a reveal. Playing again is a live attempt; the panel goes quiet so the board is
   what the user is looking at. The stop-and-explain's fix-move reminder still names the
   move that is required, so nothing is taken back that the user needs.
4. **The store enforces it, not the component.** The engine lines and the coach's verdict
   are computed as early as ever — at the read check and at the reasoning submit, so nobody
   waits for them — but they are held in store closures and only `set()` into state by
   `publishAnswer()`. `sealAnswer()` takes them back. There is no React test tooling in this
   repo, so a JSX guard could regress silently; a store invariant is provable in
   `problems.test.ts` and is. The guards in `SolvePanel` are a second lock, not the lock.
5. **The eval bar is masked for `read`, `solve` and `wrong_move`**, and live from
   `showing_refutation` onward.

## Consequences

- **PLAN.md §8.1's phase-2 description is superseded.** The reasoning coach still grades on
  submit and still reports what you got right, missed and got wrong — it just reports it
  after the attempt, where you can hold it against what you actually played. §8.1 is updated
  in the same change.
- **Do not render `feedback` or `engineLines` outside a terminal status.** If a future agent
  wants the user to have *something* before solving, the lever is a new spoiler-free field
  on the coach's response (an ADR-0003 amendment to the prompt and schema) — not un-sealing
  the itemised list.
- The keyless path is unchanged in substance: no key still means no coach, and the engine
  lines are still the self-check material. They just arrive at the end.
- `selfCheckNotice()` (previously exported but unused) is now the keyless reason-phase hint
  and says when the lines arrive; `answerHeldNotice()` is new and says the same to everyone,
  so the silence during phase 3 reads as deliberate rather than broken.
- The owner declined three adjacent ideas at the same time — showing the user's own notes
  during the solve, an "I'm stuck" escape before committing, and a third button at the
  wrong-line gate. They are not blocked, just not wanted yet.
