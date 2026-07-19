import { useSession } from '../store/context'

const CLAMP = 600

export default function EvalBar() {
  const evalCp = useSession((s) => s.evalCp)

  const clamped = Math.max(-CLAMP, Math.min(CLAMP, evalCp))
  // White's share of the bar: 50% at equality, 100% at +6 or better.
  const whitePct = 50 + (clamped / CLAMP) * 50

  const label =
    Math.abs(evalCp) >= 9000
      ? evalCp > 0
        ? '#'
        : '-#'
      : `${evalCp >= 0 ? '+' : ''}${(evalCp / 100).toFixed(1)}`

  return (
    <div className="eval-bar" title={`Engine evaluation: ${label}`}>
      <div className="eval-bar-track">
        <div className="eval-bar-white" style={{ height: `${whitePct}%` }} />
      </div>
      <div className={`eval-bar-label ${evalCp >= 0 ? 'eval-white' : 'eval-black'}`}>
        {label}
      </div>
    </div>
  )
}
