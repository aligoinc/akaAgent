import { Zalo, LoginQRCallbackEventType, ZaloApiError } from 'zca-js'
import type { API, Credentials, LoginQRCallbackEvent } from 'zca-js'
import { AutoAccount, AutoProxy, ZaloLoginQrEvent, ZaloLoginQrStartResult, ZaloSessionCheckResult, ZaloSessionCredentials } from '../../shared/types'
import { SupabaseService } from './supabase'

const DEFAULT_ZALO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'
const DEFAULT_LANGUAGE = 'vi'

interface ActiveQrLogin {
  accountId: number
  abort?: () => unknown
  cancelRequested: boolean
}

interface CachedZaloApi {
  accountId: number
  api: API
  proxyId?: number | null
  sessionUpdatedAt?: string | null
  lastVerifiedAt?: string | null
  lastError?: string | null
}

type ZaloProfile = {
  userId?: unknown
  uid?: unknown
  globalId?: unknown
  username?: unknown
  displayName?: unknown
  zaloName?: unknown
  zalo_name?: unknown
  display_name?: unknown
  avatar?: unknown
  phoneNumber?: unknown
}

export class ZaloRuntimeService {
  private activeQrLogins = new Map<number, ActiveQrLogin>()
  private apiCache = new Map<number, CachedZaloApi>()
  private apiLoginInflight = new Map<number, Promise<API>>()
  private verifyInflight = new Map<number, Promise<void>>()
  private accountCacheVersions = new Map<number, number>()
  private cacheVersion = 0

  constructor(
    private readonly supabase: SupabaseService,
    private readonly getProxyById: (id: number) => Promise<AutoProxy | null>,
    private readonly emitLoginQrEvent: (event: ZaloLoginQrEvent) => void
  ) {}

  async startLoginQr(accountId: number): Promise<ZaloLoginQrStartResult> {
    const account = await this.supabase.getAccount(accountId)
    if (!account) return { success: false, accountId, reason: 'Không tìm thấy tài khoản' }
    if (account.flatformType !== 'zalo') {
      return { success: false, accountId, reason: 'Tài khoản không phải nền tảng Zalo' }
    }

    this.cancelLoginQr(accountId)
    this.invalidateAccount(accountId)
    const active: ActiveQrLogin = { accountId, cancelRequested: false }
    this.activeQrLogins.set(accountId, active)
    void this.runLoginQr(account, active)
    return { success: true, accountId }
  }

  cancelLoginQr(accountId: number): void {
    const active = this.activeQrLogins.get(accountId)
    if (!active) return
    active.cancelRequested = true
    try { active.abort?.() } catch {}
    this.activeQrLogins.delete(accountId)
    this.emitLoginQrEvent({
      accountId,
      status: 'cancelled',
      message: 'Đã huỷ đăng nhập Zalo'
    })
  }

  async ensureApi(accountId: number): Promise<API> {
    const entry = await this.supabase.getAccountZaloSession(accountId)
    if (!entry) throw new Error('Không tìm thấy tài khoản')
    if (entry.account.flatformType !== 'zalo') throw new Error('Tài khoản không phải nền tảng Zalo')
    if (!entry.session) throw new Error('Chưa có session Zalo')

    const cached = this.apiCache.get(accountId)
    if (cached && this.isCachedApiFresh(cached, entry.account)) {
      return cached.api
    }
    if (cached) this.apiCache.delete(accountId)

    const inflight = this.apiLoginInflight.get(accountId)
    if (inflight) return inflight

    const version = this.cacheVersion
    const accountVersion = this.getAccountCacheVersion(accountId)
    let promise!: Promise<API>
    promise = this.loginWithSession(entry.account, entry.session)
      .then((api) => {
        if (this.cacheVersion === version && this.getAccountCacheVersion(accountId) === accountVersion) {
          this.cacheApi(entry.account, api)
        }
        return api
      })
      .catch((err) => {
        this.apiCache.delete(accountId)
        throw err
      })
      .finally(() => {
        if (this.apiLoginInflight.get(accountId) === promise) {
          this.apiLoginInflight.delete(accountId)
        }
      })

    this.apiLoginInflight.set(accountId, promise)
    return promise
  }

