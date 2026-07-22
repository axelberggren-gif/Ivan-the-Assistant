/**
 * BYOK reasoning coach client (ADR-0003) — the only module that talks to the
 * Anthropic API. Mirror of the src/engine rule: all LLM traffic goes through
 * here; UI, store, and problems code use the LlmAPI contract from src/types.
 *
 * The key is user-supplied, lives only in localStorage (keyStore.ts), and is
 * sent only to api.anthropic.com via the official SDK's browser-direct CORS
 * mode. It is NEVER logged, and never included in error messages.
 *
 * Every failure surfaces as a user-readable Error so the caller can degrade
 * gracefully to the engine-line reveal (the app stays fully usable keyless).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { LlmAPI, ReasoningFeedback, ReasoningGradeInput } from '../types'
import { loadKey, saveKey } from './keyStore'
import { buildSystemPrompt, buildUserPrompt, FEEDBACK_SCHEMA } from './prompt'
import { parseReasoningFeedback } from './validate'

/** Default model per ADR-0003: fast/cheap — the hard thinking is Stockfish's. */
export const REASONING_MODEL = 'claude-haiku-4-5'

const MAX_TOKENS = 1024

const NO_KEY_MESSAGE =
  'The reasoning coach needs your Anthropic API key — add it in Settings, or continue with engine-only feedback.'
const BAD_KEY_MESSAGE = 'Your API key was rejected — check it in Settings.'
const RATE_LIMIT_MESSAGE =
  'The reasoning coach is rate-limited right now — try again in a moment, showing engine lines instead.'
const CONNECTION_MESSAGE =
  'Could not reach the reasoning coach (network problem) — showing engine lines instead.'
const API_ERROR_MESSAGE =
  'The reasoning coach ran into an API error — showing engine lines instead.'
const UNUSABLE_MESSAGE =
  'The reasoning coach returned an unusable answer — showing engine lines instead.'
const REFUSAL_MESSAGE =
  'The reasoning coach declined to answer — showing engine lines instead.'
const TRUNCATED_MESSAGE =
  'The reasoning coach ran out of room mid-answer — showing engine lines instead.'

/**
 * Maps SDK typed errors to user-readable Errors. Never includes the key or
 * the raw request/response in the message.
 */
function toUserError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) return new Error(BAD_KEY_MESSAGE)
  if (error instanceof Anthropic.RateLimitError) return new Error(RATE_LIMIT_MESSAGE)
  // Check the connection error before APIError — it is a subclass of APIError.
  if (error instanceof Anthropic.APIConnectionError) return new Error(CONNECTION_MESSAGE)
  if (error instanceof Anthropic.APIError) return new Error(API_ERROR_MESSAGE)
  return new Error(API_ERROR_MESSAGE)
}

export function createLlm(): LlmAPI {
  // In-memory copy of the key; kept in sync with localStorage via setKey.
  let key: string | null = loadKey()

  return {
    hasKey(): boolean {
      return key !== null
    },

    setKey(newKey: string | null): void {
      const normalized = newKey !== null && newKey.trim() !== '' ? newKey.trim() : null
      key = normalized
      saveKey(normalized)
    },

    async gradeReasoning(input: ReasoningGradeInput): Promise<ReasoningFeedback> {
      if (key === null) throw new Error(NO_KEY_MESSAGE)

      // Construct the client lazily per call: the key may have changed, and
      // keyless sessions must never touch the SDK. dangerouslyAllowBrowser is
      // required for browser-direct CORS calls (it sets the
      // anthropic-dangerous-direct-browser-access header) — acceptable here
      // because the key is the user's own, stored only in their browser.
      const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })

      let response: Anthropic.Message
      try {
        response = await client.messages.create({
          model: REASONING_MODEL,
          max_tokens: MAX_TOKENS,
          system: buildSystemPrompt(),
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
          output_config: {
            format: { type: 'json_schema', schema: FEEDBACK_SCHEMA },
          },
        })
      } catch (error) {
        throw toUserError(error)
      }

      if (response.stop_reason === 'refusal') throw new Error(REFUSAL_MESSAGE)
      if (response.stop_reason === 'max_tokens') throw new Error(TRUNCATED_MESSAGE)

      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      )
      if (textBlock === undefined) throw new Error(UNUSABLE_MESSAGE)

      const feedback = parseReasoningFeedback(textBlock.text)
      if (feedback === null) throw new Error(UNUSABLE_MESSAGE)
      return feedback
    },
  }
}
