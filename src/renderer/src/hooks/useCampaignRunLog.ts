import { useEffect } from 'react'
import { useCampaignStore } from '../stores/campaignStore'

/** Only the visible log tab reads stored history. The main cache/RPC transfer deltas. */
export function useCampaignRunLog(id: number | null, active: boolean): void {
  useEffect(() => {
    if (!active || !id) return
    let disposed = false
    let running = false
    let due = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const visible = () => document.visibilityState === 'visible'
    const arm = () => {
      clearTimeout(timer)
      if (!disposed && visible() && !running && due) timer = setTimeout(run, Math.max(0, due - Date.now()))
    }
    const run = () => {
      if (disposed || !visible()) return
      running = true; due = 0
      void (async () => {
        // Reopening while an older read settles must still get a fresh snapshot.
        if (useCampaignStore.getState().loadingCampaignLogIds[id]) await useCampaignStore.getState().loadCampaignLog(id).catch(() => null)
        if (disposed || !visible()) return
        return useCampaignStore.getState().loadCampaignLog(id, { force: true })
      })()
        .catch(error => console.error('Failed to refresh campaign log:', error))
        .finally(() => { running = false; arm() })
    }
    const request = (delay = 2000) => {
      if (!due) due = Date.now() + delay
      else if (!delay) due = Date.now()
      arm()
    }
    const refreshVisible = () => { if (visible()) request(0); else clearTimeout(timer) }
    const unsubscribeLog = window.electronAPI.onCampaignLog(log => { if (log.campaignId === id) request() })
    const unsubscribeUpdate = window.electronAPI.onCampaignLogUpdated(signal => { if (signal.id === id) request() })
    // Legacy local/group signals and reconnects remain compatible. State events
    // do not erase the last good history while the delta is being fetched.
    const unsubscribeState = window.electronAPI.onCampaignStatusUpdated(signal => {
      if (!signal.id || signal.id === id) request(signal.id ? 2000 : 0)
    })
    const unsubscribeStore = useCampaignStore.subscribe((state, previous) => {
      // Reuse the existing page refresh for missed-event recovery; no extra polling clock.
      if (state.campaignsReadAt !== previous.campaignsReadAt) request()
    })
    document.addEventListener('visibilitychange', refreshVisible)
    window.addEventListener('focus', refreshVisible)
    request(0)
    return () => {
      disposed = true; clearTimeout(timer)
      unsubscribeLog(); unsubscribeUpdate(); unsubscribeState(); unsubscribeStore()
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('focus', refreshVisible)
    }
  }, [id, active])
}
