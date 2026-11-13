import {
  computeRenewalReminder,
  renewalReminderEnabledFor,
  vietnamDayOf,
  type RenewalReminder,
  type RenewalReminderSettings,
  type RenewalReminderState
} from '../../shared/renewalReminder'
import {
  RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE,
  RENEWAL_REMINDER_NO_REMINDER_MESSAGE,
  buildRenewalReminderLink,
  fallbackRenewalReminderServerState,
  parseRenewalReminderServerState,
  toRenewalReminderProducts,
  toRenewalReminderPublicState,
  type RenewalReminderLink,
  type RenewalReminderServerSnapshot
} from '../../shared/renewalReminderDesktop'
import { getCurrentUser, onCurrentUserSessionChanged } from '../data/currentUser'
import { loadRenewalReminderServerState } from '../data/repositories/renewalReminderRepository'

/** Khách quay lại cửa sổ/đóng cửa sổ gia hạn: đọc lại gói tối đa một lượt mỗi ngần này. */
const REFRESH_MIN_GAP_MS = 20_000

export class RenewalReminderLinkError extends Error {
  constructor(readonly code: 'no_reminder' | 'not_logged_in', message: string) { super(message) }
}

interface RenewalReminderDependencies {
  /** Gửi trạng thái xuống renderer (không bao giờ có ngày đăng nhập). */
  send?: (state: RenewalReminderState) => void
  /** Xin vé gia hạn dùng một lần (`aka_agent_renewal_link_ticket`, V521); không có vé = dùng link thường. */
  issueTicket?: (organizationProductId: number | null) => Promise<unknown>
  /** Đọc lại gói ngay (cùng hàm của lượt kiểm 30 giây), để `accountProducts` cập nhật sau khi thanh toán. */
  refreshEntitlements?: () => Promise<void>
}

const scopeOf = (user: { organizationId: number; staffId: number } | null): string | null =>
  user ? `${user.organizationId}:${user.staffId}` : null

/**
 * Nhắc gia hạn trong phần mềm (docs/RENEWAL_REMINDER_DESKTOP.md). Tiến trình chính tính thông báo, renderer chỉ hiển thị.
 *
 * Đọc DB: cài đặt `renewal.reminder` đi chung câu đọc cài đặt giao diện lúc đăng nhập (không thêm request); RPC
 * `aka_agent_renewal_reminder_state` một lần sau khi biết tính năng bật, một lần khi sang ngày, một lần sau khi gia hạn
 * xong / đóng cửa sổ gia hạn. Không có đồng hồ đọc DB riêng.
 *
 * Các ngày có đăng nhập chỉ nằm trong RAM của lớp này; không log, không gửi xuống renderer.
 */
export class RenewalReminderService {
  private deps: RenewalReminderDependencies = {}
  private scope: string | null = null
  private sessionSeq = 0
  private settings: RenewalReminderSettings | null = null
  private server: RenewalReminderServerSnapshot | null = null
  /** Ngày (theo giờ máy chủ) của lần đọc RPC gần nhất; sang ngày khác thì đọc lại một lần. */
  private serverDay: string | null = null
  private fetching: Promise<void> | null = null
  private lastPublished = ''
  private lastRefreshAt = 0
  private readonly sessionListeners = new Set<() => void>()

  private staleSession = false

  constructor() {
    // `setCurrentUser` báo đổi phiên trước khi gán người dùng mới, nên ở đây chỉ đánh dấu rồi đồng bộ sau đó.
    onCurrentUserSessionChanged(() => {
      this.staleSession = true
      queueMicrotask(() => { this.syncScope() })
    })
  }

  attach(deps: RenewalReminderDependencies): void {
    this.deps = { ...this.deps, ...deps }
  }

  /** Mã phiên đăng nhập hiện tại (đổi khi đăng xuất/đổi tài khoản); null khi chưa đăng nhập. */
  currentSessionId(): number | null {
    return this.syncScope() ? this.sessionSeq : null
  }

  onSessionChanged(listener: () => void): () => void {
    this.sessionListeners.add(listener)
    return () => { this.sessionListeners.delete(listener) }
  }

  currentScope(): string | null {
    return this.syncScope()
  }

  private syncScope(): string | null {
    const scope = scopeOf(getCurrentUser())
    if (scope !== this.scope || this.staleSession) {
      this.staleSession = false
      this.reset(scope)
    }
    return scope
  }

  private reset(scope: string | null): void {
    // Cùng nhân viên, chỉ đổi thông tin đăng nhập (đổi mật khẩu): giữ cài đặt và dữ liệu máy chủ, vì cài đặt chỉ được
    // đọc một lần mỗi phiên của renderer. Mã phiên vẫn đổi để cửa sổ gia hạn đang mở đóng lại.
    const sameStaff = scope !== null && scope === this.scope
    this.scope = scope
    this.sessionSeq += 1
    if (!sameStaff) {
      this.settings = null
      this.server = null
      this.serverDay = null
    }
    this.fetching = null
    this.lastRefreshAt = 0
    this.publish(true)
    for (const listener of this.sessionListeners) {
      try { listener() } catch { /* listener tự xử lý */ }
    }
  }

  /** Cài đặt `renewal.reminder` đã đọc cùng câu cài đặt giao diện của phiên `scope`. */
  applySettings(scope: string | null, settings: RenewalReminderSettings): void {
    if (!scope || this.syncScope() !== scope) return
    this.settings = settings
    if (this.enabledForCurrentUser() && !this.server && !this.fetching) void this.fetchServer()
    else this.publish()
  }

