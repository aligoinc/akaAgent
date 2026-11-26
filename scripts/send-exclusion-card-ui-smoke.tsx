// Fixture cho run-send-exclusion-card-ui-smoke.cjs: thẻ "Không gửi cho" (V654) với IPC giả.
import '../src/renderer/src/styles/global.css'
import {createRoot} from 'react-dom/client'
import {useState} from 'react'
import CampaignSendExclusionsCard from '../src/renderer/src/components/CampaignPanels/CampaignSendExclusionsCard'
import fixture from './fixtures/send-exclusion-ui-page.json'
import type {SendExclusionsByAccount} from '../src/shared/campaignSendExclusion'
import type {SaveSendExclusionGroupV2, SendExclusionGroupV2, SendExclusionV2Page} from '../src/shared/campaignSendExclusionMulti'
const catalog = fixture.catalog
const tagOptions = (accountId: number) => accountId === 100
  ? [{fieldId: 2, code: '7', label: 'Đã mua', value: '7', isActive: true, sortOrder: 0}, {fieldId: 2, code: '8', label: 'VIP', value: '8', isActive: true, sortOrder: 1}]
  : [{fieldId: 2, code: '21', label: 'Đã mua', value: '21', isActive: true, sortOrder: 0}]
const friendOptions = fixture.options.filter(o => o.fieldId === 1)
const state = {
  saves: [] as SaveSendExclusionGroupV2[], calls: [] as unknown[], value: {} as SendExclusionsByAccount, delay: 0,
  groups: [] as SendExclusionGroupV2[], conflict: false, resolved: 0
}
const page = (): SendExclusionV2Page => ({
  catalog: catalog as SendExclusionV2Page['catalog'],
  accounts: [
    {id: 100, name: 'Zalo Minh Thư', synced: true, syncedAt: '2026-11-25T02:00:00Z'},
    {id: 101, name: 'Zalo Shop', synced: true, syncedAt: '2026-11-25T02:00:00Z'},
    {id: 102, name: 'Zalo Mới', synced: false, syncedAt: null}
  ],
  groups: state.groups,
  blocklists: [{id: 4, name: 'VIP', accountId: 100, accountName: 'Zalo Minh Thư', count: 1005}, {id: 9, name: 'Khách cũ', accountId: 101, accountName: 'Zalo Shop', count: 42}]
})
const dataGroups = [
  {id: 11, name: 'Khách đã mua', dataType: 'phone' as const, count: 12450, shared: false, deleted: false},
  {id: 12, name: 'Nhân viên nội bộ', dataType: 'zalo_person' as const, count: 35, shared: true, deleted: false}
]
const campaigns = [
  {id: 801, name: 'Khuyến mãi tháng 10', actionId: 'zalo_message_phone', status: 'hoàn thành', accountId: 100, accountName: 'Zalo Minh Thư', deleted: false, completedAt: null, sentCount: 3200},
  {id: 802, name: 'Chăm sóc khách VIP', actionId: 'zalo_message_friend', status: 'đang chạy', accountId: 101, accountName: 'Zalo Shop', deleted: false, completedAt: null, sentCount: 410},
  // V666: DB chưa đếm kịp (null) / đếm tới 1.001.
  {id: 803, name: 'Tri ân năm cũ', actionId: 'zalo_message_friend', status: 'tạm dừng', accountId: 101, accountName: 'Zalo Shop', deleted: false, completedAt: null, sentCount: null},
  {id: 804, name: 'Ra mắt sản phẩm', actionId: 'zalo_message_phone', status: 'hoàn thành', accountId: 100, accountName: 'Zalo Minh Thư', deleted: false, completedAt: null, sentCount: 100001}
]
Object.assign(window, {cardSmoke: state})
Object.assign(window, {electronAPI: {
  getSendExclusionV2Page: async () => { state.calls.push('page'); return structuredClone(page()) },
  getSendExclusionV2Options: async (accountId: number) => { state.calls.push(['options', accountId]); return {accountId, options: [...friendOptions, ...tagOptions(accountId)]} },
  getSendExclusionV2Lists: async (query: {kind: string; query?: string; dataGroupIds?: number[]; sentCampaignIds?: number[]}) => {
    state.calls.push(['lists', query])
    const q = (query.query ?? '').toLowerCase(), match = (n: string) => !q || n.toLowerCase().includes(q)
    return {
      dataGroups: query.kind === 'campaigns' ? null : dataGroups.filter(g => match(g.name) || query.dataGroupIds?.includes(g.id)),
      campaigns: query.kind === 'dataGroups' ? null : campaigns.filter(c => (match(c.name) && (!(query as {status?: string}).status || c.status === (query as {status?: string}).status)) || query.sentCampaignIds?.includes(c.id))
    }
  },
  // V657: xem trước (giả): mỗi chiến dịch đã chọn loại 120 data, mỗi Nhóm data 30; 7 data chưa xác định.
  getSendExclusionV2Preview: async (query: {accountId: number; selection: {sentCampaignIds?: number[]; dataGroupIds?: number[]}; campaignId?: number | null}) => {
    state.calls.push(['preview', query])
    const sources = [
      ...(query.selection.sentCampaignIds ?? []).map(id => ({kind: 'campaign', id, name: campaigns.find(c => c.id === id)?.name ?? String(id), count: 120})),
      ...(query.selection.dataGroupIds ?? []).map(id => ({kind: 'data_group', id, name: dataGroups.find(g => g.id === id)?.name ?? String(id), count: 30}))]
    return {checked: 500, excluded: sources.reduce((n, s) => n + s.count, 0), pending: 7, sources, nextAfterId: null}
  },
  saveSendExclusionGroupV2: async (group: SaveSendExclusionGroupV2) => {
    state.saves.push(structuredClone(group)); await new Promise(r => setTimeout(r, state.delay))
    if (state.conflict) throw new Error("Error invoking remote method 'send-exclusions-v2:save': Error: Nhóm đã được thay đổi ở nơi khác. Hãy tải lại trước khi sửa.")
    const saved: SendExclusionGroupV2 = {id: group.id ?? 60, accountId: group.blocks[0].accountId, name: group.name, matchMode: group.blocks[0].matchMode,
      revision: group.revision + 1, version: group.blocks.length > 1 ? 2 : 1,
      blocks: group.blocks.map((b, i) => ({...b, accountName: page().accounts.find(a => a.id === b.accountId)?.name, sortOrder: i}))}
    state.groups = [...state.groups.filter(g => g.id !== saved.id), saved]
    return saved
  },
  syncZaloLabels: async () => []
}})
function App() {
  const [value, setValue] = useState<SendExclusionsByAccount>({})
  const [accounts, setAccounts] = useState([{id: 100, name: 'Zalo Minh Thư'}, {id: 101, name: 'Zalo Shop'}])
  const [pending, setPending] = useState<number | null>(null)
  Object.assign(state, {setAccounts, setPending, setValue: (v: SendExclusionsByAccount) => { setValue(v); state.value = v }})
  return <main style={{maxWidth: 840, margin: '30px auto', padding: 16}}>
    <CampaignSendExclusionsCard accounts={accounts} value={value} campaignId={900}
      pendingBlocklistAccountId={pending} onResolvePendingBlocklist={() => { state.resolved++; setPending(null) }}
      onChange={v => { setValue(v); state.value = v }} onEditing={() => {}} onManage={() => {}} />
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