  async warmStoredSessions(): Promise<void> {
    const version = this.cacheVersion
    const entries = await this.supabase.listZaloAccountsWithSession()
    if (entries.length > 0) {
      console.log(`[ZaloRuntime] Warming ${entries.length} stored Zalo session(s).`)
    }

    for (const entry of entries) {
      if (this.cacheVersion !== version) return
      try {
        await this.verifyAccountSession(entry.account.id)
        if (this.cacheVersion !== version) return
        const account = await this.supabase.markAccountZaloSessionCheck(entry.account.id, { ok: true })
        this.updateCachedVerification(account)
      } catch (err) {
        if (this.cacheVersion !== version) return
        const message = this.getErrorMessage(err)
        console.warn('[ZaloRuntime] Failed to warm stored session', {
          accountId: entry.account.id,
          message
        })
        this.invalidateAccount(entry.account.id)
        await this.supabase.markAccountZaloSessionCheck(entry.account.id, {
          ok: false,
          error: message
        }).catch(() => {})
      }
    }
  }

  invalidateAccount(accountId: number): void {
    this.accountCacheVersions.set(accountId, this.getAccountCacheVersion(accountId) + 1)
    this.apiCache.delete(accountId)
    this.apiLoginInflight.delete(accountId)
  }

  clearAll(): void {
    this.cacheVersion += 1
    for (const active of this.activeQrLogins.values()) {
      active.cancelRequested = true
      try { active.abort?.() } catch {}
    }
    this.activeQrLogins.clear()
    this.apiCache.clear()
    this.apiLoginInflight.clear()
    this.verifyInflight.clear()
    this.accountCacheVersions.clear()
  }

  async checkSession(accountId: number): Promise<ZaloSessionCheckResult> {
    const entry = await this.supabase.getAccountZaloSession(accountId)
    if (!entry) {
      return { success: false, loggedIn: false, status: 'chưa đăng nhập', reason: 'Không tìm thấy tài khoản' }
    }
    if (entry.account.flatformType !== 'zalo') {
      return { success: false, loggedIn: false, status: entry.account.loginStatus, reason: 'Tài khoản không phải nền tảng Zalo' }
    }
    if (!entry.session) {
      const account = await this.supabase.markAccountZaloSessionCheck(accountId, { ok: false, error: 'Chưa có session Zalo' })
      return { success: true, loggedIn: false, status: account.loginStatus, reason: 'Chưa có session Zalo', account }
    }

    try {
      await this.verifyAccountSession(accountId)
      const account = await this.supabase.markAccountZaloSessionCheck(accountId, { ok: true })
      this.updateCachedVerification(account)
      return { success: true, loggedIn: true, status: account.loginStatus, account }
    } catch (err) {
      const message = this.getErrorMessage(err)
      this.invalidateAccount(accountId)
      const account = await this.supabase.markAccountZaloSessionCheck(accountId, { ok: false, error: message })
      return { success: true, loggedIn: false, status: account.loginStatus, reason: message, account }
    }
  }

  async logout(accountId: number): Promise<ZaloSessionCheckResult> {
    this.cancelLoginQr(accountId)
    this.invalidateAccount(accountId)
    const account = await this.supabase.clearAccountZaloSession(accountId)
    return {
      success: true,
      loggedIn: false,
      status: account.loginStatus,
      account
    }
  }

  private async runLoginQr(account: AutoAccount, active: ActiveQrLogin): Promise<void> {
    let callbackCredentials: ZaloSessionCredentials | null = null
    try {
      const zalo = await this.createZaloClient(account)
      const api = await zalo.loginQR({
        userAgent: DEFAULT_ZALO_USER_AGENT,
        language: DEFAULT_LANGUAGE
      }, (event) => {
        callbackCredentials = this.handleQrCallback(account.id, event, active) || callbackCredentials
      })

      if (active.cancelRequested) return
      const credentials = this.getSessionCredentialsFromApi(api, callbackCredentials)

      const profile = await this.loadOwnProfile(api)
      const zaloAccount = await this.supabase.upsertZaloAccount(profile)
      const updated = await this.supabase.updateAccountZaloSession(account.id, {
        zaloAccountId: zaloAccount.id,
        session: credentials,
        verified: true,
        clearError: true
      })
      this.cacheApi(updated, api)

      this.emitLoginQrEvent({
        accountId: account.id,
        status: 'success',
        message: 'Đăng nhập Zalo thành công',
        displayName: updated.zaloDisplayName || profile.displayName || undefined,
        avatarUrl: updated.zaloAvatarUrl || profile.avatarUrl || undefined,
        zaloAccountId: zaloAccount.id,
        zaloUid: zaloAccount.zaloUid
      })
    } catch (err) {
      if (active.cancelRequested) return
      this.logLoginQrFailure(account.id, err)
      const message = this.getErrorMessage(err)
      await this.supabase.markAccountZaloSessionCheck(account.id, { ok: false, error: message }).catch(() => {})
      this.emitLoginQrEvent({
        accountId: account.id,
        status: 'error',
        message
      })
    } finally {
      this.activeQrLogins.delete(account.id)
    }
  }