  enabledForCurrentUser(): boolean {
    this.syncScope()
    const user = getCurrentUser()
    return !!user && renewalReminderEnabledFor(this.settings, { isAdminAkabiz: user.isAdminAkabiz, isAdmin: user.isAdmin === true })
  }

  private nowMs(): number {
    return Date.now() + (this.server?.serverTimeOffsetMs ?? 0)
  }

  private today(): string | null {
    return vietnamDayOf(this.nowMs())
  }

  /** Thông báo hiện tại; null khi tắt, chưa có dữ liệu máy chủ (lần đọc đầu đang chạy) hoặc không có gì cần nhắc. */
  currentReminder(): RenewalReminder | null {
    if (!this.enabledForCurrentUser() || !this.server || !this.settings) return null
    const user = getCurrentUser()
    const today = this.today()
    if (!user || !today) return null
    return computeRenewalReminder({
      products: toRenewalReminderProducts(user.accountProducts),
      today,
      settings: this.settings,
      loginDays: this.server.loginDays,
      offers: this.server.offers
    })
  }

  getState(): RenewalReminderState {
    const enabled = this.enabledForCurrentUser()
    return toRenewalReminderPublicState({
      enabled,
      today: enabled ? this.today() : null,
      serverTimeMs: this.nowMs(),
      reminder: enabled ? this.currentReminder() : null
    })
  }

  private publish(force = false): void {
    const state = this.getState()
    const key = JSON.stringify({ enabled: state.enabled, today: state.today, reminder: state.reminder })
    if (!force && key === this.lastPublished) return
    this.lastPublished = key
    try { this.deps.send?.(state) } catch { /* Cửa sổ có thể đã đóng. */ }
  }

  /** `accountProducts` vừa đổi (lượt kiểm 30 giây) hoặc quyền quản trị đổi. */
  productsChanged(): void {
    this.syncScope()
    this.checkDay()
    this.publish()
  }

  /** Gọi sau mỗi lượt kiểm gói (30 giây, 00:05). Không đọc DB trừ khi đã sang ngày mới so với lần đọc RPC trước. */
  checkDay(): void {
    if (!this.enabledForCurrentUser() || this.fetching || !this.server) return
    const today = this.today()
    if (today && today !== this.serverDay) void this.fetchServer()
  }

  private fetchServer(): Promise<void> {
    if (this.fetching) return this.fetching
    const session = this.sessionSeq
    const task = (async () => {
      const raw = await loadRenewalReminderServerState()
      const receivedAt = Date.now()
      if (session !== this.sessionSeq) return
      const parsed = raw === null ? null : parseRenewalReminderServerState(raw, receivedAt)
      if (raw !== null && !parsed) console.warn('[RenewalReminder] Dữ liệu nhắc gia hạn sai định dạng; dùng ngày theo đồng hồ máy.')
      this.server = parsed ?? fallbackRenewalReminderServerState(receivedAt)
      this.serverDay = this.today()
    })().finally(() => {
      if (session !== this.sessionSeq) return
      this.fetching = null
      this.publish()
    })
    this.fetching = task
    return task
  }

  /**
   * Đọc lại sau thao tác gia hạn: `completed` (trang CRM báo đã kích hoạt) luôn chạy; `closed`/`focus` tối đa một lượt
   * mỗi 20 giây. Đọc lại gói rồi đọc lại RPC (ưu đãi có thể đã đổi), tính lại và gửi trạng thái.
   */
  async refresh(reason: 'completed' | 'closed' | 'focus'): Promise<RenewalReminderState> {
    const session = this.currentSessionId()
    if (session === null || !this.enabledForCurrentUser()) return this.getState()
    if (reason !== 'completed' && Date.now() - this.lastRefreshAt < REFRESH_MIN_GAP_MS) return this.getState()
    this.lastRefreshAt = Date.now()
    try { await this.deps.refreshEntitlements?.() } catch { /* Lượt kiểm 30 giây sẽ đọc lại. */ }
    if (session !== this.sessionSeq) return this.getState()
    if (this.fetching) await this.fetching.catch(() => {})
    if (session === this.sessionSeq) await this.fetchServer().catch(() => {})
    this.publish()
    return this.getState()
  }

  /**
   * Link cổng gia hạn cho thông báo hiện tại. `reminderKey` của renderer chỉ để đối chiếu; luôn dùng thông báo tính lại
   * trong main. Link (có thể chứa mã vé dùng một lần) chỉ dùng trong main. Phiên đổi trong lúc xin vé (đăng xuất, đổi tài
   * khoản, đổi mật khẩu) → `not_logged_in`, link vừa tạo bị bỏ.
   */
  async resolveLink(_reminderKey: unknown): Promise<RenewalReminderLink> {
    const session = this.currentSessionId()
    if (session === null) throw new RenewalReminderLinkError('not_logged_in', RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE)
    const reminder = this.currentReminder()
    if (!reminder) throw new RenewalReminderLinkError('no_reminder', RENEWAL_REMINDER_NO_REMINDER_MESSAGE)
    const issueTicket = this.deps.issueTicket
    const link = await buildRenewalReminderLink(reminder, async opid => {
      if (!issueTicket) return null
      return issueTicket(opid)
    })
    if (this.currentSessionId() !== session) {
      throw new RenewalReminderLinkError('not_logged_in', RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE)
    }
    return link
  }

  /** Có thông báo để mở cửa sổ gia hạn không (không đọc DB). */
  hasReminder(): boolean {
    return this.currentReminder() !== null
  }
}

export const renewalReminderService = new RenewalReminderService()
