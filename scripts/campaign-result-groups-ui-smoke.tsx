// Harness giao diện của khung "Sau khi chạy" trên Desktop: hook dùng chung hai form + thành phần thật, IPC giả lập.
// Dựng và chạy bởi scripts/run-campaign-result-groups-ui-smoke.cjs.
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { buildCampaignResultGroupOptions } from '../src/shared/campaignResultGroups'
import { useCampaignFormResultGroups } from '../src/renderer/src/components/CampaignResultGroups/useCampaignFormResultGroups'
import FromCampaignsTab from '../src/renderer/src/components/Automation/FromCampaignsTab'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import '../src/renderer/src/styles/global.css'
import '../src/renderer/src/styles/automationHub.css'

type Call = { action: string; payload: Record<string, unknown> | undefined }
const state = {
  calls: [] as Call[],
  failSaveFor: null as number | null,
  notReady: false,
  retries: 0,
  items: [] as Array<Record<string, unknown>>
}
const groups = [
  { id: 701, name: 'Group đăng OK', color: '#000', sortOrder: 1, revision: 1, activeMembershipCount: 12, isDelete: false, dataTypeCode: 'facebook_group', boundZaloAccountId: null },
  { id: 702, name: 'Khách SĐT', color: '#000', sortOrder: 2, revision: 1, activeMembershipCount: 3, isDelete: false, dataTypeCode: 'phone', boundZaloAccountId: null },
  { id: 703, name: 'Group dự phòng', color: '#000', sortOrder: 3, revision: 1, activeMembershipCount: 0, isDelete: false, dataTypeCode: 'facebook_group', boundZaloAccountId: null }
]
const catalog = [
  { actionCode: 'fb_post_group', statusValue: 'thành công', sortOrder: 1 },
  { actionCode: 'fb_post_group', statusValue: 'bỏ qua', sortOrder: 2 },
  { actionCode: 'fb_post_group', statusValue: 'thất bại', sortOrder: 3 },
  { actionCode: 'fb_comment', statusValue: 'thành công', sortOrder: 4 }
]

;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
  async campaignResultGroupsCall(action: string, payload?: Record<string, unknown>) {
    state.calls.push({ action, payload })
    await new Promise(resolve => setTimeout(resolve, 5))
    if (state.notReady) return { ok: false, code: 'campaign_result_groups_not_ready', message: 'Tính năng đưa khách vào nhóm đang được cập nhật trên máy chủ.' }
    if (action === 'options') return { ok: true, data: { ...buildCampaignResultGroupOptions(String(payload?.actionId), catalog, []), enabled: true } }
    if (action === 'save') {
      const row = (payload?.rows as Array<{ groupId: number }>)[0]
      if (row.groupId === state.failSaveFor) return { ok: false, code: 'campaign_result_groups_group_not_found', message: 'Nhóm khách hàng không còn hoặc không phải của bạn. Hãy chọn nhóm khác.' }
      return { ok: true, data: { items: [] } }
    }
    if (action === 'listAll') return { ok: true, data: { items: state.items } }
    if (action === 'setStatus') {
      const item = state.items.find(entry => entry.journeyId === payload?.journeyId)!
      const next = { ...item, state: payload?.action === 'pause' ? 'paused' : payload?.action === 'stop' ? 'stopped' : 'active', reason: payload?.action === 'pause' ? 'user' : null }
      return { ok: true, data: next }
    }
    return { ok: true, data: { items: [] } }
  },
  async listDataGroups() { return { groups, total: groups.length } },
  async listDataTypeCategoryItems() { return [{ id: 41, code: 'facebook_group', name: 'Group Facebook', sortOrder: 1, isActive: true }] },
  async createDataGroup(request: { name: string }) { return { ...groups[0], id: 799, name: request.name } }
}

function Harness() {
  const draftValuesRef = useRef<Record<string, unknown>>({})
  const [actionId, setActionId] = useState('facebook_group_post')
  const [enableComment, setEnableComment] = useState(false)
  const [tab, setTab] = useState(false)
  const rg = useCampaignFormResultGroups({
    draftPayload: undefined, draftValuesRef, actionId, accountIds: [11], accounts: [{ id: 11, name: 'fb LD' }],
    flags: { enableComment }, allowed: true, campaignId: null, cloneFromCampaignId: null
  })
  const smoke = (window as unknown as { crgSmoke: Record<string, unknown> }).crgSmoke
  Object.assign(smoke, {
    setActionId, setEnableComment, setTab,
    validate: () => rg.validate(),
    visible: () => rg.visible,
    title: () => rg.title,
    draft: () => JSON.parse(JSON.stringify(draftValuesRef.current.campaignResultGroups ?? null)),
    save: async (ids: number[]) => {
      try { await rg.saveForCampaigns(ids, 'batch1', () => false, new AbortController().signal); return 'ok' }
      catch (error) { return `${(error as Error).name}:${(error as { groupId?: number }).groupId}` }
    }
  })
  if (tab) return <FromCampaignsTab isActive onNewCampaign={() => { state.retries += 100 }} />
  return <div style={{ padding: 16, maxWidth: 760 }}>
    <h3 id="crg-title">{rg.title}</h3>
    {rg.visible && rg.element({ disabled: false })}
    <div id="crg-issue">{rg.saveIssue({ pending: true, busy: false, campaignCount: 1, onRetry: () => { state.retries += 1 } })}</div>
  </div>
}

;(window as unknown as { crgSmoke: Record<string, unknown> }).crgSmoke = { state, alerts: () => useUiStore.getState().alert }
createRoot(document.getElementById('root')!).render(<Harness />)
