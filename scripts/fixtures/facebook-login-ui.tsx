import React from 'react'
import { createRoot } from 'react-dom/client'
import FacebookImportModal from '../../src/renderer/src/components/CampaignPanels/FacebookImportModal'
import FacebookCredentialsModal from '../../src/renderer/src/components/CampaignPanels/FacebookCredentialsModal'
import AlertModal from '../../src/renderer/src/components/CampaignPanels/AlertModal'
import '../../src/renderer/src/styles/global.css'
let state: any = null
const listeners = new Set<(state: any) => void>()
const emit = () => { for (const listener of listeners) listener(structuredClone(state)) }
const root = createRoot(document.getElementById('root')!)
const render = (content: React.ReactNode) => root.render(<>{content}<AlertModal/></>)
let managed = false, finishLogin: ((error?: string) => void) | null = null
let metadataPending = false
const credentialCalls: any[] = []
Object.assign(window, { facebookFixture: {
  credentials: (isManaged: boolean, id = 40, name = 'Tài khoản thủ công', pending = false) => {
    managed = isManaged; credentialCalls.length = 0
    metadataPending = pending
    render(<FacebookCredentialsModal key={id + String(managed)} account={{ id, name,
      flatformType: 'facebook', facebookUid: '100000000001111', facebookLoginManaged: managed,
      loginStatus: 'đã đăng nhập', isActive: true } as any} onClose={() => render(<p>Đã đóng form</p>)}/> )
  },
  finishLogin: (error?: string) => finishLogin?.(error),
  credentialCalls,
  progress: (rows: any[], running: boolean) => {
    rows.forEach((row, index) => Object.assign(state.rows[index], row))
    state.running = running; emit()
  }
} })
Object.assign(window, { electronAPI: { facebookLogin: {
  metadata: async () => metadataPending ? new Promise(() => {}) : ({ uid: '100000000001111', revision: managed ? 1 : 0,
    hasPassword: managed, hasTwoFactor: managed, hasCookie: managed }),
  save: async (id: number, input: any) => { credentialCalls.push({ action: 'save', id, input }) },
  login: async (id: number, input: any) => {
    credentialCalls.push({ action: 'login', id, input })
    await new Promise<void>((resolve, reject) => { finishLogin = error => error ? reject(new Error(error)) : resolve() })
  },
  state: async () => state,
  onProgress: (listener: (state: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  preview: async (input: any) => {
    const rows = input.rows || input.text.trim().split('\n').map((text: string) => ({ uid: text.split('|')[0] }))
    state = { id: 'fixture', running: false, limit: 10, rows: rows.map((row: any,index: number) => ({ index, uid: row.uid, status: 'ready', message: 'Sẵn sàng' })) }
    emit(); return structuredClone(state)
  },
  start: async () => { state.running = true; state.rows[0].status = 'running'; state.rows[0].message = 'Đang xác thực bằng mã 2FA…'; emit(); return structuredClone(state) },
  stop: async () => { state.running = false; state.rows.forEach((row: any) => { if (['ready','running'].includes(row.status)) { row.status = 'cancelled'; row.message = 'Đã dừng.' } }); emit() }
} } })
render(<FacebookImportModal accountGroupId={null} proxyId={null} onClose={() => {}} />)