  private handleQrCallback(
    accountId: number,
    event: LoginQRCallbackEvent,
    active: ActiveQrLogin
  ): ZaloSessionCredentials | null {
    if (event.actions && 'abort' in event.actions) {
      active.abort = event.actions.abort
      if (active.cancelRequested) {
        try { event.actions.abort() } catch {}
        return null
      }
    }

    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        this.emitLoginQrEvent({
          accountId,
          status: 'qr',
          message: 'Quét mã QR bằng ứng dụng Zalo',
          qrImage: this.normalizeQrImage(event.data.image)
        })
        return null
      case LoginQRCallbackEventType.QRCodeExpired:
        this.emitLoginQrEvent({
          accountId,
          status: 'expired',
          message: 'Mã QR đã hết hạn, đang tạo lại mã mới'
        })
        try { event.actions.retry() } catch {}
        return null
      case LoginQRCallbackEventType.QRCodeScanned:
        this.emitLoginQrEvent({
          accountId,
          status: 'scanned',
          message: 'Đã quét QR, vui lòng xác nhận trên điện thoại',
          displayName: event.data.display_name,
          avatarUrl: event.data.avatar
        })
        return null
      case LoginQRCallbackEventType.QRCodeDeclined:
        this.emitLoginQrEvent({
          accountId,
          status: 'declined',
          message: 'Bạn đã từ chối đăng nhập Zalo'
        })
        return null
      case LoginQRCallbackEventType.GotLoginInfo:
        return {
          cookie: event.data.cookie,
          imei: event.data.imei,
          userAgent: event.data.userAgent,
          language: DEFAULT_LANGUAGE
        }
      default:
        return null
    }
  }

  private cacheApi(account: AutoAccount, api: API, lastError: string | null = null): void {
    this.apiCache.set(account.id, {
      accountId: account.id,
      api,
      proxyId: account.proxyId ?? null,
      sessionUpdatedAt: account.zaloSessionUpdatedAt ?? null,
      lastVerifiedAt: account.zaloSessionLastVerifiedAt ?? null,
      lastError
    })
  }

  private isCachedApiFresh(cached: CachedZaloApi, account: AutoAccount): boolean {
    return cached.proxyId === (account.proxyId ?? null)
      && cached.sessionUpdatedAt === (account.zaloSessionUpdatedAt ?? null)
  }

  private updateCachedVerification(account: AutoAccount): void {
    const cached = this.apiCache.get(account.id)
    if (!cached || !this.isCachedApiFresh(cached, account)) return
    cached.lastVerifiedAt = account.zaloSessionLastVerifiedAt ?? new Date().toISOString()
    cached.lastError = null
  }

  private getAccountCacheVersion(accountId: number): number {
    return this.accountCacheVersions.get(accountId) ?? 0
  }

  private async verifyAccountSession(accountId: number): Promise<void> {
    const inflight = this.verifyInflight.get(accountId)
    if (inflight) return inflight

    let promise!: Promise<void>
    promise = this.verifyAccountSessionOnce(accountId)
      .finally(() => {
        if (this.verifyInflight.get(accountId) === promise) {
          this.verifyInflight.delete(accountId)
        }
      })

    this.verifyInflight.set(accountId, promise)
    return promise
  }

  private async verifyAccountSessionOnce(accountId: number): Promise<void> {
    try {
      const api = await this.ensureApi(accountId)
      await this.verifyAuthenticatedApi(api)
    } catch (firstErr) {
      console.warn('[ZaloRuntime] Zalo API verification failed, retrying with a fresh session login', {
        accountId,
        message: this.getErrorMessage(firstErr)
      })
      this.invalidateAccount(accountId)
      const retryApi = await this.ensureApi(accountId)
      await this.verifyAuthenticatedApi(retryApi)
    }
  }

  private async verifyAuthenticatedApi(api: API): Promise<void> {
    const info = await api.fetchAccountInfo()
    if (!info || typeof info !== 'object' || !('profile' in info)) {
      throw new Error('Không xác thực được session Zalo')
    }
  }

  private async loginWithSession(account: AutoAccount, session: ZaloSessionCredentials): Promise<API> {
    const zalo = await this.createZaloClient(account)
    return zalo.login(session as Credentials)
  }

  private async createZaloClient(account: AutoAccount): Promise<Zalo> {
    const proxy = account.proxyId ? await this.getProxyById(account.proxyId) : null
    const agent = proxy && proxy.isActive !== false
      ? await this.createProxyAgent(proxy)
      : undefined
    const options: {
      checkUpdate: boolean
      logging: boolean
      agent?: any
      polyfill?: typeof globalThis.fetch
    } = {
      checkUpdate: false,
      logging: false
    }

    if (agent) {
      options.agent = agent
      options.polyfill = await this.loadFetchPolyfillWithSetCookieSupport()
    }

    return new Zalo(options)
  }

  private async loadFetchPolyfillWithSetCookieSupport(): Promise<typeof globalThis.fetch> {
    const mod = await import('node-fetch')
    const nodeFetch = mod.default
    return (async (url: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const response = await nodeFetch(url as any, init as any)
      this.attachGetSetCookie(response)
      return response as unknown as Response
    }) as typeof globalThis.fetch
  }

  private async createProxyAgent(proxy: AutoProxy): Promise<any> {
    const mod = await import('proxy-agent')
    return new mod.ProxyAgent({ getProxyForUrl: () => this.buildProxyUrl(proxy) })
  }

  private attachGetSetCookie(response: unknown): void {
    const headers = (response as any)?.headers
    if (!headers || typeof headers.getSetCookie === 'function') return
    if (typeof headers.raw !== 'function') return

    Object.defineProperty(headers, 'getSetCookie', {
      configurable: true,
      value: () => {
        const raw = headers.raw()
        const cookies = raw?.['set-cookie']
        return Array.isArray(cookies) ? cookies : []
      }
    })
  }

  private getSessionCredentialsFromApi(api: API, fallback: ZaloSessionCredentials | null): ZaloSessionCredentials {
    const ctx = api.getContext()
    const cookie = ctx.cookie?.toJSON?.()?.cookies || fallback?.cookie
    const imei = firstString(ctx.imei, fallback?.imei)
    const userAgent = firstString(ctx.userAgent, fallback?.userAgent, DEFAULT_ZALO_USER_AGENT)
    const language = firstString(ctx.language, fallback?.language, DEFAULT_LANGUAGE) || undefined

    if (!cookie || !imei || !userAgent) {
      throw new Error('Không lấy được session sau khi quét QR')
    }

    return {
      cookie,
      imei,
      userAgent,
      language
    }
  }

  private logLoginQrFailure(accountId: number, err: unknown): void {
    const message = this.getErrorMessage(err)
    console.error('[ZaloRuntime] QR login failed', { accountId, message, err })
    if (message.includes("Can't login")) {
      console.warn('[ZaloRuntime] zca-js reported "Can\'t login" after checksession + /jr/userinfo. This means QR was scanned/confirmed, but Zalo did not mark the web session as logged in.')
    }
  }

  private async loadOwnProfile(api: API): Promise<{
    zaloUid: string
    displayName?: string | null
    phone?: string | null
    avatarUrl?: string | null
    metadata: Record<string, unknown>
  }> {
    const ownId = String(api.getOwnId() || '').trim()
    const info = await api.fetchAccountInfo().catch(() => null)
    const profile = ((info && 'profile' in info ? info.profile : null) || {}) as ZaloProfile
    const zaloUid = ownId || normalizeProfileId(profile)
    if (!zaloUid) throw new Error('Không lấy được Zalo UID')

    const displayName = firstString(profile.displayName, profile.zaloName, profile.display_name, profile.zalo_name, profile.username)
    const phone = firstString(profile.phoneNumber)
    const avatarUrl = firstString(profile.avatar)

    return {
      zaloUid,
      displayName,
      phone,
      avatarUrl,
      metadata: sanitizeProfileMetadata(profile)
    }
  }

  private buildProxyUrl(proxy: AutoProxy): string {
    const protocol = proxy.protocol || 'http'
    const auth = proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
      : ''
    return `${protocol}://${auth}${proxy.host}:${proxy.port}`
  }

  private normalizeQrImage(image: string): string {
    const trimmed = String(image || '').trim()
    if (!trimmed) return trimmed
    if (/^data:image\//i.test(trimmed)) return trimmed
    return `data:image/png;base64,${trimmed}`
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof ZaloApiError) {
      const suffix = err.code === null || err.code === undefined ? '' : ` (${err.code})`
      return `${err.message}${suffix}`
    }
    if (err instanceof Error) return err.message
    return String(err)
  }
}

function normalizeProfileId(profile: ZaloProfile): string {
  return firstString(profile.userId, profile.uid, profile.globalId) || ''
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return null
}

function sanitizeProfileMetadata(profile: ZaloProfile): Record<string, unknown> {
  const metadata = { ...(profile as Record<string, unknown>) }
  delete metadata.phoneNumber
  return metadata
}
