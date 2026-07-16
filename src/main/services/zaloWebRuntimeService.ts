import { createDecipheriv, createHash } from 'node:crypto'
import { session, type Session, type WebContents } from 'electron'
import { API } from 'zca-js'
import type {
  ContextSession,
  ImageMetadataGetter,
  ZPWServiceMap
} from 'zca-js'

const ZALO_CHAT_ORIGIN = 'https://chat.zalo.me'
const GET_LOGIN_INFO_PATH = '/api/login/getlogininfo'
const GET_SERVER_INFO_PATH = '/api/login/getserverinfo'
const DEFAULT_CAPTURE_TIMEOUT_MS = 30_000
const CDP_PROTOCOL_VERSION = '1.3'

type BootstrapRequestKind = 'login-info' | 'server-info'

type CdpMessageListener = (
  event: Electron.Event,
  method: string,
  params: any,
  sessionId: string
) => void

interface CapturedLoginInfo extends Record<string, unknown> {
  uid: string
  zpw_enk: string
  zpw_service_map_v3: ZPWServiceMap
  zpw_ws: string[]
}

interface CapturedServerInfo extends Record<string, unknown> {
  settings?: Record<string, unknown>
  setttings?: Record<string, unknown>
  extra_ver?: Record<string, unknown>
}

interface CapturedBootstrap {
  loaderId: string
  loginInfo: CapturedLoginInfo
  serverInfo: CapturedServerInfo
  imei: string
  apiType: number
  apiVersion: number
  capturedAt: number
}

interface BootstrapCandidate {
  loaderId: string
  loginInfo?: CapturedLoginInfo
  serverInfo?: CapturedServerInfo
  imei?: string
  apiType?: number
  apiVersion?: number
}

interface PendingBootstrapRequest {
  kind: BootstrapRequestKind
  loaderId: string
  url: string
  candidate: BootstrapCandidate
  status?: number
}

interface ChangeSignal {
  promise: Promise<void>
  resolve: () => void
}

interface ZaloWebRuntimeEntry {
  accountId: number
  wc: WebContents
  wcId: number
  debuggerOwned: boolean
  debuggerReady: boolean
  messageListener: CdpMessageListener
  debuggerDetachListener: (event: Electron.Event, reason: string) => void
  destroyedListener: () => void
  renderProcessGoneListener: () => void
  pendingRequests: Map<string, PendingBootstrapRequest>
  candidates: Map<string, BootstrapCandidate>
  bootstrap?: CapturedBootstrap
  captureVersion: number
  generationAbortController: AbortController
  api?: API
  apiBuild?: Promise<API>
  verified: boolean
  lastError?: string
  signal: ChangeSignal
}

