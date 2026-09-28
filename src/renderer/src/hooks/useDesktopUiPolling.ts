import { useEffect, useRef } from 'react'
import { useCampaignStore } from '../stores/campaignStore'
import { useDesktopPollingStore } from '../stores/desktopPollingStore'

/** One UI timer, two independent intervals; no runtime/scheduler timers. */
export function useDesktopUiPolling(scope: string | null, active: boolean, hasServerAccounts: boolean): void {
  const settings = useDesktopPollingStore(state => state.settings)
  const current = useRef({ active, hasServerAccounts, settings })
  current.current = { active, hasServerAccounts, settings }
  const reschedule = useRef<() => void>(() => {})
  useEffect(() => { useDesktopPollingStore.getState().enter(scope) }, [scope])
  useEffect(() => {
    if (!scope) return
    let disposed = false
    let accountsRunning = false
    let campaignsRunning = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let accountEventDue = 0
    const visible = () => document.visibilityState === 'visible'
    const arm = () => {
      clearTimeout(timer)
      if (disposed || !visible()) return
      const { active, hasServerAccounts, settings } = current.current
      const state = useCampaignStore.getState()
      const due: number[] = []
      if (!accountsRunning) {
        if (accountEventDue) due.push(accountEventDue)
        if (active && hasServerAccounts) due.push(state.accountsReadAt + settings.accounts * 1000)
      }
      if (!campaignsRunning && active && state.campaignPageActive && state.campaignPageQuery) {
        due.push(state.campaignsReadAt + settings.campaigns * 1000)
        if (state.campaignPageDirty) due.push(state.campaignPageDueAt)
      }
      if (due.length) timer = setTimeout(run, Math.max(0, Math.min(...due) - Date.now()))
    }
    const run = () => {
      if (disposed || !visible()) return
      const state = useCampaignStore.getState()
      const { active, hasServerAccounts, settings } = current.current
      const now = Date.now()
      // At most one read of each kind, as before. A slow account read must not
      // block a campaign state event (or vice versa).
      if (!accountsRunning && ((accountEventDue && now >= accountEventDue)
        || (active && hasServerAccounts && now - state.accountsReadAt >= settings.accounts * 1000))) {
        accountsRunning = true
        const invalidate = accountEventDue > 0
        accountEventDue = 0
        void state.loadAccounts({ silent: true, invalidate }).finally(() => { accountsRunning = false; arm() })
      }
      if (!campaignsRunning && active && state.campaignPageActive && state.campaignPageQuery
        && ((state.campaignPageDirty && now >= state.campaignPageDueAt) || now - state.campaignsReadAt >= settings.campaigns * 1000)) {
        campaignsRunning = true
        void state.loadCampaigns({ silent: true, passive: true }).finally(() => { campaignsRunning = false; arm() })
      }
      arm()
    }
    const accountEvent = () => {
      if (!accountEventDue) accountEventDue = Date.now() + 300
      arm()
    }
    const unsubscribe = window.electronAPI.onAccountStatusUpdated(accountEvent)
    const unsubscribeStore = useCampaignStore.subscribe(arm)
    reschedule.current = arm
    document.addEventListener('visibilitychange', arm)
    window.addEventListener('focus', arm)
    arm()
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe(); unsubscribeStore()
      document.removeEventListener('visibilitychange', arm)
      window.removeEventListener('focus', arm)
      reschedule.current = () => {}
    }
  }, [scope])
  useEffect(() => { reschedule.current() }, [active, hasServerAccounts, settings])
}
