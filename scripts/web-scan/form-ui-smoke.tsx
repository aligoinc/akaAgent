// Form "Tìm data" website (nhatot / batdongsan / Trang Vàng) và tab "Data tìm được": component thật của Desktop với IPC giả lập, không
// kết nối production. Chạy bằng scripts/web-scan/form-ui-smoke.cjs.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import { CampaignContentMediaUpdateModal, CampaignLimitUpdateModal } from '../../src/renderer/src/components/CampaignPanels/CampaignQuickEditModals'
import { campaignEdit } from '../../src/renderer/src/components/CampaignPanels/campaignEdit'
import { useDesktopPollingStore } from '../../src/renderer/src/stores/desktopPollingStore'
import { useCampaignStore } from '../../src/renderer/src/stores/campaignStore'
import { useAuthStore } from '../../src/renderer/src/stores/authStore'
import { useUiStore } from '../../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../../src/renderer/src/utils/entitlements'
import { buildWebScanWorkbook, collectWebScanRecords, webScanFieldColumns } from '../../src/renderer/src/components/CampaignPanels/webScanFoundData'
import { normalizeWebScanCampaignSettings } from '../../src/shared/webScan'
import { utils } from 'xlsx'
import '../../src/renderer/src/styles/global.css'

const accounts = [
  { id: 21, name: 'Website 1', flatformType: 'web', isActive: true, isDelete: false, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 1 },
  { id: 22, name: 'Zalo 22', flatformType: 'zalo', isActive: true, isDelete: false, isZaloServer: false, isZaloShowWeb: false, status: 'chờ xử lý',
    loginStatus: 'đã đăng nhập', staffId: 7, organizationId: 1 }
]
const WEB_ACTIONS = [
  { id: 'web_find_data_nhatot', name: 'Tìm data Nhà Tốt', limitCheckActionCodes: ['web_nhatot_phone'] },
  { id: 'web_find_data_batdongsan', name: 'Tìm data Batdongsan', limitCheckActionCodes: ['web_batdongsan_phone'] },
  { id: 'web_find_data_yellowpages', name: 'Tìm data Trang Vàng', limitCheckActionCodes: ['web_yellowpages_page'] }
]
const state: any = { calls: [], errors: [], alerts: [], details: [], nextId: 500 }
const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true,
  getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}),
  getEmailNotificationSettings: () => ({ recipientEmails: [], dailyReportTime: '18:00' }),
  getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [{ id: 77, name: 'Nhóm SĐT', dataTypeCategoryItemId: 501, dataTypeCode: 'phone', memberCount: 0 }], total: 1 }),
  listAccounts: () => accounts,
  listSendExclusionGroups: () => ({ groups: [], blocklists: [], revision: 1 }),
  listCampaignInputData: () => structuredClone(state.details),
  listCampaignInputDataPage: () => ({ rows: structuredClone(state.details), total: state.details.length }),
  saveCampaignDraft: (request: any) => ({ ...request, revision: 2, updatedAt: new Date().toISOString() }),
  createCampaign: (data: any) => ({ ...data, id: ++state.nextId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
  updateCampaign: (id: number, updates: any) => ({ id, ...updates, updatedAt: new Date().toISOString() }),
  createCampaignInputDataBatch: (rows: any[]) => rows.length,
  getCampaignTypeVisibility: () => ({ organizationId: 1, revision: 1, hiddenActionIds: [], updatedAt: null, canEdit: false }),
  getCampaign: (id: number) => ({ id, status: 'chờ xử lý', updatedAt: new Date().toISOString() })
}
window.electronAPI = new Proxy(handlers, { get(target, key: string) {
  if (key in target && typeof target[key] !== 'function') return target[key]
  if (key.startsWith('on')) return () => () => {}
  if (key === 'fileExists') return target[key]
  return async (...args: any[]) => {
    state.calls.push({ method: key, args })
    return key in target ? target[key](...args) : key.startsWith('get') ? null : []
  }
} }) as any
window.addEventListener('error', event => state.errors.push(event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 7, organizationId: 1, entitlements: normalizeEntitlements({ zalo: true }), webScanEnabled: true,
  webScanLimits: { defaultDaily: 100, maxDaily: 500, defaultSleepSeconds: 15, minSleepSeconds: 10 },
  zaloAccountCapabilities: { qr: true, web: true, server: true } } as any })
