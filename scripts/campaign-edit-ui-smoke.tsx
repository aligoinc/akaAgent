import React from 'react'
import { root } from './campaign-pending-reason-ui-smoke'
import CampaignPanel from '../src/renderer/src/components/CampaignPanels/CampaignPanel'
import CampaignEditDialogs from '../src/renderer/src/components/CampaignPanels/CampaignEditDialogs'
import AlertModal from '../src/renderer/src/components/CampaignPanels/AlertModal'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { CampaignContentMediaUpdateModal } from '../src/renderer/src/components/CampaignPanels/CampaignQuickEditModals'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
const base = (window as any).pendingSmoke
const api = window.electronAPI
const state: any = { pauses: 0, writes: 0, resumes: 0, failResume: false, ready: false, editVersion: 'original-config' }
const config = (id: number) => ({ ...base.store.getState().campaigns.find((c: any) => c.id === id), editReady: state.ready, editVersion: state.editVersion, content: 'Nội dung sau khi dừng', images: [] })
window.electronAPI = new Proxy(api, { get(target, key) {
  if (key === 'getCampaignConfig' || key === 'getDesktopCampaignConfig') return async (id: number) => config(id)
  if (key === 'listCampaignInputData') return async () => [{ id: 1, uid: '123456', name: 'Khách thử', status: 'chờ xử lý' }]
  if (key === 'updateCampaign') return async (id: number, patch: any, strict: boolean, expectedUpdatedAt?: string, retrySmsInputSchedule?: boolean, expectedEditVersion?: string) => {
    if (patch.status === 'tạm dừng') { state.pauses++; base.patch(id, { status: 'tạm dừng' }) }
    else if (patch.status === 'chờ xử lý') { state.resumes++; if (state.failResume) throw Error('Lỗi tiếp tục giả lập'); base.patch(id, patch) }
    else {
      if (!strict || !state.ready) throw Error('Missing readiness guard')
      if (expectedEditVersion !== state.editVersion) throw Error('Missing or conflicting configuration version')
      if (state.mobileEditor) {
        state.mobileWrites.push({ expectedUpdatedAt, retrySmsInputSchedule, expectedEditVersion })
        const updatedAt = `mobile-version-${state.mobileWrites.length}`
        state.editVersion = `mobile-config-${state.mobileWrites.length}`
        base.patch(id, { ...patch, updatedAt })
        if (state.failInputs) return { code: 'campaign_input_materialization_failed', campaignId: id,
          updatedAt, editVersion: state.editVersion, updateSmsSchedule: Boolean(patch.schedule || retrySmsInputSchedule),
          message: 'Cấu hình chiến dịch đã lưu, nhưng cập nhật data chưa hoàn tất. Bấm Lưu để thử lại trước khi tiếp tục chiến dịch.' }
      }
      state.writes++
      base.patch(id, patch)
    }
    return config(id)
  }
  return Reflect.get(target, key)
} })
;(window as any).editSmoke = { state, ready: () => { state.ready = true; base.store.setState({ campaignsReadAt: Date.now() }) },
  openMobileEditor: (mode: 'full' | 'quick', actionId: 'sms_send' | 'voice_call') => {
    state.mobileEditor = true; state.failInputs = true; state.mobileWrites = []; state.ready = true
    state.editVersion = 'mobile-config-original'
    const user = useAuthStore.getState().user!
    useAuthStore.setState({ user: { ...user, entitlements: { ...user.entitlements!, sms: true } } })
    const action: any = { id: actionId, name: actionId, flatformType: 'sms', isActive: true, isDelete: false }
    base.patch(91, { actionId, status: 'tạm dừng', updatedAt: 'mobile-original', extraSettings: {}, scheduleType: 'daily' })
    const campaign = config(91)
    base.store.setState({ accounts: [{ ...base.store.getState().accounts[0], flatformType: 'sms' }], campaignActions: [action] })
    const close = () => root.render(<AlertModal />)
    root.render(<>{mode === 'full' ? <CampaignFormModal key={`${mode}:${actionId}`} campaign={campaign} onClose={close} />
      : <CampaignContentMediaUpdateModal key={`${mode}:${actionId}`} campaign={campaign} action={action} onClose={close} />}
      <CampaignEditDialogs /><AlertModal /></>)
  }
}
root.render(<><div style={{height:'100vh'}}><CampaignPanel isActive /></div><CampaignEditDialogs /><AlertModal /></>)
