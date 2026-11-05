import { useCallback, useEffect, useRef, useState } from 'react'
import { EffectivenessError } from './effectivenessApi'

export interface EffectivenessDataState<T> {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: T | null
  error: string | null
  reload: () => void
}

// "Another report is loading" is a short local queue: retry a few times, then show it.
const BUSY_RETRY_DELAYS_MS = [1_500, 3_000, 4_500]

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})

/**
 * Loads one report on demand. Results stay in a page-level cache for the current login and refresh
 * revision (no polling, no focus refresh); late results after a filter, tab or session change are ignored.
 */
export function useEffectivenessData<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  cache: Map<string, unknown>
): EffectivenessDataState<T> {
  const [state, setState] = useState<Omit<EffectivenessDataState<T>, 'reload'>>(() => {
    const cached = key ? cache.get(key) as T | undefined : undefined
    return cached ? { status: 'ready', data: cached, error: null } : { status: key ? 'loading' : 'idle', data: null, error: null }
  })
  const [revision, setRevision] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const forced = useRef(false)

  useEffect(() => {
    if (!key) { setState({ status: 'idle', data: null, error: null }); return }
    const cached = cache.get(key) as T | undefined
    if (cached && !forced.current) { setState({ status: 'ready', data: cached, error: null }); return }
    forced.current = false
    const controller = new AbortController()
    let active = true
    setState({ status: 'loading', data: null, error: null })
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await loadRef.current(controller.signal) } catch (error) {
          const delay = BUSY_RETRY_DELAYS_MS[attempt]
          if (!(error instanceof EffectivenessError && error.code === 'report_busy') || delay === undefined) throw error
          await wait(delay, controller.signal)
        }
      }
    }
    run().then(data => {
      if (!active) return
      cache.set(key, data)
      setState({ status: 'ready', data, error: null })
    }).catch(error => {
      if (!active || controller.signal.aborted) return
      setState({ status: 'error', data: null, error: error instanceof Error ? error.message : 'Không thể tải báo cáo.' })
    })
    return () => { active = false; controller.abort() }
  }, [key, revision, cache])

  const reload = useCallback(() => {
    if (key) cache.delete(key)
    forced.current = true
    setRevision(value => value + 1)
  }, [cache, key])

  return { ...state, reload }
}