useCampaignStore.setState({ accounts: accounts as any,
  campaignActions: [...WEB_ACTIONS.map(a => ({ ...a, flatformType: 'web', isActive: false, isDelete: false })),
    { id: 'zalo_message_phone', name: 'Nhắn tin theo SĐT', flatformType: 'zalo', isActive: true, isDelete: false }] as any,
  campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => { state.alerts.push({ message, type }) }, showConfirm: (_message, confirm) => { void confirm() } })
useDesktopPollingStore.setState({ settings: { campaigns: 30, accounts: 30 } } as any)

// Bảng / Excel của tab "Data tìm được": dựng từ dòng Lịch sử hành động giống lượt thật (mỗi lần dùng một dòng, dòng "Tìm data" có data dùng lại).
const foundData = () => {
  const detail = (id: number, name: string, records: any[]) => ({ id, campaignId: 9, actionName: name, status: 'thành công', isDelete: false,
    createdAt: `2026-11-21T03:0${id}:00.000Z`, accountId: 21, inputData: { name: 'nhà quận 7' }, data: { webRecords: records } })
  const rec = (phone: string, extra: any = {}) => ({ site: 'nhatot', phone, name: 'Anh ' + phone.slice(-2), listingKey: 'L' + phone, link: 'https://www.nhatot.com/x/' + phone,
    section: 'sale', fields: { address: 'Quận 7', price: '5 tỷ', title: 'Nhà ' + phone.slice(-2) }, ...extra })
  const details = [detail(1, 'Hiện SĐT Nhà Tốt', [rec('0901000001')]), detail(2, 'Hiện SĐT Nhà Tốt', [rec('0901000002')]),
    detail(3, 'Tìm data', [rec('0901000003', { reused: true }), rec('0901000001')])]
  const records = collectWebScanRecords(details as any)
  const settings = normalizeWebScanCampaignSettings({}, 'nhatot')
  const sheet = buildWebScanWorkbook('nhatot', records, settings.infoMap).Sheets.Sheet1
  return { records, columns: webScanFieldColumns('nhatot', records), rows: utils.sheet_to_json(sheet, { header: 1 }) }
}

function App() {
  const [selection, setSelection] = useState({ actionId: null as string | null, mode: 'new', key: 0, extra: {} as Record<string, unknown> })
  const [closed, setClosed] = useState(false)
  ;(window as any).webScanSmoke = { state, foundData, selectSaveStatus: (status: any) => campaignEdit.selectSaveStatus(status), open: (actionId: string | null, mode = 'new', extra: Record<string, unknown> = {}, details: any[] = []) => {
    Object.assign(state, { calls: [], alerts: [], details })
    setClosed(false); setSelection(old => ({ actionId, mode, key: old.key + 1, extra }))
  } }
  const base: any = { id: 9, name: 'Môi giới Q7', actionId: selection.actionId, accountId: 21, accountName: 'Website 1',
    schedule: '2035-01-01T02:00:00.000Z', originalSchedule: '2035-01-01T02:00:00.000Z', content: '', status: 'tạm dừng', images: [],
    scheduleType: 'daily', continueNextDay: true, dataTargetSourceMode: 'direct', extraSettings: { ...selection.extra } }
  const action = WEB_ACTIONS.find(a => a.id === selection.actionId)
  const actionRow: any = action ? { ...action, flatformType: 'web', isActive: false, isDelete: false } : undefined
  const config: any = { ...base, updatedAt: '2026-11-21T00:00:00.000Z', editVersion: 1 }
  if (!closed && selection.mode === 'limit') return <CampaignLimitUpdateModal campaign={config} action={actionRow} onClose={() => setClosed(true)} />
  if (!closed && selection.mode === 'content') return <CampaignContentMediaUpdateModal campaign={config} action={actionRow} onClose={() => setClosed(true)} />
  return closed ? <p>Đã đóng</p>
    : <CampaignFormModal key={selection.key} onClose={() => setClosed(true)} campaign={selection.mode === 'edit' ? base : null}
      {...(selection.actionId ? { lockedActionId: selection.actionId } : {})} initialAccountIds={[21]} />
}
createRoot(document.getElementById('root')!).render(<App />)
