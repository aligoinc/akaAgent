import { randomUUID } from 'node:crypto'

import WebSocket from 'ws'
import { CloseReason, ThreadType, ZaloApiError } from 'zca-js'
import type { AttachmentSource, API } from 'zca-js'

import type { AutoAccount, ZaloLoginQrEvent } from '../../shared/types'
import type { SupabaseService } from './supabase'
import type {
  LocalRuntimeBindingRegistration,
  ZaloChatApiClient,
  ZaloChatBindingConflictCode
} from './zaloChatApiClient'
import { ZaloChatApiRequestError } from './zaloChatApiClient'
import type {
  ZaloListenerStatusEvent,
  ZaloRealtimeListenerHandlers,
  ZaloRuntimeService
} from './zaloRuntimeService'

const PROTOCOL_VERSION = 1
const RECONCILE_INTERVAL_MS = 15_000
const HEARTBEAT_INTERVAL_MS = 20_000
const HEARTBEAT_ACK_TIMEOUT_MS = 45_000
const WELCOME_TIMEOUT_MS = 15_000
const MAX_PENDING_EVENTS = 500
const MAX_CONTROL_RECONNECT_ATTEMPTS = 10
const MAX_UNACKNOWLEDGED_EVENT_REPLAYS = 10
const MAX_LOCAL_LISTENER_RESTART_ATTEMPTS = 10
const LOCAL_LISTENER_STABILITY_MS = 60_000
const MAX_STICKER_DETAIL_CACHE_ENTRIES = 500
const MAX_STICKER_DETAIL_LOOKUP_BATCH_SIZE = 10
const MAX_STICKER_DETAIL_PENDING_IDS = 500
const MAX_STICKER_DETAIL_PENDING_REFERENCES = 5_000
const STICKER_DETAIL_LOOKUP_TIMEOUT_MS = 15_000
const STICKER_DETAIL_NEGATIVE_CACHE_MS = 60_000
const LOCAL_LISTENER_RETRY_EXHAUSTED_MESSAGE =
  `Listener Zalo local đã dừng tự kết nối lại sau ${MAX_LOCAL_LISTENER_RESTART_ATTEMPTS} ` +
  'lần thử không thành công. Hãy thử lại thủ công.'

type PreviousZaloAccountStatus = 'chờ xử lý' | 'tạm dừng'

interface RuntimeCommand {
  protocolVersion: 1
  kind: 'zalo.command'
  actionId: string
  runtimeId: string
  autoAccountId: string
  runtimeGeneration: string
  idempotencyKey: string
  commandType: string
  payload: unknown
}

interface LocalQrCommand {
  protocolVersion: 1
  kind: 'runtime.local_qr_login.command'
  runtimeId: string
  operationId: string
  autoAccountId: string
  command: 'start' | 'cancel'
}

interface LocalQrBindingResult {
  protocolVersion: 1
  kind: 'runtime.local_qr_login.binding_result'
  runtimeId: string
  operationId: string
  autoAccountId: string
  status: 'succeeded' | 'failed'
  runtimeGeneration?: string
  expectedZaloId?: string
  errorCode?: ZaloChatBindingConflictCode
  errorMessage?: string
}

interface LocalRetryAttachCommand {
  protocolVersion: 1
  kind: 'runtime.local_account.retry_attach.command'
  runtimeId: string
  requestId: string
  autoAccountId: string
}

interface EventAck {
  protocolVersion: 1
  kind: 'zalo.event.ack'
  eventId: string
  committedAt: string
}

interface RuntimeWelcome {
  protocolVersion: 1
  kind: 'runtime.welcome'
  connectedAt: string
}

interface RuntimeHeartbeatAck {
  protocolVersion: 1
  kind: 'runtime.heartbeat_ack'
  receivedAt: string
}

interface ProtocolError {
  protocolVersion: 1
  kind: 'protocol.error'
  code: string
  message: string
  retryable: boolean
}

type IncomingMessage = RuntimeCommand | LocalQrCommand | LocalQrBindingResult |
  LocalRetryAttachCommand |
  EventAck | RuntimeWelcome | RuntimeHeartbeatAck | ProtocolError

interface RuntimeEventMessage {
  protocolVersion: 1
  kind: 'zalo.event'
  eventId: string
  runtimeId: string
  autoAccountId: string
  runtimeGeneration: string
  sequence: string
  eventType: string
  occurredAt: string
  adapterName: string
  adapterVersion: string
  payload: unknown
}

interface PendingRuntimeEvent {
  eventId: string
  autoAccountId: string
  runtimeGeneration: string
  eventType: string
  priority: 'raw' | 'synthetic'
  wire: string
  sent: boolean
  replayAttempts: number
}

interface AttachedAccount extends LocalRuntimeBindingRegistration {
  accountId: number
  unsubscribe: () => void
  initialSyncGeneration: string | null
  ready: boolean
  readyStatusVersion: number
  listenerFailureVersion: number
  listenerClosedVersion: number
}

interface BindingConflict {
  code: ZaloChatBindingConflictCode
  message: string
}

interface LocalListenerRetryState {
  runtimeGeneration: string
  failedAttempts: number
  exhausted: boolean
}

interface StickerReference {
  conversationType: 'user' | 'group'
  conversationZaloId: string
  stickerId: number
  rawCategoryZaloId: string | null
  rawTypeCode: number | null
}

interface StickerDetailMetadata {
  stickerZaloId: string
  stickerCategoryZaloId: string | null
  stickerTypeCode: number | null
  stickerText: string | null
  stickerUri: string | null
  stickerFileKey: string | null
  stickerStatusCode: number | null
  stickerUrl: string
  stickerSpriteUrl: string | null
  stickerWebpUrl: string | null
  stickerTotalFrames: number | null
  stickerDurationMs: number | null
  stickerEffectZaloId: string | null
  stickerChecksum: string | null
  stickerExtension: string | null
  stickerSource: string | null
  stickerVersion: string | null
}

interface StickerDetailProjectionItem extends StickerDetailMetadata {
  conversationType: 'user' | 'group'
  conversationZaloId: string
}

interface StickerDetailCacheEntry {
  detail: StickerDetailMetadata | null
  expiresAt: number | null
}

interface StickerEnrichmentFence {
  runtimeGeneration: string
}

interface PendingStickerDetail {
  accountId: number
  runtimeGeneration: string
  stickerId: number
  references: Map<string, StickerReference>
  inFlight: boolean
}

interface ActiveStickerDetailLookup {
  epoch: number
  token: number
  accountId: number
  runtimeGeneration: string
  pendingKeys: string[]
}

type UserPresenceRequest = { userId: string }
type UserPresenceApi = API & {
  akaGetUserPresence?: (input: UserPresenceRequest) => Promise<unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const normalized = String(value).trim()
    if (normalized) return normalized
  }
  return undefined
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

async function getUserPresence(api: API, userId: string): Promise<{
  userId: string
  lastOnlineAt: number | null
  checkedAt: number
}> {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new Error('Thiếu Zalo ID cần kiểm tra trạng thái.')
  const customApi = api as UserPresenceApi
  if (typeof customApi.akaGetUserPresence !== 'function') {
    api.custom<Promise<unknown>, UserPresenceRequest>(
      'akaGetUserPresence',
      async ({ ctx, utils, props }) => {
        const encrypted = utils.encodeAES(JSON.stringify({
          uid: props.userId,
          is_group: false,
          imei: ctx.imei
        }))
        if (!encrypted) throw new ZaloApiError('Failed to encrypt user presence params')
        const response = await utils.request(utils.makeURL(
          `${api.zpwServiceMap.profile[0]}/api/social/profile/lastOnline`,
          { params: encrypted }
        ))
        return utils.resolve(response)
      }
    )
  }
  const loadPresence = customApi.akaGetUserPresence
  if (!loadPresence) throw new Error('Không khởi tạo được API trạng thái người dùng Zalo.')
  const result = record(await loadPresence({ userId: normalizedUserId }))
  const value = finiteNumber(result.lastOnline)
  const normalizedLastOnline = value !== undefined && value > 0
    ? value < 100_000_000_000 ? value * 1_000 : value
    : null
  return {
    userId: normalizedUserId,
    lastOnlineAt: normalizedLastOnline !== null && Number.isSafeInteger(normalizedLastOnline)
      ? normalizedLastOnline
      : null,
    checkedAt: Date.now()
  }
}

