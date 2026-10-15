import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReportPage from '../src/renderer/src/pages/ReportPage'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import '../src/renderer/src/styles/global.css'

const actions = [
  { id: 1, code: 'zalo_message_friend', name: 'Nhắn tin bạn bè', flatformType: 'zalo' },
  { id: 2, code: 'zalo_add_friend', name: 'Kết bạn', flatformType: 'zalo' }
]
const accounts = [{ id: 11, name: 'Zalo CSKH', flatformType: 'zalo', accountGroupName: 'Chăm sóc khách hàng' }]
const statuses = [
  { key: 'pending', label: 'Chờ xử lý', selector: { kind: 'pending' } },
  { key: 'status:20', label: 'Thành công', selector: { kind: 'status', statusId: 20 } },
  { key: 'status:22', label: 'Lỗi', selector: { kind: 'status', statusId: 22 } },
  { key: 'status:30', label: 'Đã là bạn bè', selector: { kind: 'status', statusId: 30 } }
]
const calls: Array<{ method: string; query?: unknown }> = []
const state = { calls, alerts: [] as string[], holdSummary: false, resolveSummary: null as null | (() => void), active: true }
const summary = (query: any, detailed: boolean) => ({ query, generatedAt: '2026-10-16T01:00:00Z',
  actions: actions.map(action => detailed ? { ...action, statuses } : action),
  rows: accounts.map(account => ({ account, countsByActionCode: Object.fromEntries(actions.map(action => [action.code,
    detailed ? { pending: 2, 'status:20': 2, 'status:22': 1, 'status:30': 0 } : { pendingCount: 2, successCount: 2, skippedCount: 0, failureCount: 1 }])) })) })
const detail = (query: any) => ({ query, total: 2, page: 1, pageSize: 100, generatedAt: '2026-10-16T01:00:00Z',
  accountName: accounts[0].name, actionName: actions[0].name, statusLabel: 'Thành công', rows: [1, 2].map(id => ({
    id: `detail:${id}`, source: 'campaign_detail', accountId: 11, accountName: accounts[0].name,
    actionCode: query.actionCode, actionName: actions[0].name, campaignName: 'Chăm sóc tháng 10',
    occurredAt: '2026-10-16T01:00:00Z', status: 'thành công', statusLabel: 'Thành công', subStatusLabel: 'Đã xem',
    targetName: `Khách hàng ${id}`, targetUid: `uid-${id}`, detailText: 'Đã gửi tin nhắn'
  })) })
window.electronAPI = {
  listAccounts: async () => accounts, listAccountGroups: async () => [], listAccountActions: async () => actions,
  getAccountActionReport: async query => { calls.push({ method: 'general', query }); return summary(query, false) },
  getAccountActionStatusReport: async query => { calls.push({ method: 'status', query });
    if (state.holdSummary) await new Promise<void>(resolve => { state.resolveSummary = resolve })
    return summary(query, true)
  },
  getAccountActionReportDetails: async query => { calls.push({ method: 'general-detail', query }); return detail(query) },
  getAccountActionStatusReportDetails: async query => { calls.push({ method: 'status-detail', query }); return detail(query) }
} as unknown as Window['electronAPI']
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, chatWebSessionId: 'fixture' } as any })
useUiStore.setState({ showAlert: message => { state.alerts.push(message) } })
const Smoke = () => {
  const [active, setActive] = useState(true)
  ;(window as any).reportSmoke = { state, setActive }
  return <ReportPage isActive={active} />
}
createRoot(document.getElementById('root')!).render(<Smoke />)
