/**
 * Bot sự kiện: nối eventBotRuntime.ts với DB thật (eventBotRepository) và phiên Zalo của tiến trình.
 *   - App Desktop: một `ZaloRuntimeService`. Giữ tài khoản = Zalo QR đang có phiên trong bộ nhớ (`cachedAccountIds`, không đăng nhập
 *     thêm) hoặc Zalo trình duyệt có tab đã xác minh (`hasVerifiedWebSession`); gửi bằng `sendMessageToUser` (Zalo trình duyệt đi qua
 *     API bắt từ tab, cùng hàm).
 *   - App Server: mỗi nhân viên một `ZaloRuntimeService`; bộ chạy gom mọi tài khoản đang có phiên của các nhân viên đang chạy vào một
 *     lượt hỏi, gửi bằng runtime của đúng nhân viên trong `runWithCurrentUser`.
 */
import { randomUUID } from 'crypto'
import { ZaloApiError } from 'zca-js'
import { getCurrentUser, runWithCurrentUser } from '../data/currentUser'
import { getDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { createEventBotRepository, isEventBotRpcMissing } from '../data/repositories/eventBotRepository'
import { engagementMessageIds } from '../../shared/zaloCampaignEngagement'
import type { AuthUser } from '../../shared/types'
import type { EventBotSendPort } from '../../../packages/campaign-engine/src/eventBot/index'
import { EventBotRuntime } from './eventBotRuntime'
import { isZaloPreCallError } from './zaloPreCallError'
import type { ZaloRuntimeService } from './zaloRuntimeService'

let lastWarningAt = 0

function warnThrottled(source: string, runtime: () => EventBotRuntime | null, kind: string, detail?: Record<string, unknown>): void {
  if (isEventBotRpcMissing(detail)) return
  if (Date.now() - lastWarningAt < 60_000) return
  lastWarningAt = Date.now()
  console.warn('[EventBot] degraded', { kind, source, ...detail, ...runtime()?.metrics })
}

function portFor(resolve: (accountId: number) => { zaloRuntime: ZaloRuntimeService; user: AuthUser | null } | null): EventBotSendPort {
  const withRuntime = async <T>(accountId: number, fn: (zaloRuntime: ZaloRuntimeService) => Promise<T>): Promise<T> => {
    const target = resolve(accountId)
    if (!target) {
      // Không còn phiên của tài khoản này trong tiến trình: chắc chắn chưa gọi Zalo.
      const error = new Error('Tài khoản không còn đăng nhập trên máy chạy bot') as Error & { eventBotNotSent?: boolean }
      error.eventBotNotSent = true
      throw error
    }
    return target.user ? runWithCurrentUser(target.user, () => fn(target.zaloRuntime)) : fn(target.zaloRuntime)
  }
  return {
    sendText: (accountId, uid, text) => withRuntime(accountId, async zaloRuntime => {
      const response = await zaloRuntime.sendMessageToUser(accountId, uid, text)
      return { msgId: engagementMessageIds(response)[0] ?? null }
    }),
    getProfile: (accountId, uid) => withRuntime(accountId, async zaloRuntime => {
      const user = await zaloRuntime.getUserProfile(accountId, uid)
      return user ? { displayName: user.displayName ?? null, originalName: user.originalName ?? null, gender: user.gender ?? null } : null
    }),
    errorHints: error => ({
      answered: error instanceof ZaloApiError,
      notSent: isZaloPreCallError(error) || (error as { eventBotNotSent?: unknown } | null)?.eventBotNotSent === true
    }),
    businessNow: async () => new Date((await getDatabaseRuntimeClock()).dbNow)
  }
}

const vietnamDate = async (): Promise<string> => (await getDatabaseRuntimeClock()).vietnamDateKey

/** App Desktop: tài khoản Zalo QR / trình duyệt của nhân viên đang đăng nhập. */
export function createDesktopEventBot(zaloRuntime: ZaloRuntimeService, options: { canStartWork?: () => boolean } = {}): EventBotRuntime {
  const repository = createEventBotRepository('desktop')
  const isHeld = (accountId: number): boolean =>
    zaloRuntime.cachedAccountIds().includes(accountId) || zaloRuntime.hasVerifiedWebSession(accountId)
  let runtime: EventBotRuntime | null = null
  runtime = new EventBotRuntime({
    source: 'desktop',
    runnerId: `desktop:${randomUUID()}`,
    active: () => Boolean(getCurrentUser()),
    ...(options.canStartWork ? { canStartWork: options.canStartWork } : {}),
    isHeld,
    sync: () => repository.sync([]),
    birthdays: (accountId, people) => repository.birthdays(accountId, people),
    claim: (runnerId, accountIds, limit) => repository.claim(runnerId, accountIds, limit),
    report: (jobId, claimToken, result) => repository.report(jobId, claimToken, result),
    port: portFor(accountId => isHeld(accountId) ? { zaloRuntime, user: null } : null),
    readFriendsPage: (accountId, count, page) => zaloRuntime.getAllFriendsPage(accountId, count, page),
    vietnamDate,
    isRpcMissing: isEventBotRpcMissing,
    warn: (kind, detail) => warnThrottled('desktop', () => runtime, kind, detail),
    info: (kind, detail) => console.info('[EventBot]', kind, detail)
  })
  return runtime
}

export interface ServerEventBotAccountSource {
  /** accountId → runtime Zalo + nhân viên đang giữ phiên (chỉ runtime đang chạy). */
  resolve(accountId: number): { zaloRuntime: ZaloRuntimeService; user: AuthUser } | null
  /** Mọi tài khoản đang có phiên trong các runtime đang chạy. */
  listAccounts(): number[]
}

/** App Server: một vòng cho cả tiến trình, quyền máy chủ (`p_source = 'server'`). */
export function createServerEventBot(source: ServerEventBotAccountSource): EventBotRuntime {
  const repository = createEventBotRepository('server')
  let runtime: EventBotRuntime | null = null
  runtime = new EventBotRuntime({
    source: 'server',
    runnerId: `server:${randomUUID()}`,
    isHeld: accountId => source.resolve(accountId) !== null,
    listHeldAccounts: () => source.listAccounts(),
    sync: held => repository.sync(held),
    birthdays: (accountId, people) => repository.birthdays(accountId, people),
    claim: (runnerId, accountIds, limit) => repository.claim(runnerId, accountIds, limit),
    report: (jobId, claimToken, result) => repository.report(jobId, claimToken, result),
    port: portFor(accountId => source.resolve(accountId)),
    readFriendsPage: async (accountId, count, page) => {
      const target = source.resolve(accountId)
      if (!target) throw new Error('Tài khoản không còn đăng nhập trên máy chủ')
      return runWithCurrentUser(target.user, () => target.zaloRuntime.getAllFriendsPage(accountId, count, page))
    },
    vietnamDate,
    isRpcMissing: isEventBotRpcMissing,
    warn: (kind, detail) => warnThrottled('server', () => runtime, kind, detail),
    info: (kind, detail) => console.info('[EventBot]', kind, detail)
  })
  return runtime
}