function createChangeSignal(): ChangeSignal {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`Zalo Web bootstrap thiếu ${field}`)
  return normalized
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Zalo Web bootstrap có ${field} không hợp lệ`)
  }
  return parsed
}

function splitEvenOdd(value: string): { even: string[]; odd: string[] } {
  const even: string[] = []
  const odd: string[] = []
  Array.from(value).forEach((character, index) => {
    if (index % 2 === 0) even.push(character)
    else odd.push(character)
  })
  return { even, odd }
}

/**
 * Derive the one-request response key used by Zalo Web's encrypted
 * getLoginInfo bootstrap. This mirrors ParamsEncryptor.createEncryptKey in
 * zca-js, but does not perform a login or create another browser session.
 */
function deriveLoginResponseKey(zcid: string, zcidExt: string): string {
  const md5 = createHash('md5').update(zcidExt).digest('hex').toUpperCase()
  const md5Parts = splitEvenOdd(md5)
  const zcidParts = splitEvenOdd(zcid)
  const key = md5Parts.even.slice(0, 8).join('')
    + zcidParts.even.slice(0, 12).join('')
    + zcidParts.odd.reverse().slice(0, 12).join('')
  if (Buffer.byteLength(key, 'utf8') !== 32) {
    throw new Error('Không dựng được khóa bootstrap Zalo Web')
  }
  return key
}

function decryptLoginResponse(encryptedData: string, key: string): unknown {
  const ciphertext = Buffer.from(decodeURIComponent(encryptedData), 'base64')
  const decipher = createDecipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), Buffer.alloc(16))
  decipher.setAutoPadding(true)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(plaintext)
}

function normalizeLoginInfo(value: unknown): CapturedLoginInfo {
  const record = asRecord(value)
  if (!record) throw new Error('Phản hồi getLoginInfo của Zalo Web không hợp lệ')

  const serviceMap = asRecord(record.zpw_service_map_v3)
  const wsUrls = Array.isArray(record.zpw_ws)
    ? record.zpw_ws.map(item => String(item || '').trim()).filter(Boolean)
    : []
  if (!serviceMap || Object.keys(serviceMap).length === 0) {
    throw new Error('Zalo Web bootstrap thiếu service map')
  }
  if (wsUrls.length === 0) {
    // API's constructor creates (but does not start) a Listener and expects at
    // least one URL. Keeping the captured URL does not open a WebSocket.
    throw new Error('Zalo Web bootstrap thiếu WebSocket metadata')
  }

  return {
    ...record,
    uid: requiredString(record.uid, 'uid'),
    zpw_enk: requiredString(record.zpw_enk, 'zpw_enk'),
    zpw_service_map_v3: serviceMap as unknown as ZPWServiceMap,
    zpw_ws: wsUrls
  }
}

function normalizeServerInfo(value: unknown): CapturedServerInfo {
  const record = asRecord(value)
  if (!record) throw new Error('Phản hồi getServerInfo của Zalo Web không hợp lệ')
  const settings = asRecord(record.setttings) || asRecord(record.settings)
  if (!settings) throw new Error('Zalo Web bootstrap thiếu settings')
  return {
    ...record,
    setttings: settings,
    settings
  }
}

function decodeCdpBody(body: string, base64Encoded: boolean): string {
  return base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
}

function cookieHeader(cookies: Awaited<ReturnType<Session['cookies']['get']>>): string {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

/**
 * CookieJar-shaped bridge required by zca-js API factories. Electron's
 * account partition remains the only source of truth; no cookie is persisted
 * by this object or copied into Supabase.
 */
class ElectronSessionCookieBridge {
  private synchronousSnapshot = ''

  constructor(
    private readonly session: Session,
    private readonly assertGenerationCurrent: () => void
  ) {}

  async refreshSnapshot(url = ZALO_CHAT_ORIGIN): Promise<void> {
    this.assertGenerationCurrent()
    const value = cookieHeader(await this.session.cookies.get({ url }))
    this.assertGenerationCurrent()
    this.synchronousSnapshot = value
  }

  async getCookieString(url: string): Promise<string> {
    this.assertGenerationCurrent()
    const value = cookieHeader(await this.session.cookies.get({ url }))
    this.assertGenerationCurrent()
    if (url.startsWith(ZALO_CHAT_ORIGIN)) this.synchronousSnapshot = value
    return value
  }

  getCookieStringSync(_url: string): string {
    this.assertGenerationCurrent()
    return this.synchronousSnapshot
  }

  async setCookie(cookie: unknown, _url: string): Promise<unknown> {
    this.assertGenerationCurrent()
    // Session.fetch uses this exact Electron Session, so Chromium has already
    // applied Set-Cookie to the persistent account partition. zca-js calls
    // this method only to mirror the same header into its normal CookieJar.
    return cookie
  }
}

/**
 * Runtime for a single existing Zalo Web session.
 *
 * It passively captures the page bootstrap with CDP, builds zca-js' public API
 * from that context, and routes HTTP through the same Electron Session. It
 * never calls Zalo.login/loginQR and never starts API.listener.
 */
export class ZaloWebRuntimeService {
  private readonly entries = new Map<number, ZaloWebRuntimeEntry>()

  constructor(
    private readonly imageMetadataGetter?: ImageMetadataGetter,
    private readonly captureTimeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
    private readonly onVerified?: (accountId: number, api: API, accountInfo: unknown) => void | Promise<void>
  ) {}

  async attach(accountId: number, wc: WebContents): Promise<void> {
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw new Error('accountId Zalo Web không hợp lệ')
    }
    if (!wc || wc.isDestroyed()) throw new Error('Tab Zalo Web không khả dụng')

    const existing = this.entries.get(accountId)
    if (existing?.wcId === wc.id) {
      if (!existing.debuggerReady) await this.armDebugger(existing)
      return
    }
    if (existing) this.detach(accountId)

    const entry = {} as ZaloWebRuntimeEntry
    entry.accountId = accountId
    entry.wc = wc
    entry.wcId = wc.id
    entry.debuggerOwned = false
    entry.debuggerReady = false
    entry.pendingRequests = new Map()
    entry.candidates = new Map()
    entry.captureVersion = 0
    entry.generationAbortController = new AbortController()
    entry.verified = false
    entry.signal = createChangeSignal()
    entry.messageListener = (_event, method, params) => {
      void this.handleDebuggerMessage(entry, method, params).catch(error => {
        this.recordError(entry, error)
      })
    }
    entry.debuggerDetachListener = (_event, reason) => {
      if (this.entries.get(accountId) !== entry) return
      entry.debuggerReady = false
      entry.debuggerOwned = false
      this.resetCapturedRuntime(entry, `CDP đã ngắt: ${reason || 'không rõ nguyên nhân'}`)
    }
    entry.destroyedListener = () => {
      if (this.entries.get(accountId) === entry) this.detach(accountId)
    }
    entry.renderProcessGoneListener = () => {
      if (this.entries.get(accountId) === entry) {
        entry.debuggerReady = false
        this.resetCapturedRuntime(entry, 'Tiến trình Zalo Web đã dừng')
      }
    }

    this.entries.set(accountId, entry)
    wc.debugger.on('message', entry.messageListener)
    wc.debugger.on('detach', entry.debuggerDetachListener)
    wc.once('destroyed', entry.destroyedListener)
    wc.on('render-process-gone', entry.renderProcessGoneListener)

    try {
      await this.armDebugger(entry)
    } catch (error) {
      this.detach(accountId)
      throw error
    }
  }

  detach(accountId: number): void {
    const entry = this.entries.get(accountId)
    if (!entry) return
    this.entries.delete(accountId)
    this.notifyChange(entry)

    try { entry.wc.debugger.off('message', entry.messageListener) } catch {}
    try { entry.wc.debugger.off('detach', entry.debuggerDetachListener) } catch {}
    try { entry.wc.off('destroyed', entry.destroyedListener) } catch {}
    try { entry.wc.off('render-process-gone', entry.renderProcessGoneListener) } catch {}
    if (entry.debuggerOwned && !entry.wc.isDestroyed()) {
      try {
        if (entry.wc.debugger.isAttached()) entry.wc.debugger.detach()
      } catch {}
    }

    entry.pendingRequests.clear()
    entry.candidates.clear()
    entry.generationAbortController.abort()
    entry.bootstrap = undefined
    entry.api = undefined
    entry.apiBuild = undefined
    entry.verified = false
  }

  /** Keep the CDP observer attached, but discard all captured/authenticated state. */
  invalidate(accountId: number): void {
    const entry = this.entries.get(accountId)
    if (!entry) return
    entry.pendingRequests.clear()
    entry.candidates.clear()
    this.resetCapturedRuntime(entry)
  }

  /**
   * Discard only the derived API after a failed request. The captured page
   * bootstrap is still valid for transient network failures, so the next
   * verification can rebuild against the same live Electron partition without
   * forcing the user to reload Zalo Web.
   */
  invalidateApi(accountId: number): void {
    const entry = this.entries.get(accountId)
    if (!entry) return
    this.advanceCaptureGeneration(entry)
    entry.api = undefined
    entry.apiBuild = undefined
    entry.verified = false
    entry.lastError = undefined
    this.notifyChange(entry)
  }

  clearAll(): void {
    for (const accountId of Array.from(this.entries.keys())) this.detach(accountId)
  }

  async clearPersistentSessions(accountIds: number[]): Promise<void> {
    const normalizedIds = Array.from(new Set(accountIds.filter(accountId => (
      Number.isSafeInteger(accountId) && accountId > 0
    ))))
    for (const accountId of normalizedIds) {
      await this.clearPersistentSession(accountId, false)
    }
  }

  hasVerifiedSession(accountId: number): boolean {
    const entry = this.entries.get(accountId)
    return !!entry
      && !entry.wc.isDestroyed()
      && entry.debuggerReady
      && entry.verified
      && !!entry.api
  }

  hasPendingVerification(accountId: number): boolean {
    const entry = this.entries.get(accountId)
    return !!entry
      && !entry.wc.isDestroyed()
      && entry.debuggerReady
      && !!entry.api
      && !entry.verified
  }

  isCurrentApi(accountId: number, api: API): boolean {
    const entry = this.entries.get(accountId)
    return !!entry
      && !entry.wc.isDestroyed()
      && entry.debuggerReady
      && entry.api === api
  }

  async clearForLogout(accountId: number): Promise<WebContents | null> {
    const wc = this.entries.get(accountId)?.wc || null
    await this.clearPersistentSession(accountId, true)
    return wc && !wc.isDestroyed() ? wc : null
  }

  async loadLoginPage(wc: WebContents | null): Promise<void> {
    if (wc && !wc.isDestroyed()) await wc.loadURL(ZALO_CHAT_ORIGIN)
  }

  private async clearPersistentSession(accountId: number, keepAttached: boolean): Promise<void> {
    const entry = this.entries.get(accountId)
    this.invalidate(accountId)
    const accountSession = entry?.wc.session
      || session.fromPartition(`persist:account_${accountId}`)

    // Stop the page/WebSocket before clearing storage. Otherwise the live SPA
    // can write a fresh auth cookie between clearStorageData and navigation.
    if (entry && !entry.wc.isDestroyed()) {
      try { entry.wc.stop() } catch {}
      await entry.wc.loadURL('about:blank')
    }

    await accountSession.clearStorageData()
    await accountSession.clearCache()

    if (!entry || entry.wc.isDestroyed() || keepAttached) return
    this.detach(accountId)
  }

  async ensureApi(accountId: number): Promise<API> {
    const entry = this.entries.get(accountId)
    if (!entry || entry.wc.isDestroyed()) {
      throw new Error('Hãy mở tab Zalo Web trước khi chạy tác vụ')
    }
    if (!entry.debuggerReady) {
      throw new Error('Bộ theo dõi phiên Zalo Web chưa sẵn sàng; hãy tải lại tab Zalo')
    }
    if (entry.verified && entry.api) return entry.api
    if (entry.apiBuild) return entry.apiBuild

    let build!: Promise<API>
    build = this.buildAndVerifyApi(accountId, entry)
      .finally(() => {
        if (entry.apiBuild === build) entry.apiBuild = undefined
      })
    entry.apiBuild = build
    return build
  }

  private async armDebugger(entry: ZaloWebRuntimeEntry): Promise<void> {
    if (entry.wc.isDestroyed()) throw new Error('Tab Zalo Web không khả dụng')
    if (!entry.wc.debugger.isAttached()) {
      entry.wc.debugger.attach(CDP_PROTOCOL_VERSION)
      entry.debuggerOwned = true
    }
    try {
      await entry.wc.debugger.sendCommand('Network.enable', {
        maxTotalBufferSize: 10 * 1024 * 1024,
        maxResourceBufferSize: 2 * 1024 * 1024,
        maxPostDataSize: 512 * 1024
      })
      entry.debuggerReady = true
      entry.lastError = undefined
      this.notifyChange(entry)
    } catch (error) {
      entry.debuggerReady = false
      throw new Error(`Không bật được capture Zalo Web: ${this.errorMessage(error)}`)
    }
  }

  private async handleDebuggerMessage(
    entry: ZaloWebRuntimeEntry,
    method: string,
    params: any
  ): Promise<void> {
    if (this.entries.get(entry.accountId) !== entry) return
    if (method === 'Network.requestWillBeSent') {
      this.captureBootstrapRequest(entry, params)
      return
    }
    if (method === 'Network.responseReceived') {
      const pending = entry.pendingRequests.get(String(params?.requestId || ''))
      if (pending) pending.status = Number(params?.response?.status || 0)
      return
    }
    if (method === 'Network.loadingFailed') {
      const requestId = String(params?.requestId || '')
      if (!entry.pendingRequests.has(requestId)) return
      entry.pendingRequests.delete(requestId)
      this.recordError(entry, `Zalo Web bootstrap lỗi mạng: ${String(params?.errorText || 'không rõ')}`)
      return
    }
    if (method !== 'Network.loadingFinished') return

    const requestId = String(params?.requestId || '')
    const pending = entry.pendingRequests.get(requestId)
    if (!pending) return
    if (pending.status !== undefined && (pending.status < 200 || pending.status >= 300)) {
      entry.pendingRequests.delete(requestId)
      this.recordError(entry, `Zalo Web bootstrap trả HTTP ${pending.status}`)
      return
    }

    try {
      const response = await entry.wc.debugger.sendCommand('Network.getResponseBody', { requestId }) as {
        body?: string
        base64Encoded?: boolean
      }
      const body = decodeCdpBody(String(response?.body || ''), response?.base64Encoded === true)
      if (!body) throw new Error(`Zalo Web ${pending.kind} không có response body`)
      this.captureBootstrapResponse(entry, pending, body)
    } finally {
      if (entry.pendingRequests.get(requestId) === pending) {
        entry.pendingRequests.delete(requestId)
      }
    }
  }

  private captureBootstrapRequest(entry: ZaloWebRuntimeEntry, params: any): void {
    const requestId = String(params?.requestId || '')
    const requestUrl = String(params?.request?.url || '')
    if (!requestId || !requestUrl) return

    let url: URL
    try {
      url = new URL(requestUrl)
    } catch {
      return
    }
    if (url.hostname.toLowerCase() !== 'wpa.chat.zalo.me') return

    const pathname = url.pathname.toLowerCase()
    const kind: BootstrapRequestKind | null = pathname === GET_LOGIN_INFO_PATH
      ? 'login-info'
      : pathname === GET_SERVER_INFO_PATH
        ? 'server-info'
        : null
    if (!kind) return

    const loaderId = String(params?.loaderId || params?.frameId || 'bootstrap')
    const existingRequest = entry.pendingRequests.get(requestId)
    if (existingRequest?.kind === kind && existingRequest.loaderId === loaderId) return

    let candidate = entry.candidates.get(loaderId)
    const candidateAlreadyHasKind = kind === 'login-info'
      ? !!candidate?.loginInfo
      : !!candidate?.serverInfo
    const sameKindRequestPending = Array.from(entry.pendingRequests.values()).some(request => (
      request.loaderId === loaderId && request.kind === kind
    ))
    if (!candidate || candidateAlreadyHasKind || sameKindRequestPending) {
      // Zalo is an SPA, so a logout/login can reuse the same loaderId. A second
      // request of either bootstrap kind starts a new candidate; never combine
      // loginInfo from one request pair with serverInfo/imei from another.
      //
      // Do not invalidate the current verified API here. Zalo Web can refresh
      // only one bootstrap endpoint during a normal logged-in session. Waiting
      // for the other endpoint would then time out and incorrectly report that
      // the account had logged out. The current API is replaced atomically only
      // after a complete candidate has been captured below.
      candidate = { loaderId }
      entry.pendingRequests.clear()
      entry.candidates.clear()
      entry.candidates.set(loaderId, candidate)
    }
    entry.pendingRequests.set(requestId, { kind, loaderId, url: requestUrl, candidate })
  }

  private captureBootstrapResponse(
    entry: ZaloWebRuntimeEntry,
    pending: PendingBootstrapRequest,
    body: string
  ): void {
    const candidate = entry.candidates.get(pending.loaderId)
    // getResponseBody is asynchronous. A same-kind retry may start a new SPA
    // generation while an older response body is still being read; never let
    // that stale response populate the replacement candidate.
    if (!candidate || candidate !== pending.candidate) return
    const url = new URL(pending.url)
    const response = JSON.parse(body) as unknown
    const responseRecord = asRecord(response)
    if (!responseRecord) throw new Error(`Zalo Web ${pending.kind} trả dữ liệu không hợp lệ`)

    if (pending.kind === 'login-info') {
      const zcid = requiredString(url.searchParams.get('zcid'), 'zcid')
      const zcidExt = requiredString(url.searchParams.get('zcid_ext'), 'zcid_ext')
      const encryptedData = requiredString(responseRecord.data, 'getLoginInfo.data')
      const decoded = decryptLoginResponse(encryptedData, deriveLoginResponseKey(zcid, zcidExt))
      const decodedRecord = asRecord(decoded)
      const loginInfo = normalizeLoginInfo(decodedRecord?.data)
      const activeUid = entry.bootstrap?.loginInfo.uid
      candidate.loginInfo = loginInfo
      if (activeUid && activeUid !== loginInfo.uid) {
        // A different UID is a confirmed account switch, not a harmless
        // one-endpoint refresh. Fence the old API immediately while the other
        // half of the new bootstrap is still being captured.
        this.resetCapturedRuntime(entry, 'Tài khoản Zalo Web đang được chuyển đổi')
      }
    } else {
      candidate.imei = requiredString(url.searchParams.get('imei'), 'imei')
      candidate.apiType = positiveInteger(
        url.searchParams.get('zpw_type') || url.searchParams.get('type'),
        'zpw_type'
      )
      candidate.apiVersion = positiveInteger(
        url.searchParams.get('zpw_ver') || url.searchParams.get('client_version'),
        'zpw_ver'
      )
      candidate.serverInfo = normalizeServerInfo(responseRecord.data)
    }
    this.promoteCandidate(entry, candidate)
  }

  private promoteCandidate(entry: ZaloWebRuntimeEntry, candidate: BootstrapCandidate): void {
    if (
      !candidate.loginInfo
      || !candidate.serverInfo
      || !candidate.imei
      || !candidate.apiType
      || !candidate.apiVersion
    ) {
      return
    }
    entry.candidates.delete(candidate.loaderId)
    this.advanceCaptureGeneration(entry)
    entry.bootstrap = {
      loaderId: candidate.loaderId,
      loginInfo: candidate.loginInfo,
      serverInfo: candidate.serverInfo,
      imei: candidate.imei,
      apiType: candidate.apiType,
      apiVersion: candidate.apiVersion,
      capturedAt: Date.now()
    }
    entry.api = undefined
    entry.apiBuild = undefined
    entry.verified = false
    entry.lastError = undefined
    this.notifyChange(entry)
    void this.verifyPromotedBootstrap(entry, entry.captureVersion)
  }

  private async verifyPromotedBootstrap(
    entry: ZaloWebRuntimeEntry,
    captureVersion: number
  ): Promise<void> {
    const retryDelaysMs = [0, 1_000, 3_000, 10_000]
    for (const delayMs of retryDelaysMs) {
      if (
        this.entries.get(entry.accountId) !== entry
        || entry.wc.isDestroyed()
        || entry.captureVersion !== captureVersion
      ) {
        return
      }
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
        if (
          this.entries.get(entry.accountId) !== entry
          || entry.wc.isDestroyed()
          || entry.captureVersion !== captureVersion
        ) {
          return
        }
      }

      try {
        const api = await this.ensureApi(entry.accountId)
        if (!this.isCurrentApi(entry.accountId, api) || entry.captureVersion !== captureVersion) return
        return
      } catch (error) {
        if (
          this.entries.get(entry.accountId) !== entry
          || entry.wc.isDestroyed()
          || entry.captureVersion !== captureVersion
        ) {
          return
        }
        this.recordError(entry, error)
      }
    }
  }

  private async buildAndVerifyApi(accountId: number, entry: ZaloWebRuntimeEntry): Promise<API> {
    const bootstrap = await this.waitForBootstrap(accountId, entry)
    const captureVersion = entry.captureVersion
    const generationSignal = entry.generationAbortController.signal
    const assertGenerationCurrent = (): void => {
      if (
        this.entries.get(accountId) !== entry
        || entry.wc.isDestroyed()
        || entry.captureVersion !== captureVersion
        || entry.bootstrap !== bootstrap
      ) {
        throw new Error('Phiên Zalo Web đã thay đổi; tác vụ cũ đã bị chặn')
      }
    }
    const cookieBridge = new ElectronSessionCookieBridge(
      entry.wc.session,
      assertGenerationCurrent
    )
    await cookieBridge.refreshSnapshot()

    const settings = bootstrap.serverInfo.setttings || bootstrap.serverInfo.settings
    if (!settings) throw new Error('Zalo Web bootstrap thiếu settings')
    const callbacks = new Map<string, (data: unknown) => unknown>()
    const context = {
      API_TYPE: bootstrap.apiType,
      API_VERSION: bootstrap.apiVersion,
      uploadCallbacks: callbacks,
      options: {
        selfListen: false,
        checkUpdate: false,
        logging: false,
        apiType: bootstrap.apiType,
        apiVersion: bootstrap.apiVersion,
        // Bind every request made by this API instance to the exact bootstrap
        // generation that created it. A visible logout/login can replace the
        // Electron partition cookies while an old campaign still holds this
        // API object; without this fence that stale object could issue its next
        // request with the newly logged-in identity's cookies.
        polyfill: this.createSessionFetch(
          entry,
          captureVersion,
          bootstrap,
          generationSignal
        ),
        imageMetadataGetter: this.imageMetadataGetter
      },
      secretKey: bootstrap.loginInfo.zpw_enk,
      uid: bootstrap.loginInfo.uid,
      imei: bootstrap.imei,
      cookie: cookieBridge,
      userAgent: entry.wc.getUserAgent(),
      language: typeof bootstrap.loginInfo.language === 'string'
        ? bootstrap.loginInfo.language
        : 'vi',
      zpwServiceMap: bootstrap.loginInfo.zpw_service_map_v3,
      settings,
      extraVer: bootstrap.serverInfo.extra_ver || {},
      loginInfo: bootstrap.loginInfo
    } as unknown as ContextSession

    const api = new API(
      context,
      bootstrap.loginInfo.zpw_service_map_v3,
      bootstrap.loginInfo.zpw_ws
    )
    // Realtime is intentionally outside this phase. Fail loudly if a caller
    // accidentally tries to open zca-js' duplicate WebSocket.
    api.listener.start = (() => {
      throw new Error('Zalo Web chưa hỗ trợ realtime; không được mở listener zca-js')
    }) as typeof api.listener.start

    const accountInfo = await api.fetchAccountInfo()
    const profile = asRecord(accountInfo?.profile)
    if (!profile) throw new Error('Không xác thực được phiên Zalo Web')
    const profileUid = String(profile.userId || profile.uid || '').trim()
    if (profileUid && profileUid !== bootstrap.loginInfo.uid) {
      throw new Error('Phiên Zalo Web không khớp tài khoản bootstrap')
    }

    if (
      this.entries.get(accountId) !== entry
      || entry.wc.isDestroyed()
      || entry.captureVersion !== captureVersion
    ) {
      throw new Error('Phiên Zalo Web đã thay đổi trong lúc xác thực; vui lòng thử lại')
    }
    // Do not expose the API to campaigns/scans until the same generation's
    // public identity has been persisted. This prevents a newly logged-in web
    // identity from running while auto_accounts still points at the previous
    // Zalo identity (for example when a campaign currently owns the account).
    entry.api = api
    entry.verified = false
    entry.lastError = undefined
    this.notifyChange(entry)
    await this.onVerified?.(accountId, api, accountInfo)
    if (
      this.entries.get(accountId) !== entry
      || entry.wc.isDestroyed()
      || entry.captureVersion !== captureVersion
      || entry.api !== api
    ) {
      throw new Error('Phiên Zalo Web đã thay đổi trước khi hoàn tất đồng bộ tài khoản')
    }
    entry.verified = true
    this.notifyChange(entry)
    return api
  }

  private createSessionFetch(
    entry: ZaloWebRuntimeEntry,
    captureVersion: number,
    bootstrap: CapturedBootstrap,
    generationSignal: AbortSignal
  ): typeof fetch {
    return (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ): Promise<Response> => {
      const assertGenerationCurrent = (): void => {
        if (
          generationSignal.aborted
          || this.entries.get(entry.accountId) !== entry
          || entry.wc.isDestroyed()
          || entry.captureVersion !== captureVersion
          || entry.bootstrap !== bootstrap
        ) {
          throw new Error('Phiên Zalo Web đã thay đổi; tác vụ cũ đã bị chặn')
        }
      }
      assertGenerationCurrent()
      const source = (init || {}) as RequestInit & { agent?: unknown }
      const headers = new Headers(source.headers)
      const body = Buffer.isBuffer(source.body)
        ? new Uint8Array(source.body)
        : source.body
      const requestAbortController = new AbortController()
      const abortRequest = (): void => requestAbortController.abort()
      const callerSignal = source.signal || null
      generationSignal.addEventListener('abort', abortRequest, { once: true })
      callerSignal?.addEventListener('abort', abortRequest, { once: true })
      if (generationSignal.aborted || callerSignal?.aborted) abortRequest()
      const requestInit: RequestInit = {
        ...source,
        headers,
        body,
        credentials: 'include',
        signal: requestAbortController.signal
      }
      delete (requestInit as RequestInit & { agent?: unknown }).agent
      const target = input instanceof URL ? input.toString() : input
      try {
        const response = await entry.wc.session.fetch(target as string | Request, requestInit)
        // Aborting the underlying request is the primary fence against a stale
        // Set-Cookie response. Re-check after resolution as well so no caller
        // can consume an old identity's response if the switch won the race.
        assertGenerationCurrent()
        return response
      } finally {
        generationSignal.removeEventListener('abort', abortRequest)
        callerSignal?.removeEventListener('abort', abortRequest)
      }
    }) as typeof fetch
  }

  private async waitForBootstrap(
    accountId: number,
    entry: ZaloWebRuntimeEntry
  ): Promise<CapturedBootstrap> {
    const deadline = Date.now() + this.captureTimeoutMs
    while (true) {
      if (this.entries.get(accountId) !== entry || entry.wc.isDestroyed()) {
        throw new Error('Tab Zalo Web đã đóng trong lúc chờ session')
      }
      if (entry.bootstrap) return entry.bootstrap

      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        const suffix = entry.lastError ? `: ${entry.lastError}` : ''
        throw new Error(`Chưa lấy được session Zalo Web; hãy tải lại tab sau khi đăng nhập${suffix}`)
      }
      const signal = entry.signal.promise
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        signal,
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, remaining)
        })
      ])
      if (timer) clearTimeout(timer)
    }
  }

  private resetCapturedRuntime(entry: ZaloWebRuntimeEntry, error?: string): void {
    this.advanceCaptureGeneration(entry)
    entry.bootstrap = undefined
    entry.api = undefined
    entry.apiBuild = undefined
    entry.verified = false
    entry.lastError = error
    this.notifyChange(entry)
  }

  private advanceCaptureGeneration(entry: ZaloWebRuntimeEntry): void {
    entry.generationAbortController.abort()
    entry.generationAbortController = new AbortController()
    entry.captureVersion += 1
  }

  private recordError(entry: ZaloWebRuntimeEntry, error: unknown): void {
    entry.lastError = this.errorMessage(error)
    this.notifyChange(entry)
  }

  private notifyChange(entry: ZaloWebRuntimeEntry): void {
    const previous = entry.signal
    entry.signal = createChangeSignal()
    previous.resolve()
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
