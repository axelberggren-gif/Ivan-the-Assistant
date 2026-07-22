# Chess Coach

An interactive chess coach that teaches openings by playing them against you, commenting on every move, and stopping the game when you've thrown it. Personal training tool first, product later.

## Language

**Opening**:
A named body of theory (e.g. Queen's Gambit) the user trains from one fixed side, consisting of mainlines and traps.
_Avoid_: variation (that's a line within an opening)

**Line**:
One concrete move sequence within an opening, annotated with per-move ideas.
_Avoid_: variation, sequence

**Trap**:
An authored bait in an opening with a severity. Falling for a game-losing trap stops the session; falling for a lesser trap (e.g. loses a pawn) delivers its authored explanation inline and play continues.
_Avoid_: trick (in prose; `trickLines` remains the field name), gambit

**Bait**:
The opponent's last move in a trap — the move that tempts the natural losing reply.

**Book move**:
A move that matches known theory for the chosen opening at the current position.
_Avoid_: theory move, known move

**Out of book**:
The point where neither side has a known continuation. Coaching does not end here — it continues engine-only into the middlegame.

**Blunder**:
A move that throws the game — by engine measure (large eval loss or collapse of a holdable position) or by falling for a game-losing trap. Always stops the session.
_Avoid_: mistake (that's the milder classification)

**Stop-and-explain**:
The flow after a blunder: the game halts, the refutation is animated, the coach explains what went wrong and shows the fix, then offers a retry.

**Development score**:
A 0–100 heuristic of opening health for one side: minor pieces out, castling, center pawns, tempi lost.

**Retry**:
Resuming from the pre-blunder position after stop-and-explain. The coach requires the fix move to continue; any other move is bounced with a hint.

**Fix move**:
The single correct move in the position where the user blundered — authored for traps, engine-best otherwise.

**Session**:
One training run of one opening from the start position until a blunder stop, the middlegame move cap (~move 25), or restart.

**Problem**:
A bundled tactics position (curated from the Lichess CC0 puzzle database) solved in three gated phases: read → reason → solve. Always a 2–3 move line, never a one-mover. Served unlabeled — no motif or theme is shown before or during the attempt; the motif is revealed only after the solve.
_Avoid_: puzzle (in prose; the upstream dataset keeps its own naming), exercise

**Read check**:
The machine-checked situational-awareness gate before reasoning: material count (verified against the FEN) and a verdict guess (compared against the engine's eval bucket).

**Reasoning**:
The user's free-text explanation of the winning idea and calculated line, written before any move is played.

**Reasoning coach**:
The BYOK AI layer that compares the user's reasoning against Stockfish's analysis and reports what was right, missed, or wrong. It never calculates chess — engine output is ground truth.

**Setup move**:
The opponent's move auto-played from a problem's start position; the user solves from the resulting position. (In the Lichess data it is the first move of `Moves`.)

**BYOK**:
Bring-your-own-key — the user's own Anthropic API key, stored only in the browser and sent only to the provider. Without a key the app still works with engine-only feedback (ADR-0003).
