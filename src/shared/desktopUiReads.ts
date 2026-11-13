import type { AutoAccount, CampaignListItem } from './types'
import type { CampaignTypeVisibilitySnapshot } from './campaignTypeVisibility'
import type { RenewalReminderSettings } from './renewalReminder'

export const DESKTOP_POLL_KEYS = {
  campaigns: 'desktop.campaigns.poll_interval_seconds',
  accounts: 'desktop.accounts.poll_interval_seconds'
} as const
export interface DesktopPollingSettings {
  campaigns: number
  accounts: number
  /**
   * Hiện ô "Gửi lặp lại sau mỗi x phút" trong form chiến dịch (`web.zalo_share_repeat.enabled`, cùng công tắc với Web,
   * src/shared/zaloShareRepeat.ts). Đọc cùng lượt chu kỳ tải khi đăng nhập, không thêm request; thiếu/lỗi = ẩn.
   */
  zaloShareRepeatEnabled?: boolean
  /** Ngừng đọc theo hẹn giờ/sự kiện khi cửa sổ chính thu nhỏ, ẩn hoặc màn hình khóa. Thiếu = tắt. */
  hiddenPauseEnabled?: boolean
  /** Cả máy không có thao tác từ ngần này giây thì coi là không ai nhìn. 0/thiếu = tắt. */
  idleAfterSeconds?: number
  /** Chu kỳ đọc khi không ai nhìn (chỉ giãn, không bao giờ ngắn hơn chu kỳ thường). 0/thiếu = tắt. */
  idlePollSeconds?: number
  /** Chiến dịch không chạy và không đổi thì dùng lại số tiến độ, đếm lại sau ngần này giây. 0/thiếu = đếm mọi lượt. */
  progressRecountSeconds?: number
  /**
   * Nhắc gia hạn (`renewal.reminder`, docs/RENEWAL_REMINDER_DESKTOP.md): đọc chung câu này, không thêm request. Tiến trình
   * chính dùng để tính thông báo; renderer không cần đọc (trạng thái nhắc đi kênh riêng). Thiếu/sai = tắt.
   */
  renewalReminder?: RenewalReminderSettings
}
export const DEFAULT_DESKTOP_POLLING: DesktopPollingSettings = { campaigns: 30, accounts: 30, zaloShareRepeatEnabled: false }
export function parseDesktopPollSeconds(value: unknown): number {
  const text = String(value ?? '').trim()
  const seconds = Number(text)
  return /^\d+$/.test(text) && Number.isSafeInteger(seconds) && seconds >= 5 && seconds <= 3600 ? seconds : 30
}

/**
 * Giảm đọc DB khi không ai nhìn màn hình và khi số tiến độ không đổi (docs/DESKTOP_UI_IDLE_READS.md).
 * Đọc chung lượt đọc cài đặt lúc đăng nhập. Thiếu dòng, dòng tắt hoặc giá trị ngoài khoảng = tắt:
 * app đọc đúng như trước khi có các khóa này.
 */
export const DESKTOP_UI_TUNING_KEYS = {
  hiddenPauseEnabled: 'desktop.campaigns.hidden_pause_enabled',
  idleAfterSeconds: 'desktop.campaigns.idle_after_seconds',
  idlePollSeconds: 'desktop.campaigns.idle_poll_interval_seconds',
  progressRecountSeconds: 'desktop.campaigns.progress_recount_seconds'
} as const
export const DESKTOP_UI_TUNING_RANGES = {
  idleAfterSeconds: [60, 86_400],
  idlePollSeconds: [30, 3600],
  progressRecountSeconds: [30, 3600]
} as const
export function parseDesktopUiFlag(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true'
}
/** Số nguyên giây trong khoảng cho phép; mọi giá trị khác (kể cả 0) = 0 = tắt. */
export function parseDesktopUiSeconds(value: unknown, range: readonly [number, number]): number {
  const text = String(value ?? '').trim()
  const seconds = Number(text)
  return /^\d+$/.test(text) && Number.isSafeInteger(seconds) && seconds >= range[0] && seconds <= range[1] ? seconds : 0
}

