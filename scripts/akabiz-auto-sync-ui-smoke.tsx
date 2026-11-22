// Hộp thoại "Đồng bộ từ akaBiz Desktop" (AkaBizAutoSyncModal) thật với IPC giả lập. Chạy bằng
// scripts/run-akabiz-auto-sync-ui-smoke.cjs (Chromium của Playwright, không cần Electron, không ra mạng).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AkaBizAutoSyncModal from '../src/renderer/src/components/Settings/AkaBizAutoSyncModal'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import '../src/renderer/src/styles/global.css'

type Row = Record<string, any>
const local = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000 + 7 * 3600000).toISOString().slice(0, 19)

const connectResult = {
  target: { staffId: 123, username: 'admin.shopmau', name: 'Admin', organizationName: 'Shop Mẫu' },
  source: { staffId: 101, accountId: 100, username: 'nhanvien01', name: 'Nhân viên 01' },
  options: {
    zalo: { zalo_server: { allowed: true, used: 3, max: 10 }, zalo_web: { allowed: false, used: 0, max: null }, zalo_qr: { allowed: true, used: 10, max: 10 } },
    facebook: { allowed: true, used: 1, max: 5 }, defaultZaloAccountType: 'zalo_server'
  },
  accounts: [
    { shopId: 55, name: 'Zalo Bán hàng 1', platform: 'zalo', isActive: true, phone: '0912 xxx 101', mapped: null },
    { shopId: 56, name: 'Zalo CSKH', platform: 'zalo', isActive: true, phone: null, mapped: { accountId: '9001', type: 'zalo_server', name: 'Zalo CSKH' } },
    { shopId: 57, name: 'Zalo Tuyển dụng', platform: 'zalo', isActive: false, phone: null, mapped: null },
    { shopId: 70, name: 'Lan Nguyễn', platform: 'facebook', isActive: true, phone: null, mapped: null }
  ],
  inProgress: null,
  dbPath: 'C:\\akaBiz Auto\\Resources2\\akabiz_auto_local.db',
  installId: 'abc123',
  campaigns: [
    { id: 1, name: 'Khách cũ', shopId: 55, platform: 'zalo', actionId: 'zalo_send_to_phone', status: 'Dừng', lastUpdatedAt: local(2) },
    { id: 2, name: 'Tri ân', shopId: 55, platform: 'zalo', actionId: 'zalo_send_to_friend', status: 'Chờ xử lý', lastUpdatedAt: local(20) },
    { id: 3, name: 'Cũ', shopId: 56, platform: 'zalo', actionId: 'zalo_send_to_group', status: 'Dừng', lastUpdatedAt: local(120) },
    { id: 4, name: 'Không ngày', shopId: 56, platform: 'zalo', actionId: 'zalo_send_to_group', status: 'Dừng', lastUpdatedAt: null },
    { id: 5, name: 'Đang chạy', shopId: 55, platform: 'zalo', actionId: 'zalo_send_to_phone', status: 'Đang xử lý', lastUpdatedAt: local(1) },
    { id: 6, name: 'Đăng nhóm', shopId: 70, platform: 'facebook', actionId: 'group_post', status: 'Dừng', lastUpdatedAt: local(5) },
    { id: 7, name: 'Shop tắt', shopId: 57, platform: 'zalo', actionId: 'zalo_send_to_phone', status: 'Dừng', lastUpdatedAt: local(1) }
  ]
}

