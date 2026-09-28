// Local browser harness; every electronAPI call is mocked. No production API or database.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import LogPanel from '../src/renderer/src/components/CampaignPanels/LogPanel'
import CampaignAssistantMenu from '../src/renderer/src/components/CampaignPanels/CampaignAssistantMenu'
import CustomerFeedbackLauncher from '../src/renderer/src/components/CustomerFeedback/CustomerFeedbackLauncher'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { CAMPAIGN_SUPPORT_QUESTION, isCampaignSupportTurnBusy, type CampaignAssistantOpenRequest, type CampaignSupportConversation, type CampaignSupportStatus, type CampaignSupportVariant } from '../src/shared/campaignSupport'
import '../src/renderer/src/styles/global.css'

const calls: Array<{ method: string; args: unknown[] }> = []
const conversations = new Map<string, CampaignSupportConversation>()
const startRequests = new Map<string, string>()
const listeners = new Set<(state: CampaignSupportConversation) => void>()
const key = (id: number, variant: CampaignSupportVariant = 'standard') => `${variant}:${id}`
let revision = 0
const campaigns: any[] = [{ id: 17, name: 'Zalo • Chăm sóc khách hàng', actionId: 'zalo_message_phone', status: 'chờ xử lý' },
  { id: 18, name: 'Facebook • Giới thiệu sản phẩm', actionId: 'facebook_message_uid', status: 'tạm dừng' }]
