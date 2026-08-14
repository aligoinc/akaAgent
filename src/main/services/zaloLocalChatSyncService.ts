import { randomUUID } from 'node:crypto'

import WebSocket from 'ws'
import { CloseReason, ThreadType } from 'zca-js'
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
const MAX_PENDING_EVENTS = 500

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

interface ProtocolError {
  protocolVersion: 1
  kind: 'protocol.error'
  code: string
  message: string
  retryable: boolean
}

type IncomingMessage = RuntimeCommand | LocalQrCommand | LocalQrBindingResult |
  LocalRetryAttachCommand |
  EventAck | RuntimeWelcome | ProtocolError

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

interface AttachedAccount extends LocalRuntimeBindingRegistration {
  accountId: number
  unsubscribe: () => void
  initialSyncGeneration: string | null
  ready: boolean
  readyStatusVersion: number
  listenerFailureVersion: number
}

interface BindingConflict {
  code: ZaloChatBindingConflictCode
  message: string
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
  private running = false
  private welcomed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly attached = new Map<number, AttachedAccount>()
  private readonly bindings = new Map<number, LocalRuntimeBindingRegistration>()
  private readonly sequenceByAccount = new Map<number, bigint>()
  private readonly pendingEvents = new Map<string, RuntimeEventMessage>()
  private readonly attachedOnConnection = new Set<number>()
  private readonly activeQrOperations = new Map<number, string>()
  private readonly qrLoginAccounts = new Set<number>()
  private readonly qrClaimPreviousStatus = new Map<number, PreviousZaloAccountStatus>()
  private readonly qrClaimReleases = new Map<number, Promise<void>>()
  private readonly commandQueues = new Map<number, Promise<void>>()
  private readonly knownGroupIdsByAccount = new Map<number, Set<string>>()
  private readonly bindingConflicts = new Map<number, BindingConflict>()
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
    if (!this.running) return
    this.running = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.reconnectTimer = null
    this.reconcileTimer = null
    this.heartbeatTimer = null
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
    this.commandQueues.clear()
    this.knownGroupIdsByAccount.clear()
    this.bindingConflicts.clear()
    this.eligibleAccountFingerprint = ''
    this.welcomed = false
    const socket = this.socket
    this.socket = null
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
        headers: { authorization: `Bearer ${session.token}` }
      })
      this.socket = socket
      socket.on('open', () => {
        if (this.socket !== socket || !this.running) return
        this.reconnectAttempt = 0
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
      })
      let incomingProcessing = Promise.resolve()
      let incomingFailed = false
      socket.on('message', raw => {
        if (incomingFailed) return
        incomingProcessing = incomingProcessing
          .then(() => this.handleIncoming(String(raw)))
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
        this.welcomed = false
        this.attachedOnConnection.clear()
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
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
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5))
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private async handleIncoming(raw: string): Promise<void> {
    const message = JSON.parse(raw) as IncomingMessage
    if (message.kind === 'runtime.welcome') {
      this.welcomed = true
      this.heartbeatTimer = setInterval(() => {
        this.send({
          protocolVersion: PROTOCOL_VERSION,
          kind: 'runtime.heartbeat',
          runtimeId: this.runtimeId,
          sentAt: new Date().toISOString()
        })
      }, HEARTBEAT_INTERVAL_MS)
      this.heartbeatTimer.unref()
      await this.reconcile()
      for (const event of this.pendingEvents.values()) {
        if (this.attachedOnConnection.has(Number(event.autoAccountId))) this.send(event)
      }
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

  private async reconcile(): Promise<void> {
    if (!this.running || !this.welcomed) return
    const listedAccounts = await this.supabase.listAccounts()
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
      try {
        const session = await this.zaloRuntime.checkSession(account.id)
        if (!session.loggedIn) {
          this.detachAccount(account.id, session.reason || 'Session Zalo local không còn hiệu lực')
          continue
        }
        const profile = await this.zaloRuntime.getOwnProfileForChat(account.id)
        const candidateZaloId = text(profile.zaloId)
        if (!candidateZaloId) {
          this.detachAccount(account.id, 'Không xác định được Zalo ID của session local')
          continue
        }
        const binding = await this.chatApi.registerLocalRuntimeAccount(
          account.id,
          candidateZaloId
        )
        this.bindingConflicts.delete(account.id)
        await this.attachAccount(account.id, binding)
      } catch (error) {
        if (this.rememberBindingConflict(account.id, error)) {
          this.detachAccount(account.id, this.bindingConflicts.get(account.id)!.message)
          continue
        }
        this.logError(`register account ${account.id}`, error)
      }
    }
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
    const binding = this.bindings.get(accountId)
    const attached = this.attached.get(accountId)
    if (!binding && !attached) return
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
  }

  private async attachAccount(
    accountId: number,
    binding: LocalRuntimeBindingRegistration
  ): Promise<void> {
    const previousBinding = this.bindings.get(accountId) ?? this.attached.get(accountId)
    const generationChanged = previousBinding !== undefined &&
      previousBinding.runtimeGeneration !== binding.runtimeGeneration

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

    this.bindings.set(accountId, binding)
    attachmentSocket.send(JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      kind: 'runtime.attach_account',
      runtimeId: this.runtimeId,
      autoAccountId: String(accountId),
      runtimeGeneration: binding.runtimeGeneration
    }))
    this.attachedOnConnection.add(accountId)
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
        listenerFailureVersion: 0
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
    const listenerFailureVersion = attached.listenerFailureVersion
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

      attached.ready = true
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
      message: payload => this.publishEvent(accountId, 'message', payload),
      oldMessages: (messages, type) => this.publishEvent(
        accountId,
        'old_messages',
        { messages, type }
      ),
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
      attached.readyStatusVersion += 1
      this.reportStatus(event.accountId, 'ready')
    }
    else if (event.status === 'starting') this.reportStatus(event.accountId, 'connecting')
    else if (event.status === 'disconnected') {
      this.reportStatus(event.accountId, 'reconnecting', event.error, event.code, event.reason)
    } else if (event.status === 'closed') {
      attached.listenerFailureVersion += 1
      this.reportStatus(
        event.accountId,
        event.code === CloseReason.KickConnection ? 'kicked' : 'disconnected',
        event.error,
        event.code,
        event.reason
      )
    } else if (event.status === 'error') {
      attached.listenerFailureVersion += 1
      this.reportStatus(event.accountId, 'error', event.error)
    }
    else if (event.status === 'stopped') this.reportStatus(event.accountId, 'stopped')
  }

  private markAccountQrLoginInProgress(accountId: number): void {
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
    this.send({
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
  }

  private publishEvent(
    accountId: number,
    eventType: string,
    payload: unknown,
    expectedRuntimeGeneration?: string
  ): void {
    const binding = this.bindings.get(accountId)
    if (!binding) return
    if (
      expectedRuntimeGeneration !== undefined &&
      binding.runtimeGeneration !== expectedRuntimeGeneration
    ) return
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
    this.pendingEvents.set(event.eventId, event)
    while (this.pendingEvents.size > MAX_PENDING_EVENTS) {
      const oldestId = this.pendingEvents.keys().next().value as string | undefined
      if (!oldestId) break
      this.pendingEvents.delete(oldestId)
    }
    if (this.attachedOnConnection.has(accountId)) this.send(event)
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

  private send(message: unknown): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }

  private logError(context: string, error: unknown): void {
    console.warn(`[LocalChatSync] ${context}:`, error instanceof Error ? error.message : error)
  }
}
