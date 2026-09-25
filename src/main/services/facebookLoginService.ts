import { app, session, webContents, type BrowserWindow, type WebContents, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  FACEBOOK_LOGIN_IPC, parseFacebookText, validateFacebookInput, normalizeFacebookUid, normalizeTwoFactorSecret,
  parseFacebookCookie, isFacebookHost, type FacebookImportInput, type FacebookImportState, type FacebookLoginInput,
  type FacebookLoginMetadata, type FacebookCredentialUpdate, type FacebookSecret, type FacebookSessionObservation
} from '../../shared/facebookLogin'
import { IPC_EVENTS, type AutoAccount, type AutoProxy } from '../../shared/types'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser } from '../data/currentUser'
import { facebookRpc, FacebookDataError } from '../data/repositories/facebookLoginRepository'
import * as accountRepo from '../data/repositories/accountRepository'
import { getProxy } from '../data/repositories/proxyRepository'
import { type WebviewRegistry } from '../playwright/webviewController'
import { type ProxyRuntimeService } from './proxyRuntimeService'
import { FacebookLoginJournal } from './facebookLoginJournal'
import { FacebookStartupBrowser } from './facebookStartupBrowser'
import { accountOperationRegistry, type AccountOperationContext } from './accountOperationRegistry'
import { withRequestDeadline } from './requestDeadline'
import { FacebookLoginSession, inspectFacebookSession, loadFacebookHome, readFacebookCookies, authFingerprint, writeFacebookCookies, trustedFacebookUrl } from './facebookLoginSession'

type Created = { accountId: number; state: string; revision: number; skipped?: boolean }
type SecretResult = { secret: FacebookSecret; revision: number }
const MAX_BACKGROUND_RECOVERY_ATTEMPTS = 5
type SessionSnapshot = { fingerprint: string; observation: FacebookSessionObservation }
export class FacebookLoginService {
  private journal: FacebookLoginJournal | null = null
  private lifecycle = new AbortController()
  private activeStaffId: number | null = null
  private batch: FacebookImportState | null = null
  private inputs: Array<FacebookLoginInput | null> = []
  private options: Pick<FacebookImportInput, 'accountGroupId' | 'proxyId'> = {}
  private batchAbort: AbortController | null = null
  private batchWork: Promise<void> | null = null
  private startupWork: Promise<void> | null = null
  private startupBrowsers = new Map<number, FacebookStartupBrowser>()
  private startupFinished = new Set<number>()
  private recoveryWork: Promise<void> | null = null
  private recoveryBackoff = new Map<number, { token: string; failures: number; nextAt: number; backgroundAttempts: number }>()
  private active = new Map<number, { abort: AbortController; work: Promise<void> }>()
  private observations = new Map<number, Promise<boolean>>()
  private revisions = new Map<number, number>()
  private fingerprints = new Map<number, string>()
  private verifiedSessions = new Map<number, SessionSnapshot>()
  private watchedPages = new Map<number, { wc: WebContents; detach: () => void }>()
  private pageVersions = new Map<number, number>()
  private watchers = new Map<number, () => void>()
  private previewGeneration = 0
  private promotedSessions = new Map<number, Session>()
  constructor(private readonly window: BrowserWindow, private readonly registry: WebviewRegistry,
    private readonly proxyRuntime: ProxyRuntimeService) {}

