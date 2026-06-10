import { promises as fs } from 'node:fs'
import { Zalo, LoginQRCallbackEventType, ThreadType, ZaloApiError } from 'zca-js'
import type { API, AttachmentSource, Credentials, ImageMetadataGetterResponse, LabelData, LoginQRCallbackEvent, MessageContent, Options as ZaloOptions, UserBasic } from 'zca-js'
import { AutoAccount, AutoProxy, ZaloLabelOption, ZaloLoginQrEvent, ZaloLoginQrStartResult, ZaloSessionCheckResult, ZaloSessionCredentials } from '../../shared/types'
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

type ImageDimensions = {
  width: number
  height: number
}

async function getZaloImageMetadata(filePath: string): Promise<ImageMetadataGetterResponse> {
  const data = await fs.readFile(filePath)
  const dimensions = getImageDimensions(data)
  if (!dimensions) return null
  return {
    width: dimensions.width,
    height: dimensions.height,
    size: data.length
  }
}

function getImageDimensions(data: Buffer): ImageDimensions | null {
  return getPngDimensions(data)
    || getJpegDimensions(data)
    || getGifDimensions(data)
    || getWebpDimensions(data)
}

function getPngDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 24) return null
  if (
    data[0] !== 0x89
    || data[1] !== 0x50
    || data[2] !== 0x4e
    || data[3] !== 0x47
    || data[4] !== 0x0d
    || data[5] !== 0x0a
    || data[6] !== 0x1a
    || data[7] !== 0x0a
  ) {
    return null
  }
  return normalizeImageDimensions(data.readUInt32BE(16), data.readUInt32BE(20))
}

function getGifDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 10) return null
  const signature = data.subarray(0, 6).toString('ascii')
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null
  return normalizeImageDimensions(data.readUInt16LE(6), data.readUInt16LE(8))
}

function getJpegDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null

  let offset = 2
  while (offset < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (offset < data.length && data[offset] === 0xff) offset += 1
    const marker = data[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) break
    if (offset + 2 > data.length) break

    const segmentLength = data.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > data.length) break

    if (isJpegStartOfFrameMarker(marker)) {
      const segmentStart = offset + 2
      if (segmentStart + 5 > data.length) break
      return normalizeImageDimensions(
        data.readUInt16BE(segmentStart + 3),
        data.readUInt16BE(segmentStart + 1)
      )
    }

    offset += segmentLength
  }

  return null
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0
    && marker <= 0xcf
    && marker !== 0xc4
    && marker !== 0xc8
    && marker !== 0xcc
}

function getWebpDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 30) return null
  if (data.subarray(0, 4).toString('ascii') !== 'RIFF') return null
  if (data.subarray(8, 12).toString('ascii') !== 'WEBP') return null

  const chunkType = data.subarray(12, 16).toString('ascii')
  if (chunkType === 'VP8X') {
    return normalizeImageDimensions(readUInt24LE(data, 24) + 1, readUInt24LE(data, 27) + 1)
  }

  if (chunkType === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return normalizeImageDimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff)
  }

  if (chunkType === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
    const b0 = data[21]
    const b1 = data[22]
    const b2 = data[23]
    const b3 = data[24]
    return normalizeImageDimensions(
      1 + (((b1 & 0x3f) << 8) | b0),
      1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    )
  }

  return null
}

function readUInt24LE(data: Buffer, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16)
}

function normalizeImageDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export interface ZaloFoundUser {
  uid: string
  displayName?: string
  originalName?: string
  gender?: number | string | null
  avatar?: string
  raw: Record<string, unknown>
}

export interface ZaloFriendRequestStatus {
  isFriend: boolean
  isRequested: boolean
  isRequesting: boolean
  addFriendPrivacy?: number
  raw: Record<string, unknown>
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

