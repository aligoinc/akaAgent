import { useEffect, useRef, useState } from 'react'
import type { CampaignActionUsage } from '../../../../shared/types'

interface UsageState {
  key: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: CampaignActionUsage[]
}

/** A selection snapshot, deliberately independent of form fields, toggles and polling. */
export function useCampaignActionUsage(
  accountId: number | null,
  campaignActionId: string,
  actionCodes: string[],
  userScope: string
): UsageState {
  const key = accountId && campaignActionId && actionCodes.length > 0 && userScope
    ? JSON.stringify([userScope, accountId, campaignActionId])
    : ''
  const inputs = useRef({ accountId, actionCodes })
  inputs.current = { accountId, actionCodes }
  const inFlight = useRef(new Map<string, Promise<CampaignActionUsage[]>>())
  const [state, setState] = useState<UsageState>({ key: '', status: 'idle', rows: [] })

  useEffect(() => {
    if (!key) {
      setState({ key: '', status: 'idle', rows: [] })
      return
    }
    let disposed = false
    setState({ key, status: 'loading', rows: [] })
    // Wait for account/action initialization and quick successive selections to settle.
    const timer = setTimeout(() => {
      const { accountId: selectedAccountId, actionCodes: selectedCodes } = inputs.current
      if (!selectedAccountId) return
      let request = inFlight.current.get(key)
      if (!request) {
        request = Promise.resolve().then(() => window.electronAPI.getCampaignActionUsage(
          selectedAccountId, Array.from(new Set(selectedCodes))
        ))
        inFlight.current.set(key, request)
        const pending = request
        const clear = () => {
          if (inFlight.current.get(key) === pending) inFlight.current.delete(key)
        }
        void request.then(clear, clear)
      }
      void request.then(rows => {
        if (!disposed) setState({ key, status: 'ready', rows })
      }, () => {
        if (!disposed) setState({ key, status: 'error', rows: [] })
      })
    }, 300)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [key])

  // Hide old-account data immediately, before the next effect has run.
  if (!key) return { key, status: 'idle', rows: [] }
  return state.key === key ? state : { key, status: 'loading', rows: [] }
}
