// Khung "Khách sẽ nhận" trên form chiến dịch thật (docs/CAMPAIGN_RECIPIENT_PREVIEW.md). IPC và store là fixture;
// không DB, không mạng (runner chặn mọi http/https), không file thật.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CampaignFormModal from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'
import CampaignAgentFormModal from '../src/renderer/src/components/CampaignPanels/CampaignAgentFormModal'
import CampaignContentPreviewTab from '../src/renderer/src/components/CampaignPanels/CampaignContentPreviewTab'
import { buildCampaignContentPreview } from '../src/renderer/src/components/CampaignPanels/campaignContentPreview'
import { CampaignContentMediaUpdateModal } from '../src/renderer/src/components/CampaignPanels/CampaignQuickEditModals'
import ContentTemplatePreview from '../src/renderer/src/components/ContentTemplates/ContentTemplatePreview'
import { useAuthStore } from '../src/renderer/src/stores/authStore'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import { useUiStore } from '../src/renderer/src/stores/uiStore'
import { normalizeEntitlements } from '../src/renderer/src/utils/entitlements'
import { FORM_AI_SECTIONS } from '../src/shared/campaignFormAiConfig'
import '../src/renderer/src/styles/global.css'
import exclusionPage from './fixtures/send-exclusion-ui-page.json'

const actions = ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group', 'sms_send', 'voice_call', 'facebook_message_uid'].map(id => ({
  id, name: id, allowMultipleAccounts: true, allowSecondaryAccount: false, isActive: true, isDelete: false,
  flatformType: id.startsWith('facebook') ? 'facebook' : id.startsWith('zalo') ? 'zalo' : 'sms',
  limitCheckActionCodes: id === 'zalo_message_phone' ? ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'] : id.startsWith('zalo') ? ['zalo_message_stranger', 'zalo_add_friend'] : [id]
}))
const accounts = [
  { id: 21, name: 'Shop An Nhiên', flatformType: 'zalo', isZaloShowWeb: false, isZaloServer: false, zaloPhone: '0901234567' },
  { id: 22, name: 'Zalo trình duyệt', flatformType: 'zalo', isZaloShowWeb: true, isZaloServer: false },
  { id: 31, name: 'SIM Viettel 1', flatformType: 'sms', isZaloShowWeb: false, isZaloServer: false },
  { id: 41, name: 'Facebook A', flatformType: 'facebook', isZaloShowWeb: false, isZaloServer: false }
].map(account => ({ ...account, isActive: true, isDelete: false, staffId: 7, organizationId: 9, rateLimitMinutes: 65 }))

const state: any = { calls: [], errors: [], saved: null, savedPayloads: [], localReads: [], inputPageQueries: [] }

/** Ảnh "trên máy": vẽ một ô màu có nhãn để nhìn thấy trong ảnh chụp. */
function localImageDataUrl(path: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const context = canvas.getContext('2d')!
  let hash = 0
  for (const char of path) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  context.fillStyle = `hsl(${hash % 360} 70% 62%)`
  context.fillRect(0, 0, 320, 240)
  context.fillStyle = '#fff'
  context.font = 'bold 30px sans-serif'
  context.fillText(path.split(/[\\/]/).pop() || 'ảnh', 18, 130)
  return canvas.toDataURL('image/png')
}

