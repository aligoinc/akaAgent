import { useEffect } from 'react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import { campaignEdit } from './campaignEdit'
import { CampaignEditDialogView } from './CampaignEditDialogView'

export default function CampaignEditDialogs() {
  useEffect(() => {
    const stopStore = useCampaignStore.subscribe((state, previous) => {
      if (state.campaignsReadAt !== previous.campaignsReadAt) campaignEdit.refresh()
    })
    const stopEvent = window.electronAPI.onCampaignStatusUpdated(event => {
      if (event.id === campaignEdit.getSnapshot().campaignId) campaignEdit.refresh()
    })
    const stopAuth = useAuthStore.subscribe((state, previous) => {
      if (!state.user || state.user.staffId !== previous.user?.staffId || state.user.organizationId !== previous.user?.organizationId) campaignEdit.cancel()
    })
    return () => { stopStore(); stopEvent(); stopAuth(); campaignEdit.cancel() }
  }, [])
  return <CampaignEditDialogView flow={campaignEdit} />
}
