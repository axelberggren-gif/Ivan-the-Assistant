import { useEffect, useId, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import type { SheetActionKind, SheetPeek } from './sheetPeek'

/** Matches the phone breakpoint in `index.css` — above it there is no sheet. */
const MOBILE_QUERY = '(max-width: 720px)'

/** Vertical travel that counts as a deliberate swipe rather than a tap. */
const SWIPE_PX = 28

/**
 * The side column, and on a phone the bottom sheet it turns into.
 *
 * Desktop is unchanged: an `<aside className="trainer-side">` next to the
 * board. Below 720px the same element is pinned above the mobile nav, showing
 * only a peek row — the phase, the coach's last word, and the one button that
 * moves the session on — and expands over the board when tapped, swiped up, or
 * when `peek.expandOn` changes (the moments that exist to be read). The board
 * itself never shrinks and is never permanently covered.
 *
 * `onAction` resolves `peek.action.kind` to a store action; the pure mapping
 * lives in `sheetPeek.ts`.
 */
export default function BoardSheet({
  peek,
  onAction,
  children,
}: {
  peek: SheetPeek
  /** Runs the peek button. Not called for the `'expand'` kind — that is ours. */
  onAction?: (kind: SheetActionKind) => void
  children: ReactNode
}) {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)

  // Resizing to desktop must not leave a scrim or a locked body behind.
  useEffect(() => {
    if (!isMobile) setOpen(false)
  }, [isMobile])

  // Expand on the statuses the user is meant to stop and read; collapse on the
  // ones that hand the board back. Both refs track every value including null,
  // so returning to a status (solve → wrong line → solve) fires again.
  const lastExpand = useRef(peek.expandOn)
  const lastCollapse = useRef(peek.collapseOn)
  useEffect(() => {
    const expanded = peek.expandOn !== lastExpand.current && peek.expandOn !== null
    const collapsed = peek.collapseOn !== lastCollapse.current && peek.collapseOn !== null
    lastExpand.current = peek.expandOn
    lastCollapse.current = peek.collapseOn
    if (expanded) setOpen(true)
    else if (collapsed) setOpen(false)
  }, [peek.expandOn, peek.collapseOn])

  // A new phase means new panels: whatever the user had scrolled to belonged
  // to the old ones, so start them at the top rather than part-way down.
  const lastTitle = useRef(peek.title)
  useEffect(() => {
    if (peek.title === lastTitle.current) return
    lastTitle.current = peek.title
    bodyRef.current?.scrollTo({ top: 0 })
  }, [peek.title])

  // While the sheet is over the board: Escape closes it, and the page behind
  // the scrim must not scroll.
  useEffect(() => {
    if (!isMobile || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [isMobile, open])

  // Swipe the handle up/down. A swipe that lands on the toggle would otherwise
  // also fire its click and undo itself, so the next click is swallowed.
  const touchStartY = useRef<number | null>(null)
  const swallowClick = useRef(false)

  function onTouchStart(e: TouchEvent) {
    touchStartY.current = e.touches[0]?.clientY ?? null
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchStartY.current
    const end = e.changedTouches[0]?.clientY
    touchStartY.current = null
    if (start == null || end == null) return
    const dy = end - start
    if (dy < -SWIPE_PX) setOpen(true)
    else if (dy > SWIPE_PX) setOpen(false)
    else return
    swallowClick.current = true
  }

  function toggle() {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    setOpen((o) => !o)
  }

  // An 'expand' button has nothing left to do once the sheet is open — the
  // control it was standing in for is now on screen.
  const action = peek.action?.kind === 'expand' && open ? null : peek.action

  return (
    <>
      {isMobile && open && (
        <div className="sheet-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      )}
      <aside className="trainer-side board-sheet" data-open={open ? 'true' : 'false'}>
        <div className="sheet-handle-zone" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <span className="sheet-grabber" aria-hidden="true" />
          <div className="sheet-head">
            <button
              type="button"
              className="sheet-toggle"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={open ? 'Hide the coaching panel' : 'Show the coaching panel'}
            >
              <span className="sheet-peek-text">
                <span className="sheet-peek-title">{peek.title}</span>
                {peek.sub && <span className="sheet-peek-sub">{peek.sub}</span>}
              </span>
              <span className="sheet-chevron" aria-hidden="true">
                {open ? '▾' : '▴'}
              </span>
            </button>
            {action && (
              <button
                type="button"
                className="btn btn-primary btn-small sheet-action"
                disabled={action.disabled}
                onClick={
                  action.kind === 'expand'
                    ? () => setOpen(true)
                    : () => onAction?.(action.kind)
                }
              >
                {action.label}
              </button>
            )}
          </div>
        </div>
        <div className="sheet-body" id={bodyId} ref={bodyRef}>
          {children}
        </div>
      </aside>
    </>
  )
}

/** Live `matchMedia` result — the sheet only exists on phone-sized viewports. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}
