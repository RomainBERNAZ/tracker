import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'

export function useReviewBack(fallback: string) {
  const navigate = useNavigate()
  return () => {
    const state: unknown = globalThis.history.state
    if (state != null && typeof state === 'object' && 'idx' in state &&
      typeof state.idx === 'number' && state.idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }
}

function isUpdater<T>(action: SetStateAction<T>): action is (previous: T) => T {
  return typeof action === 'function'
}

// Keep review choices in memory across route/tab unmounts, never the imported data.
export function createReviewState<T>(initial: () => T) {
  const scopes = new Map<string, { value: T; listeners: Set<() => void> }>()
  return function useReviewState(scope = 'default'): [T, Dispatch<SetStateAction<T>>] {
    let entry = scopes.get(scope)
    if (!entry) {
      entry = { value: initial(), listeners: new Set() }
      scopes.set(scope, entry)
    }
    const current = entry
    const subscribe = useCallback((listener: () => void) => {
      current.listeners.add(listener)
      return () => { current.listeners.delete(listener) }
    }, [current])
    const snapshot = useCallback(() => current.value, [current])
    const update = useCallback((action: SetStateAction<T>) => {
      const next = isUpdater(action) ? action(current.value) : action
      if (Object.is(current.value, next)) return
      current.value = next
      current.listeners.forEach((listener) => listener())
    }, [current])
    return [useSyncExternalStore(subscribe, snapshot, snapshot), update]
  }
}