useAuthStore.setState({ user: { staffId: 7, organizationId: 1 } as any })
useCampaignStore.setState({ campaigns, accounts: [], logs: [] })
function emit(state: CampaignSupportConversation) {
  state.revision = ++revision
  listeners.forEach(listener => listener(structuredClone(state)))
  return structuredClone(state)
}
function start(id: number, autoStart = true, variant: CampaignSupportVariant = 'standard') {
  const state: CampaignSupportConversation = { variant, id: crypto.randomUUID(), staffId: 7, organizationId: 1, campaignId: id, revision: ++revision,
    turns: autoStart ? [{ requestId: crypto.randomUUID(), question: CAMPAIGN_SUPPORT_QUESTION, images: [], createdAt: new Date().toISOString(),
      result: null, error: null, retryable: false, controlPending: null }] : [] }
  conversations.set(key(id, variant), state)
  return state
}
function finish(id: number, status: CampaignSupportStatus, variant: CampaignSupportVariant = 'standard') {
  const state = conversations.get(key(id, variant))
  if (!state) return
  const last = state.turns.at(-1)
  if (!last) return
  last.result = { conversationId: state.turns[0]?.result?.conversationId || crypto.randomUUID(), turnId: last.result?.turnId || crypto.randomUUID(), status,
    answer: status === 'completed' ? 'Chiến dịch chưa đến lịch chạy.\n\n1. Kiểm tra thời gian đã đặt trong chiến dịch.\n2. Xác nhận tài khoản đang đăng nhập.\n3. Giữ akaAgent mở để chạy đúng lịch.\n\nĐây là kết quả giả lập dùng kiểm tra giao diện.' : null,
    progress: { state: status, reason: status === 'needs_input' ? 'Gửi thêm ảnh màn hình trạng thái chiến dịch.' : null,
      stage: 'diagnosis', attempts: 1, nextAttemptAt: null, startedAt: null, updatedAt: null }, statusUrl: 'unused' }
  emit(state)
  if (state.pendingStartRequestId && ['cancelled', 'completed', 'needs_input'].includes(status)) emit(start(id, true, variant))
}
const api: Record<string, (...args: any[]) => any> = {
  onCampaignLog: () => () => {},
  onCampaignSupportUpdated: (listener: (state: CampaignSupportConversation) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  openCampaignSupport: (id: number, startRequestId?: string, variant: CampaignSupportVariant = 'standard') => {
    if (startRequestId && startRequests.get(key(id, variant)) !== startRequestId) {
      startRequests.set(key(id, variant), startRequestId)
      const state = conversations.get(key(id, variant))
      if (state && (state.pendingStartRequestId || isCampaignSupportTurnBusy(state.turns.at(-1)))) {
        state.pendingStartRequestId = startRequestId
        state.turns.at(-1)!.controlPending = 'cancel'
        return emit(state)
      }
      return emit(start(id, true, variant))
    }
    return emit(conversations.get(key(id, variant)) ?? start(id, true, variant))
  },
  sendCampaignSupport: (request: any) => {
    const state = conversations.get(key(request.campaignId, request.variant))!
    state.turns.push({ requestId: crypto.randomUUID(), question: request.question, images: request.images, createdAt: new Date().toISOString(),
      result: null, error: null, retryable: false, controlPending: null })
    return emit(state)
  },
  controlCampaignSupport: (request: any) => { finish(request.campaignId, request.action === 'cancel' ? 'cancelled' : 'working', request.variant); return conversations.get(key(request.campaignId, request.variant)) },
  resetCampaignSupport: (id: number, _conversationKey: string, variant: CampaignSupportVariant = 'standard') => emit(start(id, false, variant)),
  retryCampaignSupport: (id: number, _conversationKey: string, variant: CampaignSupportVariant = 'standard') => emit(conversations.get(key(id, variant))!),
  readCampaignSupportImage: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKO0AAAAASUVORK5CYII=',
  getCampaignAssistantContext: (id: number) => ({ contextSnapshot: { campaign: { id }, snapshotAt: new Date().toISOString() } }),
  chatCampaignAssistant: () => ({ content: 'Hỏi AI hiện tại vẫn hoạt động.' })
}
;(window as any).electronAPI = new Proxy({}, { get: (_, name: string) => (...args: any[]) => {
  calls.push({ method: name, args })
  const result = api[name]?.(...args)
  return name.startsWith('on') ? result : Promise.resolve(result)
} })
;(window as any).supportSmoke = { calls, conversations, finish }

function Harness() {
  const [request, setRequest] = useState<CampaignAssistantOpenRequest | null>(null)
  const [width, setWidth] = useState(330)
  const variant = request?.mode === 'campaign_support_dsh' ? 'dsh' : 'standard'
  return <main style={{ height: 'calc(100vh - 36px)', display: 'flex', background: 'var(--bg-primary)' }}>
    <section style={{ flex: 1, padding: 24 }}>
      <h2>Kiểm tra Trợ lý AI</h2>
      <p>API giả lập — không gọi production.</p>
      {campaigns.map(campaign => <div key={campaign.id} style={{ display: 'flex', alignItems: 'center', gap: 24, margin: '22px 0' }}>
        <span>{campaign.name}</span><CampaignAssistantMenu onSelect={mode => setRequest({ campaignId: campaign.id, mode, requestId: crypto.randomUUID() })} />
      </div>)}
      <output data-testid="support-variant">{variant}</output>
      <button onClick={() => finish(request?.campaignId ?? 17, 'completed', variant === 'dsh' ? 'standard' : 'dsh')}>API: Hoàn tất bản khác</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 40 }}>
        <button onClick={() => finish(request?.campaignId ?? 17, 'completed', variant)}>API: Hoàn tất</button>
        <button onClick={() => finish(request?.campaignId ?? 17, 'needs_input', variant)}>API: Cần bổ sung</button>
        <button onClick={() => finish(request?.campaignId ?? 17, 'waiting_dependency', variant)}>API: Chờ dịch vụ</button>
        <button onClick={() => finish(request?.campaignId ?? 17, 'cancelled', variant)}>API: Đã dừng lượt cũ</button>
        <button onClick={() => setWidth(width === 220 ? 330 : 220)}>Đổi độ rộng khung</button>
      </div>
    </section>
    <section style={{ width, minWidth: 200, borderLeft: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column' }}>
      <LogPanel assistantOpenRequest={request} />
    </section>
    <CustomerFeedbackLauncher />
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