/** Trạng thái "có ai đang nhìn không", tiến trình chính trả về từ cửa sổ và hệ điều hành; không đọc DB/mạng. */
export interface DesktopUiAttention {
  /** Cửa sổ chính thu nhỏ/ẩn, hoặc màn hình đang khóa. */
  hidden: boolean
  /** Số giây cả máy không có thao tác chuột/phím. */
  idleSeconds: number
}
/** Mặc định an toàn khi chưa biết hoặc đọc lỗi: coi như đang có người nhìn (đọc như trước). */
export const DESKTOP_UI_ATTENTIVE: DesktopUiAttention = { hidden: false, idleSeconds: 0 }
/** Khi đang ngừng/giãn, hỏi lại trạng thái cửa sổ bằng lệnh nội bộ sau ngần này ms (không đọc DB). */
export const DESKTOP_UI_ATTENTION_RECHECK_MS = 30_000
export function normalizeDesktopUiAttention(value: unknown): DesktopUiAttention {
  if (!value || typeof value !== 'object') return { ...DESKTOP_UI_ATTENTIVE }
  const { hidden, idleSeconds } = value as Record<string, unknown>
  const idle = Number(idleSeconds)
  return { hidden: hidden === true, idleSeconds: Number.isFinite(idle) && idle > 0 ? Math.floor(idle) : 0 }
}
export function desktopUiIdleStretchEnabled(settings: DesktopPollingSettings): boolean {
  return (settings.idleAfterSeconds ?? 0) > 0 && (settings.idlePollSeconds ?? 0) > 0
}
/** Có khóa nào của mục "không ai nhìn" đang bật không. Tắt hết thì bộ điều phối không hỏi trạng thái cửa sổ. */
export function desktopUiAttentionEnabled(settings: DesktopPollingSettings): boolean {
  return settings.hiddenPauseEnabled === true || desktopUiIdleStretchEnabled(settings)
}
export function desktopUiReadsPaused(settings: DesktopPollingSettings, attention: DesktopUiAttention): boolean {
  return settings.hiddenPauseEnabled === true && attention.hidden
}
export function desktopUiIdle(settings: DesktopPollingSettings, attention: DesktopUiAttention): boolean {
  return desktopUiIdleStretchEnabled(settings) && attention.idleSeconds >= (settings.idleAfterSeconds ?? 0)
}
/** Chu kỳ hiệu lực (giây) của một đồng hồ đọc: chu kỳ thường, hoặc chu kỳ giãn khi máy không có thao tác. */
export function desktopUiPollSeconds(base: number, settings: DesktopPollingSettings, attention: DesktopUiAttention): number {
  return desktopUiIdle(settings, attention) ? Math.max(base, settings.idlePollSeconds ?? 0) : base
}

/**
 * Cách đếm tiến độ của một lượt đọc trang, giao diện gửi kèm khi `progressRecountSeconds` > 0.
 * `reuse`: lượt đọc nền, chỉ đếm lại chiến dịch có thể đã đổi. `full`: đếm tất cả như trước và ghi nhớ kết quả.
 * Không gửi = đúng như trước (đếm tất cả, không ghi nhớ).
 */
export interface DesktopCampaignPageReadOptions {
  progress: 'reuse' | 'full'
  recountSeconds: number
}
export function normalizeDesktopCampaignPageReadOptions(value: unknown): DesktopCampaignPageReadOptions | null {
  if (!value || typeof value !== 'object') return null
  const { progress, recountSeconds } = value as Record<string, unknown>
  if (progress !== 'reuse' && progress !== 'full') return null
  const seconds = typeof recountSeconds === 'number'
    ? parseDesktopUiSeconds(String(recountSeconds), DESKTOP_UI_TUNING_RANGES.progressRecountSeconds)
    : 0
  return seconds > 0 ? { progress, recountSeconds: seconds } : null
}

export interface DesktopCampaignFilters {
  applyDisplaySettings?: boolean
  search?: string
  dateFrom?: string
  dateTo?: string
  statuses?: string[]
  accountIds?: number[]
  filterAccountId?: number
  actionIds?: string[]
  platforms?: string[]
}
export interface DesktopCampaignPageQuery {
  filters: DesktopCampaignFilters
  page: number
  selectedId?: number | null
  drafts?: Array<{ id: string; schedule: string; actionId?: string }>
}
export interface DesktopCampaignPage {
  displaySettings?: CampaignTypeVisibilitySnapshot
  configVersion?: { id: number; version: string } | null
  items: CampaignListItem[]
  selected: CampaignListItem | null
  order: Array<{ kind: 'campaign' | 'draft'; id: string }>
  total: number
  runningCampaigns: Array<{ id: number; accountId: number; name: string }>
  extraAccounts: Array<{ id: number; name: string }>
  actionOptions: Array<{ id: string; name: string; platform: string }>
  campaignTotal: number
  page: number
  pageSize: number
}
export interface DesktopCampaignSelectionQuery {
  filters: DesktopCampaignFilters
  afterId?: number
  ids?: number[]
}
export interface DesktopCampaignSelection { id: number; status: string }
export interface DesktopAccountSnapshot {
  version: string
  catalog: AutoAccount[] | null
  states: Array<Pick<AutoAccount, 'id' | 'status' | 'loginStatus' | 'updatedAt' | 'hasDisabledActions'> & Partial<AutoAccount>>
}

export const DESKTOP_UI_IPC = {
  settings: 'desktop-ui:polling-settings',
  campaignPage: 'desktop-ui:campaign-page',
  campaignCatalog: 'desktop-ui:campaign-catalog',
  campaignSelection: 'desktop-ui:campaign-selection',
  campaignSources: 'desktop-ui:campaign-sources',
  campaignConfig: 'desktop-ui:campaign-config',
  campaignLog: 'desktop-ui:campaign-log',
  campaignLogs: 'desktop-ui:campaign-logs',
  accountSnapshot: 'desktop-ui:account-snapshot',
  /** Hỏi trạng thái cửa sổ/máy (invoke) và báo khi cửa sổ thu nhỏ/khôi phục/ẩn/hiện (main gửi, không kèm dữ liệu). */
  attention: 'desktop-ui:attention',
  attentionChanged: 'desktop-ui:attention-changed'
} as const
