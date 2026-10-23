import { useEffect, useMemo, useRef, useState } from 'react'
import type { CampaignAccountActionScope, CampaignAccountActionSnapshot } from '../../../../shared/campaignAccountActionSnapshot'

interface SnapshotState {
  scope: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot: CampaignAccountActionSnapshot | null
}

/** A single snapshot per mounted form/session, including unselected accounts and optional actions. */
export function useCampaignAccountActionSnapshot(scopes: CampaignAccountActionScope[], ready: boolean, userScope: string) {
  const inputs = useRef(scopes)
  inputs.current = scopes
  const request = useRef<{ scope: string; promise: Promise<CampaignAccountActionSnapshot> } | null>(null)
  const [state, setState] = useState<SnapshotState>({ scope: '', status: 'idle', snapshot: null })
  useEffect(() => {
    if (!userScope) {
      request.current = null
      setState({ scope: '', status: 'idle', snapshot: null })
      return
    }
    if (!ready) return
    let disposed = false
    if (request.current?.scope !== userScope) {
      const initialScopes = inputs.current
      request.current = {
        scope: userScope,
        promise: initialScopes.length
          ? Promise.resolve().then(() => window.electronAPI.getCampaignAccountActionSnapshot(initialScopes))
          : Promise.resolve({ capturedAt: null, accounts: [] })
      }
    }
    setState({ scope: userScope, status: 'loading', snapshot: null })
    void request.current.promise.then(snapshot => {
      if (!disposed) setState({ scope: userScope, status: 'ready', snapshot })
    }, () => {
      if (!disposed) setState({ scope: userScope, status: 'error', snapshot: null })
    })
    return () => { disposed = true }
  }, [ready, userScope])

  const snapshot = state.scope === userScope && userScope ? state.snapshot : null
  const byAccount = useMemo(() => new Map((snapshot?.accounts || []).map(account => [
    account.accountId, new Map(account.actions.map(action => [action.actionCode, action]))
  ])), [snapshot])
  return {
    status: !userScope ? 'idle' as const : state.scope === userScope ? state.status : 'loading' as const,
    snapshot,
    byAccount
  }
}
