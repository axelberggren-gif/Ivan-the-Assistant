# 0002 — Adopt AI-first guardrails (patterned on health-data-hub)

- **Status:** Accepted
- **Date:** 2026-07-22

## Context
The prototype was built fast by parallel AI agents. Further iteration needs structure so
agents don't hallucinate APIs, drift from decisions, or ship broken chess logic. The owner
has already evolved a guardrail pattern across three projects (Klassikern →
3-musketeers-wc-game → health-data-hub); health-data-hub is the most refined version and
its security model was audited (see its ADR-0002).

This repo is currently **private**. On a free GitHub personal account, *enforced* branch
protection / required status checks are only available on **public** repos. This app has
no secrets, no personal data, and no backend, so publishing the source carries the same
low risk as the sibling repos.

## Decision
- **Canon docs**: root `AGENTS.md` (loaded via `CLAUDE.md`), per-directory `CLAUDE.md`
  files, `CONTEXT.md` as the ubiquitous language, `CHANGELOG.md` as the session-to-session
  memory, ADRs in `docs/decisions/`.
- **Enforcement = required status checks** on `main`: `build` (typecheck/test/build),
  `review` (AI reviewer, fail-closed gate), `lint` (PR title). No direct pushes to `main`.
- **Merge model: the bot reviews and blocks; the owner presses Merge.** No auto-merge — a
  human is always the final gate, which closes the prompt-injection-to-`main` risk.
- **Supply-chain hygiene**: third-party Actions SHA-pinned; workflows use `pull_request`
  (never `pull_request_target`) with least-privilege `permissions`; the AI reviewer's tool
  allowlist is minimal and it treats PR content as untrusted.
- **Make the repository public** so the checks are actually enforced for free (owner
  action; until then the checks run but are advisory).

## Consequences
- Iteration stays fast (agents work freely on branches) while `main` is protected by three
  independent gates plus a human click.
- The owner has ~4 one-time setup steps (see `ONBOARDING.md`): make repo public, add
  branch protection, set `ANTHROPIC_API_KEY`, install the Claude GitHub App.
- Source becomes publicly visible; reversible later, but public history stays public.
