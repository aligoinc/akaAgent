import type { AutoAccount } from '../../shared/types'

/**
 * Ảnh chụp trạng thái bộ chạy Desktop gửi kèm heartbeat có sẵn (v455), để Web hiển
 * thị app Desktop đang chạy/đứng chờ và tài khoản nào chưa sẵn sàng. Chỉ đọc RAM của
 * scheduler: không thêm truy vấn DB, timer hay kết nối. Hợp đồng JSON khớp
 * `normalizeDesktopRuntimeState` ở akaAgentWebApp (packages/control-api).
 */
export type DesktopSchedulerState = 'running' | 'idle' | 'stopped' | 'blocked_daily_maintenance'

export type DesktopAccountReadinessReason = 'inactive' | 'paused' | 'not_logged_in' | 'browser_tab_closed'

export interface DesktopRuntimeSnapshotSource {
  running: boolean
  /** Tài khoản của lượt tick gần nhất (scheduler đọc mỗi tick, không đọc thêm). */
  accounts: readonly AutoAccount[]
  activeAccountIds: readonly number[]
  runningCampaigns: ReadonlyMap<number, number>
  isBrowserTabOpen(accountId: number): boolean
}

export interface DesktopRuntimeSnapshotPayload {
  v: 1
  scheduler: { state: DesktopSchedulerState; since: string }
  accounts: Array<{
    id: number
    ready: boolean
    reason: DesktopAccountReadinessReason | null
    runningCampaignId: number | null
    progress: null
  }>
}

/** RPC giới hạn 32 KB; 200 tài khoản ~20 KB. */
export const MAX_DESKTOP_RUNTIME_ACCOUNTS = 200

const isDesktopZaloAccount = (account: AutoAccount): boolean =>
  String(account.flatformType || '').trim().toLowerCase() === 'zalo' && account.isZaloServer !== true

export function desktopAccountReadiness(
  account: AutoAccount,
  isBrowserTabOpen: (accountId: number) => boolean
): DesktopAccountReadinessReason | null {
  if (!account.isActive) return 'inactive'
  if (account.status === 'tạm dừng') return 'paused'
  if (account.loginStatus !== 'đã đăng nhập') return 'not_logged_in'
  // Tài khoản trình duyệt chỉ chạy khi tab Zalo Web đã được mở trong app (giống scheduler).
  if (account.isZaloShowWeb && !isBrowserTabOpen(account.id)) return 'browser_tab_closed'
  return null
}

export class DesktopRuntimeSnapshot {
  private source: (() => DesktopRuntimeSnapshotSource | null) | null = null
  private maintenanceWaitingSince: string | null = null
  private lastState: DesktopSchedulerState | null = null
  private lastStateSince: string | null = null

  constructor(private readonly now: () => Date = () => new Date()) {}

  attach(source: () => DesktopRuntimeSnapshotSource | null): void {
    this.source = source
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
    const accounts = source.running ? source.accounts.filter(isDesktopZaloAccount).slice(0, MAX_DESKTOP_RUNTIME_ACCOUNTS) : []
    return {
      v: 1,
      scheduler: { state, since: this.lastStateSince || this.now().toISOString() },
      accounts: accounts.map(account => {
        const reason = desktopAccountReadiness(account, id => source!.isBrowserTabOpen(id))
        return {
          id: account.id,
          ready: reason === null,
          reason,
          runningCampaignId: source!.runningCampaigns.get(account.id) ?? null,
          progress: null
        }
      })
    }
  }
}

export const desktopRuntimeSnapshot = new DesktopRuntimeSnapshot()
