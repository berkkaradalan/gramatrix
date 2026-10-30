import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { HostEventName, HostEvents, RpcMethod, RpcParams, RpcResult } from '@shared/rpc'
import { errorMessage } from '../lib/format'
import { toast } from './toasts'

export function invoke<M extends RpcMethod>(
  method: M,
  params: RpcParams<M>
): Promise<RpcResult<M>> {
  return window.gramatrix.invoke(method, params)
}

export function useHostEvent<E extends HostEventName>(
  event: E,
  listener: (payload: HostEvents[E]) => void
): void {
  const latest = useRef(listener)
  latest.current = listener
  useEffect(() => window.gramatrix.on(event, (payload) => latest.current(payload)), [event])
}

export interface Query<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload(): Promise<void>
}

/** Loads data when the dependencies change. A newer load always wins over an older one. */
export function useQuery<T>(load: () => Promise<T>, deps: DependencyList): Query<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const latestLoad = useRef(load)
  latestLoad.current = load
  const generation = useRef(0)

  const reload = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    try {
      const result = await latestLoad.current()
      if (current !== generation.current) return
      setData(result)
      setError(null)
    } catch (caught) {
      if (current === generation.current) setError(errorMessage(caught))
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, ...deps])

  return { data, error, loading, reload }
}

export interface Action {
  busy: boolean
  run<T>(action: () => Promise<T>): Promise<T | undefined>
}

/** Runs an async action with a busy flag. Failures become an error toast. */
export function useAction(): Action {
  const [busy, setBusy] = useState(false)

  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    try {
      return await action()
    } catch (caught) {
      toast.error(errorMessage(caught))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, run }
}

/** Remembers a small value for this viewer. Storage can be unavailable, so failures are ignored. */
export function usePersistedState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : (JSON.parse(stored) as T)
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // The preference only lasts for this session.
      }
    },
    [key]
  )
  return [value, update]
}