const report = (dryRun: boolean, settings: Row) => ({
  dryRun, asOf: new Date().toISOString(), settings,
  accounts: [{ shopId: 55, result: dryRun ? 'would_create' : 'created', accountId: '9101', type: 'zalo_server' },
    { shopId: 56, result: dryRun ? 'would_reuse' : 'reused', accountId: '9001', type: 'zalo_server' },
    { shopId: 70, result: dryRun ? 'would_create' : 'created', accountId: '9201', type: 'facebook' }],
  campaigns: { total: 4, copied: 3, alreadyCopied: 0, outOfScope: 0,
    byAction: [{ actionId: 'zalo_message_phone', count: 2 }, { actionId: 'facebook_group_post', count: 1 }],
    skipped: [{ sourceId: 'abc123:9', campaignId: 9, name: 'Chấp nhận kết bạn', code: 'UNSUPPORTED_ACTION', message: 'akaAgent chưa có loại này' }],
    issues: [{ sourceId: 'abc123:2', campaignId: 2, name: 'Tri ân', code: 'DETAIL_UID_UNRESOLVED', message: '14 dòng thiếu UID Zalo' }] },
  rows: { read: 1500, imported: 1497, dropped: 3 },
  adjustments: [{ code: 'MEDIA_NOT_COPIED', message: 'Chiến dịch có ảnh được chép không kèm ảnh.', count: 2 }],
  mediaNotCopied: 2
})

const server: any = { calls: [] as Array<{ action: string; args: unknown[] }>, progress: null as null | ((p: unknown) => void), runGate: null as null | (() => void),
  holdSync: false, parentClicks: 0 }

;(window as any).electronAPI = {
  akaBizAutoSyncConnect: async (password: string) => {
    server.calls.push({ action: 'connect', args: [password] })
    if (password !== 'dung-mat-khau') return { ok: false, code: 'akabiz_sync_invalid_credentials', message: 'Tên đăng nhập hoặc mật khẩu akaBiz không đúng.' }
    return { ok: true, data: connectResult }
  },
  akaBizAutoSyncRun: async (settings: Row, dryRun: boolean) => {
    server.calls.push({ action: 'run', args: [settings, dryRun] })
    server.progress?.({ dryRun, stage: 'campaigns', campaignsDone: 1, campaignsTotal: 4, rowsDone: 600, rowsTotal: 1500,
      current: { name: 'Khách cũ', rowsDone: 100, rowsTotal: 1000 }, note: null, recent: [{ at: new Date().toISOString(), text: 'Đã chép “A” · 500 dòng', tone: 'ok' }] })
    if (!dryRun && server.holdSync) await new Promise<void>(resolve => { server.runGate = resolve })
    return { ok: true, data: report(dryRun, settings) }
  },
  akaBizAutoSyncCancel: async () => { server.calls.push({ action: 'cancel', args: [] }); return { ok: true, data: null } },
  akaBizAutoSyncClose: async () => { server.calls.push({ action: 'close', args: [] }); return { ok: true, data: null } },
  onAkaBizAutoSyncProgress: (callback: (p: unknown) => void) => { server.progress = callback; return () => { server.progress = null } }
}

useAuthStore.setState({ user: { staffId: 123, organizationId: 9, username: 'admin.shopmau', name: 'Admin', organizationName: 'Shop Mẫu' } as any })

function App() {
  const [open, setOpen] = useState(false)
  return (
    // Lớp ngoài giả lớp phủ của hộp Cài đặt chung: click lan lên đây là lỗi (hộp Cài đặt sẽ đóng).
    <>
      <button id="open" onClick={() => setOpen(true)}>Mở</button>
      <div id="parent" onClick={() => { server.parentClicks += 1 }}>
        {open && <AkaBizAutoSyncModal integration={{ id: 1, staffId: 101, username: 'nhanvien01', name: 'NV', installPath: 'C:\\akaBiz Auto',
          dbPath: connectResult.dbPath, integratedAt: '2026-11-10T09:15:00Z' }} onClose={() => setOpen(false)} />}
      </div>
    </>
  )
}

;(window as any).akaBizAutoSyncSmoke = {
  server,
  release: () => server.runGate?.(),
  saved: () => window.localStorage.getItem('aka.akabizAutoSync.settings.v1:9:123')
}
createRoot(document.getElementById('root')!).render(<App />)
