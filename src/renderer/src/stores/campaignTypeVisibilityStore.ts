import { useEffect, useState, useSyncExternalStore } from 'react'
import { createCampaignVisibilitySession, type CampaignTypeVisibilitySnapshot } from '../../../shared/campaignTypeVisibility'
import { useAuthStore } from './authStore'

export const campaignVisibilitySession = createCampaignVisibilitySession()
export const campaignVisibilityScope = () => {
  const user = useAuthStore.getState().user
  return user ? `${user.organizationId}:${user.staffId}:${user.chatWebSessionId || ''}` : ''
}
campaignVisibilitySession.reset(campaignVisibilityScope())
useAuthStore.subscribe((state, previous) => {
  if (state.user?.organizationId !== previous.user?.organizationId || state.user?.staffId !== previous.user?.staffId
    || state.user?.chatWebSessionId !== previous.user?.chatWebSessionId) campaignVisibilitySession.reset(campaignVisibilityScope())
})
export function acceptCampaignVisibility(snapshot: CampaignTypeVisibilitySnapshot) {
  return campaignVisibilitySession.accept(snapshot, campaignVisibilityScope())
}
export function useCampaignTypeVisibility(loadOnMount = false) {
  const scope = useAuthStore(state => state.user ? `${state.user.organizationId}:${state.user.staffId}:${state.user.chatWebSessionId || ''}` : '')
  const snapshot = useSyncExternalStore(campaignVisibilitySession.subscribe, campaignVisibilitySession.getSnapshot)
  // Consumers taking an opening snapshot must wait for this mount's refresh,
  // even when the shared store still contains a previous form's snapshot.
  const [loadedScope, setLoadedScope] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setLoadedScope('')
    if (!loadOnMount || !scope) return
    let current = true
    setError('')
    void campaignVisibilitySession.load(scope, () => window.electronAPI.getCampaignTypeVisibility())
      .then(() => { if (current) setLoadedScope(scope) })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Không thể tải cài đặt hiển thị.') })
    return () => { current = false }
  }, [scope, loadOnMount, retry])
  return {
    snapshot,
    ready: !!scope && loadedScope === scope && snapshot !== null,
    error,
    retry: () => setRetry(value => value + 1)
  }
}
