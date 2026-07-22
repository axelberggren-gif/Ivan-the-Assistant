# src/llm — BYOK reasoning coach client (Anthropic API, ADR-0003)

Three layers, keep them separate:

- `prompt.ts` — **pure** prompt construction: `buildSystemPrompt` (the grading rubric),
  `buildUserPrompt` (FEN + engine lines + delimited user prose), `FEEDBACK_SCHEMA`
  (structured-output JSON schema). No SDK, no DOM: Node-testable (`prompt.test.ts`).
- `validate.ts` — **pure** response validation: `parseReasoningFeedback` (JSON.parse +
  structural checks + size caps; null on anything invalid). Node-testable
  (`validate.test.ts`).
- `index.ts` + `keyStore.ts` — the SDK client (`createLlm(): LlmAPI`) and the
  localStorage key wrapper. Network client is deliberately untested.

## Invariants

- **ALL LLM traffic goes through this module** — mirror of the `src/engine` rule. Other
  modules use the `LlmAPI` contract in `src/types.ts`; extend it there (optional fields)
  if they need more.
- **BYOK key handling (ADR-0003)**: the user's Anthropic API key lives ONLY in
  localStorage (`keyStore.ts`, key `chess-coach.anthropic-key`), is sent ONLY to
  `api.anthropic.com` (browser-direct, `dangerouslyAllowBrowser`), and is never bundled,
  committed, logged, or included in error messages. No key ⇒ `hasKey()` is false and the
  app stays fully usable with engine-only feedback.
- **Model is a constant**: `REASONING_MODEL = 'claude-haiku-4-5'` (`index.ts`) — the
  hard thinking is Stockfish's; changing the default model is an ADR-0003 amendment.
- **The engine is ground truth.** Prompts state that Stockfish lines are fact and forbid
  the model from calculating or contradicting them; the LLM's job is language only
  (compare prose vs lines). Never let engine facts be produced by the model.
- **Structured JSON, validated before rendering**: responses are requested via
  `output_config.format` (json_schema) and still re-validated by
  `parseReasoningFeedback` — never render unvalidated model output.
- **Every failure is a user-readable Error** — missing key, SDK errors (auth/rate
  limit/connection/API), refusals, truncation, unparseable JSON — so callers can always
  degrade to the engine-line reveal.

## Recent changes

- Initial LLM module: prompt/rubric, schema validation, localStorage key store,
  Haiku-backed `createLlm` (Milestone 6c).
