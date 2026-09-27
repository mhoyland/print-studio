import { React } from 'jimu-core'

const MAX_HISTORY = 50
const COMMIT_DEBOUNCE_MS = 600

interface HistoryState<T> {
  present: T
  past: T[]
  future: T[]
}

export interface UseLayoutHistoryResult<T> {
  value: T
  update: (updater: T | ((prev: T) => T)) => void
  commitNow: () => void
  undo: () => void
  redo: () => void
  reset: (value: T) => void
  canUndo: boolean
  canRedo: boolean
}

// A basic linear undo/redo history. `update` applies immediately (so typing/dragging feels live),
// but the pre-change snapshot only lands on the undo stack after a short quiet period, so a burst of
// rapid edits (typing a word, dragging a color slider) collapses into one undo step instead of one
// per keystroke. Every kind of edit in the Layout Editor goes through this same `update` function —
// drag/resize/delete/arrange already fire once per gesture so they behave the same as a committed
// step either way, and typed fields get the debounce benefit for free without special-casing them.
export function useLayoutHistory<T> (initial: T): UseLayoutHistoryResult<T> {
  const [state, setState] = React.useState<HistoryState<T>>({ present: initial, past: [], future: [] })
  const pendingBaselineRef = React.useRef<T | null>(null)
  const timerRef = React.useRef<number | null>(null)

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const commitNow = React.useCallback((): void => {
    clearTimer()
    setState((s) => {
      const baseline = pendingBaselineRef.current
      pendingBaselineRef.current = null
      if (baseline === null || baseline === s.present) return s
      return { present: s.present, past: [...s.past, baseline].slice(-MAX_HISTORY), future: [] }
    })
  }, [])

  const update = React.useCallback((updater: T | ((prev: T) => T)): void => {
    setState((s) => {
      if (pendingBaselineRef.current === null) pendingBaselineRef.current = s.present
      return { ...s, present: typeof updater === 'function' ? (updater as (p: T) => T)(s.present) : updater }
    })
    clearTimer()
    timerRef.current = window.setTimeout(commitNow, COMMIT_DEBOUNCE_MS)
  }, [commitNow])

  const undo = React.useCallback((): void => {
    commitNow() // flush any pending burst as its own step first, so it isn't silently discarded
    setState((s) => {
      if (s.past.length === 0) return s
      const previous = s.past[s.past.length - 1]
      return { present: previous, past: s.past.slice(0, -1), future: [s.present, ...s.future] }
    })
  }, [commitNow])

  const redo = React.useCallback((): void => {
    commitNow()
    setState((s) => {
      if (s.future.length === 0) return s
      const [next, ...rest] = s.future
      return { present: next, past: [...s.past, s.present], future: rest }
    })
  }, [commitNow])

  const reset = React.useCallback((value: T): void => {
    clearTimer()
    pendingBaselineRef.current = null
    setState({ present: value, past: [], future: [] })
  }, [])

  return {
    value: state.present,
    update,
    commitNow,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0
  }
}
