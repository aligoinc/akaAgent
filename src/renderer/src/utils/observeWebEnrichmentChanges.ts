import type { WebEnrichmentState } from '../../../shared/facebookWebEnrichment'

/** Local IPC only: observe session transitions without reading account/configuration data. */
export function observeWebEnrichmentChanges(onChange: (accountIds: ReadonlySet<number> | null) => void): () => void {
  const api = window.electronAPI.webEnrichment
  if (!api || typeof api.onState !== 'function') return () => {}
  let live = true, receivedEvent = false
  let previous: Map<number, string> | null = null
  const accept = (states: WebEnrichmentState[], event: boolean) => {
    if (!live) return
    const next = new Map(states.map(state => [state.accountId, state.runId]))
    const before = previous
    const changed = before ? new Set([...Array.from(before.keys()), ...Array.from(next.keys())].filter(id => before.get(id) !== next.get(id))) : null
    previous = next
    // An event before the initial snapshot has an unknown previous state; invalidate conservatively.
    if (event && (!changed || changed.size)) onChange(changed)
  }
  const unsubscribe = api.onState(states => { receivedEvent = true; accept(states, true) })
  void api.state().then(states => { if (!receivedEvent) accept(states, false) }).catch(() => {})
  return () => { live = false; unsubscribe() }
}
