/**
 * Compact deep-analysis progress chip for the app header.
 *
 * The run lives at App level and survives navigation (ADR-0005 decision 4b),
 * so it has to be visible — and cancellable — from every screen, not just the
 * insights dashboard. All prose comes from src/analysis/templates.
 */
import { useStore } from 'zustand'
import { progressLabel } from '../analysis'
import type { AnalysisState } from '../store/analysis'
import { useAnalysisStoreOrNull } from '../store/analysisContext'

interface AnalysisProgressChipProps {
  /** Jump to the insights screen, where the full progress bar lives. */
  onOpen?: () => void
}

export default function AnalysisProgressChip({ onOpen }: AnalysisProgressChipProps) {
  const store = useAnalysisStoreOrNull()
  if (!store) return null
  return <Chip store={store} onOpen={onOpen} />
}

function Chip({
  store,
  onOpen,
}: {
  store: NonNullable<ReturnType<typeof useAnalysisStoreOrNull>>
  onOpen?: () => void
}) {
  const running = useStore(store, (s: AnalysisState) => s.running)
  const progress = useStore(store, (s: AnalysisState) => s.progress)
  const cancel = useStore(store, (s: AnalysisState) => s.cancel)

  if (!running || !progress) return null

  const label = progressLabel({
    phase: progress.phase,
    gamesDone: progress.gamesDone,
    gamesTotal: progress.gamesTotal,
    etaMs: progress.etaMs,
  })
  const donePct =
    progress.gamesTotal > 0 ? (progress.gamesDone / progress.gamesTotal) * 100 : 0

  return (
    <span className="analysis-chip" role="status">
      <button
        type="button"
        className="analysis-chip-body"
        onClick={onOpen}
        title="Deep analysis is running — open Insights"
      >
        <span className="spinner spinner-tiny" aria-hidden="true" />
        <span className="analysis-chip-text">{label}</span>
        <span className="analysis-chip-track" aria-hidden="true">
          <span className="analysis-chip-fill" style={{ width: `${donePct}%` }} />
        </span>
      </button>
      <button
        type="button"
        className="analysis-chip-cancel"
        onClick={cancel}
        aria-label="Cancel deep analysis"
        title="Cancel"
      >
        ×
      </button>
    </span>
  )
}
