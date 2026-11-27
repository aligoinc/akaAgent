import type { AutoAccount } from '../../shared/types'

/**
 * Ảnh chụp trạng thái bộ chạy Desktop gửi kèm heartbeat có sẵn (v461), để Web hiển
 * thị app Desktop đang chạy/đứng chờ và tài khoản nào chưa sẵn sàng. Chỉ đọc RAM của
 * scheduler: không thêm truy vấn DB, timer hay kết nối. Hợp đồng JSON khớp
 * `normalizeDesktopRuntimeState` ở akaAgentWebApp (packages/control-api).
 * Gồm tài khoản Zalo mã QR/trình duyệt (v461) và tài khoản Facebook (v476, Web quản lý
 * chiến dịch Facebook); Zalo luôn đứng trước nên phần Zalo giữ nguyên như bản cũ.
 */
export type DesktopSchedulerState = 'running' | 'idle' | 'stopped' | 'blocked_daily_maintenance'

export type DesktopAccountReadinessReason = 'inactive' | 'paused' | 'checkpoint' | 'not_logged_in' | 'browser_tab_closed'

export interface DesktopRuntimeSnapshotSource {
  running: boolean
  /** Tài khoản của lượt tick gần nhất (scheduler đọc mỗi tick, không đọc thêm). */
  accounts: readonly AutoAccount[]
  activeAccountIds: readonly number[]
  runningCampaigns: ReadonlyMap<number, number>
  isBrowserTabOpen(accountId: number): boolean
}

/** Bộ giữ sau khi máy ngủ đang giữ việc mới (systemSleepGuard); Web bỏ qua khoá lạ nên không đổi hợp đồng cũ. */
export interface DesktopSleepHoldPayload {
  since: string
  reason: string
}

/** Lần bộ giữ thôi giữ gần nhất (lý do, đã thức liền mạch bao lâu): để tra vì sao máy nhận việc sau khi ngủ; Web bỏ qua khoá lạ. */
export interface DesktopSleepReleasePayload {
  at: string
  reason: string
  heldSince: string
  awakeSeconds: number
}

/**
 * Bot sự kiện (docs/EVENT_BOT_TECH.md mục 8): trạng thái vòng gửi của bot trên máy này. Có khoá là app đã có bot (Web dựa vào để báo
 * "cần cập nhật app"). Đứng sau `accounts` để phần cũ của payload giữ nguyên từng byte; Web bỏ qua khoá lạ.
 */
export interface DesktopEventBotPayload {
  state: 'stopped' | 'off' | 'idle' | 'running'
  accounts: number[]
  lastClaimAt: string | null
}

export interface DesktopRuntimeSnapshotPayload {
  v: 1
  scheduler: { state: DesktopSchedulerState; since: string }
  /** Chỉ có khi đang giữ, để quét presence biết máy đang đứng chờ người dùng sau khi ngủ. */
  sleepHold?: DesktopSleepHoldPayload
  /** Lần thôi giữ gần nhất của phiên app này (không có khi chưa từng giữ). */
  sleepRelease?: DesktopSleepReleasePayload
  accounts: Array<{
    id: number
    ready: boolean
    reason: DesktopAccountReadinessReason | null
    runningCampaignId: number | null
    progress: null
  }>
  /** Chỉ có khi app đã nối bot sự kiện (attachEventBot). */
  eventBot?: DesktopEventBotPayload
}

/** RPC giới hạn 32 KB; 200 tài khoản ~20 KB. */
export const MAX_DESKTOP_RUNTIME_ACCOUNTS = 200

const platformOf = (account: AutoAccount): string => String(account.flatformType || '').trim().toLowerCase()
const isDesktopZaloAccount = (account: AutoAccount): boolean =>
  platformOf(account) === 'zalo' && account.isZaloServer !== true
/** Facebook luôn chạy trên app Desktop, trong tab trình duyệt (webview) của tài khoản. */
const isFacebookAccount = (account: AutoAccount): boolean => platformOf(account) === 'facebook'

export function desktopAccountReadiness(
  account: AutoAccount,
  isBrowserTabOpen: (accountId: number) => boolean
): DesktopAccountReadinessReason | null {
  if (!account.isActive) return 'inactive'
  if (account.status === 'tạm dừng') return 'paused'
  const facebook = isFacebookAccount(account)
  // Chỉ Facebook tách checkpoint; Zalo giữ lý do cũ để Web đang chạy hiển thị như trước.
  if (facebook && account.loginStatus === 'checkpoint') return 'checkpoint'
  if (account.loginStatus !== 'đã đăng nhập') return 'not_logged_in'
  // Tài khoản trình duyệt chỉ chạy khi tab đã được mở trong app (giống điều kiện tick của
  // scheduler): mọi tài khoản Facebook và tài khoản Zalo Web.
  if ((facebook || account.isZaloShowWeb) && !isBrowserTabOpen(account.id)) return 'browser_tab_closed'
  return null
}

