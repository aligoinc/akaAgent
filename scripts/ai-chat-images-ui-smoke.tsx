// Ảnh đính kèm câu hỏi của Hỏi đáp AI: form hỏi (AiChatStartModal) và tab Trợ lý (AiChatTab) thật của Desktop với IPC giả lập.
// Chạy bằng scripts/run-ai-chat-images-ui-smoke.cjs (Chromium của Playwright, không cần Electron, không kết nối mạng).
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AiChatStartModal } from '../src/renderer/src/components/AiChat/AiChatStartModal'
import { AiChatTab, type AiChatPanelRequest } from '../src/renderer/src/components/AiChat/AiChatTab'
import { useAiChatAgents } from '../src/renderer/src/components/AiChat/aiChatStore'
import '../src/renderer/src/styles/global.css'

type Row = Record<string, unknown>
const server: any = { maxImages: 3, calls: [] as Array<{ action: string; payload: Row }>, uploads: [] as Row[], files: new Map<string, string>(), messages: [] as Row[], revision: 0, uploadDelayMs: 0, failUpload: '' }
const iso = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function thread(): Row {
  const last = server.messages[server.messages.length - 1] as Row | undefined
  return {
    id: 7, projectId: 2, projectCode: 'hoi-dap-chien-dich-desktop', projectName: 'Hỏi đáp chiến dịch', name: String(server.messages[0]?.question ?? ''),
    firstQuestion: String(server.messages[0]?.question ?? ''), campaignId: 10, campaignName: 'Chăm sóc khách tháng 11', accountId: 5, accountName: 'Zalo Hà',
    status: 'đang mở', source: 'desktop', revision: server.revision, messageCount: server.messages.length, lastMessageSeq: server.messages.length,
    lastMessageStatus: last?.status ?? null, lastMessageAt: iso(), lastReadSeq: server.messages.length, unread: false, createdAt: iso()
  }
}
function addMessage(payload: Row): Row {
  const images = Array.isArray(payload.images) ? payload.images as string[] : []
  const question = String(payload.question ?? '').trim() || `[Gửi ${images.length} ảnh]`
  server.revision += 1
  const message = {
    id: 70 + server.messages.length, threadId: 7, seq: server.messages.length + 1, requestId: payload.requestId, question, images, status: 'chờ câu trả lời',
    threadRev: server.revision, progressNote: null, answer: null, answerJson: null, askedAt: iso(), queuedAt: iso(), startedAt: null, answeredAt: null, completedAt: null,
    deadlineAt: new Date(Date.now() + 20 * 60_000).toISOString(), errorCode: null, errorMessage: null, rating: null
  }
  server.messages.push(message)
  return message
}
const snapshot = (): Row => ({ changed: true, full: true, revision: server.revision, thread: thread(), messages: server.messages, hasMore: false, serverTime: iso() })

function call(action: string, payload: Row): unknown {
  server.calls.push({ action, payload })
  if (action === 'agents') {
    return {
      enabled: true, serverTime: iso(),
      limits: { maxQuestionLength: 4000, maxPendingPerStaff: 3, maxQuestionsPerDay: 50, ...(server.maxImages > 0 ? { maxImagesPerQuestion: server.maxImages } : {}) },
      groups: [{ id: 2, code: 'akaagent-desktop', name: 'akaAgent Desktop', description: '', projects: [{
        id: 2, code: 'hoi-dap-chien-dich-desktop', name: 'Hỏi đáp chiến dịch', description: 'Trợ lý trả lời câu hỏi về một chiến dịch: vì sao chưa chạy, kết quả, lỗi và cách xử lý.',
        defaultQuestion: '', suggestedQuestions: ['Vì sao chiến dịch chưa chạy?', 'Kết quả hôm nay thế nào?'], intakeSchema: [], appliesTo: { platforms: [], actionIds: [] },
        requiresCampaign: true, timeoutSeconds: 1200, version: 2
      }] }]
    }
  }
  if (action === 'open' || action === 'ask') { addMessage(payload); return snapshot() }
  if (action === 'sync') return { changed: false, revision: server.revision, lastReadSeq: server.messages.length, serverTime: iso() }
  if (action === 'sync_pending') return { items: [], serverTime: iso() }
  if (action === 'threads') return { items: server.messages.length ? [thread()] : [], nextCursor: null, serverTime: iso() }
  if (action === 'mark_read') return { ok: true, lastReadSeq: server.messages.length }
  if (action === 'cancel') {
    const last = server.messages[server.messages.length - 1]
    if (last) { last.status = 'đã hủy'; server.revision += 1; last.threadRev = server.revision }
    return snapshot()
  }
  throw new Error(`action chưa giả lập: ${action}`)
}

