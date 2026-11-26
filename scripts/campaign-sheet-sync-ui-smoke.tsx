// Đồng bộ Google Sheet vào data chiến dịch (V662): cửa sổ Upload thật (tab Link sheet), dòng tóm tắt và thẻ trong chiến dịch,
// với IPC giả lập. Chạy bằng scripts/run-campaign-sheet-sync-ui-smoke.cjs (Chromium của Playwright, không cần Electron).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignDataUploadModal, { type CampaignDataUploadSubmission } from '../src/renderer/src/components/CampaignPanels/CampaignDataUploadModal'
import AlertModal from '../src/renderer/src/components/CampaignPanels/AlertModal'
import ConfirmModal from '../src/renderer/src/components/CampaignPanels/ConfirmModal'
import { CampaignSheetSyncFormNote } from '../src/renderer/src/components/CampaignSheetSync/CampaignSheetSyncFormNote'
import { CampaignSheetSyncCard } from '../src/renderer/src/components/CampaignSheetSync/CampaignSheetSyncCard'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import type { CampaignSheetSyncDraft, CampaignSheetSyncSource } from '../src/shared/campaignSheetSync'
import '../src/renderer/src/styles/global.css'

const state: any = { calls: [], errors: [], submission: null as CampaignDataUploadSubmission | null, settingsAvailable: true, sync: null as CampaignSheetSyncSource | null, active: true }
window.addEventListener('error', event => state.errors.push(String(event.message)))
window.addEventListener('unhandledrejection', event => state.errors.push(String((event as PromiseRejectionEvent).reason)))

const cell = (v: string) => ({ value: v, text: v })
const sheetTable = { tables: [{ name: 'Trang tính1', rowNumbers: [1, 2, 3, 4, 5], rows: [
  ['SĐT', 'Tên'], ['0912345678', 'An'], ['0912345679', 'Bình'], ['0912345678', 'An lặp'], ['abc', 'Lỗi']
].map(row => row.map(cell)) }] }

;(window as any).electronAPI = new Proxy({}, {
  get: (_target, name: string) => async (...args: any[]) => {
    state.calls.push({ method: name, args })
    if (name === 'campaignSheetSyncCall') {
      const request = args[0]
      if (request.action === 'settings') return state.settingsAvailable ? { ok: true, data: { available: true, maxSourcesPerStaff: 20, minEveryHours: 1 } } : { ok: true, data: { available: false } }
      if (request.action === 'state') return { ok: true, data: { sync: state.sync, active: state.active } }
      if (request.action === 'runs') return { ok: true, data: { runs: [
        { id: 3, kind: 'run', actor: 'system', status: 'success', startedAt: '2026-11-26T07:00:00Z', finishedAt: '2026-11-26T07:00:02Z', createdAt: '2026-11-26T07:00:00Z', rowsRead: 40, added: 37, duplicates: 2, invalid: 1, perCampaign: [{ campaignId: 1, added: 37, reopened: false }], errorCode: null, errorMessage: null, detail: null },
        { id: 2, kind: 'run', actor: 'system', status: 'error', startedAt: '2026-11-26T01:00:00Z', finishedAt: '2026-11-26T01:00:01Z', createdAt: '2026-11-26T01:00:00Z', rowsRead: null, added: null, duplicates: null, invalid: null, perCampaign: null, errorCode: 'sheet_read_failed', errorMessage: 'Không thể kết nối Google Sheet. Vui lòng thử lại.', detail: null },
        { id: 1, kind: 'enable', actor: 'staff', status: null, startedAt: null, finishedAt: null, createdAt: '2026-11-25T13:00:00Z', rowsRead: null, added: null, duplicates: null, invalid: null, perCampaign: null, errorCode: null, errorMessage: null, detail: null }
      ] } }
      if (request.action === 'stop') {
        state.sync = { ...state.sync, campaignIds: [], isEnabled: false, status: 'paused', stoppedReason: 'staff_off',
          campaigns: state.sync.campaigns.map((c: any) => ({ ...c, state: 'left', leftReason: 'staff_off' })) }
        state.active = false
        return { ok: true, data: { sync: state.sync } }
      }
      if (request.action === 'resume') {
        state.sync = { ...state.sync, campaignIds: [1], isEnabled: true, status: 'pending', stoppedReason: null, endDate: request.endDate || state.sync.endDate,
          campaigns: state.sync.campaigns.map((c: any) => ({ ...c, state: 'active', leftReason: undefined })) }
        state.active = true
        return { ok: true, data: { sync: state.sync } }
      }
      if (request.action === 'save') {
        state.sync = { ...state.sync, revision: state.sync.revision + 1, status: 'pending', isEnabled: true, everyHours: request.everyHours, endDate: request.endDate, stoppedReason: null, lastErrorCode: null }
        return { ok: true, data: { sync: state.sync } }
      }
    }
    if (name === 'loadCampaignDataFromSheet') return sheetTable
    if (name === 'campaignInputDuplicates') return { ok: false, code: 'off', message: '' }
    if (name === 'dataGroupMemberMatches') return { ok: false }
    return undefined
  }
})
useAuthStore.setState({ user: { staffId: 4, organizationId: 1, username: 'demo', name: 'Demo', isAdmin: true, isAdminAkabiz: false, entitlements: {}, accountProducts: [] } as any })

function today(days = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + days * 86400000))
  return parts
}

function Upload() {
  const [open, setOpen] = useState(true)
  if (!open) return <div id="upload-closed">đã đóng</div>
  return <CampaignDataUploadModal platform="zalo" actionId="zalo_message_phone" accountIds={[11]} showDatasetName={false}
    sheetSync={{ campaignEndDate: null }} onClose={() => setOpen(false)} onInsert={() => {}}
    onSubmitRows={submission => { state.submission = submission }} />
}

function Note() {
  const [draft, setDraft] = useState<CampaignSheetSyncDraft | null>({
    enabled: true, everyHours: 6, endDate: today(30), sheetValues: [], requestId: 'r1',
    config: { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit', hasHeader: true, mapping: { phone: 0 }, expectedHeaders: ['SĐT'], columnCount: 1, phonePolicy: 'first', targetField: 'phone', platform: 'zalo' }
  })
  ;(window as any).noteDraft = draft
  return draft ? <CampaignSheetSyncFormNote draft={draft} onChange={setDraft} /> : <div id="note-removed">đã bỏ</div>
}

function App() {
  const [view, setView] = useState<'upload' | 'note' | 'card'>('upload')
  const [cardKey, setCardKey] = useState(0)
  ;(window as any).sheetSmoke = { state, view: (next: any) => setView(next), remountCard: () => setCardKey(value => value + 1) }
  return <>
    {view === 'upload' && <Upload />}
    {view === 'note' && <div style={{ padding: 20, width: 720 }}><Note /></div>}
    {view === 'card' && <div style={{ padding: 20, width: 720 }}><CampaignSheetSyncCard key={cardKey} campaignId={1} campaignName="Nhắn tin khách tháng 11" /></div>}
    <AlertModal />
    <ConfirmModal />
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