  private get log(): FacebookLoginJournal { return this.journal ||= new FacebookLoginJournal() }
  private check(): number {
    const user = requireCurrentUser()
    if (this.lifecycle.signal.aborted || this.activeStaffId !== user.staffId) throw new Error('Phiên đăng nhập Facebook chưa sẵn sàng hoặc đã kết thúc.')
    return user.staffId
  }
  private fence(): () => void {
    const staffId = this.check(), credentials = getCurrentUserCredentials(), signal = this.lifecycle.signal
    return () => {
      signal.throwIfAborted()
      if (getCurrentUser()?.staffId !== staffId || getCurrentUserCredentials() !== credentials) throw new Error('Phiên akaAgent đã thay đổi.')
    }
  }
  private async read<T>(request: (signal: AbortSignal) => PromiseLike<T>, signal = this.lifecycle.signal): Promise<T> {
    const guard = this.fence()
    const value = await withRequestDeadline(AbortSignal.any([this.lifecycle.signal, signal]), request)
    guard()
    return value
  }
  private async applyProxy(partition: string, proxyId: number | null | undefined, signal: AbortSignal): Promise<AutoProxy | null> {
    const guard = this.fence()
    const proxy = proxyId ? await this.read(readSignal => getProxy(proxyId, readSignal), signal) : null
    // Only abandon the read. A late proxy lookup must never change a partition
    // after cancellation, while an apply already started must finish draining.
    guard(); signal.throwIfAborted()
    await this.proxyRuntime.applyProxyToPartition(partition, proxy)
    guard(); signal.throwIfAborted()
    return proxy
  }
  private async recoverHeldOperation(context: AccountOperationContext, signal: AbortSignal, background = false): Promise<boolean> {
    const guard = this.fence()
    if (background) {
      const previous = this.recoveryBackoff.get(context.accountId)
      const state = previous?.token === context.claimToken ? previous : undefined
      this.recoveryBackoff.set(context.accountId, { token: context.claimToken,
        failures: state?.failures ?? 0, nextAt: state?.nextAt ?? 0,
        backgroundAttempts: (state?.backgroundAttempts ?? 0) + 1 })
    }
    const recovered = await accountOperationRegistry.recoverOperation(context, signal)
    guard(); signal.throwIfAborted()
    if (recovered) {
      this.recoveryBackoff.delete(context.accountId)
      this.changed()
    } else {
      const previous = this.recoveryBackoff.get(context.accountId)
      const failures = previous?.token === context.claimToken ? Math.min(previous.failures + 1, 5) : 1
      this.recoveryBackoff.set(context.accountId, { token: context.claimToken, failures,
        backgroundAttempts: previous?.token === context.claimToken ? previous.backgroundAttempts : 0,
        nextAt: Date.now() + Math.min(300_000, 30_000 * 2 ** (failures - 1)) })
    }
    return recovered
  }
  /** Existing poller: one cleanup per tick, at most five attempts per token/session. */
  recoverPending(): void {
    if (this.recoveryWork || this.lifecycle.signal.aborted || !this.activeStaffId || getCurrentUser()?.staffId !== this.activeStaffId) return
    const candidates = accountOperationRegistry.listRecoverable(this.activeStaffId, 'facebook.login')
      .filter(context => context.platform === 'facebook' && context.runtimeTarget === 'desktop' && !this.active.has(context.accountId))
    const dueAt = (context: AccountOperationContext): number => {
      const state = this.recoveryBackoff.get(context.accountId)
      if (state?.token !== context.claimToken) return 0
      return state.backgroundAttempts >= MAX_BACKGROUND_RECOVERY_ATTEMPTS ? Infinity : state.nextAt
    }
    const context = candidates.filter(item => dueAt(item) <= Date.now()).sort((a, b) => dueAt(a) - dueAt(b))[0]
    if (!context) return
    this.recoveryWork = this.recoverHeldOperation(context, this.lifecycle.signal, true).then(() => {}).catch(() => {})
      .finally(() => { this.recoveryWork = null })
  }
  private emit(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(FACEBOOK_LOGIN_IPC.progress, this.batch)
  }
  private changed(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
  }
  state(): FacebookImportState | null { this.check(); return this.batch }
  async preview(input: FacebookImportInput): Promise<FacebookImportState> {
    const guard = this.fence(), generation = ++this.previewGeneration
    if (this.batchWork) throw new Error('Lượt import đang chạy. Hãy dừng trước khi thay danh sách.')
    if (!input || typeof input !== 'object') throw new Error('Danh sách không hợp lệ.')
    for (const id of [input.accountGroupId, input.proxyId]) if (id != null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Nhóm hoặc proxy không hợp lệ.')
    const raw = input.rows ?? parseFacebookText(String(input.text || ''))
    if (!Array.isArray(raw) || !raw.length || raw.length > 5000) throw new Error('Cần nhập từ 1 đến 5.000 dòng để kiểm tra.')
    const inputs: Array<FacebookLoginInput | null> = []
    const seen = new Set<string>()
    const rows: FacebookImportState['rows'] = raw.map((value, index) => {
      try {
        const row = validateFacebookInput(value)
        if (seen.has(row.uid)) { inputs.push(null); return { index, uid: row.uid, status: 'skipped', message: 'Trùng UID trong danh sách nhập.' } }
        seen.add(row.uid); inputs.push(row)
        return { index, uid: row.uid, status: 'ready', message: 'Sẵn sàng' }
      } catch (error) { inputs.push(null); return { index, uid: /^\d{1,24}$/.test(String(value?.uid)) ? String(value.uid) : '', status: 'invalid', message: error instanceof Error ? error.message : 'Dòng không hợp lệ.' } }
    })
    const result = await facebookRpc<{ limit: number; duplicates: string[] }>('preview', { uids: [...seen] })
    guard()
    if (generation !== this.previewGeneration) throw new Error('Danh sách nhập đã thay đổi.')
    for (const row of rows) if (row.status === 'ready' && result.duplicates.includes(row.uid)) {
      row.status = 'skipped'; row.message = 'UID đã có trong tài khoản Facebook chưa xóa.'; inputs[row.index] = null
    }
    this.inputs = inputs; this.options = { accountGroupId: input.accountGroupId, proxyId: input.proxyId }
    this.batch = { id: randomUUID(), running: false, limit: result.limit, rows }
    this.emit(); return this.batch
  }
  async start(id: string): Promise<FacebookImportState> {
    const guard = this.fence()
    if (this.batchWork || !this.batch || this.batch.id !== id) throw new Error('Danh sách đã thay đổi hoặc đang chạy.')
    const ready = this.batch.rows.filter(row => row.status === 'ready')
    if (!ready.length) throw new Error('Không còn dòng hợp lệ để nhập.')
    const fresh = await facebookRpc<{ limit: number; duplicates: string[] }>('preview', { uids: ready.map(row => row.uid) })
    guard()
    if (this.batchWork || this.batch?.id !== id) throw new Error('Danh sách đã thay đổi hoặc đang chạy.')
    for (const row of ready) if (fresh.duplicates.includes(row.uid)) { row.status = 'skipped'; row.message = 'UID vừa được tạo ở lượt import khác.'; this.inputs[row.index] = null }
    const count = ready.filter(row => row.status === 'ready').length
    this.batch.limit = fresh.limit
    if (count > fresh.limit) { this.emit(); throw new Error(`Có ${count} tài khoản hợp lệ; tối đa ${fresh.limit} tài khoản mỗi lượt.`) }
    if (!count) { this.emit(); throw new Error('Tất cả UID đã tồn tại.') }
    this.batch.running = true; this.batchAbort = new AbortController()
    const signal = AbortSignal.any([this.lifecycle.signal, this.batchAbort.signal])
    this.batchWork = this.runBatch(count, signal).finally(() => {
      this.inputs = []; this.batchWork = null; this.batchAbort = null
      if (this.batch) this.batch.running = false
      this.emit()
    })
    this.emit(); return this.batch
  }
  async stopBatch(): Promise<void> { this.batchAbort?.abort(); await this.batchWork }
  private async runBatch(count: number, signal: AbortSignal): Promise<void> {
    const staffId = this.check(), guard = this.fence()
    for (const row of this.batch!.rows) {
      if (row.status !== 'ready') continue
      if (signal.aborted) { row.status = 'cancelled'; row.message = 'Đã dừng'; continue }
      row.status = 'running'; row.message = 'Đang đăng nhập và xác minh…'; this.emit()
      const requestId = randomUUID()
      let browser: FacebookLoginSession | null = null
      try {
        guard()
        const input = this.inputs[row.index]!
        const attempt = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        browser = new FacebookLoginSession(attempt)
        const proxy = await this.applyProxy(browser.partition, this.options.proxyId, attempt)
        const secret: FacebookSecret = { uid: input.uid, password: input.password, twoFactorSecret: input.twoFactorSecret,
          cookies: input.cookie ? parseFacebookCookie(input.cookie, input.uid) : [] }
        const observation = await browser.login(secret, proxy, true, message => {
          guard(); attempt.throwIfAborted()
          row.message = message; this.emit()
        })
        if (observation.uid !== input.uid) throw new Error('Phiên import không khớp UID đã nhập.')
        guard(); attempt.throwIfAborted()
        secret.cookies = await readFacebookCookies(browser.ses)
        this.log.put({ staffId, requestId })
        const commitInput = { requestId, batchSize: count, secret, name: observation.name || input.uid, ...this.options }
        const created = await facebookRpc<Created>('reserve', commitInput)
        if (created.skipped) { row.status = 'skipped'; row.message = 'UID vừa được tạo ở lượt import khác.'; this.log.remove(requestId); continue }
        this.log.put({ staffId, requestId, accountId: created.accountId })
        guard(); attempt.throwIfAborted()
        const accountId = created.accountId
        const persistentSession = session.fromPartition(`persist:account_${accountId}`)
        this.promotedSessions.set(accountId, persistentSession)
        this.log.put({ staffId, requestId, accountId, profilePath: persistentSession.storagePath || undefined })
        const promotedProxy = await this.applyProxy(`persist:account_${accountId}`, this.options.proxyId, attempt)
        await writeFacebookCookies(persistentSession, secret.cookies, attempt)
        const promoted = new FacebookLoginSession(attempt, `persist:account_${accountId}`)
        try {
          const verified = await promoted.observe(promotedProxy)
          if (verified.state !== 'authenticated' || verified.uid !== input.uid) throw new Error('Chưa xác minh được phiên sau khi lưu browser.')
          secret.cookies = await readFacebookCookies(promoted.ses)
        } finally { await promoted.dispose() }
        guard(); attempt.throwIfAborted()
        const finished = await facebookRpc<Created>('finish', { ...commitInput, accountId })
        if (finished.skipped) {
          await this.cleanup(requestId, staffId)
          row.status = 'skipped'; row.message = 'UID vừa được tạo ở lượt import khác.'; continue
        }
        this.log.remove(requestId)
        this.promotedSessions.delete(accountId)
        row.status = 'success'; row.message = 'Đăng nhập thành công'; row.name = commitInput.name; row.accountId = accountId
        this.watch(accountId); this.changed()
      } catch (error) {
        const reconciled = await this.cleanup(requestId, staffId).catch(() => 'pending' as const)
        if (reconciled === 'ready') { row.status = 'success'; row.message = 'Đã tạo thành công'; this.changed() }
        else { row.status = signal.aborted ? 'cancelled' : 'failed'; row.message = reconciled === 'pending'
          ? 'Đang chờ xác nhận/dọn dữ liệu. App sẽ kiểm tra lại ở lần mở sau.'
          : signal.aborted ? 'Đã dừng' : this.safeMessage(error) }
      } finally {
        this.inputs[row.index] = null
        await browser?.dispose(); this.emit()
      }
    }
  }
  private safeMessage(error: unknown): string {
    // Only our authored messages escape. Electron/SQL errors may contain request data.
    if (error instanceof FacebookDataError) return error.message
    if (error instanceof Error && error.name === 'Error' && !/ERR_|https?:|SELECT|INSERT|UPDATE|\{/.test(error.message)) return error.message.slice(0,250)
    return 'Không hoàn tất đăng nhập. Kiểm tra mạng, proxy hoặc đăng nhập thủ công.'
  }
  private async cleanup(requestId: string, staffId: number): Promise<'removed' | 'ready' | 'pending'> {
    const known = this.log.pending(staffId).find(entry => entry.requestId === requestId)
    if (!known) return 'removed'
    const result = await facebookRpc<Created | null>('request_status', { requestId })
    if (result?.state === 'ready') { this.log.remove(requestId); this.promotedSessions.delete(result.accountId); return 'ready' }
    const accountId = result?.accountId ?? known.accountId
    if (result) {
      const removed = await facebookRpc<{ ready?: boolean }>('abort', { accountId: result.accountId, requestId })
      if (removed.ready) { this.log.remove(requestId); return 'ready' }
    }
    if (accountId) {
      const ses = this.promotedSessions.get(accountId)
      if (ses) { await ses.clearStorageData(); await ses.clearCache(); await ses.closeAllConnections() }
      const storagePath = known.profilePath || ses?.storagePath
      // Do not reopen a Chromium session on startup just to delete its directory: Windows
      // would lock it again. Only delete the exact task-owned partition recorded at promotion.
      if (storagePath) {
        const expected = resolve(app.getPath('sessionData'), 'Partitions', `account_${accountId}`)
        if (resolve(storagePath) !== expected || !expected.startsWith(resolve(app.getPath('sessionData')) + sep)) throw new Error('Đường dẫn profile không hợp lệ.')
        await rm(storagePath, { recursive: true, force: true })
      }
      this.promotedSessions.delete(accountId)
    }
    this.log.remove(requestId); return 'removed'
  }
  startSession(restore = true): void {
    this.lifecycle = new AbortController(); this.activeStaffId = requireCurrentUser().staffId
    for (const entry of this.registry.listRegistered()) this.watch(entry.accountId)
    if (!restore) return
    const signal = this.lifecycle.signal
    this.startupWork = this.startup(signal).catch(() => {
      // No credential-bearing errors in logs; next startup/manual command can retry.
    }).finally(() => {
      this.startupWork = null
      for (const browser of this.startupBrowsers.values()) browser.dispose()
      this.startupBrowsers.clear(); this.startupFinished.clear()
    })
  }
  /** Called before the renderer is allowed to mount its initial account tab. */
  async prepareStartupBrowser(accountId: number): Promise<void> {
    if (!this.startupWork || this.startupFinished.has(accountId)) return
    if (this.visible(accountId)) {
      // Preparing an already mounted tab is an explicit reload, not initial mount.
      this.cancelStartupBrowser(accountId)
      return
    }
    const guard = this.fence()
    const active = this.active.get(accountId)
    if (active) {
      // Startup won the race. Its producer must finish before a new tab can load.
      await withRequestDeadline(this.lifecycle.signal, () => active.work.catch(() => {}), 120_000)
      guard()
      return
    }
    // Browser preparation won. Startup will await only this tab's first load,
    // before claiming the account or reading its saved Facebook credentials.
    if (!this.startupBrowsers.has(accountId)) this.startupBrowsers.set(accountId, new FacebookStartupBrowser())
  }
  startupBrowserRegistered(accountId: number, page: WebContents): void {
    this.startupBrowsers.get(accountId)?.attach(page)
  }
  cancelStartupBrowser(accountId: number): void {
    this.startupBrowsers.get(accountId)?.cancel()
  }
  private async restoreAtStartup(accountId: number, signal: AbortSignal): Promise<void> {
    try {
      const visible = this.visible(accountId)
      let browser = this.startupBrowsers.get(accountId)
      if (!browser && visible?.isLoadingMainFrame()) {
        browser = new FacebookStartupBrowser()
        this.startupBrowsers.set(accountId, browser)
      }
      if (browser) {
        if (visible) browser.attach(visible)
        await browser.wait(signal)
      }
      signal.throwIfAborted()
      await this.restore(accountId)
    } catch {
      // Failure stays isolated to this account; no background password retry.
    } finally {
      this.startupFinished.add(accountId)
      this.startupBrowsers.get(accountId)?.dispose()
      this.startupBrowsers.delete(accountId)
    }
  }
  private async startup(signal: AbortSignal): Promise<void> {
    const staffId = this.check()
    const remote = await this.read(() => facebookRpc<Array<{ accountId: number; requestId: string }>>('pending'), signal).catch(() => {
      // Discovery is independent of restoring already-created accounts. Keep local
      // reservations and retry remote discovery on the next startup.
      signal.throwIfAborted()
      return []
    })
    signal.throwIfAborted()
    for (const entry of remote) this.log.put({ ...entry, staffId })
    for (const entry of this.log.pending(staffId)) {
      signal.throwIfAborted()
      try { await this.cleanup(entry.requestId, staffId) } catch {
        // Keep the journal entry for next startup; one locked profile must not block other accounts.
        signal.throwIfAborted()
      }
    }
    const pendingAccounts = new Set(this.log.pending(staffId).map(entry => entry.accountId))
    const accounts = await this.read(() => accountRepo.listAccounts(), signal)
    for (const account of accounts) {
      signal.throwIfAborted()
      if (account.flatformType !== 'facebook' || pendingAccounts.has(account.id)) continue
      this.watch(account.id)
      if (account.facebookLoginManaged && account.isActive && account.status !== 'đang chạy') await this.restoreAtStartup(account.id, signal)
    }
  }
  async stop(): Promise<void> {
    this.lifecycle.abort(); this.batchAbort?.abort(); this.activeStaffId = null; this.previewGeneration++
    for (const stop of this.watchers.values()) stop()
    this.watchers.clear()
    for (const page of this.watchedPages.values()) page.detach()
    this.watchedPages.clear()
    await Promise.allSettled([this.batchWork, this.startupWork, this.recoveryWork, ...[...this.active.values()].map(item => item.work), ...this.observations.values()].filter(Boolean))
    this.inputs = []; this.batch = null; this.revisions.clear(); this.fingerprints.clear(); this.recoveryBackoff.clear()
    this.verifiedSessions.clear(); this.pageVersions.clear()
  }
  watch(accountId: number): void {
    if (this.watchers.has(accountId) || !this.activeStaffId || this.lifecycle.signal.aborted) return
    const staffId = this.activeStaffId, ses = session.fromPartition(`persist:account_${accountId}`)
    let lastUid: string | undefined
    void readFacebookCookies(ses).then(cookies => { lastUid ??= cookies.find(cookie => cookie.name === 'c_user')?.value }).catch(() => {})
    const changed = (_event: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean): void => {
      if (['c_user', 'xs'].includes(cookie.name) && isFacebookHost((cookie.domain || '').replace(/^\./,''))) this.verifiedSessions.delete(accountId)
      if (cookie.name !== 'c_user' || removed || !cookie.value || !isFacebookHost((cookie.domain || '').replace(/^\./,''))) return
      if (cookie.value === lastUid) return
      lastUid = cookie.value
      // Mark before an asynchronous HTTP/DB check. A crash cannot restore an older cloud identity.
      try { this.log.mark(staffId, accountId, true) } catch { this.active.get(accountId)?.abort.abort() }
    }
    ses.cookies.on('changed', changed)
    this.watchers.set(accountId, () => ses.cookies.removeListener('changed', changed))
  }
  private visible(accountId: number): WebContents | null {
    const id = this.registry.getWebContentsId(accountId)
    const wc = id ? webContents.fromId(id) : null
    return wc && !wc.isDestroyed() ? wc : null
  }
  private watchPage(accountId: number, wc: WebContents): void {
    if (this.watchedPages.get(accountId)?.wc === wc) return
    this.watchedPages.get(accountId)?.detach()
    const invalidate = (): void => {
      this.verifiedSessions.delete(accountId)
      this.pageVersions.set(accountId, (this.pageVersions.get(accountId) || 0) + 1)
    }
    invalidate()
    const navigation = (_event: Electron.Event, url: string, isInPlace: boolean, isMainFrame: boolean): void => {
      if (!isMainFrame) return
      const authenticationRoute = trustedFacebookUrl(url)
        && /^\/(?:login|checkpoint|challenge|two_factor|two_step_verification|recover|confirmemail)(?:[/.]|$)/.test(new URL(url).pathname)
      if (!isInPlace || authenticationRoute) invalidate()
    }
    wc.on('did-start-navigation', navigation)
    this.watchedPages.set(accountId, { wc, detach: () => wc.removeListener('did-start-navigation', navigation) })
  }
  private async inspect(accountId: number, ses: Session, signal: AbortSignal, force = false): Promise<SessionSnapshot> {
    const fingerprint = authFingerprint(await readFacebookCookies(ses)), version = this.pageVersions.get(accountId)
    signal.throwIfAborted()
    const cached = this.verifiedSessions.get(accountId)
    if (!force && cached?.fingerprint === fingerprint && cached.observation.state !== 'unknown') return cached
    const observation = await inspectFacebookSession(ses, signal, this.proxyRuntime.getSessionProxyAuthentication(ses))
    signal.throwIfAborted()
    if (version !== this.pageVersions.get(accountId) || fingerprint !== authFingerprint(await readFacebookCookies(ses)))
      return { fingerprint, observation: { state: 'unknown' } }
    const snapshot = { fingerprint, observation }
    this.verifiedSessions.set(accountId, snapshot)
    return snapshot
  }
  async observe(account: AutoAccount, wc: WebContents | null, force = false): Promise<boolean> {
    if (account.flatformType !== 'facebook' || this.activeStaffId !== account.staffId || this.lifecycle.signal.aborted) return false
    // Restoration owns observation until the visible page has loaded the promoted session.
    if (this.active.has(account.id)) return false
    if (wc) {
      this.watchPage(account.id, wc)
      if (wc.isDestroyed() || wc.isLoadingMainFrame()) return false
    }
    const existing = this.observations.get(account.id)
    if (existing) return existing
    const work = this.observeInner(account, wc?.session || session.fromPartition(`persist:account_${account.id}`), undefined, force)
      .finally(() => this.observations.delete(account.id))
    this.observations.set(account.id, work); return work
  }
  private async observeInner(account: AutoAccount, ses: Session, provided?: SessionSnapshot, force = false): Promise<boolean> {
    const guard = this.fence(), staffId = this.check()
    this.watch(account.id)
    const snapshot = provided || await this.inspect(account.id, ses, this.lifecycle.signal, force)
    const { observation } = snapshot
    if (observation.state === 'unknown') return false
    const currentCookies = await readFacebookCookies(ses)
    if (snapshot.fingerprint !== authFingerprint(currentCookies)) return false
    this.verifiedSessions.set(account.id, snapshot)
    const cookies = observation.state === 'authenticated' ? currentCookies : []
    if (observation.state === 'authenticated' && cookies.find(c => c.name === 'c_user')?.value !== observation.uid) return false
    const key = `${observation.state}:${observation.uid || ''}:${observation.state === 'authenticated' ? authFingerprint(cookies) : ''}`
    if (this.fingerprints.get(account.id) === key && (!account.facebookLoginManaged || !this.log.dirty(staffId, account.id))) return false
    guard()
    if (observation.state === 'authenticated' && account.facebookLoginManaged) this.log.mark(staffId, account.id, true)
    try {
      if (account.facebookLoginManaged && !this.revisions.has(account.id)) {
        const meta = await this.metadata(account.id); this.revisions.set(account.id, meta.revision)
      }
      guard()
      const result = await facebookRpc<{ revision: number }>('observe', {
        accountId: account.id, ...observation, cookies, expectedUid: account.facebookUid ?? null, revision: this.revisions.get(account.id)
      })
      guard()
      if (snapshot.fingerprint !== authFingerprint(await readFacebookCookies(ses))) {
        this.revisions.delete(account.id); return false
      }
      this.revisions.set(account.id, result.revision); this.fingerprints.set(account.id, key)
      if (observation.state === 'authenticated' && account.facebookLoginManaged) this.log.mark(staffId, account.id, false)
      return true
    } catch (error) { this.revisions.delete(account.id); throw error }
  }
  async metadata(accountId: number): Promise<FacebookLoginMetadata> {
    return this.read(() => facebookRpc<FacebookLoginMetadata>('metadata', { accountId }))
  }
  async save(accountId: number, input: FacebookCredentialUpdate): Promise<void> {
    const guard = this.fence(), staffId = this.check()
    if (this.active.has(accountId)) throw new Error('Tài khoản đang đăng nhập lại. Hãy đợi hoàn tất.')
    const uid = normalizeFacebookUid(input.uid)
    if (!Number.isSafeInteger(input.revision) || input.revision < 1 || (input.password?.length ?? 0) > 1024) throw new Error('Thông tin đăng nhập không hợp lệ.')
    const account = await this.read(signal => accountRepo.getAccount(accountId, signal))
    guard()
    if (!account?.facebookLoginManaged) throw new Error('Tài khoản không hỗ trợ lưu đăng nhập tự động.')
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(60_000)])
    const browser = new FacebookLoginSession(signal, `persist:account_${accountId}`)
    try {
      const visible = this.visible(accountId)
      if (visible) this.watchPage(accountId, visible)
      else if (account.status !== 'đang chạy') await this.applyProxy(browser.partition, account.proxyId, signal)
      const { observation: observed, fingerprint: before } = await this.inspect(accountId, browser.ses, signal, true)
      if (observed.state !== 'authenticated' && observed.state !== 'logged_out') throw new Error('Chưa xác minh được phiên Facebook. Kiểm tra mạng hoặc đăng nhập thủ công.')
      if (observed.state === 'authenticated' && observed.uid !== uid) throw new Error('UID nhập vào khác UID đang đăng nhập trong trình duyệt.')
      guard()
      const result = await facebookRpc<{ revision: number }>('save', { accountId, uid, revision: input.revision,
        ...(input.password !== undefined ? { password: input.password } : {}),
        ...(input.twoFactorSecret !== undefined ? { twoFactorSecret: normalizeTwoFactorSecret(input.twoFactorSecret) } : {}),
        observedState: observed.state, observedUid: observed.uid })
      guard(); this.revisions.set(accountId, result.revision); this.fingerprints.delete(accountId)
      if (before === authFingerprint(await readFacebookCookies(browser.ses))) this.log.mark(staffId, accountId, false)
      else this.log.mark(staffId, accountId, true)
    } finally { await browser?.dispose() }
  }
  async restore(accountId: number): Promise<void> {
    return this.runLogin(accountId)
  }
  async login(accountId: number, input: FacebookCredentialUpdate): Promise<void> {
    const uid = normalizeFacebookUid(input?.uid)
    if (!Number.isSafeInteger(input.revision) || input.revision < 0 ||
      (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 1024)))
      throw new Error('Thông tin đăng nhập không hợp lệ.')
    return this.runLogin(accountId, { uid, revision: input.revision,
      ...(input.password !== undefined ? { password: input.password } : {}),
      ...(input.twoFactorSecret !== undefined ? { twoFactorSecret: normalizeTwoFactorSecret(input.twoFactorSecret) } : {}) })
  }
  isLoggingIn(accountId: number): boolean { return this.active.has(accountId) }
  private async runLogin(accountId: number, input?: FacebookCredentialUpdate): Promise<void> {
    this.check()
    if (this.active.has(accountId)) throw new Error('Tài khoản đang được đăng nhập lại.')
    const abort = new AbortController()
    const signal = AbortSignal.any([this.lifecycle.signal, abort.signal, AbortSignal.timeout(120_000)])
    const work = this.restoreInner(accountId, signal, input).finally(() => this.active.delete(accountId))
    this.active.set(accountId, { abort, work }); return work
  }
  private async restoreInner(accountId: number, signal: AbortSignal, input?: FacebookCredentialUpdate): Promise<void> {
    const staffId = this.check(), guard = this.fence()
    const ses = session.fromPartition(`persist:account_${accountId}`), visible = this.visible(accountId)
    let claim: Awaited<ReturnType<typeof accountRepo.claimNonZaloAccountRuntimeOperation>> | undefined
    let local: FacebookLoginSession | null = null, temporary: FacebookLoginSession | null = null
    let detach = (): void => {}
    try {
      const conflict = new AbortController(), expected = new Map<string, string>()
      const attempt = AbortSignal.any([signal, conflict.signal])
      let cookieVersion = 0, protectCookies = !!input
      const cancelForUser = (): void => conflict.abort(new Error('Phiên hoặc thao tác trình duyệt đã thay đổi. Đã dừng tự khôi phục.'))
      const onCookie = (_event: Electron.Event, cookie: Electron.Cookie, cause: string, removed: boolean): void => {
        if (!['c_user', 'xs'].includes(cookie.name) || !isFacebookHost((cookie.domain || '').replace(/^\./, ''))) return
        cookieVersion++
        // Compare cookieVersion around the initial HTTP verification. Once logout is
        // verified, protect every await through cloud lookup and our expected writes.
        if (!protectCookies) return
        if (removed && (cause === 'overwrite' || (cookie.name === 'c_user' && cause === 'expired-overwrite')) && expected.has(cookie.name)) return
        if (!removed && expected.get(cookie.name) === cookie.value) { expected.delete(cookie.name); return }
        cancelForUser()
      }
      const onNavigate = (_event: Electron.Event, _url: string, _isInPlace: boolean, isMainFrame: boolean): void => { if (isMainFrame) cancelForUser() }
      const onInput = (): void => cancelForUser()
      ses.cookies.on('changed', onCookie); visible?.on('did-start-navigation', onNavigate); visible?.on('before-input-event', onInput)
      detach = () => {
        ses.cookies.removeListener('changed', onCookie)
        if (visible && !visible.isDestroyed()) { visible.removeListener('did-start-navigation', onNavigate); visible.removeListener('before-input-event', onInput) }
      }
      const assertCurrent = (): void => {
        guard()
        // A tab mounted/replaced during an await has not been watched; leave it alone.
        if (this.visible(accountId) !== visible) cancelForUser()
        attempt.throwIfAborted()
      }
      const syncVisible = async (): Promise<void> => {
        assertCurrent()
        if (!visible) return
        // No more cookie injection follows this navigation. Keep input cancellation, but
        // do not treat our own loadURL as a user navigating away from the login page.
        visible.removeListener('did-start-navigation', onNavigate)
        await loadFacebookHome(visible, attempt)
        assertCurrent()
      }
      // Install these listeners before any read, recovery or claim can yield. Explicit
      // login must not accept a user-changed session as a new baseline after waiting.
      const held = accountOperationRegistry.listRecoverable(staffId, 'facebook.login')
        .find(context => context.accountId === accountId && context.platform === 'facebook' && context.runtimeTarget === 'desktop')
      if (held && !await this.recoverHeldOperation(held, signal)) throw new Error('Chưa giải phóng được lượt cũ. Bạn có thể bấm đăng nhập lại hoặc mở lại app khi kết nối ổn định.')
      assertCurrent()
      const account = await this.read(readSignal => accountRepo.getAccount(accountId, readSignal), attempt)
      assertCurrent()
      if (!account || account.flatformType !== 'facebook' || (!input && !account.facebookLoginManaged) || !account.isActive || account.status === 'đang chạy') throw new Error('Tài khoản đang bận, đã tắt hoặc không hỗ trợ tự khôi phục.')
      const previousStatus = account.status === 'tạm dừng' ? 'tạm dừng' : 'chờ xử lý'
      // The DB generation closes even a request that arrives after cancellation.
      // Keep the account reserved until cleanup confirms that fence.
      claim = await accountRepo.claimNonZaloAccountRuntimeOperation(accountId, 'facebook', previousStatus, false, 'facebook.login', signal, account.facebookLoginClaimGeneration)
      if (!claim.claimed || !claim.claimToken || !claim.previousStatus) throw new Error('Tài khoản đang bận. Hãy thử lại sau.')
      assertCurrent(); this.changed(); this.watch(accountId)
      if (visible) this.watchPage(accountId, visible)
      // Drain an observation that started before restoration took ownership. The poller
      // skips this account until finally/release, so an older check cannot undo success.
      await this.observations.get(accountId)
      assertCurrent()
      if (visible?.isLoadingMainFrame()) throw new Error('Trình duyệt đang tải. Tự khôi phục đã dừng để giữ thao tác của bạn.')
      local = new FacebookLoginSession(attempt, `persist:account_${accountId}`)
      const localProxy = visible ? this.proxyRuntime.getSessionProxyAuthentication(ses) : await this.applyProxy(local.partition, account.proxyId, attempt)
      assertCurrent()
      // Explicit login is allowed with any existing session. Keep it untouched while
      // authenticating in memory; only background restoration requires definite logout.
      const baseline = authFingerprint(await readFacebookCookies(ses))
      let stored: SecretResult
      if (input) {
        const meta = await this.metadata(accountId)
        assertCurrent()
        if (meta.revision !== input.revision) throw new Error('Thông tin đăng nhập vừa thay đổi. Hãy mở lại form.')
        stored = meta.revision > 0 ? await this.read(() => facebookRpc<SecretResult>('get', { accountId }), attempt)
          : { revision: 0, secret: { uid: input.uid, cookies: [] } }
        if (stored.revision !== input.revision) throw new Error('Thông tin đăng nhập vừa thay đổi. Hãy mở lại form.')
        // A different UID must never inherit another identity's password or 2FA key.
        const previous = stored.secret.uid === input.uid ? stored.secret : { uid: input.uid }
        stored.secret = { ...previous, uid: input.uid, cookies: [],
          ...(input.password !== undefined ? { password: input.password } : {}),
          ...(input.twoFactorSecret !== undefined ? { twoFactorSecret: input.twoFactorSecret } : {}) }
        if (!stored.secret.password || !stored.secret.twoFactorSecret) throw new Error('Nhập mật khẩu và khóa 2FA cho UID cần đăng nhập.')
      } else {
        const observedVersion = cookieVersion
        const observation = await local.observe(localProxy)
        assertCurrent()
        if (cookieVersion !== observedVersion) { cancelForUser(); assertCurrent() }
        const observedSnapshot = { fingerprint: baseline, observation }
        if (observation.state === 'authenticated') {
          await this.observeInner(account, ses, observedSnapshot); this.changed(); return
        }
        protectCookies = true
        if (observation.state !== 'unknown' && await this.observeInner(account, ses, observedSnapshot)) this.changed()
        assertCurrent()
        if (observation.state !== 'logged_out') throw new Error('Facebook cần xác minh hoặc chưa xác định được phiên. Hãy kiểm tra trình duyệt.')
        if (this.log.dirty(staffId, accountId)) throw new Error('Phiên đã được thay đổi thủ công nhưng chưa đồng bộ. Hãy đăng nhập thủ công hoặc cập nhật thông tin đăng nhập.')
        stored = await this.read(() => facebookRpc<SecretResult>('get', { accountId }), attempt)
      }
      assertCurrent()
      temporary = new FacebookLoginSession(attempt)
      const proxy = await this.applyProxy(temporary.partition, account.proxyId, attempt)
      assertCurrent()
      await temporary.login(stored.secret, proxy)
      assertCurrent()
      if (authFingerprint(await readFacebookCookies(ses)) !== baseline) throw new Error('Người dùng đã thay đổi phiên. Đã dừng tự khôi phục.')
      // Verify the saved credentials were not edited on another app while login was running.
      if ((await this.metadata(accountId)).revision !== stored.revision) throw new Error('Thông tin đăng nhập vừa thay đổi. Hãy thử lại.')
      const cookies = (await readFacebookCookies(temporary.ses)).map(cookie =>
        // Keep the legacy document.cookie check usable if enrollment fails after
        // promotion. c_user is the public UID; xs remains the HttpOnly secret.
        input && !account.facebookLoginManaged && cookie.name === 'c_user' ? { ...cookie, httpOnly: false } : cookie)
      assertCurrent()
      await writeFacebookCookies(ses, cookies, attempt, cookie => {
        assertCurrent()
        if (['c_user','xs'].includes(cookie.name)) expected.set(cookie.name, cookie.value)
      })
      assertCurrent()
      protectCookies = false // No more writes: verification checks its cookie fingerprint; keep watching user input/navigation.
      const promotedFingerprint = authFingerprint(await readFacebookCookies(ses))
      const promoted = await local.observe(localProxy)
      assertCurrent()
      if (promoted.state !== 'authenticated') throw new Error('Chưa xác minh được phiên khôi phục. Hãy mở trình duyệt kiểm tra.')
      if (input) {
        const verifiedCookies = await readFacebookCookies(ses)
        if (promoted.uid !== input.uid || promotedFingerprint !== authFingerprint(verifiedCookies))
          throw new Error('Phiên Facebook vừa thay đổi. Hãy kiểm tra trình duyệt.')
        assertCurrent()
        this.log.mark(staffId, accountId, true)
        const result = await facebookRpc<{ revision: number }>('login', { accountId, revision: stored.revision,
          secret: { ...stored.secret, cookies: verifiedCookies } }).catch(() => {
          assertCurrent()
          // A lost response may have committed. Do not claim the credentials were
          // definitely discarded or roll back a browser the user can already use.
          throw new Error('Đã đăng nhập Facebook, nhưng chưa xác nhận lưu thành công thông tin 2FA. Hãy mở lại form để kiểm tra và thử lại.')
        })
        assertCurrent()
        this.revisions.set(accountId, result.revision); this.fingerprints.delete(accountId)
        if (promotedFingerprint === authFingerprint(await readFacebookCookies(ses))) this.log.mark(staffId, accountId, false)
        this.changed()
        await syncVisible()
        return
      }
      await syncVisible()
      // Any authenticated UID wins, including a user switching identities during verification.
      this.revisions.set(accountId, stored.revision)
      await this.observeInner(account, ses, { fingerprint: promotedFingerprint, observation: promoted })
      this.changed()
    } finally {
      detach()
      try {
        // Temporary storage is unrelated to ownership of the persistent account.
        if (claim?.claimed && claim.claimToken && claim.previousStatus) {
          const released = await accountRepo.releaseNonZaloAccountRuntimeOperation(accountId, 'facebook', claim.previousStatus, claim.claimToken, claim.staffId)
          this.changed()
          if (!released) throw new Error('Chưa giải phóng được tài khoản sau đăng nhập. App sẽ tự kiểm tra lại; bạn có thể bấm đăng nhập lại khi kết nối ổn định.')
        }
      } finally { await temporary?.dispose(); await local?.dispose() }
    }
  }
  async checkAccount(accountId: number, page?: WebContents): Promise<{ loggedIn: boolean; status: string; reason?: string }> {
    this.check()
    const account = await this.read(signal => accountRepo.getAccount(accountId, signal))
    if (!account || account.flatformType !== 'facebook') throw new Error('Không tìm thấy tài khoản Facebook.')
    const wc = page || this.visible(accountId)
    if (!wc && !this.active.has(accountId) && account.status !== 'đang chạy')
      await this.applyProxy(`persist:account_${accountId}`, account.proxyId, this.lifecycle.signal)
    if (await this.observe(account, wc, true)) this.changed()
    const cached = this.verifiedSessions.get(accountId)
    const observation: FacebookSessionObservation = !this.active.has(accountId) && !wc?.isLoadingMainFrame()
      && cached?.fingerprint === authFingerprint(await readFacebookCookies(wc?.session || session.fromPartition(`persist:account_${accountId}`)))
      ? cached.observation : { state: 'unknown' }
    return { loggedIn: observation.state === 'authenticated', status: observation.state === 'authenticated' ? 'đã đăng nhập'
      : observation.state === 'challenge' ? 'checkpoint' : observation.state === 'logged_out' ? 'chưa đăng nhập' : account.loginStatus,
      reason: observation.state === 'unknown' ? 'Trang đang tải hoặc chưa xác minh được phiên.' : observation.message }
  }
}