;(window as any).electronAPI = {
  aiChatCall: async (action: string, payload: Row) => {
    try { return { ok: true, data: call(action, payload) } } catch (error) { return { ok: false, code: 'ai_chat_unavailable', message: String(error) } }
  },
  aiChatUploadImage: async (image: { mimeType: string; dataBase64: string }) => {
    server.uploads.push({ mimeType: image.mimeType, base64Length: image.dataBase64.length })
    if (server.uploadDelayMs) await new Promise(resolve => setTimeout(resolve, server.uploadDelayMs))
    if (server.failUpload) return { ok: false, code: server.failUpload, message: 'Không tải được ảnh lên. Thử lại sau ít phút.' }
    const url = `https://pub-smoke.r2.dev/aka-agent/ai-chat/1/1/${uuid()}.${EXT[image.mimeType] ?? 'png'}`
    server.files.set(url, `${image.mimeType};${image.dataBase64}`)
    return { ok: true, data: { url, mimeType: image.mimeType, sizeBytes: Math.floor(image.dataBase64.length * 3 / 4) } }
  }
}

function App({ scope }: { scope: string }) {
  const agents = useAiChatAgents(scope)
  const [modal, setModal] = useState(false)
  const [request, setRequest] = useState<AiChatPanelRequest | null>(null)
  const project = agents?.groups[0]?.projects[0]
  return <div style={{ position: 'fixed', inset: 0, display: 'flex', background: 'var(--bg-primary)' }}>
    <div style={{ flex: 1, padding: 16 }}>
      <button type="button" id="open-modal" className="btn btn-primary" disabled={!project} onClick={() => setModal(true)}>Hỏi trợ lý</button>
    </div>
    <div className="ai-chat-host" style={{ width: 420, flex: 'none', borderLeft: '1px solid var(--border-default)' }}>
      <AiChatTab request={request} active />
    </div>
    {modal && project && <AiChatStartModal project={project} campaign={{ id: 10, name: 'Chăm sóc khách tháng 11', accountName: 'Zalo Hà' }}
      onClose={() => setModal(false)} onOpened={opened => { setModal(false); setRequest({ key: Date.now(), snapshot: opened }) }} />}
  </div>
}

const root = createRoot(document.getElementById('root') as HTMLElement)
let generation = 0
;(window as any).aiChatSmoke = {
  server,
  /** Dựng lại trang với một "database" mới. maxImages = 0: database chưa nhận ảnh. */
  reset(options: { maxImages?: number; uploadDelayMs?: number; failUpload?: string } = {}) {
    Object.assign(server, { maxImages: options.maxImages ?? 3, calls: [], uploads: [], messages: [], revision: 0, uploadDelayMs: options.uploadDelayMs ?? 0, failUpload: options.failUpload ?? '' })
    server.files.clear()
    generation += 1
    root.render(<App key={generation} scope={`smoke-${generation}`} />)
  },
  file: (url: string) => server.files.get(url) ?? null,
  lastCall: (action: string) => [...server.calls].reverse().find((item: { action: string }) => item.action === action)?.payload ?? null
}
;(window as any).aiChatSmoke.reset()