function nullableInteger(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function nullableText(value: unknown): string | null {
  return text(value) ?? null
}

function positiveSafeInteger(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function stickerReference(value: unknown): StickerReference | null {
  const message = record(value)
  const messageType = message.type === ThreadType.Group
    ? 'group'
    : message.type === ThreadType.User
      ? 'user'
      : null
  if (!messageType) return null

  const conversationZaloId = text(message.threadId)
  const data = record(message.data)
  if (!conversationZaloId || data.msgType !== 'chat.sticker') return null

  const content = record(data.content)
  const stickerId = positiveSafeInteger(content.id)
  if (stickerId === null) return null

  return {
    conversationType: messageType,
    conversationZaloId,
    stickerId,
    rawCategoryZaloId: nullableText(content.catId),
    rawTypeCode: nullableInteger(content.type)
  }
}

function stickerReferences(values: unknown[]): StickerReference[] {
  const result = new Map<string, StickerReference>()
  for (const value of values) {
    const reference = stickerReference(value)
    if (!reference) continue
    const key = `${reference.conversationType}:${reference.conversationZaloId}:${reference.stickerId}`
    if (!result.has(key)) result.set(key, reference)
  }
  return Array.from(result.values())
}

function stickerDetailMetadata(value: unknown): StickerDetailMetadata | null {
  const detail = record(value)
  const stickerId = positiveSafeInteger(detail.id)
  const stickerUrl = text(detail.stickerUrl)
  if (stickerId === null || !stickerUrl) return null
  return {
    stickerZaloId: String(stickerId),
    stickerCategoryZaloId: nullableText(detail.cateId),
    stickerTypeCode: nullableInteger(detail.type),
    stickerText: nullableText(detail.text),
    stickerUri: nullableText(detail.uri),
    stickerFileKey: nullableText(detail.fkey),
    stickerStatusCode: nullableInteger(detail.status),
    stickerUrl,
    stickerSpriteUrl: nullableText(detail.stickerSpriteUrl),
    stickerWebpUrl: nullableText(detail.stickerWebpUrl),
    stickerTotalFrames: nullableInteger(detail.totalFrames),
    stickerDurationMs: nullableInteger(detail.duration),
    stickerEffectZaloId: nullableText(detail.effectId),
    stickerChecksum: nullableText(detail.checksum),
    stickerExtension: nullableText(detail.ext),
    stickerSource: nullableText(detail.source),
    stickerVersion: nullableText(detail.version)
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(item => text(item)).filter((item): item is string => !!item)))
}

function groupsOf<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function isEligibleLocalAccount(account: AutoAccount): boolean {
  return account.flatformType === 'zalo' &&
    account.isZaloServer === false &&
    account.isZaloShowWeb === false &&
    account.isActive === true &&
    account.isDelete === false
}

function threadType(value: unknown): ThreadType {
  return value === 'group' ? ThreadType.Group : ThreadType.User
}

export class ZaloLocalChatSyncService {
  private readonly runtimeId = `aka-agent-local-${randomUUID()}`
  private socket: WebSocket | null = null
  private liveEventSocket: WebSocket | null = null
  private running = false
  private welcomed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatAckTimer: ReturnType<typeof setTimeout> | null = null
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly attached = new Map<number, AttachedAccount>()
  private readonly bindings = new Map<number, LocalRuntimeBindingRegistration>()
  private readonly sequenceByAccount = new Map<number, bigint>()
  private readonly pendingEvents = new Map<string, PendingRuntimeEvent>()
  private readonly attachedOnConnection = new Set<number>()
  private readonly lastSentStatusFingerprintByAccount = new Map<number, string>()
  private readonly activeQrOperations = new Map<number, string>()
  private readonly qrLoginAccounts = new Set<number>()
  private readonly qrClaimPreviousStatus = new Map<number, PreviousZaloAccountStatus>()
  private readonly qrClaimReleases = new Map<number, Promise<void>>()
  private readonly commandQueues = new Map<number, Promise<void>>()
  private readonly knownGroupIdsByAccount = new Map<number, Set<string>>()
  private readonly bindingConflicts = new Map<number, BindingConflict>()
  private readonly listenerRetryStates = new Map<number, LocalListenerRetryState>()
  private readonly listenerStabilityTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private readonly stickerDetailCache = new Map<string, StickerDetailCacheEntry>()
  private readonly pendingStickerDetails = new Map<string, PendingStickerDetail>()
  private pendingStickerDetailReferenceCount = 0
  private activeStickerDetailLookup: ActiveStickerDetailLookup | null = null
  private stickerDetailLookupBlocker: Promise<void> | null = null
  private stickerDetailLookupEpoch = 0
  private stickerDetailLookupToken = 0
  private stickerDetailLookupPausedEpoch: number | null = null
  private eligibleAccountFingerprint = ''
  private reconcilePromise: Promise<void> | null = null
  private reconcileRequested = false
  private unsubscribeQr: (() => void) | null = null

  public constructor(
    private readonly supabase: SupabaseService,
    private readonly chatApi: ZaloChatApiClient,
    private readonly zaloRuntime: ZaloRuntimeService
  ) {}

  public start(): void {
    if (this.running || !this.chatApi.canUseLocalRuntime()) return
    this.running = true
    this.reconnectAttempt = 0
    this.unsubscribeQr = this.zaloRuntime.subscribeLoginQrEvents(
      event => this.handleLocalQrEvent(event)
    )
    this.reconcileTimer = setInterval(() => {
      this.refreshSoon()
    }, RECONCILE_INTERVAL_MS)
    this.reconcileTimer.unref()
    void this.connect()
  }

  public stop(): void {
    this.running = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.heartbeatAckTimer) clearTimeout(this.heartbeatAckTimer)
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
    this.reconnectTimer = null
    this.reconcileTimer = null
    this.heartbeatTimer = null
    this.heartbeatAckTimer = null
    this.welcomeTimer = null
    this.unsubscribeQr?.()
    this.unsubscribeQr = null
    for (const accountId of this.activeQrOperations.keys()) {
      void this.zaloRuntime.cancelLoginQrAndWait(accountId)
        .finally(() => this.releaseQrClaim(accountId))
        .catch(error => this.logError(`stop QR ${accountId}`, error))
    }
    this.activeQrOperations.clear()
    this.qrLoginAccounts.clear()
    for (const account of this.attached.values()) account.unsubscribe()
    this.attached.clear()
    this.bindings.clear()
    this.pendingEvents.clear()
    this.attachedOnConnection.clear()
    this.lastSentStatusFingerprintByAccount.clear()
    this.commandQueues.clear()
    this.knownGroupIdsByAccount.clear()
    this.bindingConflicts.clear()
    this.resetStickerDetails()
    for (const timer of this.listenerStabilityTimers.values()) clearTimeout(timer)
    this.listenerStabilityTimers.clear()
    this.listenerRetryStates.clear()
    this.eligibleAccountFingerprint = ''
    this.welcomed = false
    this.reconnectAttempt = 0
    const socket = this.socket
    this.socket = null
    this.liveEventSocket = null
    try { socket?.close(1000, 'akaAgent stopped') } catch {}
  }

  public refreshSoon(): void {
    if (!this.running || !this.welcomed) return
    if (this.reconcilePromise) {
      this.reconcileRequested = true
      return
    }
    const reconcile = this.reconcile()
    this.reconcilePromise = reconcile
    void reconcile
      .catch(error => this.logError('reconcile', error))
      .finally(() => {
        if (this.reconcilePromise === reconcile) this.reconcilePromise = null
        if (this.reconcileRequested) {
          this.reconcileRequested = false
          this.refreshSoon()
        }
      })
  }

  private async connect(): Promise<void> {
    if (!this.running || this.socket) return
    try {
      const session = await this.chatApi.getLocalRuntimeSession()
      if (!this.running) return
      const socket = new WebSocket(session.webSocketUrl, {
        headers: { authorization: `Bearer ${session.token}` },
        handshakeTimeout: WELCOME_TIMEOUT_MS
      })
      this.socket = socket
      socket.on('open', () => {
        if (this.socket !== socket || !this.running) return
        this.send({
          protocolVersion: PROTOCOL_VERSION,
          kind: 'runtime.hello',
          runtimeId: this.runtimeId,
          runtimeType: 'local',
          runtimeVersion: `akaAgent-${process.env.npm_package_version || 'dev'}`,
          adapterName: 'zca-js-local',
          adapterVersion: '1',
          capabilities: [
            'socket', 'send_message', 'send_media', 'media_upload', 'sticker_api',
            'reaction_api', 'label_api', 'friend_api', 'group_api', 'qr_login'
          ]
        })
        if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
        this.welcomeTimer = setTimeout(() => {
          this.handleWelcomeTimeout(socket)
        }, WELCOME_TIMEOUT_MS)
        this.welcomeTimer.unref()
      })
      let incomingProcessing = Promise.resolve()
      let incomingFailed = false
      socket.on('message', raw => {
        if (incomingFailed) return
        incomingProcessing = incomingProcessing
          .then(() => this.handleIncoming(String(raw), socket))
          .catch(error => {
            incomingFailed = true
            this.logError('incoming message', error)
            try { socket.close(1011, 'invalid local runtime message') } catch {}
          })
      })
      socket.on('error', error => this.logError('websocket', error))
      socket.on('close', () => {
        if (this.socket !== socket) return
        this.socket = null
        this.liveEventSocket = null
        this.welcomed = false
        this.attachedOnConnection.clear()
        this.lastSentStatusFingerprintByAccount.clear()
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        if (this.heartbeatAckTimer) clearTimeout(this.heartbeatAckTimer)
        if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
        this.heartbeatTimer = null
        this.heartbeatAckTimer = null
        this.welcomeTimer = null
        for (const account of this.attached.values()) account.ready = false
        for (const accountId of this.activeQrOperations.keys()) {
          void this.zaloRuntime.cancelLoginQrAndWait(accountId)
            .finally(() => this.releaseQrClaim(accountId))
            .catch(error => this.logError(`disconnect QR ${accountId}`, error))
        }
        this.activeQrOperations.clear()
        this.scheduleReconnect()
      })
    } catch (error) {
      this.logError('connect', error)
      this.socket = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return
    if (this.reconnectAttempt >= MAX_CONTROL_RECONNECT_ATTEMPTS) {
      this.stopAfterReconnectExhaustion()
      return
    }
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5))
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private handleWelcomeTimeout(socket: WebSocket): void {
    if (this.socket !== socket || this.welcomed || !this.running) return
    this.welcomeTimer = null
    try { socket.close(1011, 'local Chat welcome timeout') } catch {}
  }

  private armHeartbeatAckTimeout(socket: WebSocket): void {
    if (this.heartbeatAckTimer || this.socket !== socket || !this.running) return
    this.heartbeatAckTimer = setTimeout(() => {
      this.handleHeartbeatAckTimeout(socket)
    }, HEARTBEAT_ACK_TIMEOUT_MS)
    this.heartbeatAckTimer.unref()
  }

  private handleHeartbeatAckTimeout(socket: WebSocket): void {
    if (this.socket !== socket || !this.welcomed || !this.running) return
    this.heartbeatAckTimer = null
    try { socket.close(1011, 'local Chat heartbeat ACK timeout') } catch {}
  }

  private async handleIncoming(raw: string, sourceSocket: WebSocket | null = this.socket): Promise<void> {
    if (!sourceSocket || this.socket !== sourceSocket || !this.running) return
    const message = JSON.parse(raw) as IncomingMessage
    if (message.kind === 'runtime.welcome') {
      if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
      this.welcomeTimer = null
      this.welcomed = true
      this.liveEventSocket = null
      await this.reconcile(sourceSocket)
      if (this.socket !== sourceSocket || !this.welcomed || !this.running) return
      for (const event of this.pendingEvents.values()) {
        if (this.attachedOnConnection.has(Number(event.autoAccountId))) {
          this.sendPendingEvent(event, sourceSocket)
        }
      }
      this.liveEventSocket = sourceSocket
      this.heartbeatTimer = setInterval(() => {
        if (this.socket !== sourceSocket || !this.welcomed || !this.running) return
        this.send({
          protocolVersion: PROTOCOL_VERSION,
          kind: 'runtime.heartbeat',
          runtimeId: this.runtimeId,
          sentAt: new Date().toISOString()
        })
        this.armHeartbeatAckTimeout(sourceSocket)
      }, HEARTBEAT_INTERVAL_MS)
      this.heartbeatTimer.unref()
      return
    }
    if (message.kind === 'runtime.heartbeat_ack') {
      // A heartbeat round-trip proves that the authenticated connection stayed
      // healthy beyond bootstrap. Short welcome/close flaps keep consuming the
      // same finite reconnect budget.
      if (this.heartbeatAckTimer) clearTimeout(this.heartbeatAckTimer)
      this.heartbeatAckTimer = null
      if (this.welcomed) this.reconnectAttempt = 0
      return
    }
    if (message.kind === 'zalo.event.ack') {
      this.pendingEvents.delete(message.eventId)
      return
    }
    if (message.kind === 'runtime.local_qr_login.command') {
      await this.handleQrCommand(message)
      return
    }
    if (message.kind === 'runtime.local_qr_login.binding_result') {
      await this.handleQrBindingResult(message)
      return
    }
    if (message.kind === 'runtime.local_account.retry_attach.command') {
      await this.handleRetryAttachCommand(message)
      return
    }
    if (message.kind === 'zalo.command') {
      this.handleCommand(message)
      return
    }
    if (message.kind === 'protocol.error') {
      throw new Error(`Chat API từ chối local runtime (${message.code}): ${message.message}`)
    }
  }

  private async reconcile(expectedSocket: WebSocket | null = this.socket): Promise<void> {
    const isCurrentConnection = () => (
      expectedSocket !== null &&
      this.socket === expectedSocket &&
      this.running &&
      this.welcomed
    )
    if (!isCurrentConnection()) return
    const listedAccounts = await this.supabase.listAccounts()
    if (!isCurrentConnection()) return
    const accounts = listedAccounts.filter(isEligibleLocalAccount)
    const eligibleIds = new Set(accounts.map(account => account.id))
    const nextFingerprint = listedAccounts
      .filter(account => account.flatformType === 'zalo')
      .map(account => `${account.id}:${account.isZaloServer ? 'server' : account.isZaloShowWeb ? 'web' : 'local'}`)
      .sort()
      .join(',')
    if (nextFingerprint !== this.eligibleAccountFingerprint) {
      // Account deletion/type changes can make an earlier business conflict
      // valid again, so retry once when the eligible account set changes.
      this.bindingConflicts.clear()
      this.eligibleAccountFingerprint = nextFingerprint
    }
    this.sendAvailability(accounts)

    for (const [accountId] of this.attached) {
      if (eligibleIds.has(accountId)) continue
      this.detachAccount(accountId, 'Loại runtime của tài khoản đã thay đổi')
      this.bindingConflicts.delete(accountId)
    }

    const storedSessions = await this.supabase.listZaloAccountsWithSession('desktop')
    if (!isCurrentConnection()) return
    const sessionsByAccount = new Map(
      storedSessions.map(entry => [entry.account.id, entry] as const)
    )
    for (const account of accounts) {
      if (
        this.activeQrOperations.has(account.id) ||
        this.qrLoginAccounts.has(account.id) ||
        this.zaloRuntime.isLoginQrActive(account.id)
      ) continue
      if (!sessionsByAccount.has(account.id)) {
        this.detachAccount(account.id, 'Tài khoản chưa có session Zalo local')
        continue
      }
      const attached = this.attached.get(account.id)
      if (attached?.ready && this.attachedOnConnection.has(account.id)) continue
      if (this.bindingConflicts.has(account.id)) {
        this.detachAccount(account.id, this.bindingConflicts.get(account.id)!.message)
        continue
      }
      if (this.keepExhaustedListenerAttached(account.id)) continue
      try {
        const session = await this.zaloRuntime.checkSession(account.id)
        if (!isCurrentConnection()) return
        if (!session.loggedIn) {
          this.detachAccount(account.id, session.reason || 'Session Zalo local không còn hiệu lực')
          continue
        }
        const profile = await this.zaloRuntime.getOwnProfileForChat(account.id)
        if (!isCurrentConnection()) return
        const candidateZaloId = text(profile.zaloId)
        if (!candidateZaloId) {
          this.detachAccount(account.id, 'Không xác định được Zalo ID của session local')
          continue
        }
        const binding = await this.chatApi.registerLocalRuntimeAccount(
          account.id,
          candidateZaloId
        )
        if (!isCurrentConnection()) return
        this.bindingConflicts.delete(account.id)
        await this.attachAccount(account.id, binding)
        if (!isCurrentConnection()) return
      } catch (error) {
        if (!isCurrentConnection()) return
        if (this.rememberBindingConflict(account.id, error)) {
          this.detachAccount(account.id, this.bindingConflicts.get(account.id)!.message)
          continue
        }
        this.logError(`register account ${account.id}`, error)
      }
    }
    if (!isCurrentConnection()) return
    this.sendAvailability(accounts)
  }

  private sendAvailability(accounts: AutoAccount[]): void {
    const eligibleIds = new Set(accounts.map(account => account.id))
    this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: 'runtime.local_account.availability',
      runtimeId: this.runtimeId,
      autoAccountIds: accounts.map(account => String(account.id)),
      conflicts: Array.from(this.bindingConflicts.entries())
        .filter(([accountId]) => eligibleIds.has(accountId))
        .map(([accountId, conflict]) => ({
          autoAccountId: String(accountId),
          code: conflict.code,
          message: conflict.message
        }))
    })
  }

  private rememberBindingConflict(accountId: number, error: unknown): boolean {
    if (!(error instanceof ZaloChatApiRequestError)) return false
    if (
      error.code !== 'zalo_already_linked' &&
      error.code !== 'account_already_has_another_zalo'
    ) return false
    this.bindingConflicts.set(accountId, { code: error.code, message: error.message })
    console.warn(`[LocalChatSync] account ${accountId}: ${error.message}`)
    return true
  }

  private detachAccount(accountId: number, reason: string): void {
    this.clearListenerStabilityTimer(accountId)
    this.listenerRetryStates.delete(accountId)
    this.lastSentStatusFingerprintByAccount.delete(accountId)
    const binding = this.bindings.get(accountId)
    const attached = this.attached.get(accountId)
    if (!binding && !attached) {
      this.dropStickerDetailsForAccount(accountId)
      return
    }
    this.reportStatus(accountId, 'disconnected', undefined, undefined, reason)
    if (binding && this.attachedOnConnection.has(accountId)) {
      this.send({
        protocolVersion: PROTOCOL_VERSION,
        kind: 'runtime.detach_account',
        runtimeId: this.runtimeId,
        autoAccountId: String(accountId),
        runtimeGeneration: binding.runtimeGeneration
      })
    }
    attached?.unsubscribe()
    this.attached.delete(accountId)
    this.bindings.delete(accountId)
    this.attachedOnConnection.delete(accountId)
    this.lastSentStatusFingerprintByAccount.delete(accountId)
    this.dropStickerDetailsForAccount(accountId)
  }

  private async attachAccount(
    accountId: number,
    binding: LocalRuntimeBindingRegistration
  ): Promise<void> {
    const previousBinding = this.bindings.get(accountId) ?? this.attached.get(accountId)
    const generationChanged = previousBinding !== undefined &&
      previousBinding.runtimeGeneration !== binding.runtimeGeneration
    const retryState = this.listenerRetryStates.get(accountId)
    if (generationChanged || (
      retryState !== undefined &&
      retryState.runtimeGeneration !== binding.runtimeGeneration
    )) {
      this.clearListenerStabilityTimer(accountId)
      this.listenerRetryStates.delete(accountId)
    }
    if (generationChanged) {
      this.dropStickerDetailsForAccount(accountId, binding.runtimeGeneration)
    }

    // Events are acknowledged against the generation that produced them. Once
    // a QR login rotates the binding generation, replaying older pending events
    // would make the gateway reject the runtime connection on every reconnect.
    for (const [eventId, event] of this.pendingEvents) {
      if (
        Number(event.autoAccountId) === accountId &&
        event.runtimeGeneration !== binding.runtimeGeneration
      ) {
        this.pendingEvents.delete(eventId)
      }
    }

    const attachmentSocket = this.socket
    if (!attachmentSocket || attachmentSocket.readyState !== WebSocket.OPEN) return

    const alreadyAttachedToCurrentConnection = this.attachedOnConnection.has(accountId) &&
      previousBinding?.runtimeGeneration === binding.runtimeGeneration
    this.bindings.set(accountId, binding)
    if (!alreadyAttachedToCurrentConnection) {
      // Status idempotency is scoped to one control attachment. A new control
      // connection or binding generation must be allowed to replay the current
      // state even when its semantic value matches the previous connection.
      this.lastSentStatusFingerprintByAccount.delete(accountId)
      attachmentSocket.send(JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        kind: 'runtime.attach_account',
        runtimeId: this.runtimeId,
        autoAccountId: String(accountId),
        runtimeGeneration: binding.runtimeGeneration
      }))
      this.attachedOnConnection.add(accountId)
    }
    let attached = this.attached.get(accountId)
    const readyStatusVersion = attached?.readyStatusVersion ?? 0
    if (!attached) {
      const handlers = this.listenerHandlers(accountId)
      attached = {
        ...binding,
        accountId,
        unsubscribe: () => {},
        initialSyncGeneration: null,
        ready: false,
        readyStatusVersion: 0,
        listenerFailureVersion: 0,
        listenerClosedVersion: 0
      }
      this.attached.set(accountId, attached)
      try {
        // Register the attached row before subscribing because ZaloRuntimeService
        // immediately replays an already-running listener snapshot.
        attached.unsubscribe = this.zaloRuntime.subscribeRealtimeListener(accountId, handlers)
      } catch (error) {
        this.attached.delete(accountId)
        throw error
      }
    } else {
      Object.assign(attached, binding)
      if (generationChanged) {
        attached.initialSyncGeneration = null
        this.knownGroupIdsByAccount.delete(accountId)
      }
    }
    const currentRetryState = this.listenerRetryStates.get(accountId)
    if (
      currentRetryState?.exhausted &&
      currentRetryState.runtimeGeneration === binding.runtimeGeneration
    ) {
      attached.ready = false
      this.reportStatus(accountId, 'error', LOCAL_LISTENER_RETRY_EXHAUSTED_MESSAGE)
      return
    }
    const listenerFailureVersion = attached.listenerFailureVersion
    const listenerClosedVersion = attached.listenerClosedVersion
    const isCurrentAttachmentAttempt = () => (
      this.socket === attachmentSocket &&
      attachmentSocket.readyState === WebSocket.OPEN &&
      this.attached.get(accountId) === attached &&
      this.bindings.get(accountId)?.runtimeGeneration === binding.runtimeGeneration &&
      this.attachedOnConnection.has(accountId)
    )
    try {
      await this.zaloRuntime.ensureRealtimeListenerReady(accountId)
      if (!isCurrentAttachmentAttempt()) return
      if (
        attached.listenerClosedVersion !== listenerClosedVersion &&
        !attached.ready
      ) return

      attached.ready = true
      this.scheduleListenerStabilityReset(accountId, binding.runtimeGeneration)
      if (attached.readyStatusVersion === readyStatusVersion) {
        this.reportStatus(accountId, 'ready')
      }
      if (attached.initialSyncGeneration !== binding.runtimeGeneration) {
        attached.initialSyncGeneration = binding.runtimeGeneration
        void this.initialSync(accountId, binding.runtimeGeneration)
          .catch(error => this.logError(`initial sync ${accountId}`, error))
      }
    } catch (error) {
      if (!isCurrentAttachmentAttempt()) return
      attached.ready = false
      // Synchronous startup failures and listener errors are normally emitted
      // by ZaloRuntimeService. A timeout/reset can still reject without a
      // terminal listener event, so preserve the explicit error fallback only
      // for that case.
      if (attached.listenerFailureVersion === listenerFailureVersion) {
        this.reportStatus(accountId, 'error', error)
      }
      if (attached.listenerClosedVersion === listenerClosedVersion) {
        this.recordListenerStartFailure(accountId, binding.runtimeGeneration)
      }
      throw error
    }
  }

  private async handleRetryAttachCommand(command: LocalRetryAttachCommand): Promise<void> {
    const accountId = Number(command.autoAccountId)
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return
    try {
      if (this.reconcilePromise) await this.reconcilePromise
      const account = await this.supabase.getAccount(accountId)
      if (!account || !isEligibleLocalAccount(account)) {
        throw new Error('Tài khoản không còn là Zalo QR local hợp lệ trên akaAgent.')
      }
      if (
        this.activeQrOperations.has(accountId) ||
        this.qrLoginAccounts.has(accountId) ||
        this.zaloRuntime.isLoginQrActive(accountId)
      ) {
        throw new Error('Tài khoản đang đăng nhập QR, chưa thể bật đồng bộ Chat.')
      }

      this.clearListenerStabilityTimer(accountId)
      this.listenerRetryStates.delete(accountId)
      this.zaloRuntime.invalidateAccount(accountId)
      this.bindingConflicts.delete(accountId)
      const session = await this.zaloRuntime.checkSession(accountId)
      if (!session.loggedIn) {
        throw new Error(session.reason || 'Session Zalo local không còn hiệu lực.')
      }
      const profile = await this.zaloRuntime.getOwnProfileForChat(accountId)
      const candidateZaloId = text(profile.zaloId)
      if (!candidateZaloId) throw new Error('Không xác định được Zalo ID của session local.')
      const binding = await this.chatApi.registerLocalRuntimeAccount(accountId, candidateZaloId)
      await this.attachAccount(accountId, binding)
      this.send({
        protocolVersion: PROTOCOL_VERSION,
        kind: 'runtime.local_account.retry_attach.result',
        runtimeId: this.runtimeId,
        requestId: command.requestId,
        autoAccountId: command.autoAccountId,
        status: 'succeeded',
        runtimeGeneration: binding.runtimeGeneration,
        expectedZaloId: binding.zaloId
      })
      await this.publishCurrentAvailability()
    } catch (error) {
      const isConflict = this.rememberBindingConflict(accountId, error)
      const requestError = error instanceof ZaloChatApiRequestError ? error : null
      this.send({
        protocolVersion: PROTOCOL_VERSION,
        kind: 'runtime.local_account.retry_attach.result',
        runtimeId: this.runtimeId,
        requestId: command.requestId,
        autoAccountId: command.autoAccountId,
        status: 'failed',
        ...(requestError?.code ? { errorCode: requestError.code } : {}),
        errorMessage: error instanceof Error ? error.message : 'Chưa thể bật đồng bộ Chat.'
      })
      if (isConflict) await this.publishCurrentAvailability()
    }
  }

  private async publishCurrentAvailability(): Promise<void> {
    try {
      this.sendAvailability((await this.supabase.listAccounts()).filter(isEligibleLocalAccount))
    } catch (error) {
      this.logError('refresh local availability', error)
    }
  }

  private listenerHandlers(accountId: number): ZaloRealtimeListenerHandlers {
    return {
      typing: payload => this.publishEvent(accountId, 'typing', payload),
      message: payload => {
        if (!this.publishEvent(accountId, 'message', payload)) return
        this.scheduleStickerDetails(accountId, stickerReferences([payload]))
      },
      oldMessages: (messages, type) => {
        if (!this.publishEvent(accountId, 'old_messages', { messages, type })) return
        this.scheduleStickerDetails(
          accountId,
          stickerReferences(Array.isArray(messages) ? messages : [])
        )
      },
      reaction: payload => this.publishEvent(accountId, 'reaction', payload),
      oldReactions: (reactions, isGroup) => this.publishEvent(
        accountId,
        'old_reactions',
        { reactions, isGroup }
      ),
      undo: payload => this.publishEvent(accountId, 'undo', payload),
      friendEvent: payload => this.publishEvent(accountId, 'friend_event', payload),
      groupEvent: payload => {
        this.publishEvent(accountId, 'group_event', payload)
        const raw = record(payload)
        const groupId = text(raw.threadId)
        if (groupId && ['join', 'leave', 'remove_member', 'block_member', 'add_admin', 'remove_admin']
          .includes(String(raw.type || ''))) {
          void this.syncGroupSnapshot(accountId, groupId, false)
            .catch(error => this.logError(`group refresh ${accountId}`, error))
        }
      },
      seenMessages: payload => this.publishEvent(accountId, 'seen_messages', payload),
      deliveredMessages: payload => this.publishEvent(accountId, 'delivered_messages', payload),
      uploadAttachment: payload => this.publishEvent(accountId, 'upload_attachment', payload),
      status: event => this.handleListenerStatus(event)
    }
  }

  private handleListenerStatus(event: ZaloListenerStatusEvent): void {
    const attached = this.attached.get(event.accountId)
    if (!attached) return
    attached.ready = event.status === 'running' && event.ready
    if (attached.ready && !event.error) {
      // A cipher key proves readiness, but a short ready/close flap must keep
      // consuming the same finite budget until the socket is stable.
      this.scheduleListenerStabilityReset(event.accountId, attached.runtimeGeneration)
      attached.readyStatusVersion += 1
      this.reportStatus(event.accountId, 'ready')
    }
    else if (event.status === 'starting') {
      this.clearListenerStabilityTimer(event.accountId)
      this.reportStatus(event.accountId, 'connecting')
    }
    else if (event.status === 'disconnected') {
      this.clearListenerStabilityTimer(event.accountId)
      this.reportStatus(event.accountId, 'reconnecting', event.error, event.code, event.reason)
    } else if (event.status === 'closed') {
      this.clearListenerStabilityTimer(event.accountId)
      attached.listenerFailureVersion += 1
      attached.listenerClosedVersion += 1
      this.reportStatus(
        event.accountId,
        event.code === CloseReason.KickConnection ? 'kicked' : 'disconnected',
        event.error,
        event.code,
        event.reason
      )
      this.recordListenerStartFailure(event.accountId, attached.runtimeGeneration)
    } else if (event.status === 'error') {
      this.clearListenerStabilityTimer(event.accountId)
      attached.listenerFailureVersion += 1
      this.reportStatus(event.accountId, 'error', event.error)
    }
    else if (event.status === 'stopped') {
      this.clearListenerStabilityTimer(event.accountId)
      this.reportStatus(event.accountId, 'stopped')
    }
  }

  private markAccountQrLoginInProgress(accountId: number): void {
    this.clearListenerStabilityTimer(accountId)
    this.listenerRetryStates.delete(accountId)
    const attached = this.attached.get(accountId)
    if (!attached?.ready) return

    // startLoginQr() invalidates the cached API and stops the current listener.
    // Reflect that transition immediately so Chat Web cannot keep dispatching
    // actions through a listener that no longer exists.
    attached.ready = false
    this.reportStatus(
      accountId,
      'connecting',
      undefined,
      undefined,
      'Đang đăng nhập lại Zalo QR local.'
    )
  }

  private keepExhaustedListenerAttached(accountId: number): boolean {
    const retryState = this.listenerRetryStates.get(accountId)
    if (!retryState?.exhausted) return false

    const binding = this.bindings.get(accountId)
    const attached = this.attached.get(accountId)
    if (
      !binding ||
      !attached ||
      binding.runtimeGeneration !== retryState.runtimeGeneration
    ) {
      // This state belongs to a lifecycle that no longer exists. Let the
      // normal registration path create a fresh listener budget.
      this.listenerRetryStates.delete(accountId)
      return false
    }

    // On a new control connection we must register again before trusting the
    // cached generation. attachAccount() will either observe a fresh generation
    // (new budget) or attach the same exhausted generation without restarting
    // its Zalo listener.
    return this.attachedOnConnection.has(accountId)
  }

  private recordListenerStartFailure(accountId: number, runtimeGeneration: string): void {
    let retryState = this.listenerRetryStates.get(accountId)
    if (!retryState || retryState.runtimeGeneration !== runtimeGeneration) {
      retryState = {
        runtimeGeneration,
        failedAttempts: 0,
        exhausted: false
      }
      this.listenerRetryStates.set(accountId, retryState)
    }
    if (retryState.exhausted) return

    retryState.failedAttempts += 1
    if (retryState.failedAttempts < MAX_LOCAL_LISTENER_RESTART_ATTEMPTS) return

    retryState.exhausted = true
    console.warn(
      `[LocalChatSync] listener auto-retry exhausted accountId=${accountId} ` +
      `attempts=${retryState.failedAttempts}.`
    )
    this.reportStatus(accountId, 'error', LOCAL_LISTENER_RETRY_EXHAUSTED_MESSAGE)
  }

  private scheduleListenerStabilityReset(
    accountId: number,
    runtimeGeneration: string
  ): void {
    this.clearListenerStabilityTimer(accountId)
    const timer = setTimeout(() => {
      if (this.listenerStabilityTimers.get(accountId) !== timer) return
      this.listenerStabilityTimers.delete(accountId)
      const attached = this.attached.get(accountId)
      if (
        !attached?.ready ||
        attached.runtimeGeneration !== runtimeGeneration ||
        this.bindings.get(accountId)?.runtimeGeneration !== runtimeGeneration
      ) return
      this.listenerRetryStates.delete(accountId)
    }, LOCAL_LISTENER_STABILITY_MS)
    timer.unref()
    this.listenerStabilityTimers.set(accountId, timer)
  }

  private clearListenerStabilityTimer(accountId: number): void {
    const timer = this.listenerStabilityTimers.get(accountId)
    if (timer) clearTimeout(timer)
    this.listenerStabilityTimers.delete(accountId)
  }

  private reportStatus(
    accountId: number,
    state: string,
    error?: unknown,
    closeCode?: number,
    closeReason?: string
  ): void {
    const binding = this.bindings.get(accountId)
    if (!binding || !this.attachedOnConnection.has(accountId)) return
    const errorMessage = error instanceof Error ? error.message : text(error)
    const fingerprint = JSON.stringify({
      runtimeGeneration: binding.runtimeGeneration,
      state,
      ...(closeCode === undefined ? {} : { closeCode }),
      ...(closeReason ? { closeReason } : {}),
      ...(errorMessage ? { errorMessage } : {})
    })
    if (this.lastSentStatusFingerprintByAccount.get(accountId) === fingerprint) return

    const sent = this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: 'runtime.account.status',
      runtimeId: this.runtimeId,
      autoAccountId: String(accountId),
      runtimeGeneration: binding.runtimeGeneration,
      state,
      observedAt: new Date().toISOString(),
      ...(closeCode === undefined ? {} : { closeCode }),
      ...(closeReason ? { closeReason } : {}),
      ...(errorMessage ? { errorMessage } : {})
    })
    if (sent) this.lastSentStatusFingerprintByAccount.set(accountId, fingerprint)
  }

  private publishEvent(
    accountId: number,
    eventType: string,
    payload: unknown,
    expectedRuntimeGeneration?: string
  ): boolean {
    if (!this.running) return false
    const binding = this.bindings.get(accountId)
    if (!binding) return false
    if (
      expectedRuntimeGeneration !== undefined &&
      binding.runtimeGeneration !== expectedRuntimeGeneration
    ) return false
    const priority = eventType === 'sticker_details' ? 'synthetic' : 'raw'
    if (priority === 'synthetic' && this.pendingEvents.size >= MAX_PENDING_EVENTS) {
      return false
    }
    const next = (this.sequenceByAccount.get(accountId) ?? 0n) + 1n
    this.sequenceByAccount.set(accountId, next)
    const event: RuntimeEventMessage = {
      protocolVersion: PROTOCOL_VERSION,
      kind: 'zalo.event',
      eventId: randomUUID(),
      runtimeId: this.runtimeId,
      autoAccountId: String(accountId),
      runtimeGeneration: binding.runtimeGeneration,
      sequence: next.toString(),
      eventType,
      occurredAt: new Date().toISOString(),
      adapterName: 'zca-js-local',
      adapterVersion: '1',
      payload
    }
    let wire: string
    try {
      wire = JSON.stringify(event)
    } catch {
      this.logUnserializableEvent(accountId, eventType)
      return false
    }
    this.pendingEvents.set(event.eventId, {
      eventId: event.eventId,
      autoAccountId: event.autoAccountId,
      runtimeGeneration: event.runtimeGeneration,
      eventType,
      priority,
      wire,
      sent: false,
      replayAttempts: 0
    })
    while (this.pendingEvents.size > MAX_PENDING_EVENTS) {
      const oldestSyntheticId = Array.from(this.pendingEvents)
        .find(([, pending]) => pending.priority === 'synthetic')?.[0]
      const evictionId = oldestSyntheticId ??
        this.pendingEvents.keys().next().value as string | undefined
      if (!evictionId) break
      this.pendingEvents.delete(evictionId)
    }
    if (
      this.attachedOnConnection.has(accountId) &&
      this.liveEventSocket === this.socket
    ) {
      const pending = this.pendingEvents.get(event.eventId)
      if (pending) this.sendPendingEvent(pending)
    }
    return true
  }

  private scheduleStickerDetails(accountId: number, references: StickerReference[]): void {
    if (references.length === 0) return
    const binding = this.bindings.get(accountId)
    if (!binding) return
    const fence: StickerEnrichmentFence = {
      runtimeGeneration: binding.runtimeGeneration
    }

    const cachedItems: StickerDetailProjectionItem[] = []
    let droppedReferences = 0
    for (const reference of references) {
      const cached = this.readStickerDetailCache(accountId, fence.runtimeGeneration, reference.stickerId)
      if (cached !== undefined) {
        if (cached === null) continue
        cachedItems.push(this.projectStickerDetail(reference, cached))
        continue
      }

      const pendingKey = this.stickerDetailLookupKey(
        accountId,
        fence.runtimeGeneration,
        reference.stickerId
      )
      let pending = this.pendingStickerDetails.get(pendingKey)
      const referenceKey = `${reference.conversationType}:${reference.conversationZaloId}`
      if (pending?.references.has(referenceKey)) continue
      if (
        (!pending && this.pendingStickerDetails.size >= MAX_STICKER_DETAIL_PENDING_IDS) ||
        this.pendingStickerDetailReferenceCount >= MAX_STICKER_DETAIL_PENDING_REFERENCES
      ) {
        droppedReferences += 1
        continue
      }
      if (!pending) {
        pending = {
          accountId,
          runtimeGeneration: fence.runtimeGeneration,
          stickerId: reference.stickerId,
          references: new Map(),
          inFlight: false
        }
        this.pendingStickerDetails.set(pendingKey, pending)
      }
      pending.references.set(referenceKey, reference)
      this.pendingStickerDetailReferenceCount += 1
    }
    this.publishStickerDetailItems(accountId, cachedItems, fence)
    if (droppedReferences > 0) {
      console.warn(
        `[LocalChatSync] sticker detail queue full accountId=${accountId} ` +
        `skippedReferences=${droppedReferences}.`
      )
    }
    this.drainStickerDetails()
  }

  private drainStickerDetails(): void {
    if (
      !this.running ||
      this.activeStickerDetailLookup ||
      this.stickerDetailLookupBlocker ||
      this.stickerDetailLookupPausedEpoch === this.stickerDetailLookupEpoch
    ) return

    let first: PendingStickerDetail | null = null
    for (const [key, pending] of this.pendingStickerDetails) {
      if (this.bindings.get(pending.accountId)?.runtimeGeneration !== pending.runtimeGeneration) {
        this.removePendingStickerDetail(key)
        continue
      }
      if (!pending.inFlight) {
        first = pending
        break
      }
    }
    if (!first) return

    const pendingKeys: string[] = []
    for (const [key, pending] of this.pendingStickerDetails) {
      if (
        !pending.inFlight &&
        pending.accountId === first.accountId &&
        pending.runtimeGeneration === first.runtimeGeneration
      ) {
        pending.inFlight = true
        pendingKeys.push(key)
        if (pendingKeys.length >= MAX_STICKER_DETAIL_LOOKUP_BATCH_SIZE) break
      }
    }
    if (pendingKeys.length === 0) return

    const lookup: ActiveStickerDetailLookup = {
      epoch: this.stickerDetailLookupEpoch,
      token: ++this.stickerDetailLookupToken,
      accountId: first.accountId,
      runtimeGeneration: first.runtimeGeneration,
      pendingKeys
    }
    this.activeStickerDetailLookup = lookup
    void this.executeStickerDetailLookup(lookup)
  }

  private async executeStickerDetailLookup(lookup: ActiveStickerDetailLookup): Promise<void> {
    const stickerIds = lookup.pendingKeys
      .map(key => this.pendingStickerDetails.get(key)?.stickerId)
      .filter((stickerId): stickerId is number => stickerId !== undefined)
    type LookupOutcome =
      | { status: 'succeeded'; response: unknown[] }
      | { status: 'failed' }
      | { status: 'timed_out' }

    const settledLookup: Promise<LookupOutcome> = Promise.resolve()
      .then(() => this.zaloRuntime.getRealtimeStickerDetails(lookup.accountId, stickerIds))
      .then(response => ({ status: 'succeeded' as const, response }))
      .catch(() => ({ status: 'failed' as const }))
    const lookupBlocker = settledLookup.then(() => undefined)
    this.stickerDetailLookupBlocker = lookupBlocker
    void lookupBlocker.then(() => {
      if (this.stickerDetailLookupBlocker !== lookupBlocker) return
      this.stickerDetailLookupBlocker = null
      if (this.stickerDetailLookupPausedEpoch === lookup.epoch) {
        this.stickerDetailLookupPausedEpoch = null
      }
      this.drainStickerDetails()
    })

    let timeout: ReturnType<typeof setTimeout> | null = null
    const outcome = await Promise.race<LookupOutcome>([
      settledLookup,
      new Promise<LookupOutcome>(resolve => {
        timeout = setTimeout(() => resolve({ status: 'timed_out' }), STICKER_DETAIL_LOOKUP_TIMEOUT_MS)
        timeout.unref()
      })
    ])
    if (timeout) clearTimeout(timeout)
    if (!this.isActiveStickerDetailLookup(lookup)) return

    const details = new Map<number, StickerDetailMetadata>()
    if (outcome.status === 'succeeded') {
      for (const value of outcome.response) {
        const detail = stickerDetailMetadata(value)
        if (!detail) continue
        const stickerId = positiveSafeInteger(detail.stickerZaloId)
        if (stickerId !== null && stickerIds.includes(stickerId)) details.set(stickerId, detail)
      }
    }

    const items: StickerDetailProjectionItem[] = []
    for (const key of lookup.pendingKeys) {
      const pending = this.pendingStickerDetails.get(key)
      this.removePendingStickerDetail(key)
      if (
        !pending ||
        this.bindings.get(pending.accountId)?.runtimeGeneration !== pending.runtimeGeneration
      ) continue
      const detail = details.get(pending.stickerId) ?? null
      this.writeStickerDetailCache(
        pending.accountId,
        pending.runtimeGeneration,
        pending.stickerId,
        detail
      )
      if (detail) {
        for (const reference of pending.references.values()) {
          items.push(this.projectStickerDetail(reference, detail))
        }
      }
    }

    this.activeStickerDetailLookup = null
    if (outcome.status === 'timed_out') {
      if (this.stickerDetailLookupBlocker === lookupBlocker) {
        this.stickerDetailLookupPausedEpoch = lookup.epoch
      }
      console.warn(`[LocalChatSync] sticker detail lookup timed out accountId=${lookup.accountId}.`)
    } else if (outcome.status === 'failed') {
      console.warn(`[LocalChatSync] sticker detail lookup failed accountId=${lookup.accountId}.`)
    }
    this.publishStickerDetailItems(
      lookup.accountId,
      items,
      { runtimeGeneration: lookup.runtimeGeneration }
    )
    this.drainStickerDetails()
  }

  private isActiveStickerDetailLookup(lookup: ActiveStickerDetailLookup): boolean {
    return this.stickerDetailLookupEpoch === lookup.epoch &&
      this.activeStickerDetailLookup?.token === lookup.token
  }

  private removePendingStickerDetail(key: string): void {
    const pending = this.pendingStickerDetails.get(key)
    if (!pending) return
    this.pendingStickerDetailReferenceCount -= pending.references.size
    this.pendingStickerDetails.delete(key)
  }

  private resetStickerDetails(): void {
    this.stickerDetailLookupEpoch += 1
    this.activeStickerDetailLookup = null
    this.stickerDetailLookupPausedEpoch = null
    this.pendingStickerDetails.clear()
    this.pendingStickerDetailReferenceCount = 0
    this.stickerDetailCache.clear()
  }

  private dropStickerDetailsForAccount(
    accountId: number,
    keepRuntimeGeneration?: string
  ): void {
    for (const [key, pending] of this.pendingStickerDetails) {
      if (
        pending.accountId === accountId &&
        pending.runtimeGeneration !== keepRuntimeGeneration
      ) {
        this.removePendingStickerDetail(key)
      }
    }
    const accountPrefix = `${accountId}:`
    const keepPrefix = keepRuntimeGeneration === undefined
      ? null
      : `${accountId}:${keepRuntimeGeneration}:`
    for (const key of this.stickerDetailCache.keys()) {
      if (key.startsWith(accountPrefix) && (!keepPrefix || !key.startsWith(keepPrefix))) {
        this.stickerDetailCache.delete(key)
      }
    }
    this.drainStickerDetails()
  }

  private projectStickerDetail(
    reference: StickerReference,
    detail: StickerDetailMetadata
  ): StickerDetailProjectionItem {
    return {
      conversationType: reference.conversationType,
      conversationZaloId: reference.conversationZaloId,
      ...detail,
      stickerZaloId: String(reference.stickerId),
      stickerCategoryZaloId: detail.stickerCategoryZaloId ?? reference.rawCategoryZaloId,
      stickerTypeCode: detail.stickerTypeCode ?? reference.rawTypeCode
    }
  }

  private publishStickerDetailItems(
    accountId: number,
    items: StickerDetailProjectionItem[],
    fence: StickerEnrichmentFence
  ): void {
    if (items.length === 0 || !this.isStickerEnrichmentFenceCurrent(accountId, fence)) return
    const uniqueItems = new Map<string, StickerDetailProjectionItem>()
    for (const item of items) {
      const key = `${item.conversationType}:${item.conversationZaloId}:${item.stickerZaloId}`
      if (!uniqueItems.has(key)) uniqueItems.set(key, item)
    }
    for (const batch of groupsOf(Array.from(uniqueItems.values()), 100)) {
      if (!this.isStickerEnrichmentFenceCurrent(accountId, fence)) return
      if (!this.publishEvent(
        accountId,
        'sticker_details',
        { items: batch },
        fence.runtimeGeneration
      )) return
    }
  }

  private isStickerEnrichmentFenceCurrent(
    accountId: number,
    fence: StickerEnrichmentFence
  ): boolean {
    return this.running &&
      this.bindings.get(accountId)?.runtimeGeneration === fence.runtimeGeneration
  }

  private stickerDetailLookupKey(
    accountId: number,
    runtimeGeneration: string,
    stickerId: number
  ): string {
    return `${accountId}:${runtimeGeneration}:${stickerId}`
  }

  private readStickerDetailCache(
    accountId: number,
    runtimeGeneration: string,
    stickerId: number
  ): StickerDetailMetadata | null | undefined {
    const key = this.stickerDetailLookupKey(accountId, runtimeGeneration, stickerId)
    const entry = this.stickerDetailCache.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.stickerDetailCache.delete(key)
      return undefined
    }
    this.stickerDetailCache.delete(key)
    this.stickerDetailCache.set(key, entry)
    return entry.detail
  }

  private writeStickerDetailCache(
    accountId: number,
    runtimeGeneration: string,
    stickerId: number,
    detail: StickerDetailMetadata | null
  ): void {
    const key = this.stickerDetailLookupKey(accountId, runtimeGeneration, stickerId)
    this.stickerDetailCache.delete(key)
    this.stickerDetailCache.set(key, {
      detail,
      expiresAt: detail === null ? Date.now() + STICKER_DETAIL_NEGATIVE_CACHE_MS : null
    })
    while (this.stickerDetailCache.size > MAX_STICKER_DETAIL_CACHE_ENTRIES) {
      const oldestKey = this.stickerDetailCache.keys().next().value as string | undefined
      if (!oldestKey) break
      this.stickerDetailCache.delete(oldestKey)
    }
  }

  private isCurrentGeneration(accountId: number, runtimeGeneration: string): boolean {
    return this.bindings.get(accountId)?.runtimeGeneration === runtimeGeneration
  }

  private async initialSync(accountId: number, runtimeGeneration: string): Promise<void> {
    try {
      const friends: Record<string, unknown>[] = []
      for (let page = 1; page <= 100; page += 1) {
        const batch = await this.zaloRuntime.getAllFriendsPage(accountId, 500, page)
        if (!this.isCurrentGeneration(accountId, runtimeGeneration)) return
        friends.push(...batch)
        if (batch.length < 500) break
      }
      for (const batch of groupsOf(friends, 200)) {
        this.publishEvent(accountId, 'account_users_snapshot', {
          source: 'friends',
          users: batch.map(user => this.userSnapshot(user)).filter(Boolean)
        }, runtimeGeneration)
      }
    } catch (error) {
      this.logError(`initial friends ${accountId}`, error)
    }

    try {
      const groupVersions = await this.zaloRuntime.getAllGroups(accountId)
      if (!this.isCurrentGeneration(accountId, runtimeGeneration)) return
      this.knownGroupIdsByAccount.set(accountId, new Set(Object.keys(groupVersions)))
      for (const groupIds of groupsOf(Object.keys(groupVersions), 50)) {
        const response = await this.zaloRuntime.getGroupInfoBatch(accountId, groupIds)
        if (!this.isCurrentGeneration(accountId, runtimeGeneration)) return
        for (const [groupId, group] of Object.entries(response.gridInfoMap)) {
          this.publishEvent(accountId, 'account_groups_snapshot', {
            source: 'lookup',
            groups: [this.groupSnapshot(groupId, group, false)]
          }, runtimeGeneration)
        }
      }
    } catch (error) {
      this.logError(`initial groups ${accountId}`, error)
    }

    try {
      const knownGroupIds = this.knownGroupIdsByAccount.get(accountId) ?? new Set()
      const labels = await this.zaloRuntime.listLabels(accountId)
      if (!this.isCurrentGeneration(accountId, runtimeGeneration)) return
      this.publishEvent(accountId, 'account_tags_snapshot', {
        source: 'labels',
        tags: labels.map(label => ({
          zaloId: String(label.id),
          name: label.text,
          textKey: label.textKey,
          color: label.color,
          emoji: label.emoji,
          conversationZaloIds: (label.conversations ?? []).map(id => {
            const normalized = String(id).trim()
            return normalized.startsWith('g') && knownGroupIds.has(normalized.slice(1))
              ? normalized.slice(1)
              : normalized
          })
        }))
      }, runtimeGeneration)
    } catch (error) {
      this.logError(`initial tags ${accountId}`, error)
    }

    // This uses the same old_messages/old_reactions listener pipeline as Server.
    try {
      const api = await this.zaloRuntime.ensureApi(accountId)
      if (!this.isCurrentGeneration(accountId, runtimeGeneration)) return
      api.listener.requestOldMessages(ThreadType.User, null)
      api.listener.requestOldMessages(ThreadType.Group, null)
      api.listener.requestOldReactions(ThreadType.User, null)
      api.listener.requestOldReactions(ThreadType.Group, null)
    } catch (error) {
      this.logError(`initial conversations ${accountId}`, error)
    }
  }

  private userSnapshot(user: Record<string, unknown>): Record<string, unknown> | null {
    const zaloId = text(user.userId, user.uid, user.id)
    if (!zaloId) return null
    return {
      zaloId,
      globalId: text(user.globalId),
      username: text(user.username),
      displayName: text(user.displayName, user.display_name),
      zaloName: text(user.zaloName, user.zalo_name),
      avatarUrl: text(user.avatar),
      backgroundAvatarUrl: text(user.bgavatar),
      coverUrl: text(user.cover),
      gender: Number(user.gender) === 0
        ? 'male'
        : Number(user.gender) === 1
          ? 'female'
          : 'unknown',
      dobRaw: finiteNumber(user.dob),
      sdob: text(user.sdob),
      statusText: text(user.status),
      phoneNumber: text(user.phoneNumber, user.phone),
      isFriend: Number(user.isFr ?? user.isFriend) === 1 || user.isFriend === true,
      isBlocked: Number(user.isBlocked) === 1 || user.isBlocked === true
    }
  }

  private groupSnapshot(
    groupId: string,
    input: Record<string, unknown>,
    memberSnapshotComplete: boolean,
    memberProfiles: Record<string, unknown>[] = []
  ): Record<string, unknown> {
    const settings = record(input.setting)
    const currentMembers = Array.isArray(input.currentMems)
      ? input.currentMems.map(record)
      : []
    const memberIds = Array.from(new Set([
      ...(memberSnapshotComplete ? stringArray(input.memberIds) : []),
      ...currentMembers.map(member => text(member.id, member.uid)).filter(
        (id): id is string => !!id
      ),
      ...memberProfiles.map(member => text(member.zaloUid, member.id)).filter(
        (id): id is string => !!id
      )
    ]))
    const members = [
      ...currentMembers.map(member => ({
        zaloId: text(member.id, member.uid),
        globalId: text(member.globalId),
        displayName: text(member.dName, member.displayName, member.name),
        zaloName: text(member.zaloName, member.zalo_name),
        avatarUrl: text(member.avatar),
        accountStatusCode: finiteNumber(member.accountStatus),
        userTypeCode: finiteNumber(member.type),
        lastUpdateTime: finiteNumber(member.lastUpdateTime)
      })),
      ...memberProfiles.map(member => ({
        zaloId: text(member.zaloUid, member.id),
        globalId: text(member.globalId),
        displayName: text(member.displayName),
        zaloName: text(member.zaloName),
        avatarUrl: text(member.avatar),
        accountStatusCode: finiteNumber(member.accountStatus),
        userTypeCode: finiteNumber(member.type),
        lastUpdateTime: finiteNumber(member.lastUpdateTime)
      }))
    ].filter(member => !!member.zaloId)
    return {
      zaloId: text(input.groupId) || groupId,
      globalId: text(input.globalId),
      creatorZaloId: text(input.creatorId),
      name: text(input.name),
      description: text(input.desc, input.description),
      groupType: Number(input.type) === 2 ? 'community' : 'group',
      version: text(input.version),
      avatarUrl: text(input.avt, input.avatar),
      fullAvatarUrl: text(input.fullAvt),
      hasMoreMember: Number(input.hasMoreMember) === 1,
      totalMember: finiteNumber(input.totalMember),
      maxMember: finiteNumber(input.maxMember),
      visibility: finiteNumber(input.visibility),
      e2ee: Number(input.e2ee) === 1,
      memberIds,
      adminIds: stringArray(input.adminIds),
      memberSnapshotComplete,
      members,
      settings: {
        blockName: settings.blockName,
        signAdminMessage: settings.signAdminMsg,
        addMemberOnly: settings.addMemberOnly,
        setTopicOnly: settings.setTopicOnly,
        enableMessageHistory: settings.enableMsgHistory,
        joinApproval: settings.joinAppr,
        lockCreatePost: settings.lockCreatePost,
        lockCreatePoll: settings.lockCreatePoll,
        lockSendMessage: settings.lockSendMsg,
        lockViewMember: settings.lockViewMember,
        banFeature: settings.bannFeature,
        dirtyMedia: settings.dirtyMedia,
        banDuration: settings.banDuration
      }
    }
  }

  private async syncGroupSnapshot(
    accountId: number,
    groupId: string,
    includeMembers: boolean
  ): Promise<void> {
    if (includeMembers) {
      const result = await this.zaloRuntime.getJoinedGroupMembers(accountId, groupId)
      this.publishEvent(accountId, 'account_groups_snapshot', {
        source: 'lookup',
        groups: [this.groupSnapshot(
          groupId,
          result.group,
          result.memberSnapshotComplete === true,
          result.members.map(member => ({ ...member }))
        )]
      })
      return
    }
    const response = await this.zaloRuntime.getGroupInfoBatch(accountId, [groupId])
    const group = response.gridInfoMap[groupId]
    if (!group) return
    const knownGroups = this.knownGroupIdsByAccount.get(accountId) ?? new Set<string>()
    knownGroups.add(groupId)
    this.knownGroupIdsByAccount.set(accountId, knownGroups)
    this.publishEvent(accountId, 'account_groups_snapshot', {
      source: 'lookup',
      groups: [this.groupSnapshot(groupId, group, false)]
    })
  }

  private async handleQrCommand(command: LocalQrCommand): Promise<void> {
    const accountId = Number(command.autoAccountId)
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return
    if (command.command === 'cancel') {
      this.zaloRuntime.cancelLoginQr(accountId)
      return
    }
    this.bindingConflicts.delete(accountId)
    this.qrLoginAccounts.add(accountId)
    this.refreshSoon()
    this.activeQrOperations.set(accountId, command.operationId)
    try {
      const claim = await this.supabase.claimZaloAccountRuntimeOperation(accountId, 'desktop', false)
      if (!claim.claimed || !claim.previousStatus) {
        const message = claim.reason === 'runtime_not_owner'
          ? 'Tài khoản không còn chạy bằng akaAgent local.'
          : 'Tài khoản Zalo đang thực hiện một tác vụ khác.'
        this.sendLocalQrEvent(accountId, 'failed', { message })
        this.activeQrOperations.delete(accountId)
        this.qrLoginAccounts.delete(accountId)
        return
      }
      this.qrClaimPreviousStatus.set(accountId, claim.previousStatus)
      const result = await this.zaloRuntime.startLoginQr(accountId)
      if (!result.success) {
        this.sendLocalQrEvent(accountId, 'failed', { message: result.reason || 'Không thể tạo QR.' })
        this.activeQrOperations.delete(accountId)
        this.qrLoginAccounts.delete(accountId)
        await this.releaseQrClaim(accountId)
        return
      }
      this.markAccountQrLoginInProgress(accountId)
      void this.zaloRuntime.waitForLoginQrIdle(accountId)
        .then(() => this.releaseQrClaim(accountId))
        .then(() => {
          // Terminal QR events remove the operation before the zca-js login
          // promise settles. Reconcile only after both conditions are true.
          if (!this.activeQrOperations.has(accountId)) this.refreshSoon()
        })
        .catch(error => this.logError(`finish QR ${accountId}`, error))
    } catch (error) {
      this.sendLocalQrEvent(accountId, 'failed', {
        message: error instanceof Error ? error.message : 'Không thể tạo QR.'
      })
      this.activeQrOperations.delete(accountId)
      this.qrLoginAccounts.delete(accountId)
      await this.releaseQrClaim(accountId)
    }
  }

  private releaseQrClaim(accountId: number): Promise<void> {
    const inFlight = this.qrClaimReleases.get(accountId)
    if (inFlight) return inFlight
    const previousStatus = this.qrClaimPreviousStatus.get(accountId)
    if (!previousStatus) return Promise.resolve()
    const release = this.supabase
      .releaseZaloAccountRuntimeOperation(accountId, 'desktop', previousStatus)
      .then(() => {
        if (this.qrClaimPreviousStatus.get(accountId) === previousStatus) {
          this.qrClaimPreviousStatus.delete(accountId)
        }
      })
      .finally(() => {
        if (this.qrClaimReleases.get(accountId) === release) {
          this.qrClaimReleases.delete(accountId)
        }
      })
    this.qrClaimReleases.set(accountId, release)
    return release
  }

  private async handleLocalQrEvent(event: ZaloLoginQrEvent): Promise<void> {
    if (event.status === 'qr' || event.status === 'scanned') {
      this.qrLoginAccounts.add(event.accountId)
    } else {
      this.qrLoginAccounts.delete(event.accountId)
    }
    if (event.status === 'qr') {
      this.bindingConflicts.delete(event.accountId)
      // This event is emitted by the shared ZaloRuntimeService for both QR
      // entry points: Chat Web and the akaAgent account UI.
      this.markAccountQrLoginInProgress(event.accountId)
      this.refreshSoon()
    }
    if (!this.activeQrOperations.has(event.accountId)) {
      if (event.status !== 'qr' && event.status !== 'scanned') {
        // Direct akaAgent QR has no Chat operation/finalizer. Wait until the
        // zca-js login promise really settles before checking the local session.
        await this.zaloRuntime.waitForLoginQrIdle(event.accountId)
        this.refreshSoon()
      }
      return
    }
    if (event.status === 'qr') {
      const qrImageBase64 = String(event.qrImage || '').replace(/^data:image\/[^;]+;base64,/i, '')
      this.sendLocalQrEvent(event.accountId, 'qr_generated', { qrImageBase64 })
      return
    }
    if (event.status === 'scanned') {
      this.sendLocalQrEvent(event.accountId, 'qr_scanned', {
        displayName: event.displayName,
        avatarUrl: event.avatarUrl
      })
      return
    }
    if (event.status === 'success') {
      try {
        // runLoginQr emits success only after the local session and identity were persisted.
        const profile = await this.zaloRuntime.getOwnProfileForChat(event.accountId)
        this.sendLocalQrEvent(event.accountId, 'succeeded', {
          displayName: event.displayName,
          avatarUrl: event.avatarUrl,
          profile
        })
      } catch (error) {
        this.sendLocalQrEvent(event.accountId, 'failed', {
          message: `Đã lưu session local nhưng không lấy được profile Chat: ${
            error instanceof Error ? error.message : 'Lỗi không xác định'
          }`
        })
        this.activeQrOperations.delete(event.accountId)
        await this.zaloRuntime.waitForLoginQrIdle(event.accountId)
        await this.releaseQrClaim(event.accountId)
        this.refreshSoon()
      }
      return
    }
    const status = event.status === 'expired'
      ? 'qr_expired'
      : event.status === 'declined'
        ? 'declined'
        : event.status === 'cancelled'
          ? 'cancelled'
          : 'failed'
    this.sendLocalQrEvent(event.accountId, status, { message: event.message })
    this.activeQrOperations.delete(event.accountId)
  }

  private sendLocalQrEvent(
    accountId: number,
    status: string,
    extra: Record<string, unknown>
  ): void {
    const operationId = this.activeQrOperations.get(accountId)
    if (!operationId) return
    this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: 'runtime.local_qr_login.event',
      runtimeId: this.runtimeId,
      operationId,
      autoAccountId: String(accountId),
      status,
      ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
      occurredAt: new Date().toISOString()
    })
  }

  private async handleQrBindingResult(result: LocalQrBindingResult): Promise<void> {
    const accountId = Number(result.autoAccountId)
    if (this.activeQrOperations.get(accountId) !== result.operationId) return
    this.activeQrOperations.delete(accountId)
    if (
      result.status === 'succeeded' &&
      result.runtimeGeneration &&
      result.expectedZaloId
    ) {
      await this.attachAccount(accountId, {
        autoAccountId: result.autoAccountId,
        chatZaloAccountId: '',
        chatZaloAccountOrganizationId: '',
        runtimeGeneration: result.runtimeGeneration,
        zaloId: result.expectedZaloId
      })
    } else if (result.errorMessage) {
      if (
        result.errorCode === 'zalo_already_linked' ||
        result.errorCode === 'account_already_has_another_zalo'
      ) {
        this.bindingConflicts.set(accountId, {
          code: result.errorCode,
          message: result.errorMessage
        })
      }
      console.warn(`[LocalChatSync] account ${accountId}: ${result.errorMessage}`)
      // The QR finalizer may have completed while the operation was still
      // waiting for this binding result, so request reconcile after every
      // binding failure instead of only business conflicts.
      this.refreshSoon()
    }
  }

  private handleCommand(command: RuntimeCommand): void {
    const accountId = Number(command.autoAccountId)
    const previous = this.commandQueues.get(accountId) ?? Promise.resolve()
    const execution = previous
      .catch(() => undefined)
      .then(async () => {
        this.sendCommandResult(command, 'accepted')
        try {
          const result = await this.executeCommand(accountId, command)
          this.sendCommandResult(command, 'succeeded', result)
        } catch (error) {
          this.sendCommandResult(
            command,
            'failed',
            undefined,
            error instanceof Error ? error.message : 'Lệnh Zalo local thất bại.'
          )
        }
      })
    this.commandQueues.set(accountId, execution)
    void execution.finally(() => {
      if (this.commandQueues.get(accountId) === execution) this.commandQueues.delete(accountId)
    })
  }

  private async executeCommand(accountId: number, command: RuntimeCommand): Promise<unknown> {
    const binding = this.bindings.get(accountId)
    const attached = this.attached.get(accountId)
    if (!binding || binding.runtimeGeneration !== command.runtimeGeneration) {
      throw new Error('Lệnh thuộc runtime generation cũ hoặc tài khoản chưa attach.')
    }
    if (!attached?.ready) throw new Error('Socket Zalo local của tài khoản chưa sẵn sàng.')
    const payload = record(command.payload)
    const api = await this.zaloRuntime.ensureApi(accountId)
    const targetType = threadType(payload.threadType)
    switch (command.commandType) {
      case 'send_text':
        return api.sendMessage(
          payload.quote ? { msg: String(payload.message || ''), quote: payload.quote as any } :
            String(payload.message || ''),
          String(payload.threadId || ''),
          targetType
        )
      case 'send_media': {
        const data = Buffer.from(String(payload.dataBase64 || ''), 'base64')
        const attachment: AttachmentSource = {
          data,
          filename: String(payload.fileName || 'file.bin') as `${string}.${string}`,
          metadata: {
            totalSize: Number(payload.fileSizeBytes || data.length),
            ...(finiteNumber(payload.width) === undefined ? {} : { width: Number(payload.width) }),
            ...(finiteNumber(payload.height) === undefined ? {} : { height: Number(payload.height) })
          }
        }
        return api.sendMessage(
          { msg: String(payload.caption || ''), attachments: attachment },
          String(payload.threadId || ''),
          targetType
        )
      }
      case 'send_sticker':
        return api.sendSticker({
          id: Number(payload.stickerId),
          cateId: Number(payload.categoryId),
          type: Number(payload.stickerType)
        }, String(payload.threadId || ''), targetType)
      case 'add_reaction':
        return api.addReaction(String(payload.reactionIcon) as any, {
          data: {
            msgId: String(payload.messageId || ''),
            cliMsgId: String(payload.clientMessageId || '')
          },
          threadId: String(payload.threadId || ''),
          type: targetType
        })
      case 'recall_message':
        return api.undo(
          {
            msgId: String(payload.messageId || ''),
            cliMsgId: String(payload.clientMessageId || '')
          },
          String(payload.threadId || ''),
          targetType
        )
      case 'search_stickers': {
        const basics = await api.searchSticker(String(payload.keyword || ''), Number(payload.limit || 24))
        return basics.length > 0
          ? api.getStickersDetail(basics.map(sticker => sticker.sticker_id))
          : []
      }
      case 'find_user': {
        const found = await this.zaloRuntime.findUserByPhone(
          accountId,
          String(payload.phoneNumber || '')
        )
        if (found.user) {
          const status = await this.zaloRuntime.getFriendRequestStatus(accountId, found.user.uid)
          const friendship = {
            isFriend: status.isFriend,
            isRequested: status.isRequested,
            isRequesting: status.isRequesting,
            canSendFriendRequest: !status.isFriend && !status.isRequested && !status.isRequesting
          }
          const friendshipStatusCode = status.isFriend
            ? 'friend'
            : status.isRequesting
              ? 'request_sent'
              : status.isRequested
                ? 'request_received'
                : 'stranger'
          this.publishEvent(accountId, 'account_users_snapshot', {
            source: 'lookup',
            users: [{
              zaloId: found.user.uid,
              displayName: found.user.displayName,
              zaloName: found.user.originalName,
              avatarUrl: found.user.avatar,
              phoneNumber: found.user.phone || payload.phoneNumber,
              isFriend: status.isFriend,
              friendshipStatusCode
            }]
          })
          return {
            ...found.user.raw,
            uid: found.user.uid,
            display_name: found.user.displayName,
            zalo_name: found.user.originalName,
            avatar: found.user.avatar,
            phoneNumber: found.user.phone || payload.phoneNumber,
            friendship
          }
        }
        return null
      }
      case 'get_user_presence':
        return getUserPresence(api, String(payload.userId || ''))
      case 'send_friend_request':
        return this.zaloRuntime.sendFriendRequestToUser(
          accountId,
          String(payload.userId || ''),
          String(payload.message || '')
        )
      case 'accept_friend_request':
        return api.acceptFriendRequest(String(payload.userId || ''))
      case 'reject_friend_request':
        return api.rejectFriendRequest(String(payload.userId || ''))
      case 'change_friend_display_name':
        return this.zaloRuntime.changeUserAlias(
          accountId,
          String(payload.userId || ''),
          String(payload.displayName || '')
        )
      case 'create_group': {
        const members = Array.isArray(payload.memberIds)
          ? payload.memberIds.map(String)
          : []
        const result = await api.createGroup({ name: String(payload.name || ''), members })
        if (result.groupId) await this.syncGroupSnapshot(accountId, result.groupId, false)
        return result
      }
      case 'set_conversation_tag':
        return this.setConversationTag(accountId, api, payload)
      case 'sync_group_members':
        await this.syncGroupSnapshot(accountId, String(payload.threadId || ''), true)
        return { groupId: String(payload.threadId || '') }
      default:
        throw new Error(`Runtime local chưa hỗ trợ lệnh ${command.commandType}.`)
    }
  }

  private async setConversationTag(
    accountId: number,
    api: API,
    payload: Record<string, unknown>
  ): Promise<unknown> {
    const current = await api.getLabels()
    const tagZaloId = payload.tagZaloId === null ? null : String(payload.tagZaloId || '')
    const rawConversationId = payload.threadType === 'group'
      ? `g${String(payload.threadId || '')}`
      : String(payload.threadId || '')
    let found = tagZaloId === null
    const labelData = current.labelData.map(label => {
      if (String(label.id) === tagZaloId) found = true
      const conversations = label.conversations.filter(id => id !== rawConversationId)
      if (String(label.id) === tagZaloId) conversations.push(rawConversationId)
      return { ...label, conversations }
    })
    if (!found) throw new Error('Nhãn Zalo không tồn tại trên tài khoản này.')
    const result = await api.updateLabels({ labelData, version: current.version })
    const labels = await this.zaloRuntime.listLabels(accountId)
    const knownGroupIds = this.knownGroupIdsByAccount.get(accountId) ?? new Set<string>()
    this.publishEvent(accountId, 'account_tags_snapshot', {
      source: 'labels',
      tags: labels.map(label => ({
        zaloId: String(label.id),
        name: label.text,
        textKey: label.textKey,
        color: label.color,
        emoji: label.emoji,
        conversationZaloIds: (label.conversations ?? []).map(conversationId => {
          const normalized = String(conversationId).trim()
          return normalized.startsWith('g') && knownGroupIds.has(normalized.slice(1))
            ? normalized.slice(1)
            : normalized
        })
      }))
    })
    return result
  }

  private sendCommandResult(
    command: RuntimeCommand,
    status: 'accepted' | 'succeeded' | 'failed',
    result?: unknown,
    errorMessage?: string
  ): void {
    this.send({
      protocolVersion: PROTOCOL_VERSION,
      kind: 'zalo.command.result',
      actionId: command.actionId,
      runtimeId: this.runtimeId,
      status,
      ...(result === undefined ? {} : { result }),
      ...(errorMessage ? { errorCode: 'local_command_failed', errorMessage } : {}),
      completedAt: new Date().toISOString()
    })
  }

  private send(message: unknown): boolean {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }

  private sendPendingEvent(
    event: PendingRuntimeEvent,
    expectedSocket: WebSocket | null = this.socket
  ): void {
    const socket = this.socket
    if (!socket || socket !== expectedSocket || socket.readyState !== WebSocket.OPEN) return
    if (event.sent && event.replayAttempts >= MAX_UNACKNOWLEDGED_EVENT_REPLAYS) {
      this.pendingEvents.delete(event.eventId)
      this.logDroppedUnacknowledgedEvent(event)
      return
    }
    socket.send(event.wire)
    if (event.sent) event.replayAttempts += 1
    else event.sent = true
  }

  private stopAfterReconnectExhaustion(): void {
    if (!this.running) return
    const pendingEventCount = this.pendingEvents.size
    console.warn(
      `[LocalChatSync] control websocket stopped after the initial connection and ` +
      `${MAX_CONTROL_RECONNECT_ATTEMPTS} reconnect attempts failed; ` +
      `pendingEvents=${pendingEventCount}.`
    )

    // Stop producing more raw events once transport recovery is exhausted. Keep
    // the current pending map intact for diagnostics; an explicit stop/logout
    // still owns the normal lifecycle cleanup.
    this.running = false
    this.welcomed = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.heartbeatAckTimer) clearTimeout(this.heartbeatAckTimer)
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer)
    this.reconnectTimer = null
    this.reconcileTimer = null
    this.heartbeatTimer = null
    this.heartbeatAckTimer = null
    this.welcomeTimer = null
    this.unsubscribeQr?.()
    this.unsubscribeQr = null
    for (const account of this.attached.values()) account.unsubscribe()
    for (const timer of this.listenerStabilityTimers.values()) clearTimeout(timer)
    this.listenerStabilityTimers.clear()
    this.attached.clear()
    this.bindings.clear()
    this.attachedOnConnection.clear()
    this.lastSentStatusFingerprintByAccount.clear()
    this.knownGroupIdsByAccount.clear()
    this.resetStickerDetails()
    const socket = this.socket
    this.socket = null
    this.liveEventSocket = null
    try { socket?.close(1011, 'local Chat control retry exhausted') } catch {}
  }

  private logUnserializableEvent(accountId: number, eventType: string): void {
    const safeEventType = String(eventType || 'unknown')
      .replace(/[\u0000-\u001f\u007f]/g, '?')
      .slice(0, 150) || 'unknown'
    console.warn(
      `[LocalChatSync] skipped unserializable event accountId=${accountId} ` +
      `eventType=${safeEventType}.`
    )
  }

  private logDroppedUnacknowledgedEvent(event: PendingRuntimeEvent): void {
    const safeEventType = String(event.eventType || 'unknown')
      .replace(/[\u0000-\u001f\u007f]/g, '?')
      .slice(0, 150) || 'unknown'
    console.warn(
      `[LocalChatSync] dropped unacknowledged event after ` +
      `${MAX_UNACKNOWLEDGED_EVENT_REPLAYS} replays accountId=${event.autoAccountId} ` +
      `eventType=${safeEventType}.`
    )
  }

  private logError(context: string, error: unknown): void {
    console.warn(`[LocalChatSync] ${context}:`, error instanceof Error ? error.message : error)
  }
}
