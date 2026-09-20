import React from 'react'
import { createRoot } from 'react-dom/client'
import GeneralSettingsModal from '../src/renderer/src/components/Settings/GeneralSettingsModal'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], fail: false, pending: [], hold: false }
const rows = Array.from({ length: 52 }, (_, i) => ({
  id: String(i + 1), phone: i === 0 ? '0901234567' : null, email: i === 0 ? 'lan@example.com' : null,
  zaloGlobalId: `global-${i + 1}`, zaloName: i === 0 ? 'Nguyễn Thị Lan' : `Khách hàng ${i + 1}`,
  zaloAvatar: i === 0 ? 'https://example.com/broken.png' : null,
  confirmedAt: '2026-09-20T03:30:00Z', sourceCampaignId: i === 0 ? 11 : null,
  sourceCampaignName: i === 0 ? 'Chăm sóc khách hàng tháng 9' : null, sourceDetailId: i === 0 ? 100 : null,
  sourceSentAt: i === 0 ? '2026-09-20T02:15:00Z' : null,
  sourceActionName: i === 0 ? 'Nhắn tin bạn bè' : null, sourceStatus: i === 0 ? 'thành công' : null
}))
const api: any = {
  getAkaBizIntegrations: async () => ({}), listAkaBizContactTags: async () => [],
  getEmailNotificationSettings: async () => ({ recipientEmails: [], dailyReportTime: '18:00' }),
  listMessageOptOutCustomers: async ({ search = '', page = 1 }: any) => {
    state.calls.push({ search, page })
    if (state.hold) await new Promise(resolve => state.pending.push(resolve))
    if (state.fail) throw new Error('fixture error')
    const filtered = rows.filter(row => !search || Object.values(row).some(value => String(value).toLowerCase().includes(search.toLowerCase())))
    const actualPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 50)))
    return { items: filtered.slice((actualPage - 1) * 50, actualPage * 50), total: filtered.length, page: actualPage, pageSize: 50 }
  }
}
window.electronAPI = api
useAuthStore.setState({user: {staffId:7,organizationId:9} as any})
;(window as any).optOutSmoke = { state, release: () => { state.hold=false; state.pending.splice(0).forEach((resolve: any) => resolve()) } }
createRoot(document.getElementById('root')!).render(<GeneralSettingsModal initialMenu="chatSync" onClose={() => {}} />)