  async listLabels(accountId: number): Promise<ZaloLabelOption[]> {
    const api = await this.ensureApi(accountId)
    const response = await api.getLabels()
    return (Array.isArray(response?.labelData) ? response.labelData : [])
      .map(label => ({
        id: Number(label.id),
        text: String(label.text || '').trim(),
        textKey: String(label.textKey || '').trim() || undefined,
        color: String(label.color || '').trim() || undefined,
        emoji: String(label.emoji || '').trim() || undefined
      }))
      .filter(label => Number.isFinite(label.id) && label.id > 0 && label.text)
  }

  async findUserByPhone(accountId: number, phone: string): Promise<ZaloFoundUser | null> {
    const api = await this.ensureApi(accountId)
    const user = await api.findUser(phone)
    return normalizeFoundUser(user)
  }

  async getFriendRequestStatus(accountId: number, uid: string): Promise<ZaloFriendRequestStatus> {
    const api = await this.ensureApi(accountId)
    const status = await api.getFriendRequestStatus(uid)
    const raw = normalizeRecord(status)
    return {
      isFriend: Number(status?.is_friend || 0) === 1,
      isRequested: Number(status?.is_requested || 0) === 1,
      isRequesting: Number(status?.is_requesting || 0) === 1,
      addFriendPrivacy: Number.isFinite(Number(status?.addFriendPrivacy)) ? Number(status?.addFriendPrivacy) : undefined,
      raw
    }
  }

  async sendMessageToUser(
    accountId: number,
    uid: string,
    message: string,
    attachments: string[] = []
  ): Promise<unknown> {
    const api = await this.ensureApi(accountId)
    const safeAttachments = attachments.map(item => String(item || '').trim()).filter(Boolean) as AttachmentSource[]
    const payload: MessageContent = safeAttachments.length > 0
      ? { msg: String(message || ''), attachments: safeAttachments }
      : { msg: String(message || '') }
    return api.sendMessage(payload, uid, ThreadType.User)
  }

  async sendFriendRequestToUser(accountId: number, uid: string, message: string): Promise<unknown> {
    const api = await this.ensureApi(accountId)
    return api.sendFriendRequest(String(message || ''), uid)
  }

  async applyLabelToUser(accountId: number, uid: string, labelId: number | string): Promise<LabelData> {
    const api = await this.ensureApi(accountId)
    const id = Number(labelId)
    if (!Number.isFinite(id) || id <= 0) throw new Error('Tag Zalo không hợp lệ')
    const response = await api.getLabels()
    const labels = Array.isArray(response?.labelData) ? response.labelData : []
    const label = labels.find(item => Number(item.id) === id)
    if (!label) throw new Error('Tag Zalo không tồn tại')
    if (!Array.isArray(label.conversations)) label.conversations = []
    if (!label.conversations.includes(uid)) {
      label.conversations.push(uid)
      await api.updateLabels({ labelData: labels, version: response.version })
    }
    return label
  }

  async changeUserAlias(accountId: number, uid: string, alias: string): Promise<unknown> {
    const api = await this.ensureApi(accountId)
    return api.changeFriendAlias(String(alias || ''), uid)
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
    const options: Partial<ZaloOptions> = {
      checkUpdate: false,
      logging: false,
      imageMetadataGetter: getZaloImageMetadata
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

function normalizeFoundUser(user: UserBasic | null | undefined): ZaloFoundUser | null {
  if (!user || typeof user !== 'object') return null
  const raw = normalizeRecord(user)
  const uid = firstString((user as any).uid, (user as any).userId, (user as any).globalId)
  if (!uid) return null
  return {
    uid,
    displayName: firstString((user as any).display_name, (user as any).displayName, (user as any).zalo_name, (user as any).zaloName) || undefined,
    originalName: firstString((user as any).zalo_name, (user as any).zaloName, (user as any).display_name, (user as any).displayName) || undefined,
    gender: (user as any).gender ?? null,
    avatar: firstString((user as any).avatar) || undefined,
    raw
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  return { ...(value as Record<string, unknown>) }
}
