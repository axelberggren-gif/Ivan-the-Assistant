# Chess Coach — Solution Plan

## Vision

An interactive chess coach that teaches through classical exercises, openings, and chess problems, powered by a real chess engine (Stockfish). The coach doesn't just play — it watches your moves, comments on them, stops you when you've thrown the game, explains *why*, and shows how to fix it.

**Version 1 is an Opening Trainer:** pick an opening, play it against the computer. The computer plays different variations (including known tricks and trap lines) trying to get you behind in development. Every move you make gets feedback; a losing move stops the game with an explanation and a correction.

---

## 1. Architecture Overview

**Web app, no backend for v1.** Everything runs in the browser, which keeps it simple, free to host, and instant to start.

```
┌─────────────────────────────────────────────────────┐
│                     Browser (SPA)                    │
│                                                      │
│  ┌────────────┐   ┌──────────────┐   ┌────────────┐ │
│  │  Board UI   │◄─►│  Game/Coach  │◄─►│  Opening   │ │
│  │ (chessground│   │    Engine    │   │    Book    │ │
│  │  component) │   │ (TypeScript) │   │ (JSON data)│ │
│  └────────────┘   └──────┬───────┘   └────────────┘ │
│                          │                           │
│                   ┌──────▼───────┐                   │
│                   │  Stockfish   │                   │
│                   │ (WASM, Web   │                   │
│                   │   Worker)    │                   │
│                   └──────────────┘                   │
└─────────────────────────────────────────────────────┘
```

### Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React + TypeScript + Vite | Fast dev loop, huge ecosystem |
| Board UI | `chessground` (Lichess's board) or `react-chessboard` | Battle-tested, drag/drop, arrows, highlights |
| Rules/legality | `chess.js` | Move generation, legality, PGN/FEN, check/mate detection |
| Engine | Stockfish WASM (`stockfish.js` / lila-stockfish-web) in a Web Worker | Full-strength engine in-browser, no server, UCI protocol |
| Opening data | Lichess `chess-openings` dataset (ECO codes, ~3,500 named lines) + curated trap lines per opening | Free, well-maintained, covers every mainline |
| State | Zustand (or plain React context) | Simple game-session state |
| Styling | Tailwind CSS | Fast, consistent |

**Why not a backend?** Stockfish compiles to WASM and runs at multi-million NPS in a worker thread — more than enough depth (18–22) for coaching in under a second per move. If later phases need accounts/progress sync, add a thin backend then (see Phase 3).

---

## 2. Core Concepts (v1 — Opening Trainer)

### 2.1 The training session loop

1. **User picks an opening** (e.g., Italian Game, Queen's Gambit, Sicilian Najdorf) and a color.
2. Board is set up; if the user plays Black, the computer opens.
3. **User makes a move.** The coach evaluates it *before the computer replies*:
   - Is it a book move for this opening? (theory check)
   - What does Stockfish say? (eval before vs. after = centipawn loss)
   - Development heuristics: pieces developed, castled, center control, tempo count.
4. **Feedback is shown** on a scale: `Book ✓` / `Good` / `Playable but imprecise` / `Inaccuracy` / `Mistake` / **`Blunder — game stopped`**.
5. **Computer replies** — not always the mainline. It samples from a weighted set of variations, deliberately including *trick lines* (e.g., early queen sorties, gambit traps, move-order tricks) designed to punish rote memorization and lure the user into losing tempo or grabbing poisoned material.
6. Loop continues until: user blunders (session stops with explanation + fix), the opening phase ends (~move 10–14, "you're out of book and fine — well played"), or the user resigns/restarts.

### 2.2 Move classification (the coaching brain)

Combine **engine eval** with **opening-specific heuristics**:

| Signal | Source | Used for |
|---|---|---|
| Centipawn loss (eval drop after user move) | Stockfish, depth ~18, MultiPV 3 | Good/inaccuracy/mistake/blunder thresholds |
| Book conformance | Opening book lookup by position (FEN → known continuations) | "This is theory" vs "you're improvising" |
| Development score | Heuristic: minor pieces off back rank, castling done, queen not out early, center pawns advanced | The "behind on development" commentary the coach specializes in |
| Tempo tracking | Count of moves that develop vs. moves that don't (repeat piece moves, pawn grabs) | "You've moved this knight three times — you're two tempi behind" |
| Best-move gap | Stockfish MultiPV: what were the top 3 moves and their evals? | "Instead, Nf3 develops and defends e5" |

**Classification thresholds (tunable):**
- Book move → always ✓ with the line's name/idea
- CP loss < 30 → Good
- 30–90 → Inaccuracy (comment, continue)
- 90–200 → Mistake (comment + show better move, continue)
- \> 200 or eval swings to lost (< −2.5 for user) → **Blunder: stop the game**

### 2.3 "Stop and explain" flow

When the game is stopped:
1. **What happened** — plain-language diagnosis, driven by which signal fired:
   - Tactical: "Your move hangs the knight on g5 — after Qa5+ the king and knight are forked."
   - Developmental: "You've spent three moves on pawn grabs while White developed three pieces and castled. You're losing the center fight before it starts."
2. **The refutation** — the coach plays out Stockfish's punishing line on the board (animated, 3–5 moves) so the user *sees* the consequence.
3. **The fix** — rewind to the position before the blunder, show the top engine move + the book move (often the same), with a one-line "idea" explanation from the opening's annotation data.
4. **Options:** retry from that position, restart the opening, or switch variation.

### 2.4 Explanation engine (v1: rules + templates, not an LLM)

v1 explanations are generated from structured facts — reliable and instant:
- Template library keyed on *reason codes*: `hangs_piece`, `loses_tempo`, `weakens_king`, `blocks_development`, `wrong_move_order`, `falls_for_trap:<trap_id>`, `misses_tactic:<motif>`.
- Reason codes are derived from: Stockfish's principal variation (does the punishment win material? attack the king?), the development-score delta, and per-opening annotations authored into the trap-line data.
- Each curated trap line ships with a hand-written explanation ("The Fried Liver bait: taking on d5 looks safe, but Nxd5 walks into Nxf7!").

An LLM-generated natural-language layer is a Phase 3 enhancement, not a v1 dependency.

### 2.5 Computer opponent behavior

The opponent is *not* max-strength Stockfish (that would crush and teach nothing). It's a **book-driven variation player**:
- While in book: pick the next move from the opening dataset, weighted toward (a) mainlines, (b) the tricky sidelines/traps flagged for this opening, with a difficulty slider shifting the weights.
- Out of book: Stockfish with limited depth/skill-level UCI options, biased to keep the position thematically consistent (contempt/skill settings) — enough to punish real mistakes without engine-perfect play.

---

## 3. Data Model

```ts
// Opening definitions
interface Opening {
  id: string;              // "italian-game"
  name: string;            // "Italian Game"
  eco: string;             // "C50"
  color: "white" | "black" | "both";  // which side the user trains
  mainlines: Line[];       // theory the user should know
  trickLines: TrickLine[]; // traps the computer will try
}

interface Line {
  moves: string[];         // SAN: ["e4","e5","Nf3","Nc6","Bc4"]
  ideas: Record<number, string>;  // move index → "controls the center, eyes f7"
}

interface TrickLine extends Line {
  trapId: string;
  baitMove: number;        // where the user is tempted to go wrong
  punishment: string[];    // the refutation sequence if they bite
  explanation: string;     // hand-written coaching text
  fix: string;             // the correct response + why
}

// Session state
interface TrainingSession {
  openingId: string;
  userColor: "white" | "black";
  game: Chess;             // chess.js instance
  history: MoveFeedback[];
  status: "playing" | "stopped_blunder" | "out_of_book_ok" | "complete";
}

interface MoveFeedback {
  san: string;
  classification: "book" | "good" | "inaccuracy" | "mistake" | "blunder";
  cpLoss: number;
  reasonCodes: string[];
  bestMove: string;
  comment: string;
}
```

Opening/trap data lives in versioned JSON files — easy to author, review, and extend one opening at a time.

---

## 4. Build Plan (v1)

### Milestone 1 — Playable board + engine plumbing (foundation)
- Vite + React + TS scaffold, chessground board, chess.js game state
- Stockfish WASM in a Web Worker with a small UCI wrapper (`analyze(fen, {depth, multipv}) → {eval, pv[]}`)
- Sanity check: play a legal game against Stockfish at fixed skill level

### Milestone 2 — Opening book + variation opponent
- Import Lichess openings dataset; position-keyed book lookup (FEN → continuations)
- Author 3 launch openings with mainlines + 3–5 trick lines each:
  **Italian Game** (white), **Queen's Gambit** (white), **Sicilian Defence** (black) — popular, trap-rich, clearly distinct
- Opponent move selector: weighted book sampling + limited-strength engine fallback

### Milestone 3 — The coach
- Move evaluation pipeline (book check → engine eval → development heuristics → classification)
- Feedback UI: per-move verdict chips, running eval bar, development score meter
- Stop-the-game flow: diagnosis, animated refutation, rewind-and-retry
- Template explanation engine + hand-written trap explanations

### Milestone 4 — Polish & session UX
- Opening picker screen with descriptions and difficulty
- End-of-session summary: accuracy %, tempi lost, traps avoided/fallen-for, "study this" links into the lines you missed
- Settings: difficulty slider, hint button (show book move), sound/animations
- Deploy as static site (Vercel/Netlify/GitHub Pages)

**Definition of done for v1:** a user can pick one of 3 openings, play it against a tricky opponent, get accurate per-move coaching, be stopped on a game-losing move with a clear explanation and fix, and retry.

---

## 5. Game Insights from chess.com

Chess.com exposes a **free public API** (no auth, no API key — just a User-Agent header):

- `GET api.chess.com/pub/player/{username}/games/archives` → list of monthly archive URLs
- `GET api.chess.com/pub/player/{username}/games/{YYYY}/{MM}` → all games that month as JSON: full PGN, ratings, result, time class, and the opening (ECO) of each game
- `GET api.chess.com/pub/player/{username}/stats` → current ratings, records, best wins

Because it's public and read-only, the browser fetches it directly — the user just types their username. Games are cached locally (IndexedDB) so re-analysis is instant and only new months are fetched on revisit.

### 5.1 Insights dashboard (stats layer — cheap, instant)

Computed from PGN metadata alone, no engine needed:

- **Rating over time** per time class (blitz/rapid/bullet)
- **Win/draw/loss splits** by color, time class, and opponent rating band
- **Opening repertoire report** — your most-played openings as White and Black, with score per opening: "You play the Italian in 40% of White games and score 58%, but against the Sicilian you score 31%"
- **Result patterns** — how games end (checkmate, resignation, **timeout**), game length distribution, performance by day/time

### 5.2 Deep analysis (engine layer — batch, background) — **built (ADR-0005)**

Run games through the same in-browser Stockfish pipeline the trainer uses, in a background
queue over your most recent games:

- **Blunder timeline** — where in the game you lose it (opening / early middlegame), average centipawn loss per phase. The pass stops at move 30, so the endgame is deliberately out of scope for this milestone
- **Opening-phase diagnosis** — the coach's development heuristics applied to *your real games*: how often you leave the opening behind in development, which specific move numbers you drift at
- **Recurring mistakes** — cluster blunders by motif (hung pieces, missed forks, back-rank) using the same reason-code engine as the trainer

Milestone 5 originally shipped §5.1 and §5.3 only; this section was its unbuilt half.
**ADR-0005** records the architecture decisions, and §5.2a–5.2d below all landed — the code
lives in `src/analysis/` with the weakness panel on the insights screen. Milestone 6d is no
longer blocked (and stays opening-only by decision 3).

#### 5.2.1 The shape of it

A new `src/analysis/` module (not `src/insights/`, which must stay pure; not `src/coach/`,
which must stay engine-free), because "annotate a game from its SAN moves" is also exactly
what Phase 5's post-game review needs:

| File | Job |
|---|---|
| `pgn.ts` | PGN movetext → SAN moves (pure) |
| `annotate.ts` | one game → `AnnotatedGame`, driving the injected engine |
| `queue.ts` | batch scheduler: cache, progress, cancel, incremental commit |
| `aggregate.ts` | `AnnotatedGame[]` → `WeaknessReport` (pure) |
| `templates.ts` | all report prose (mirror of the `src/coach/templates.ts` rule) |

Key constraints, all from ADR-0005: analysis runs on its **own** engine instance so it never
parks an interactive move behind a 5-minute batch (measured cost: +128 MB while running,
freed on dispose); classification comes from the coach's thresholds via new exported
`classifyMove` / `deriveReasonCodes` (never duplicated); the run is time-boxed
(150ms/position, ply cap 60, decided-position cutoff), cached per game in IndexedDB forever,
cancellable, and commits results game by game.

**It runs in the background.** The store lives at `App` level, so the user can go train or
solve problems while their games are analysed. Progress is visible from every screen —
"Game 7 of 25 · ~3 min left" on the insights screen, a compact chip in the nav elsewhere,
cancel from either. The ETA is averaged over genuinely analysed games only, so a re-run over
a warm cache does not promise seconds and then take minutes.

#### 5.2 build plan — **all four shipped**

- **5.2a — Coach extraction.** ✅ Export `classifyMove` + `deriveReasonCodes` from `src/coach`;
  refactor `assessMove` to call them; `coach.test.ts` proves behaviour is unchanged. No
  user-visible change — this just unblocks everything else.
- **5.2b — Annotate one game.** ✅ `src/analysis/` with `types.ts`, `pgn.ts`, `annotate.ts`;
  tested against a fake engine (the `session.test.ts` seam). Still no UI.
- **5.2c — The queue.** ✅ Batch scheduler on its own engine instance, IndexedDB cache,
  progress + ETA + cancel + incremental commit, `createAnalysisStore(deps)` mounted at `App`
  level so runs survive navigation. `InsightsGame` gains an optional `pgn`.
- **5.2d — The dashboard.** ✅ A weakness panel on the insights screen: blunder timeline, phase
  table, development diagnosis, recurring mistakes, and your worst moments linking back to
  the game on chess.com. Plus the cross-screen progress chip.

*(A fifth step — mapping the coach's reason codes onto problem motifs, to recommend problems
by what you actually fall for — was specced and cut on 2026-07-25: the reason codes don't
carry a motif, and 6d stays opening-only. See ADR-0005, decision 3.)*

### 5.3 The killer feature: closing the loop with the trainer

This is where insights stop being a dashboard and become coaching:

- **"Train what you lose"** — the opening picker gets a recommendation banner: "You've lost 12 of your last 18 games against the Queen's Gambit — train it now" (deep-links into the trainer with that opening pre-selected, playing your color)
- **Replay your own mistakes** — load a real lost game, rewind to the move where the eval collapsed, and let the coach run its stop-and-explain flow on *your* position, then retry against the trainer's opponent
- **Personalized trap selection** — if the analysis shows you repeatedly fall for a known trap pattern, the trainer's opponent weights that trick line up in future sessions

### 5.4 Build notes

- Ships as **Milestone 5** after trainer v1: §5.1 (fetch + stats dashboard) is a small, self-contained increment; §5.2 reuses the Milestone 3 engine pipeline; §5.3 reuses the trainer itself
- Landed in that order: the dashboard (§5.1) and the train-what-you-lose banner (§5.3,
  opening-based) shipped in Milestone 5; §5.2 followed as 5.2a–5.2d per ADR-0005
- Rate limits are generous for serial requests; fetching a full history (even years) takes seconds per month archive and is done once, then cached
- Lichess has an equivalent public API — supporting both later is trivial since everything downstream consumes PGN

---

## 6. Roadmap Beyond v1

- **Phase 2 — chess.com insights (Milestone 5, §5):** fetch your game history, stats dashboard, engine-based weakness analysis, and "train what you lose" recommendations feeding the opening trainer.
- **Phase 3 — Problems mode (Milestone 6, §8):** three-phase problem solving (read → reason → solve) on a curated, bundled subset of the Lichess puzzle database, with a BYOK AI reasoning coach grading the user's written calculation against Stockfish (ADR-0003) — prioritized by *your* recurring mistakes from the insights analysis.
- **Phase 4 — Adaptive coach:** progress tracking (which lines you know, spaced repetition on your mistakes), LLM-polished explanations extended from the §8 reasoning coach to the opening trainer, more openings (user-requested), optional accounts/sync backend.
- **Phase 5 — Full-game coaching:** play complete games with post-game annotated review (blunder timeline, recurring-weakness detection: "you consistently drift in closed positions").

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Engine eval ≠ good coaching (Stockfish says −0.4 but the *lesson* is about tempo) | Layer heuristics + authored annotations over raw eval; eval sets thresholds, annotations set the narrative |
| Authoring trap lines is manual work | Start with 3 openings; the data format makes each new opening an isolated content task |
| WASM Stockfish performance on weak devices | Cap depth with a time budget (e.g., 800ms/move); coaching needs consistency, not depth 30 |
| Feedback feels naggy or robotic | Only interrupt on mistake+; batch minor notes into the end summary; vary templates |

---

## 8. Problems Mode — three-phase tactics training (Milestone 6)

Classic puzzle trainers reward tap-until-right guessing. This mode forces the habits that
transfer to real games: **read the position, write down your calculation, then prove it.**
One-move problems are excluded by design — every problem is a 2–4 move line where the user
must see the opponent's replies in advance. Difficulty spans a wide spread (~1400–2500),
balanced across bands so there's a long tail of hard problems, not just a cluster at the
easy end. The motif mix is deliberately varied — attacking motifs plus defensive/holding
positions — so the read-check verdict isn't always "you're winning".

### 8.1 The three phases (gated — each unlocks the next)

**Phase 0 — an unlabeled problem is served.** Problems start at random across the whole
bundled set with **no motif or theme shown** before or during the attempt — the user must
find the idea without any indication where to look. The motif is revealed only after the
solve, as the learning payoff. (Owner decision from 2026-07-22 feedback: the original
by-motif picker gave too many clues.)

**Phase 1 — Read (situational awareness, machine-checked).**
Before anything else, two quick checks answered via simple controls:
1. **Material count** — who is up material and by how much (verified against the FEN).
2. **Verdict guess** — a 5-bucket call (White winning / better / equal / Black better /
   Black winning), compared against Stockfish's eval. The reveal is itself the hook:
   *"You said equal — Stockfish says you're winning. Your job: prove it."*

**Phase 2 — Reason (free text, the heart of the exercise).**
The user writes their idea and calculation in plain language before touching a piece:
*"I could take on e4 but then the knight hangs, so I take on d4 first."* To support
calculation, the board here is a **scratch board**: the user can try candidate lines on it
and paste the resulting notation into their notes with one click, so they only have to add
the *why* — they motivate the line rather than transcribe it. Scratch moves are throwaway
and never count as a solve attempt. The **reasoning coach** (BYOK LLM, §8.3) compares this
prose against Stockfish's lines — never calculating itself — and reports: what you got
right, what you missed (*"after Bxe4, Re8 pins the rook"*), what's wrong. Without an API
key, the phase still runs: the user self-checks against the revealed engine line (graceful
degradation).

**Phase 3 — Solve (execute the committed line).**
The user plays their moves out; the opponent's forced replies animate. Anti-guessing rules:
- An attempt is one continuous line — no exploratory piece-tapping.
- Every move is called: a correct one is confirmed as correct, a wrong one is named as
  wrong *and nothing else* — no refutation, no solution move, no fresh eval.
- A wrong move stops the attempt at that verdict and hands the user the choice (owner
  decision, 2026-07-27): **"Try again?"** takes the move back with the answer still hidden
  — a genuine second attempt, not fix-move-gated — or **"Show answer"** runs the existing
  **stop-and-explain** flow, with the refutation animated and the coach's comment
  referencing the user's *written* reasoning ("you said the knight was safe — here's why it
  isn't"). Learning beats being told, so the answer is never spent by accident.
- Retry *after* the answer was shown follows the existing **fix-move** semantics: the
  correct move is required to continue.
- The solved message says which it was: a clean line, a self-corrected miss, or a
  stop-and-explain.
- Move matching follows Lichess semantics: the authored solution move is required (any
  immediate checkmate also counts as correct).

### 8.2 Data: curated Lichess problems, bundled as static JSON (ADR-0003)

- **Source**: Lichess puzzle database (CC0, ~6M rows, CSV) — motif-tagged, rating-graded.
- **Pipeline**: `scripts/build-problems.mjs` (dev-only Node) downloads the `.csv.zst`,
  filters (2–4 movers via `short`/`long`/`veryLong` tags, rating ~1400–2500, popularity +
  NbPlays thresholds, a broad curated motif set — fork/pin/skewer/discoveredAttack/
  doubleCheck/backRankMate/hangingPiece/trappedPiece/deflection/attraction/sacrifice/
  intermezzo/advancedPawn plus the defensive `defensiveMove`), samples a balanced set
  across theme × rating band, and writes per-theme JSON plus a `manifest.json` to
  `public/problems/`. Output is committed; the raw CSV never is.
- **Delivery**: fetched on demand per theme (like `public/engine/`), keeping the JS bundle
  small. Each theme file is ~50–150 KB gzipped. The per-theme split is storage/delivery
  only — problems are served unlabeled (§8.1); the motif surfaces only in the post-solve
  reveal.
- **Format gotcha**: the Lichess FEN is the position *before* the opponent's setup move;
  `Moves[0]` is that setup move (auto-played on load), and the user's solution starts at
  `Moves[1]`. Getting this backwards is the classic integration bug.
- **Proof**: like opening data, bundled problems ship with a test replaying every solution
  through chess.js (FEN valid, every move legal in sequence).

### 8.3 The reasoning coach (BYOK — ADR-0003)

- **Division of labor**: Stockfish is ground truth (eval, best lines, refutations — all
  already computed by `src/engine/`). The LLM does a *language-only* job: compare the
  user's prose to the engine's lines and articulate the gap. It never adjudicates chess.
- **BYOK**: the user pastes their own Anthropic API key in settings; it lives only in
  `localStorage` and is sent only to `api.anthropic.com` (browser-direct). Default model:
  Claude Haiku 4.5. No key → engine-only feedback, everything else works.
- **Contract**: prompts carry FEN + engine lines (SAN) + user prose; the response is
  structured JSON (`goodPoints`, `missed`, `wrong`, `comment`) validated before rendering;
  invalid/failed responses degrade to the engine-line reveal.

### 8.4 Module layout

| Piece | Where | Rule |
|---|---|---|
| Build pipeline | `scripts/build-problems.mjs` | Dev-only; never runs in the browser |
| Problem data | `public/problems/*.json` + manifest | Read-only at runtime, committed, CC0 |
| Loader + phase logic | `src/problems/` | Pure where possible; fetch + validate |
| LLM access | `src/llm/` | **All** LLM traffic goes through here (mirror of the `src/engine/` rule); prompt builders are pure and Node-testable |
| Session state | `src/store/problems.ts` | Separate zustand store, deps injected (`engine`, `coach`, `llm`, problem source) — same testable seam as `session.ts` |
| Types | `src/types.ts` | Additive only: `Problem`, read-check/feedback/API shapes |

### 8.5 Build plan

- **6a — Data**: pipeline script, bundled problem set, `Problem` types, chess.js replay
  test. (Content lands before UI.)
- **6b — Solve loop, engine-only**: problems start screen (problems served unlabeled, at
  random across the set — the motif is revealed after the solve; originally a by-motif
  picker, dropped per 2026-07-22 owner feedback), read-check gate, solve phase with
  stop-and-explain + fix-move retry. No LLM yet — reasoning phase shows the engine line
  for self-checking.
- **6c — Reasoning coach**: settings screen for the key, `src/llm/` client + prompt
  builders + JSON validation, graded feedback UI.
- **6d — Close the loop**: insights integration — recommend training by the **openings** you
  actually lose to (reuses §5.3's `recommendTraining` plumbing). Scoped to openings only as
  of 2026-07-25: recommending problems by *motif* would need motif detection the coach's
  reason codes can't provide, and was cut (ADR-0005, decision 3). Not blocked on §5.2 —
  shippable today.

### 8.6 Risks

| Risk | Mitigation |
|---|---|
| LLM hallucinates chess ("actually Qh5 wins") | It never gets to calculate: engine lines in, language out; structured JSON; engine facts rendered separately from prose |
| Key handling erodes trust | Key only in localStorage, only to api.anthropic.com, removable in settings; documented in ADR-0003 |
| Free-text grading feels wrong/nitpicky | Grade ideas, not grammar: rubric in the prompt (credit the plan, flag only concrete missed/wrong tactics); user can always see raw engine lines |
| Bundled set goes stale vs Lichess upstream | CC0 + committed script = refresh is one command; manifest carries the source dump date |