/** Zalo Desktop trước (đúng thứ tự và phần đầu payload như v461), rồi Facebook; chung trần 200. */
export function desktopRuntimeAccounts(accounts: readonly AutoAccount[]): AutoAccount[] {
  return [...accounts.filter(isDesktopZaloAccount), ...accounts.filter(isFacebookAccount)]
    .slice(0, MAX_DESKTOP_RUNTIME_ACCOUNTS)
}

export class DesktopRuntimeSnapshot {
  private source: (() => DesktopRuntimeSnapshotSource | null) | null = null
  private sleepHoldSource: (() => DesktopSleepHoldPayload | null) | null = null
  private sleepReleaseSource: (() => DesktopSleepReleasePayload | null) | null = null
  private eventBotSource: (() => DesktopEventBotPayload | null) | null = null
  private maintenanceWaitingSince: string | null = null
  private lastState: DesktopSchedulerState | null = null
  private lastStateSince: string | null = null

  constructor(private readonly now: () => Date = () => new Date()) {}

  attach(source: () => DesktopRuntimeSnapshotSource | null): void {
    this.source = source
  }

  /** Trạng thái giữ việc mới sau khi máy ngủ (systemSleepGuard.snapshot); lỗi thì coi như không giữ. */
  attachSleepHold(source: () => DesktopSleepHoldPayload | null): void {
    this.sleepHoldSource = source
  }

  /** Lần thôi giữ gần nhất (systemSleepGuard.releaseSnapshot); lỗi thì bỏ qua. */
  attachSleepRelease(source: () => DesktopSleepReleasePayload | null): void {
    this.sleepReleaseSource = source
  }

  /** Trạng thái bot sự kiện (EventBotRuntime.snapshot); lỗi thì bỏ khoá. */
  attachEventBot(source: () => DesktopEventBotPayload | null): void {
    this.eventBotSource = source
  }

  /** Cổng bảo trì ngày mới đang chờ lượt chạy hôm trước settle. */
  markMaintenanceWaiting(waiting: boolean): void {
    this.maintenanceWaitingSince = waiting ? this.maintenanceWaitingSince ?? this.now().toISOString() : null
  }

  reset(): void {
    this.maintenanceWaitingSince = null
    this.lastState = null
    this.lastStateSince = null
  }

  build(): DesktopRuntimeSnapshotPayload | null {
    let source: DesktopRuntimeSnapshotSource | null = null
    try { source = this.source?.() ?? null } catch { source = null }
    if (!source) return null
    const state: DesktopSchedulerState = !source.running
      ? 'stopped'
      : this.maintenanceWaitingSince
        ? 'blocked_daily_maintenance'
        : source.activeAccountIds.length > 0 ? 'running' : 'idle'
    if (state !== this.lastState) {
      this.lastState = state
      this.lastStateSince = state === 'blocked_daily_maintenance' && this.maintenanceWaitingSince
        ? this.maintenanceWaitingSince
        : this.now().toISOString()
    }
    const accounts = source.running ? desktopRuntimeAccounts(source.accounts) : []
    let sleepHold: DesktopSleepHoldPayload | null = null
    try { sleepHold = this.sleepHoldSource?.() ?? null } catch { sleepHold = null }
    let sleepRelease: DesktopSleepReleasePayload | null = null
    try { sleepRelease = this.sleepReleaseSource?.() ?? null } catch { sleepRelease = null }
    let eventBot: DesktopEventBotPayload | null = null
    try { eventBot = this.eventBotSource?.() ?? null } catch { eventBot = null }
    return {
      v: 1,
      scheduler: { state, since: this.lastStateSince || this.now().toISOString() },
      ...(sleepHold ? { sleepHold: { since: sleepHold.since, reason: sleepHold.reason } } : {}),
      ...(sleepRelease ? { sleepRelease: { at: sleepRelease.at, reason: sleepRelease.reason, heldSince: sleepRelease.heldSince,
        awakeSeconds: sleepRelease.awakeSeconds } } : {}),
      accounts: accounts.map(account => {
        const reason = desktopAccountReadiness(account, id => source!.isBrowserTabOpen(id))
        return {
          id: account.id,
          ready: reason === null,
          reason,
          runningCampaignId: source!.runningCampaigns.get(account.id) ?? null,
          progress: null
        }
      }),
      ...(eventBot ? { eventBot: { state: eventBot.state, accounts: eventBot.accounts.slice(0, MAX_DESKTOP_RUNTIME_ACCOUNTS),
        lastClaimAt: eventBot.lastClaimAt } } : {})
    }
  }
}

export const desktopRuntimeSnapshot = new DesktopRuntimeSnapshot()
