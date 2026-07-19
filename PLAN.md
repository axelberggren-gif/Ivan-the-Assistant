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

### 5.2 Deep analysis (engine layer — batch, background)

Run games through the same in-browser Stockfish pipeline the trainer uses (a background queue, e.g. most recent 50–100 games first):

- **Blunder timeline** — where in the game you lose it (opening / middlegame / endgame), average centipawn loss per phase
- **Opening-phase diagnosis** — the coach's development heuristics applied to *your real games*: how often you leave the opening behind in development, which specific move numbers you drift at
- **Recurring mistakes** — cluster blunders by motif (hung pieces, missed forks, back-rank) using the same reason-code engine as the trainer

### 5.3 The killer feature: closing the loop with the trainer

This is where insights stop being a dashboard and become coaching:

- **"Train what you lose"** — the opening picker gets a recommendation banner: "You've lost 12 of your last 18 games against the Queen's Gambit — train it now" (deep-links into the trainer with that opening pre-selected, playing your color)
- **Replay your own mistakes** — load a real lost game, rewind to the move where the eval collapsed, and let the coach run its stop-and-explain flow on *your* position, then retry against the trainer's opponent
- **Personalized trap selection** — if the analysis shows you repeatedly fall for a known trap pattern, the trainer's opponent weights that trick line up in future sessions

### 5.4 Build notes

- Ships as **Milestone 5** after trainer v1: §5.1 (fetch + stats dashboard) is a small, self-contained increment; §5.2 reuses the Milestone 3 engine pipeline; §5.3 reuses the trainer itself
- Rate limits are generous for serial requests; fetching a full history (even years) takes seconds per month archive and is done once, then cached
- Lichess has an equivalent public API — supporting both later is trivial since everything downstream consumes PGN

---

## 6. Roadmap Beyond v1

- **Phase 2 — chess.com insights (Milestone 5, §5):** fetch your game history, stats dashboard, engine-based weakness analysis, and "train what you lose" recommendations feeding the opening trainer.
- **Phase 3 — Tactics & classical problems:** puzzle mode using the Lichess puzzle database (motif-tagged: forks, pins, back-rank…), graded by rating; "spot the trap" drills generated from the same trick-line data — prioritized by *your* recurring mistakes from the insights analysis.
- **Phase 4 — Adaptive coach:** progress tracking (which lines you know, spaced repetition on your mistakes), LLM-polished explanations on top of the structured reason codes, more openings (user-requested), optional accounts/sync backend.
- **Phase 5 — Full-game coaching:** play complete games with post-game annotated review (blunder timeline, recurring-weakness detection: "you consistently drift in closed positions").

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Engine eval ≠ good coaching (Stockfish says −0.4 but the *lesson* is about tempo) | Layer heuristics + authored annotations over raw eval; eval sets thresholds, annotations set the narrative |
| Authoring trap lines is manual work | Start with 3 openings; the data format makes each new opening an isolated content task |
| WASM Stockfish performance on weak devices | Cap depth with a time budget (e.g., 800ms/move); coaching needs consistency, not depth 30 |
| Feedback feels naggy or robotic | Only interrupt on mistake+; batch minor notes into the end summary; vary templates |