const handlers: Record<string, any> = {
  platform: 'darwin', fileExists: () => true, getCampaignInputDataLimit: () => 10000,
  getAkaBizIntegrations: () => ({}), getStaffIntegrations: () => ({}), getSystemSetting: () => null, getSystemSettingValue: () => null,
  listDataGroups: () => ({ groups: [], total: 0 }), listAccounts: () => accounts, getAllCampaignActions: () => actions,
  getAllAccountActions: () => [], getCampaignActionUsage: () => [],
  getCampaignTypeVisibility: () => ({ organizationId: 9, revision: 0, hiddenActionIds: [], updatedAt: null, canEdit: false }),
  listCampaignFormAi: () => Object.values(FORM_AI_SECTIONS).map(sectionId => ({ sectionId, campaignScope: 'all', campaignActionIds: [] })),
  listZaloLabels: () => [],
  listSendExclusionGroups: (id: number) => ({ ...structuredClone(exclusionPage), groups: exclusionPage.groups.map(group => ({ ...group, accountId: id })) }),
  readCampaignPreviewFileDataUrl: (path: string) => {
    state.localReads.push(path)
    if (path.includes('missing')) throw new Error("Error invoking remote method 'campaign:read-preview-file': Error: File xem trước không còn tồn tại.")
    return { filePath: path, dataUrl: localImageDataUrl(path), sizeBytes: 2048, mimeType: 'image/png' }
  },
  listCampaignInputDataPage: (query: any) => {
    state.inputPageQueries.push(query)
    return { items: [{ id: 501, phone: '0912345678', name: 'Trần Văn Bình', info1: 'Quận 1' }, { id: 502, phone: '0987654321', name: 'Lê Hà', info1: '' }], total: 40 }
  },
  saveCampaignDraft: (request: any) => {
    state.savedPayloads.push(structuredClone(request.payload))
    state.saved = { ...request, ...request.payload.values.formData, revision: request.revision + 1, updatedAt: new Date().toISOString(), isDelete: false, deletionReason: null, campaignIds: [] }
    return state.saved
  }
}
window.electronAPI = new Proxy(handlers, {
  get(target, key: string) {
    if (key in target && typeof target[key] !== 'function') return target[key]
    if (key.startsWith('on')) return () => () => {}
    return async (...args: any[]) => {
      state.calls.push({ method: key, args })
      return key in target ? target[key](...args) : key.startsWith('get') ? null : []
    }
  }
}) as any
window.addEventListener('error', event => state.errors.push(event.error?.stack || event.message))
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)))
useAuthStore.setState({ user: { staffId: 7, organizationId: 9, entitlements: normalizeEntitlements({ facebookCore: true, zalo: true, sms: true }), zaloAccountCapabilities: { qr: true, web: true, server: true } } as any })
useCampaignStore.setState({ accounts: accounts as any, campaignActions: actions as any, campaigns: [], loadCampaigns: async () => {}, loadAccountGroups: async () => {}, loadAccounts: async () => {}, loadCampaignActions: async () => {} })
useUiStore.setState({ showAlert: (message, type) => state.calls.push({ method: 'alert', args: [message, type] }), showConfirm: (_message, callback) => { void callback() } })

const draft = (actionId: string, accountIds: number[], formData: Record<string, unknown>, details: Record<string, unknown>[] = []) => ({
  id: crypto.randomUUID(), revision: 1, updatedAt: '2035-01-01T09:00:00+07:00', name: `Smoke ${actionId}`, actionId, accountIds,
  schedule: '2035-01-01T09:00', isDelete: false, campaignIds: [], deletionReason: null,
  payload: { version: 1, values: { formData: { name: `Smoke ${actionId}`, actionId, accountIds, schedule: '2035-01-01T09:00', ...formData }, details, advancedContentSourceMode: 'manual' } }
})

