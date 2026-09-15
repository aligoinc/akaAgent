export type CampaignAssistantMode = 'ask' | 'campaign_support'
export interface CampaignAssistantOpenRequest {
  campaignId: number
  mode: CampaignAssistantMode
  requestId: string
}

export const CAMPAIGN_SUPPORT_QUESTION = 'Tại sao chiến dịch không chạy?'
export const CAMPAIGN_SUPPORT_MAX_QUESTION = 4000
export const CAMPAIGN_SUPPORT_MAX_IMAGES = 5
export const CAMPAIGN_SUPPORT_MAX_IMAGE_NAME = 200
export const CAMPAIGN_SUPPORT_IMAGE_BYTES = 5 * 1024 * 1024
export const CAMPAIGN_SUPPORT_TOTAL_IMAGE_BYTES = 15 * 1024 * 1024
export const CAMPAIGN_SUPPORT_BODY_BYTES = 25 * 1024 * 1024
export const CAMPAIGN_SUPPORT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const CAMPAIGN_SUPPORT_IPC = {
  open: 'ai:campaign-support:open',
  send: 'ai:campaign-support:send',
  control: 'ai:campaign-support:control',
  retry: 'ai:campaign-support:retry',
  reset: 'ai:campaign-support:reset',
  image: 'ai:campaign-support:image',
  updated: 'ai:campaign-support:updated'
} as const

export type CampaignSupportStatus = 'queued' | 'working' | 'waiting_dependency' | 'completed' | 'needs_input' | 'cancelled'
export type CampaignSupportControl = 'cancel' | 'resume'
export interface CampaignSupportOwner { organizationId: number; staffId: number }
export interface CampaignSupportImage {
  name: string
  mimeType: typeof CAMPAIGN_SUPPORT_IMAGE_TYPES[number]
  dataBase64: string
}
export interface CampaignSupportProgress {
  state: CampaignSupportStatus
  stage: string | null
  attempts: number
  reason: string | null
  nextAttemptAt: string | null
  startedAt: string | null
  updatedAt: string | null
}
export interface CampaignSupportRun {
  conversationId: string
  turnId: string
  status: CampaignSupportStatus
  answer: string | null
  progress: CampaignSupportProgress
  statusUrl: string
}
export interface CampaignSupportTurn {
  requestId: string
  question: string
  images: Array<Pick<CampaignSupportImage, 'name' | 'mimeType'>>
  createdAt: string
  result: CampaignSupportRun | null
  error: string | null
  retryable: boolean
  controlPending: CampaignSupportControl | null
  /** A known run returned NOT_FOUND; a new conversation can be started explicitly. */
  runNotFound?: boolean
  /** Read the known run before replaying a control whose outcome is uncertain. */
  controlNeedsRefresh?: boolean
}
export interface CampaignSupportConversation extends CampaignSupportOwner {
  id: string
  campaignId: number
  revision: number
  turns: CampaignSupportTurn[]
  /** A menu selection waiting for the previous remote run to stop before starting fresh. */
  pendingStartRequestId?: string
}
export interface CampaignSupportSendRequest {
  campaignId: number
  conversationKey: string
  question: string
  images: CampaignSupportImage[]
}
export interface CampaignSupportControlRequest {
  campaignId: number
  conversationKey: string
  requestId: string
  action: CampaignSupportControl
}
export interface CampaignSupportImageRequest {
  campaignId: number
  conversationKey: string
  requestId: string
  index: number
}
export function isCampaignSupportRunning(status: CampaignSupportStatus | undefined): boolean {
  return status === 'queued' || status === 'working' || status === 'waiting_dependency'
}
export function isCampaignSupportTurnBusy(turn: CampaignSupportTurn | undefined): boolean {
  if (!turn) return false
  if (turn.runNotFound) return false
  if (isCampaignSupportRunning(turn.result?.status)) return true
  if (turn.error && !turn.retryable) return false
  return !!turn.controlPending || !turn.result
}
