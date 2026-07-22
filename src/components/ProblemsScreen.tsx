import { useEffect, useState } from 'react'
import type { LlmAPI } from '../types'
import { useProblems } from '../store/problemsContext'
import ProblemBoard, { ProblemEvalBar } from './ProblemBoard'
import ReadCheckPanel from './ReadCheckPanel'
import ReasonPanel from './ReasonPanel'
import SolvePanel from './SolvePanel'
import ApiKeySettings from './ApiKeySettings'

/**
 * Problems mode (Milestone 6b/6c): three gated phases per problem —
 * read → reason → solve (PLAN §8.1). This screen switches on the problems
 * store status; the LlmAPI instance is passed in from App for the BYOK
 * settings modal (ADR-0003).
 */
export default function ProblemsScreen({ llm }: { llm: LlmAPI }) {
  const status = useProblems((s) => s.status)
  const engineInitializing = useProblems((s) => s.engineInitializing)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const openSettings = () => setSettingsOpen(true)

  return (
    <>
      <ProblemsErrorBanner />
      {status === 'picking' ? (
        <ThemePicker onOpenSettings={openSettings} />
      ) : status === 'loading' ? (
        <div className="loading-screen">
          <span className="spinner spinner-large" aria-hidden="true" />
          <p>{engineInitializing ? 'Warming up the engine…' : 'Setting up the problem…'}</p>
        </div>
      ) : (
        <ProblemView onOpenSettings={openSettings} />
      )}
      {settingsOpen && <ApiKeySettings llm={llm} onClose={() => setSettingsOpen(false)} />}
    </>
  )
}

/** Store errors surface here — same look as App's session error banner. */
function ProblemsErrorBanner() {
  const error = useProblems((s) => s.error)
  const clearError = useProblems((s) => s.clearError)
  const status = useProblems((s) => s.status)
  const backToPicker = useProblems((s) => s.backToPicker)

  if (!error) return null

  return (
    <div className="error-banner problems-error-banner" role="alert">
      <span className="error-banner-text">{error}</span>
      <span className="error-banner-actions">
        {status !== 'picking' && (
          <button type="button" className="btn btn-small" onClick={backToPicker}>
            Back to problems
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={clearError}
          aria-label="Dismiss error"
        >
          Dismiss
        </button>
      </span>
    </div>
  )
}

function ThemePicker({ onOpenSettings }: { onOpenSettings: () => void }) {
  const manifest = useProblems((s) => s.manifest)
  const manifestError = useProblems((s) => s.manifestError)
  const loadManifest = useProblems((s) => s.loadManifest)
  const pickTheme = useProblems((s) => s.pickTheme)
  const solvedCount = useProblems((s) => s.solvedCount)
  const attemptedCount = useProblems((s) => s.attemptedCount)

  // Idempotent in the store — safe to call on every mount of the picker.
  useEffect(() => {
    loadManifest()
  }, [loadManifest])

  return (
    <div className="picker problems-picker">
      <div className="picker-intro problems-picker-intro">
        <div>
          <h2>Pick a problem theme</h2>
          <p>
            Three gated phases per problem: read the position, write your reasoning, then
            prove it on the board. A wrong move ends the attempt — no guessing.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={onOpenSettings}
          title="Reasoning coach settings (BYOK)"
        >
          ⚙ Reasoning coach
        </button>
      </div>

      {attemptedCount > 0 && (
        <p className="problems-counters">
          This session: {solvedCount} solved of {attemptedCount} attempted
        </p>
      )}

      {manifestError ? (
        <div className="insights-error problems-manifest-error">
          <span>{manifestError}</span>
          <button type="button" className="btn btn-small" onClick={loadManifest}>
            Retry
          </button>
        </div>
      ) : !manifest ? (
        <div className="loading-screen problems-manifest-loading">
          <span className="spinner spinner-large" aria-hidden="true" />
          <p>Loading the problem sets…</p>
        </div>
      ) : (
        <div className="picker-grid">
          {manifest.themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className="opening-card theme-card"
              onClick={() => pickTheme(theme.id)}
            >
              <div className="opening-card-top">
                <span className="opening-eco">
                  ~{manifest.ratingMin}–{manifest.ratingMax}
                </span>
              </div>
              <h3 className="opening-name">{theme.name}</h3>
              <p className="opening-desc">{theme.description}</p>
              <div className="opening-meta">
                {theme.count} problem{theme.count === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="problems-footnote">
        Problems curated from the Lichess puzzle database (CC0).
      </p>
    </div>
  )
}

function ProblemView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const status = useProblems((s) => s.status)
  const themeName = useProblems((s) => s.themeName)
  const problem = useProblems((s) => s.problem)
  const userColor = useProblems((s) => s.userColor)
  const backToPicker = useProblems((s) => s.backToPicker)

  return (
    <div className="trainer problems-view">
      <div className="trainer-board-area">
        <ProblemEvalBar />
        <ProblemBoard />
      </div>

      <aside className="trainer-side">
        <div className="panel trainer-head">
          <div className="trainer-head-row">
            <div>
              <h2 className="trainer-opening-name">{themeName ?? 'Problem'}</h2>
              <div className="trainer-opening-meta">
                {problem ? `Rating ${problem.rating} · ` : ''}you play {userColor}
              </div>
            </div>
            <div className="problems-head-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={onOpenSettings}
                title="Reasoning coach settings (BYOK)"
                aria-label="Reasoning coach settings"
              >
                ⚙
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={backToPicker}>
                Back to problems
              </button>
            </div>
          </div>
        </div>

        {status === 'read' ? (
          <ReadCheckPanel />
        ) : status === 'reason' || status === 'grading' ? (
          <ReasonPanel />
        ) : (
          <SolvePanel />
        )}
      </aside>
    </div>
  )
}