/** Chiến dịch Zalo đã lưu (tab chi tiết, Sửa nhanh). */
const savedZaloCampaign: any = {
  id: 77, name: 'Chăm sóc khách mới', actionId: 'zalo_message_phone', accountId: 21, staffId: 7, organizationId: 9,
  schedule: '2035-01-01T02:00:00.000Z', updatedAt: '2035-01-01T02:00:00.000Z', status: 'tạm dừng', editReady: true,
  content: 'Chào #{FULL_NAME}, shop vừa về mẫu mới | Xin chào {anh|chị} #{INFO1}',
  images: [{ name: 'ao-len.png', localPath: '/Users/thao/anh/ao-len.png', mimeType: 'image/png' }],
  extraSettings: { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Kết bạn với shop nhé #{FULL_NAME}', imageOption: 'all', randomImageCount: 3 }
}

/** Chiến dịch gọi tự động đã lưu: không có mẫu nội dung nên tab nhận mô hình thẻ cũ là null, như CampaignPanel. */
const savedVoiceCampaign: any = {
  id: 78, name: 'Gọi báo ưu đãi', actionId: 'voice_call', accountId: 31, staffId: 7, organizationId: 9,
  schedule: '2035-01-01T02:00:00.000Z', updatedAt: '2035-01-01T02:00:00.000Z', status: 'tạm dừng', editReady: true,
  content: 'Chào #{FULL_NAME}, shop An Nhiên gọi báo ưu đãi cuối tuần | Cảm ơn #{FULL_NAME} đã mua hàng ở shop',
  images: [], extraSettings: {}
}

const scenarios: Record<string, () => any> = {
  zaloAdvanced: () => draft('zalo_message_phone', [21], {
    content: '', advancedContentEnabled: true, enableMessage: true, enableAddFriend: false,
    advancedContentItems: [
      { id: 'adv-1', content: 'Mục một cho #{FULL_NAME}', mediaOption: 'all', mediaItems: [
        { name: 'ao-len.png', localPath: '/Users/thao/anh/ao-len.png', mimeType: 'image/png' },
        { name: 'bang-size.png', cloudUrl: localImageDataUrl('bang-size.png'), mimeType: 'image/png' }
      ], randomMediaCount: 3 },
      { id: 'adv-2', content: 'Mục hai #{INFO2}', mediaOption: 'none', mediaItems: [], randomMediaCount: 3 }
    ]
  }, [{ phone: '0912345678', name: 'Trần Văn Bình' }]),
  zalo: () => draft('zalo_message_phone', [21], {
    content: 'Chào #{SEX{anh-chị-bạn}} #{FULL_NAME}, shop vừa về mẫu mới | Xin chào {anh|chị} #{INFO1}, ưu đãi tới #{TOMORROW(DD/MM)} | Bản 3 cho #{TEN}',
    enableMessage: true, enableAddFriend: true,
    friendRequestMessage: 'Chào #{FULL_NAME}, em là Thảo bên Shop An Nhiên, mình kết bạn để em gửi ảnh mẫu nhé!',
    imageOption: 'all', randomImageCount: 3,
    images: [
      { name: 'ao-len.png', localPath: '/Users/thao/anh/ao-len.png', mimeType: 'image/png' },
      '/Users/thao/anh/missing-quan.png',
      { name: 'bang-size.png', cloudUrl: localImageDataUrl('bang-size.png'), mimeType: 'image/png' }
    ]
  }, [{ phone: '0912345678', name: 'Trần Văn Bình', info1: 'Quận 1' }, { phone: '0987654321', name: 'Lê Hà', info1: '' }]),
  sms: () => draft('sms_send', [31], {
    content: 'Chào #{FULL_NAME}, ưu đãi 20% cho đơn trong tuần này. Gọi #{PHONE} để đặt hàng | Shop An Nhiên tặng quà cho #{FULL_NAME}',
    smsUseUnicode: false, smsKeepNewLines: false
  }, [{ phone: '0912345678', name: 'Trần Văn Bình' }]),
  facebook: () => draft('facebook_message_uid', [41], { content: 'Chào bạn', enableMessage: true }, [{ uid: '100000000000001', name: 'Khách A' }])
}

function App() {
  const [view, setView] = useState<{ generation: number; scenario: string; agent: boolean } | null>(null)
  const zaloAction = actions.find(action => action.id === 'zalo_message_phone') as any
  ;(window as any).rpSmoke = {
    state,
    open: (scenario: string, agent = false) => setView(current => ({ generation: (current?.generation || 0) + 1, scenario, agent })),
    close: () => setView(null)
  }
  if (!view) return <div>Đã đóng</div>
  if (view.scenario === 'tab') {
    return <div className="rp-smoke-tab" style={{ height: '100vh', overflow: 'auto', background: 'var(--bg-primary)' }}>
      <CampaignContentPreviewTab key={view.generation} campaign={savedZaloCampaign} account={accounts[0] as any} preview={buildCampaignContentPreview(savedZaloCampaign)!} />
    </div>
  }
  if (view.scenario === 'voiceTab') {
    return <div className="rp-smoke-tab" style={{ height: '100vh', overflow: 'auto', background: 'var(--bg-primary)' }}>
      <CampaignContentPreviewTab key={view.generation} campaign={savedVoiceCampaign} account={accounts[2] as any} preview={buildCampaignContentPreview(savedVoiceCampaign)} />
    </div>
  }
  if (view.scenario === 'quick') {
    return <CampaignContentMediaUpdateModal key={view.generation} campaign={savedZaloCampaign} action={zaloAction} onClose={() => setView(null)} />
  }
  if (view.scenario === 'template') {
    return <div style={{ width: 420, margin: '24px auto' }}>
      <ContentTemplatePreview key={view.generation} channel="zalo_message" variants={['Chào #{FULL_NAME}, mẫu thu đông đã về', 'Bản hai cho #{FULL_NAME}']}
        imageUrls={['/Users/thao/anh/ao-len.png', localImageDataUrl('bang-size.png')]} mediaMimeTypes={{}} showSampleData />
    </div>
  }
  const savedDraft = scenarios[view.scenario]()
  return view.agent
    ? <CampaignAgentFormModal key={view.generation} savedDraft={savedDraft} initialSection="general" campaign={null} onClose={() => setView(null)} />
    : <CampaignFormModal key={view.generation} savedDraft={savedDraft} campaign={null} onClose={() => setView(null)} />
}
createRoot(document.getElementById('root')!).render(<App />)
