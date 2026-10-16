import React from 'react'
import { createRoot } from 'react-dom/client'
import { createZaloPhoneCheckStore } from '../src/renderer/src/stores/zaloPhoneCheckStore'
import { ZaloPhoneCheckTable, ZaloPhoneCheckSummary } from '../src/renderer/src/components/DataScan/ZaloPhoneCheckTable'
import ZaloPhoneCheckModal from '../src/renderer/src/components/DataScan/ZaloPhoneCheckModal'
import ConfirmModal from '../src/renderer/src/components/CampaignPanels/ConfirmModal'
import AlertModal from '../src/renderer/src/components/CampaignPanels/AlertModal'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import '../src/renderer/src/styles/global.css'
const win = window as any
const store = createZaloPhoneCheckStore()
const phones = Array.from({ length: 300 }, (_, i) => `090${String(i).padStart(7, '0')}`)
store.load(phones)
const root = createRoot(document.getElementById('root')!)
let rowHandler: Function, completed: Function, resolve: Function, request: any
let sequence = 0
let currentRows = new Map<string, any>()
win.phoneSmoke = { store, phones, row: (event: any) => {
  if (event.runId === request?.runId) { sequence = Math.max(sequence, event.sequence); currentRows.set(event.row.id, event.row) }
  rowHandler(event)
}, complete: (rows?: any[], stopped = true) => {
  const result = { runId: request.runId, accountId: request.accountId, sequence: ++sequence, stopped, rows: rows || [...currentRows.values()].map(row => row.status === 'checking' ? { ...row, status: 'unknown', note: 'Đã dừng trước khi xác nhận được kết quả.' } : row) }
  completed(result); resolve(result)
}, captureExport: (book: any) => { win.phoneSmoke.exported = book }, startCount: 0, cancels: [], closed: false, renders: {}, show: () => {
  root.render(<><ZaloPhoneCheckModal initialAccountId={71} onClose={() => { win.phoneSmoke.closed = true; root.render(<div>Đã đóng</div>) }} /><ConfirmModal /><AlertModal /></>)
} }
win.electronAPI = {
  listDataTypeCategoryItems: async () => [{ id: 1, code: 'phone', name: 'SĐT', sortOrder: 1, isActive: true }, { id: 2, code: 'zalo_person', name: 'Zalo UID', sortOrder: 2, isActive: true }],
  listDataGroups: async (query: any) => ({ total: 1, groups: [{ id: 100, name: 'Nhóm thử', color: '#16803d', sortOrder: 0, revision: 1, dataTypeCategoryItemId: query.compatibleDataTypeCategoryItemId,
    dataTypeCode: query.compatibleDataTypeCategoryItemId === 1 ? 'phone' : 'zalo_person', boundZaloAccountId: query.compatibleDataTypeCategoryItemId === 1 ? null : 71, activeMembershipCount: 0, isDelete: false }] }),
  listDataGroupMembers: async () => ({ members: [], total: 0 }),
  listDataGroupDatasets: async () => [],
  listDataGroupAccountOptions: async () => [],
  ingestDataGroup: async (payload: any) => { win.phoneSmoke.ingested = payload; return { insertedMembershipCount: payload.rows.length, reactivatedMembershipCount: 0, alreadyMemberCount: 0, invalidCount: 0, incompatibleCount: 0, conflictCount: 0, conflicts: [] } },

  zaloPhoneCheck: {
    onRow: (handler: Function) => { rowHandler = handler; return () => {} },
    onCompleted: (handler: Function) => { completed = handler; return () => {} },
    start: (value: any) => { request = value; sequence = 0; currentRows = new Map(value.phones.slice(0, value.limit).map((phone: string) => [phone, { id: phone, phone, name: '', uid: '', status: 'pending', note: '' }])); win.phoneSmoke.request = value; win.phoneSmoke.startCount++; return new Promise(r => { resolve = r }) },
    cancel: async (id: string) => { win.phoneSmoke.cancels.push(id); win.phoneSmoke.complete() }
  }
}
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: { zalo: true } } as any })
useCampaignStore.setState({ loadAccounts: async () => {}, accounts: [{ id: 71, name: 'Tài khoản thử', flatformType: 'zalo', isActive: true, isZaloServer: false, isZaloShowWeb: false }] as any })
root.render(<div style={{ padding: 20 }}><ZaloPhoneCheckSummary store={store} /><ZaloPhoneCheckTable store={store} /></div>)
