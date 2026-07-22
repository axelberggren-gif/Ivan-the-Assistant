import { useState } from 'react'
import type { LlmAPI } from '../types'
import { useProblems } from '../store/problemsContext'

/**
 * BYOK settings modal (ADR-0003): the user's own Anthropic API key, stored
 * only in this browser's localStorage and sent only to api.anthropic.com.
 * The key is write-only here — it is never read back into the UI.
 */
export default function ApiKeySettings({
  llm,
  onClose,
}: {
  llm: LlmAPI
  onClose: () => void
}) {
  const llmAvailable = useProblems((s) => s.llmAvailable)
  const refreshLlm = useProblems((s) => s.refreshLlm)
  const [value, setValue] = useState('')

  function save() {
    if (value.trim() === '') return
    llm.setKey(value)
    refreshLlm()
    onClose()
  }

  function remove() {
    llm.setKey(null)
    refreshLlm()
    onClose()
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Reasoning coach settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal key-modal">
        <div className="key-modal-badge">Reasoning coach</div>
        <h2 className="key-modal-title">Your Anthropic API key (BYOK)</h2>
        <p className="key-modal-copy">
          With your own key, the reasoning coach grades your written reasoning against
          Stockfish&rsquo;s lines. The key is stored only in this browser (localStorage) and
          sent only to api.anthropic.com — never to any other server, and never bundled or
          logged. Everything else works without it.
        </p>
        <p className="key-modal-status">
          {llmAvailable
            ? 'A key is saved in this browser.'
            : 'No key saved — feedback is engine-only.'}
        </p>
        <input
          type="password"
          className="key-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          aria-label="Anthropic API key"
        />
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={value.trim() === ''}
          >
            Save key
          </button>
          {llmAvailable && (
            <button type="button" className="btn" onClick={remove}>
              Remove saved key
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
