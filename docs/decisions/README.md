# Architecture Decision Records (ADRs)

This folder is the **memory of why** the project is built the way it is. Each significant
technical decision gets one short, numbered file. It exists so that:

- the owner (non-technical) has a plain-language record of decisions made on his behalf, and
- future AI agents read past decisions and **don't silently contradict them** (the
  `claude-review` bot flags diffs that conflict with an accepted ADR).

## When to add an ADR

Add one when a PR changes an **architectural seam** or makes a decision that's expensive to
reverse. Concretely, that includes changes to:

- `src/types.ts` — the contract between modules (breaking changes only)
- the engine worker protocol or Stockfish build
- adding a new runtime dependency
- anything that would introduce a backend, accounts, secrets, or authenticated APIs

For ordinary changes (a new opening that follows the existing pattern, a bug fix, docs) you
do **not** need an ADR. The review bot will *suggest* one only for seam changes — it never
blocks on a missing ADR.

## How to add one

1. Copy `0000-template.md` to the next number, e.g. `0003-add-tailwind.md`.
2. Fill in Context / Decision / Consequences. Keep it short (half a page).
3. Set Status to `Accepted` (or `Proposed` if you want discussion first).
4. Commit it in the same PR as the change it describes.

## Index

- [0001 — Record architecture decisions](0001-record-architecture-decisions.md)
- [0002 — Adopt AI-first guardrails](0002-ai-first-guardrails.md)
