import { useEffect, useState } from 'react'
import type { Color, VerdictBucket } from '../types'
import { useProblems } from '../store/problemsContext'

/** Verdict expressed relative to the user's side (what the buttons show). */
type RelativeVerdict = 'winning' | 'better' | 'equal' | 'worse' | 'losing'

const VERDICT_OPTIONS: { rel: RelativeVerdict; label: string }[] = [
  { rel: 'winning', label: "You're winning" },
  { rel: 'better', label: "You're better" },
  { rel: 'equal', label: 'Equal' },
  { rel: 'worse', label: 'Opponent is better' },
  { rel: 'losing', label: 'Opponent is winning' },
]

/** Map a user-relative verdict back to the White-perspective bucket. */
function toWhiteBucket(rel: RelativeVerdict, userColor: Color): VerdictBucket {
  if (rel === 'equal') return 'equal'
  const mine = userColor
  const theirs: Color = userColor === 'white' ? 'black' : 'white'
  switch (rel) {
    case 'winning':
      return `${mine}_winning` as VerdictBucket
    case 'better':
      return `${mine}_better` as VerdictBucket
    case 'worse':
      return `${theirs}_better` as VerdictBucket
    case 'losing':
      return `${theirs}_winning` as VerdictBucket
  }
}

const MATERIAL_MAX = 15

/**
 * Phase 1 — the machine-checked read gate (PLAN §8.1): material count and a
 * 5-bucket verdict guess, both presented relative to the user's side and
 * converted to the White-perspective contract shapes on submit.
 */
export default function ReadCheckPanel() {
  const userColor = useProblems((s) => s.userColor)
  const submitReadCheck = useProblems((s) => s.submitReadCheck)
  const error = useProblems((s) => s.error)

  /** Material diff in pawns from the USER's side (positive = user is up). */
  const [userDiff, setUserDiff] = useState(0)
  const [verdict, setVerdict] = useState<RelativeVerdict | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // A failed analysis keeps us in 'read' with a store error — re-enable the form.
  useEffect(() => {
    if (error) setSubmitted(false)
  }, [error])

  const materialLabel =
    userDiff === 0
      ? 'Even material'
      : userDiff > 0
        ? `You're up ${userDiff} ${userDiff === 1 ? 'point' : 'points'}`
        : `You're down ${-userDiff} ${userDiff === -1 ? 'point' : 'points'}`

  function submit() {
    if (verdict === null || submitted) return
    setSubmitted(true)
    submitReadCheck({
      // Contract is White minus Black — convert from the user-relative control.
      materialDiff: userColor === 'white' ? userDiff : -userDiff,
      verdict: toWhiteBucket(verdict, userColor),
    })
  }

  return (
    <div className="panel read-check">
      <div className="panel-title">Read check</div>
      <p className="read-check-intro">
        Read the position before you touch a piece: count the material, then call the
        verdict. Both get checked.
      </p>

      <div className="read-field">
        <span className="read-field-label">Material</span>
        <div className="stepper" role="group" aria-label="Material difference in points">
          <button
            type="button"
            className="btn btn-small stepper-btn"
            onClick={() => setUserDiff((d) => Math.max(-MATERIAL_MAX, d - 1))}
            disabled={submitted || userDiff <= -MATERIAL_MAX}
            aria-label="One point less"
          >
            −
          </button>
          <span
            className={`stepper-value${userDiff === 0 ? '' : userDiff > 0 ? ' stepper-up' : ' stepper-down'}`}
          >
            {materialLabel}
          </span>
          <button
            type="button"
            className="btn btn-small stepper-btn"
            onClick={() => setUserDiff((d) => Math.min(MATERIAL_MAX, d + 1))}
            disabled={submitted || userDiff >= MATERIAL_MAX}
            aria-label="One point more"
          >
            +
          </button>
        </div>
        <span className="read-field-hint">Q9 · R5 · B3 · N3 · P1</span>
      </div>

      <div className="read-field">
        <span className="read-field-label">Verdict</span>
        <div className="verdict-grid" role="group" aria-label="Position verdict">
          {VERDICT_OPTIONS.map((opt) => (
            <button
              key={opt.rel}
              type="button"
              className={`verdict-btn${verdict === opt.rel ? ' verdict-btn-active' : ''}`}
              onClick={() => setVerdict(opt.rel)}
              disabled={submitted}
              aria-pressed={verdict === opt.rel}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary read-check-submit"
        onClick={submit}
        disabled={verdict === null || submitted}
      >
        {submitted && <span className="spinner" aria-hidden="true" />}
        {submitted ? 'Checking your read…' : 'Check my read'}
      </button>
    </div>
  )
}
