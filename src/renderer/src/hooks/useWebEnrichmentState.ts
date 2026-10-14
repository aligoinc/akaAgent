import { useEffect, useState } from 'react'
export function useWebEnrichmentState(): Set<number> {
  const [ids, setIds] = useState<Set<number>>(() => new Set())
  useEffect(() => {
    let live = true, changed = false
    const unsubscribe = window.electronAPI.webEnrichment.onState(states => {
      changed = true
      if (live) setIds(new Set(states.map(s => s.accountId)))
    })
    void window.electronAPI.webEnrichment.state().then(states => {
      if (live && !changed) setIds(new Set(states.map(s => s.accountId)))
    }).catch(() => {})
    return () => { live = false; unsubscribe() }
  }, [])
  return ids
}
