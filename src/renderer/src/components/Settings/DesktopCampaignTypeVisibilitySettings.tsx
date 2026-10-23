import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { campaignVisibilityScope, campaignVisibilitySession } from '../../stores/campaignTypeVisibilityStore'
import CampaignTypeVisibilitySettings from './CampaignTypeVisibilitySettings'

export default function DesktopCampaignTypeVisibilitySettings({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const user = useAuthStore(state => state.user)
  const scope = campaignVisibilityScope()
  return <CampaignTypeVisibilitySettings key={scope} organizationName={user?.organizationName || ''}
    load={() => window.electronAPI.getCampaignTypeVisibility(true)}
    save={changes => window.electronAPI.patchCampaignTypeVisibility(changes)}
    onBusyChange={onBusyChange}
    onConfirmed={result => {
      const previous = campaignVisibilitySession.getSnapshot()
      if (campaignVisibilitySession.accept(result, scope) && previous?.revision !== result.revision) {
        void useCampaignStore.getState().loadCampaigns({ silent: true })
      }
    }} />
}
