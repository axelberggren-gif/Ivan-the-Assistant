# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-07-22

## Context
This project is developed almost entirely by AI agents across many short sessions. Agents
have no memory between sessions; decisions made in one session were silently contradicted
in later ones in earlier projects. The owner is non-technical and needs a plain-language
record of what was decided on his behalf.

## Decision
Keep Architecture Decision Records in `docs/decisions/`, numbered, short (half a page),
using `0000-template.md`. Reading the ADR log is part of the session-start ritual in
`AGENTS.md`, and the `claude-review` bot points out diffs that contradict an accepted ADR.

## Consequences
Every expensive-to-reverse decision has a written "why". Slight overhead per seam change;
none for ordinary work.
