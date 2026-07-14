import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { IPC_EVENTS, type AuthUser, type AutoAccountContact, type ZaloLabelOption } from '../../shared/types'
import {
  ZALO_SERVER_IPC,
  ZALO_SERVER_OPERATION_UPDATED_CHANNEL,
  type ZaloServerCommandName,
  type ZaloServerOperationSnapshot,
  type ZaloServerOperationStatus,
  type ZaloServerRuntimeEvent,
  type ZaloServerRuntimeHandoffResponse,
  type ZaloServerRuntimeState,
  type ZaloServerSnapshot,
  type ZaloServerStaffSnapshot
} from '../../shared/zaloServerProtocol'
import { requireCurrentUser, runWithCurrentUser } from '../../main/data/currentUser'
import {
  listActiveZaloServerUsers,
  type ZaloServerRuntimeUser
} from '../../main/data/repositories/serverRuntimeRepository'
import {
  loadStaffZaloServerMode,
  loadStaffZaloServerModeSnapshot
} from '../../main/data/repositories/zaloRuntimeModeRepository'
import { WebviewRegistry } from '../../main/playwright/webviewController'
import { CampaignScheduler } from '../../main/services/campaignScheduler'
import { ContactLoader } from '../../main/services/contactLoader'
import { DailyMaintenanceCoordinator } from '../../main/services/dailyMaintenanceCoordinator'
import { ProxyRuntimeService } from '../../main/services/proxyRuntimeService'
import { SupabaseService } from '../../main/services/supabase'
import { ZaloRealtimeGroupCampaignManager } from '../../main/services/zaloRealtimeGroupCampaignManager'
import { ZaloRuntimeService } from '../../main/services/zaloRuntimeService'
import type { ServerRuntimeOwnershipStore } from './serverRuntimeOwnershipStore'

const RECONCILE_INTERVAL_MS = 60_000
const RECENT_EVENT_LIMIT = 1000
const RECENT_OPERATION_LIMIT_PER_STAFF = 200

interface StaffRuntime {
  user: ZaloServerRuntimeUser
  state: ZaloServerRuntimeState
  startedAt: string | null
  lastError: string | null
  supabase: SupabaseService | null
  scheduler: CampaignScheduler | null
  contactLoader: ContactLoader | null
  zaloRuntime: ZaloRuntimeService | null
  realtimeManager: ZaloRealtimeGroupCampaignManager | null
  eventWindow: BrowserWindow | null
  activeCommands: Set<Promise<unknown>>
  qrAccountClaims: Map<number, 'chờ xử lý' | 'tạm dừng'>
  qrReleasePromises: Map<number, Promise<void>>
  controlOperationIds: Map<number, string>
  stopDeferred: boolean
}

export interface ZaloServerRuntimeManagerOptions {
  adminWindow(): BrowserWindow | null
  publishEvent(event: ZaloServerRuntimeEvent): void
  publishLiveEvent(event: ZaloServerRuntimeEvent): void
  publishControlEvent(event: ZaloServerRuntimeEvent): void
  broadcastSnapshot(): void
  connectedClientCount(): number
  listeningAt(): string
  ownershipStore: ServerRuntimeOwnershipStore
}

function mapZaloLabelToContact(accountId: number, label: ZaloLabelOption): Partial<AutoAccountContact> {
  return {
    accountId,
    contactType: 'zalo_tag',
    uid: String(label.id),
    name: label.text,
    extraData: {
      textKey: label.textKey || undefined,
      color: label.color || undefined,
      emoji: label.emoji || undefined,
      conversations: Array.isArray(label.conversations)
        ? label.conversations.map(item => String(item || '').trim()).filter(Boolean)
        : []
    }
  }
}

function markServerCampaignLog(channel: string, payload: unknown): unknown {
  if (
    channel !== IPC_EVENTS.CAMPAIGN_LOG ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return payload
  }
  return { ...payload, source: 'server' }
}

function isUserFacingActivityChannel(channel: string): boolean {
  return channel === IPC_EVENTS.CAMPAIGN_LOG ||
    channel === IPC_EVENTS.ZALO_LOGIN_QR_EVENT ||
    channel === IPC_EVENTS.CONTACTS_PROGRESS ||
    channel === IPC_EVENTS.CONTACTS_COMPLETED
}

function isLiveUiStateChannel(channel: string): boolean {
  return channel === IPC_EVENTS.CAMPAIGN_STATUS_UPDATED ||
    channel === IPC_EVENTS.ACCOUNT_STATUS_UPDATED
}

export class ZaloServerRuntimeManager {
  private readonly startedAt = new Date().toISOString()
  private readonly runtimes = new Map<number, StaffRuntime>()
  private readonly recentEvents: ZaloServerRuntimeEvent[] = []
  private state: ZaloServerRuntimeState = 'stopped'
  private sequence = 0
  private reconcileTimer: ReturnType<typeof setInterval> | null = null
  private reconcilePromise: Promise<void> | null = null
  private readonly lifecycleTails = new Map<number, Promise<void>>()
  private initialDiscoveryComplete = false
  private lastDiscoveredStaffIds = new Set<number>()
  private readonly handoffRequiredStaffIds = new Set<number>()
  private readonly operations = new Map<string, ZaloServerOperationSnapshot>()

  constructor(private readonly options: ZaloServerRuntimeManagerOptions) {}

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return
    this.state = 'starting'
    this.notifySnapshot()
    this.reconcileTimer = setInterval(() => {
      void this.runReconcileCycle()
    }, RECONCILE_INTERVAL_MS)
    await this.runReconcileCycle()
  }

  private async runReconcileCycle(): Promise<void> {
    if (this.state === 'stopping' || this.state === 'stopped') return
    try {
      await this.reconcile()
      if (!this.isStoppingOrStopped()) this.state = 'running'
    } catch (error) {
      if (!this.isStoppingOrStopped()) this.state = 'error'
      console.error('[ZaloServerRuntimeManager] Reconcile failed:', error)
    } finally {
      this.notifySnapshot()
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') return
    this.state = 'stopping'
    if (this.reconcileTimer) clearInterval(this.reconcileTimer)
    this.reconcileTimer = null
    this.notifySnapshot()
    await this.reconcilePromise?.catch(() => {})
    await Promise.allSettled(Array.from(this.lifecycleTails.values()))
    await Promise.allSettled(Array.from(this.runtimes.keys()).map(staffId => this.stopRuntimeSerialized(staffId)))
    this.runtimes.clear()
    this.state = 'stopped'
    this.notifySnapshot()
  }

  async ensureUser(user: ZaloServerRuntimeUser): Promise<void> {
    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error('akaAgent Zalo Server đang dừng')
    }
    await this.runStaffLifecycle(user.staffId, async () => {
      if (this.state === 'stopping' || this.state === 'stopped') {
        throw new Error('akaAgent Zalo Server đang dừng')
      }
      if (!await runWithCurrentUser(user, () => loadStaffZaloServerMode(user.staffId))) {
        const existing = this.runtimes.get(user.staffId)
        if (existing) await this.stopRuntime(user.staffId)
        return
      }
      if (this.initialDiscoveryComplete && !this.lastDiscoveredStaffIds.has(user.staffId)) {
        this.handoffRequiredStaffIds.add(user.staffId)
      }
      const existing = this.runtimes.get(user.staffId)
      if (existing) {
        // A deferred stop may still have commands holding the old AuthUser
        // object through AsyncLocalStorage. Do not overwrite that object with
        // a newly discovered session before the stop has actually settled.
        if (existing.stopDeferred || existing.state === 'stopping') {
          await this.stopRuntime(user.staffId)
          if (this.runtimes.has(user.staffId)) return
          await this.startRuntime(user, this.handoffRequiredStaffIds.has(user.staffId))
          if (this.runtimes.get(user.staffId)?.state === 'running') {
            this.handoffRequiredStaffIds.delete(user.staffId)
          }
          return
        }
        Object.assign(existing.user, user)
        if (existing.state === 'running' || existing.state === 'starting') {
          this.options.ownershipStore.claim(user.staffId, user.zaloRuntimeModeRevision)
        }
        if (existing.state === 'waiting') {
          const runningState = await runWithCurrentUser(existing.user, () =>
            existing.supabase!.inspectStaffZaloRunningState(user.staffId)
          )
          if (runningState.hasRunningState) return
          this.runtimes.delete(user.staffId)
          await this.startRuntime(user, false)
          this.handoffRequiredStaffIds.delete(user.staffId)
          return
        }
        if (existing.state === 'running' || existing.state === 'starting') return
        await this.stopRuntime(user.staffId)
        if (this.runtimes.has(user.staffId)) return
      }
      await this.startRuntime(user, this.handoffRequiredStaffIds.has(user.staffId))
      if (this.runtimes.get(user.staffId)?.state === 'running') {
        this.handoffRequiredStaffIds.delete(user.staffId)
      }
    })
  }

  async handoffToDesktop(staffId: number): Promise<ZaloServerRuntimeHandoffResponse> {
    const normalizedStaffId = this.normalizePositiveId(staffId, 'Staff ID')
    const requestUser = requireCurrentUser()
    if (requestUser.staffId !== normalizedStaffId) {
      throw new Error('Không thể bàn giao runtime của staff khác')
    }

    return this.runStaffLifecycle(normalizedStaffId, () =>
      runWithCurrentUser(requestUser, async (): Promise<ZaloServerRuntimeHandoffResponse> => {
        // Authentication intentionally accepts mode=false, but a stale or
        // premature request must never stop the currently selected server.
        if (await loadStaffZaloServerMode(normalizedStaffId)) {
          const runtime = this.runtimes.get(normalizedStaffId)
          const supabase = runtime?.supabase || new SupabaseService()
          const runningState = await supabase.inspectStaffZaloRunningState(normalizedStaffId)
          return {
            success: false,
            serverOwned: true,
            settled: !runningState.hasRunningState,
            serverStopped: false,
            ownership: 'server',
            requiresDesktopRecovery: false,
            ...(runningState.hasRunningState ? { runningState } : {})
          }
        }

        // Remember an explicit server -> desktop handoff even when the flag is
        // toggled back to true before the next 60s discovery pass. A later
        // server start must inspect/wait for the desktop-owned rows.
        this.handoffRequiredStaffIds.add(normalizedStaffId)

        const runtime = this.runtimes.get(normalizedStaffId)
        const wasWaitingForDesktop = runtime?.state === 'waiting'
        const wasServerOwned = !!runtime && !wasWaitingForDesktop

        if (runtime) {
          await this.stopRuntime(normalizedStaffId)
        }

        const remainingRuntime = this.runtimes.get(normalizedStaffId)
        const processServerOwned = !!remainingRuntime && remainingRuntime.state !== 'waiting'
        const supabase = runtime?.supabase || remainingRuntime?.supabase || new SupabaseService()
        const liveIsZaloServer = await loadStaffZaloServerMode(normalizedStaffId)

        if (processServerOwned || liveIsZaloServer) {
          const runningState = await supabase.inspectStaffZaloRunningState(normalizedStaffId)
          this.notifySnapshot()
          return {
            success: false,
            serverOwned: true,
            settled: !runningState.hasRunningState,
            serverStopped: false,
            ownership: 'server',
            requiresDesktopRecovery: false,
            ...(runningState.hasRunningState ? { runningState } : {})
          }
        }

        // A waiting runtime never owned the rows; they may still belong to a
        // live desktop. With no runtime, only the durable marker proves that
        // rows were left by a previous crashed server session. Recover those
        // rows before acknowledging the lifecycle barrier, but never recover
        // unmarked rows here because they belong to desktop (or are otherwise
        // indistinguishable from desktop work without adding DB ownership).
        if (
          !wasWaitingForDesktop &&
          !wasServerOwned &&
          this.options.ownershipStore.has(normalizedStaffId)
        ) {
          await supabase.recoverServerZaloRunningState(normalizedStaffId)
          this.options.ownershipStore.release(normalizedStaffId)
        }

        const runningState = await supabase.inspectStaffZaloRunningState(normalizedStaffId)
        const settled = !runningState.hasRunningState
        const ownership = settled ? 'none' as const : 'desktop-or-unknown' as const
        this.notifySnapshot()
        return {
          // Success acknowledges that every server lifecycle action queued
          // before this request has settled and no live server runtime remains.
          // Desktop may still need to recover its own crashed rows below.
          success: true,
          serverOwned: false,
          settled,
          serverStopped: true,
          ownership,
          requiresDesktopRecovery: !settled,
          ...(settled ? {} : { runningState })
        }
      })
    )
  }

  /**
   * Start a browser/PWA command independently from the requesting socket. The
   * operation remains owned by the server runtime when that browser disconnects.
   */
  startControlOperation(
    staffId: number,
    command: ZaloServerCommandName,
    args: unknown[]
  ): ZaloServerOperationSnapshot {
    const runtime = this.runtimes.get(staffId)
    const organizationId = runtime?.user.organizationId
    if (
      !runtime ||
      runtime.state !== 'running' ||
      !runtime.supabase ||
      !runtime.scheduler ||
      !runtime.zaloRuntime ||
      !runtime.contactLoader ||
      !organizationId
    ) {
      throw new Error('Runtime Zalo của staff chưa sẵn sàng')
    }
    const accountId = command === 'campaign.pause'
      ? null
      : this.normalizeAccountId(args[0])
    const timestamp = new Date().toISOString()
    const operation: ZaloServerOperationSnapshot = {
      operationId: randomUUID(),
      staffId,
      organizationId,
      command,
      accountId,
      status: 'running',
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    }
    this.operations.set(operation.operationId, operation)
    this.pruneOperations(staffId)
    this.emitOperationUpdate(runtime.user, operation)

    // Deliberately detach from the WebSocket request. Gateway disconnects only
    // stop delivery; runtime ownership/cleanup stays with this promise.
    void this.executeCommand(staffId, command, args, operation.operationId)
      .then(result => {
        const safeResult = this.sanitizeControlOperationResult(command, result)
        if (command === 'zalo.loginQr.start') {
          const started = !!(result && typeof result === 'object' && (result as { success?: unknown }).success)
          if (started) {
            this.updateOperation(operation.operationId, 'running', safeResult)
          } else {
            const reason = result && typeof result === 'object'
              ? String((result as { reason?: unknown }).reason || 'Không thể bắt đầu đăng nhập QR')
              : 'Không thể bắt đầu đăng nhập QR'
            this.updateOperation(operation.operationId, 'failed', safeResult, reason)
          }
          return
        }
        const stopped = !!(result && typeof result === 'object' && (result as { stopped?: unknown }).stopped)
        const reportedFailure = !!(
          result &&
          typeof result === 'object' &&
          (result as { success?: unknown }).success === false
        )
        if (reportedFailure) {
          const failure = result as { error?: unknown; reason?: unknown }
          this.updateOperation(
            operation.operationId,
            'failed',
            safeResult,
            String(failure.error || failure.reason || 'Tác vụ không hoàn thành')
          )
        } else {
          this.updateOperation(operation.operationId, stopped ? 'cancelled' : 'completed', safeResult)
        }
      })
      .catch(error => {
        this.updateOperation(operation.operationId, 'failed', undefined, this.errorMessage(error))
      })

    return { ...operation }
  }

  getOperations(staffId: number): ZaloServerOperationSnapshot[] {
    return Array.from(this.operations.values())
      .filter(operation => operation.staffId === staffId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map(operation => ({ ...operation }))
  }

  async executeCommand(
    staffId: number,
    command: ZaloServerCommandName,
    args: unknown[],
    controlOperationId?: string
  ): Promise<unknown> {
    const runtime = this.runtimes.get(staffId)
    if (!runtime || runtime.state !== 'running' || !runtime.supabase || !runtime.zaloRuntime || !runtime.contactLoader) {
      throw new Error('Runtime Zalo của staff chưa sẵn sàng')
    }

    const transitionCommand = command === 'campaign.pause' ||
      command === 'contacts.cancel' ||
      command === 'zalo.loginQr.cancel'
    if (!transitionCommand && !await loadStaffZaloServerMode(staffId)) {
      throw new Error('Staff đã được chuyển về chế độ chạy Zalo local')
    }
    if (this.runtimes.get(staffId) !== runtime || runtime.state !== 'running') {
      throw new Error('Runtime Zalo của staff đang dừng')
    }

    if (command === 'campaign.pause') {
      const campaignId = this.normalizePositiveId(args[0], 'Campaign ID')
      const operation = runWithCurrentUser(runtime.user, () => runtime.scheduler!.requestPauseCampaign(campaignId))
      runtime.activeCommands.add(operation)
      try {
        return await operation
      } finally {
        runtime.activeCommands.delete(operation)
      }
    }

    const accountId = this.normalizeAccountId(args[0])
    const bypassReservation = command === 'contacts.cancel' || command === 'zalo.loginQr.cancel'
    const bypassAccountValidation = bypassReservation || command === 'zalo.runtime.invalidate'
    const bindsControlEvents = !!controlOperationId && (
      command === 'zalo.loginQr.start' ||
      command === 'contacts.loadFriends' ||
      command === 'contacts.loadGroups' ||
      command === 'contacts.loadZaloGroupMembers'
    )
    if (!bypassAccountValidation) {
      const account = await runWithCurrentUser(runtime.user, () => runtime.supabase!.getAccount(accountId))
      if (!account || account.flatformType !== 'zalo') {
        throw new Error('Tài khoản không phải Zalo hoặc không còn tồn tại')
      }
      if (this.runtimes.get(staffId) !== runtime || runtime.state !== 'running') {
        throw new Error('Runtime Zalo của staff đang dừng')
      }
    }
    if (!bypassReservation && !runtime.scheduler?.tryReserveExternalAccount(accountId)) {
      throw new Error('Tài khoản Zalo đang thực hiện một tác vụ khác')
    }
    if (bindsControlEvents && controlOperationId) {
      runtime.controlOperationIds.set(accountId, controlOperationId)
    }
    let holdQrReservation = false
    let claimedPreviousStatus: 'chờ xử lý' | 'tạm dừng' | null = null
    const requiresAccountClaim = command === 'zalo.loginQr.start' ||
      command === 'zalo.session.check' ||
      command === 'zalo.logout' ||
      command === 'zalo.labels.sync'
    const operation = runWithCurrentUser(runtime.user, async () => {
      try {
        if (requiresAccountClaim) {
          const claim = await runtime.supabase!.claimZaloAccountRuntimeOperation(
            accountId,
            'server',
            command !== 'zalo.loginQr.start'
          )
          if (!claim.claimed || !claim.previousStatus) {
            const reason = claim.reason === 'runtime_not_owner'
              ? 'Staff đã được chuyển về chế độ chạy Zalo local'
              : 'Tài khoản Zalo đang thực hiện một tác vụ khác'
            throw new Error(reason)
          }
          claimedPreviousStatus = claim.previousStatus
          if (command === 'zalo.loginQr.start') {
            runtime.qrAccountClaims.set(accountId, claim.previousStatus)
          }
        }

        switch (command) {
          case 'zalo.loginQr.start': {
            const result = await runtime.zaloRuntime!.startLoginQr(accountId)
            holdQrReservation = result.success
            if (result.success) this.watchQrCompletion(runtime, accountId, controlOperationId)
            return result
          }
          case 'zalo.loginQr.cancel':
            if (!await runtime.zaloRuntime!.cancelLoginQrAndWait(accountId)) {
              return { success: false, accountId, reason: 'QR chưa dừng an toàn. Vui lòng thử lại sau.' }
            }
            await this.releaseQrAccountClaim(runtime, accountId)
            runtime.scheduler?.releaseExternalAccount(accountId)
            return { success: true, accountId }
          case 'zalo.session.check': {
            const result = await runtime.zaloRuntime!.checkSession(accountId)
            runtime.eventWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
            runtime.realtimeManager?.refreshSoon('remote-check-session')
            return result
          }
          case 'zalo.logout': {
            const result = await runtime.zaloRuntime!.logout(accountId)
            runtime.eventWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
            runtime.realtimeManager?.refreshSoon('remote-logout')
            return result
          }
          case 'zalo.labels.sync':
            return await this.syncLabels(runtime, accountId)
          case 'zalo.runtime.invalidate':
            runtime.zaloRuntime!.invalidateAccount(accountId)
            return { success: true, accountId }
          case 'contacts.loadFriends':
            return await runtime.contactLoader!.loadFriends(accountId)
          case 'contacts.loadGroups':
            return await runtime.contactLoader!.loadGroups(accountId)
          case 'contacts.loadZaloGroupMembers':
            return await runtime.contactLoader!.loadZaloGroupMembers(accountId, (args[1] || {}) as never)
          case 'contacts.cancel':
            runtime.contactLoader!.cancelLoad(accountId)
            return { success: true, accountId }
          default:
            throw new Error(`Lệnh server không được hỗ trợ: ${String(command)}`)
        }
      } finally {
        if (claimedPreviousStatus && !holdQrReservation) {
          if (command === 'zalo.loginQr.start') {
            await this.releaseQrAccountClaim(runtime, accountId).catch(error => {
              console.error(`[ZaloServerRuntimeManager] Cannot release QR claim for account ${accountId}:`, error)
            })
          } else {
            await this.restoreAccountClaim(runtime, accountId, claimedPreviousStatus).catch(error => {
              console.error(`[ZaloServerRuntimeManager] Cannot release command claim for account ${accountId}:`, error)
            })
          }
        }
        if (!bypassReservation && !holdQrReservation) runtime.scheduler?.releaseExternalAccount(accountId)
        if (bindsControlEvents && controlOperationId && !holdQrReservation) {
          this.clearBoundControlOperation(runtime, accountId, controlOperationId)
        }
      }
    })
    runtime.activeCommands.add(operation)
    try {
      return await operation
    } finally {
      runtime.activeCommands.delete(operation)
    }
  }

  getSnapshot(staffId?: number): ZaloServerSnapshot {
    const staffs = Array.from(this.runtimes.values())
      .filter(runtime => staffId === undefined || runtime.user.staffId === staffId)
      .map(runtime => this.mapStaffSnapshot(runtime))
      .sort((left, right) => left.staffId - right.staffId)
    const recentEvents = this.recentEvents.filter(event => staffId === undefined || event.staffId === staffId)
    return {
      state: this.state,
      startedAt: this.startedAt,
      vietnamTime: new Date().toISOString(),
      timeZoneOk: -new Date().getTimezoneOffset() === 7 * 60,
      listeningAt: this.options.listeningAt(),
      connectedClients: this.options.connectedClientCount(),
      runtimeCount: staffs.filter(runtime => runtime.state === 'running').length,
      staffs,
      recentEvents: [...recentEvents]
    }
  }

  clearLogs(): number {
    this.recentEvents.length = 0
    // Keep the sequence monotonic so events emitted after the flush cannot
    // collide with event keys that a renderer may already have observed.
    return this.sequence
  }

  private async reconcile(): Promise<void> {
    if (this.state === 'stopping' || this.state === 'stopped') return
    if (this.reconcilePromise) return this.reconcilePromise
    this.reconcilePromise = this.doReconcile().finally(() => {
      this.reconcilePromise = null
    })
    return this.reconcilePromise
  }

  private async doReconcile(): Promise<void> {
    const users = await listActiveZaloServerUsers()
    if (this.state === 'stopping' || this.state === 'stopped') return
    const activeStaffIds = new Set(users.map(user => user.staffId))
    if (!this.initialDiscoveryComplete) {
      // On first launch, only a durable marker from this VPS proves that a
      // running row was left by a crashed server. Every other staff must wait
      // for a possibly-live desktop to settle its own work.
      for (const user of users) {
        const markerMatches = this.options.ownershipStore.matchesModeRevision(
          user.staffId,
          user.zaloRuntimeModeRevision
        )
        if (!markerMatches) {
          // A stale marker must never later authorize unconditional handoff
          // recovery after an offline true -> false -> true cycle.
          this.options.ownershipStore.release(user.staffId)
          this.handoffRequiredStaffIds.add(user.staffId)
        }
      }
    } else {
      for (const staffId of activeStaffIds) {
        if (!this.lastDiscoveredStaffIds.has(staffId)) this.handoffRequiredStaffIds.add(staffId)
      }
    }
    await Promise.allSettled(users.map(async user => {
      try {
        await this.ensureUser(user)
      } catch (error) {
        console.error(`[ZaloServerRuntimeManager] Failed to start staff ${user.staffId}:`, error)
      }
    }))
    for (const staffId of Array.from(this.runtimes.keys())) {
      if (!activeStaffIds.has(staffId)) await this.stopRuntimeSerialized(staffId)
    }
    this.lastDiscoveredStaffIds = activeStaffIds
    this.initialDiscoveryComplete = true
    this.notifySnapshot()
  }

  private async startRuntime(user: ZaloServerRuntimeUser, waitForDesktopHandoff: boolean): Promise<void> {
    const runtime: StaffRuntime = {
      user,
      state: 'starting',
      startedAt: null,
      lastError: null,
      supabase: null,
      scheduler: null,
      contactLoader: null,
      zaloRuntime: null,
      realtimeManager: null,
      eventWindow: null,
      activeCommands: new Set(),
      qrAccountClaims: new Map(),
      qrReleasePromises: new Map(),
      controlOperationIds: new Map(),
      stopDeferred: false
    }
    this.runtimes.set(user.staffId, runtime)
    this.notifySnapshot()

    try {
      let waitingForDesktop = false
      await runWithCurrentUser(user, async () => {
        this.assertRuntimeMayStart(runtime)
        const supabase = new SupabaseService()
        runtime.supabase = supabase

        if (waitForDesktopHandoff) {
          const runningState = await supabase.inspectStaffZaloRunningState(user.staffId)
          this.assertRuntimeMayStart(runtime)
          if (runningState.hasRunningState) {
            waitingForDesktop = true
            runtime.state = 'waiting'
            runtime.lastError = null
            return
          }
        }

        const eventWindow = this.createEventWindow(runtime)
        const webviewRegistry = new WebviewRegistry()
        const proxyRuntime = new ProxyRuntimeService(id => supabase.getProxy(id))
        let realtimeManager: ZaloRealtimeGroupCampaignManager | null = null
        const zaloRuntime = new ZaloRuntimeService(
          supabase,
          id => supabase.getProxy(id),
          event => {
            eventWindow.webContents.send(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, event)
            if (
              event.status === 'success' ||
              event.status === 'error' ||
              event.status === 'cancelled' ||
              event.status === 'expired' ||
              event.status === 'declined'
            ) {
              eventWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
              realtimeManager?.refreshSoon(`zalo-login-${event.status}`)
            }
          }
        )
        const maintenance = new DailyMaintenanceCoordinator(async () => {
          const updatedCampaigns = await supabase.maintainZaloCampaignSchedules()
          for (const campaign of updatedCampaigns) {
            eventWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, campaign)
          }
        })
        const scheduler = new CampaignScheduler(
          supabase,
          webviewRegistry,
          eventWindow,
          proxyRuntime,
          zaloRuntime,
          undefined,
          { runtimeTarget: 'server', maintenanceCoordinator: maintenance }
        )
        const contactLoader = new ContactLoader(
          supabase,
          webviewRegistry,
          eventWindow,
          proxyRuntime,
          zaloRuntime,
          { zaloRuntimeTarget: 'server' }
        )
        realtimeManager = new ZaloRealtimeGroupCampaignManager(supabase, zaloRuntime, eventWindow, 'server')

        runtime.scheduler = scheduler
        runtime.contactLoader = contactLoader
        runtime.zaloRuntime = zaloRuntime
        runtime.realtimeManager = realtimeManager
        runtime.eventWindow = eventWindow

        const liveModeBeforeRecovery = await loadStaffZaloServerModeSnapshot(user.staffId)
        this.assertRuntimeMayStart(runtime)
        if (!liveModeBeforeRecovery.isZaloServer) {
          throw new Error('Staff đã được chuyển về chế độ chạy Zalo local')
        }
        // xmin is the staff-row revision, so unrelated profile/device updates
        // also change it. While the live flag remains true, adopt the latest
        // revision without interrupting server work; actual local startup must
        // pass through the serialized handoff endpoint above.
        user.zaloRuntimeModeRevision = liveModeBeforeRecovery.revision
        // Persist before recovery/start. If this process dies afterwards,
        // only this VPS marker authorizes recovery on the next launch.
        this.options.ownershipStore.claim(user.staffId, liveModeBeforeRecovery.revision)
        await supabase.recoverServerZaloRunningState(user.staffId, {
          expectedModeRevision: liveModeBeforeRecovery.revision,
          requireServerMode: true
        })
        this.assertRuntimeMayStart(runtime)
        await maintenance.ensureReady()
        this.assertRuntimeMayStart(runtime)
        await zaloRuntime.warmStoredSessions('server')
        this.assertRuntimeMayStart(runtime)
        const liveModeAfterWarmup = await loadStaffZaloServerModeSnapshot(user.staffId)
        this.assertRuntimeMayStart(runtime)
        if (!liveModeAfterWarmup.isZaloServer) {
          throw new Error('Staff đã được chuyển về chế độ chạy Zalo local')
        }
        user.zaloRuntimeModeRevision = liveModeAfterWarmup.revision
        this.options.ownershipStore.claim(user.staffId, liveModeAfterWarmup.revision)
        this.assertRuntimeMayStart(runtime)
        realtimeManager.start()
        scheduler.start()
      })
      if (waitingForDesktop) return
      this.assertRuntimeMayStart(runtime)
      runtime.state = 'running'
      runtime.startedAt = new Date().toISOString()
      runtime.lastError = null
    } catch (error) {
      runtime.state = 'error'
      runtime.lastError = this.errorMessage(error)
      throw error
    } finally {
      this.notifySnapshot()
    }
  }

  private async stopRuntime(staffId: number): Promise<void> {
    const runtime = this.runtimes.get(staffId)
    if (!runtime) return
    const wasWaitingForDesktop = runtime.state === 'waiting'
    runtime.state = 'stopping'
    this.notifySnapshot()
    await runWithCurrentUser(runtime.user, async () => {
      try {
        if (wasWaitingForDesktop) return
        runtime.contactLoader?.stopAll()
        runtime.scheduler?.blockZaloRuntimeForRestart(null)
        runtime.scheduler?.stop()
        runtime.realtimeManager?.stop()
        const waitForQr = runtime.zaloRuntime?.cancelAllLoginQrAndWait() ?? Promise.resolve(true)
        const pendingCommands = Array.from(runtime.activeCommands)
        const waitForCommands = pendingCommands.length === 0
          ? Promise.resolve(true)
          : Promise.race([
              Promise.allSettled(pendingCommands).then(() => true),
              new Promise<false>(resolve => setTimeout(() => resolve(false), 30_000))
            ])
        const [qrSettled, commandsSettled, schedulerIdle, contactLoaderIdle, realtimeIdle] = await Promise.all([
          waitForQr,
          waitForCommands,
          runtime.scheduler?.waitForIdle(30_000) ?? Promise.resolve(true),
          runtime.contactLoader?.waitForIdle(30_000, 'zalo') ?? Promise.resolve(true),
          runtime.realtimeManager?.waitForIdle(30_000) ?? Promise.resolve(true)
        ])
        if (!qrSettled || !commandsSettled || !schedulerIdle || !contactLoaderIdle || !realtimeIdle) {
          runtime.stopDeferred = true
          runtime.lastError = 'Đang chờ tác vụ Zalo hiện tại kết thúc an toàn'
          return
        }
        await Promise.allSettled(
          Array.from(runtime.qrAccountClaims.keys()).map(accountId =>
            this.releaseQrAccountClaim(runtime, accountId)
          )
        )
        runtime.zaloRuntime?.clearAll()
        // Releasing already-owned server work is independent from the current
        // mode flag. The flag may have changed to local while this runtime was
        // still settling. Waiting runtimes return above and never recover
        // desktop-owned rows.
        if (runtime.supabase) {
          await runtime.supabase.recoverServerZaloRunningState(staffId)
        }
        this.options.ownershipStore.release(staffId)
        runtime.stopDeferred = false
        runtime.lastError = null
      } catch (error) {
        runtime.stopDeferred = true
        runtime.lastError = this.errorMessage(error)
        console.error(`[ZaloServerRuntimeManager] Stop staff ${staffId} failed:`, error)
      }
    })
    if (!wasWaitingForDesktop && runtime.stopDeferred) {
      this.notifySnapshot()
      return
    }
    runtime.state = 'stopped'
    this.settleRunningOperations(staffId, 'Runtime Zalo server đã dừng')
    this.runtimes.delete(staffId)
    this.notifySnapshot()
  }

  private stopRuntimeSerialized(staffId: number): Promise<void> {
    return this.runStaffLifecycle(staffId, () => this.stopRuntime(staffId))
  }

  private runStaffLifecycle<T>(staffId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleTails.get(staffId) || Promise.resolve()
    const result = previous.catch(() => {}).then(task)
    const tail = result.then(() => undefined, () => undefined)
    this.lifecycleTails.set(staffId, tail)
    return result.finally(() => {
      if (this.lifecycleTails.get(staffId) === tail) this.lifecycleTails.delete(staffId)
    })
  }

  private async restoreAccountClaim(
    runtime: StaffRuntime,
    accountId: number,
    previousStatus: 'chờ xử lý' | 'tạm dừng'
  ): Promise<void> {
    if (!runtime.supabase) return
    const released = await runtime.supabase.releaseZaloAccountRuntimeOperation(
      accountId,
      'server',
      previousStatus
    )
    if (released) runtime.eventWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
  }

  private releaseQrAccountClaim(runtime: StaffRuntime, accountId: number): Promise<void> {
    const existing = runtime.qrReleasePromises.get(accountId)
    if (existing) return existing
    const previousStatus = runtime.qrAccountClaims.get(accountId)
    if (!previousStatus) return Promise.resolve()

    const release = runWithCurrentUser(runtime.user, async () => {
      await this.restoreAccountClaim(runtime, accountId, previousStatus)
      runtime.qrAccountClaims.delete(accountId)
    })
    runtime.qrReleasePromises.set(accountId, release)
    runtime.activeCommands.add(release)
    void release.finally(() => {
      runtime.qrReleasePromises.delete(accountId)
      runtime.activeCommands.delete(release)
    }).catch(() => {})
    return release
  }

  private watchQrCompletion(
    runtime: StaffRuntime,
    accountId: number,
    controlOperationId?: string
  ): void {
    const completion = runWithCurrentUser(runtime.user, async () => {
      try {
        await runtime.zaloRuntime?.waitForLoginQrIdle(accountId)
        await this.releaseQrAccountClaim(runtime, accountId)
        runtime.scheduler?.releaseExternalAccount(accountId)
        runtime.eventWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      } finally {
        if (controlOperationId) {
          this.clearBoundControlOperation(runtime, accountId, controlOperationId)
        }
      }
    })
    runtime.activeCommands.add(completion)
    void completion.finally(() => {
      runtime.activeCommands.delete(completion)
    }).catch(error => {
      console.error(`[ZaloServerRuntimeManager] QR completion failed for account ${accountId}:`, error)
    })
  }

  private async syncLabels(runtime: StaffRuntime, accountId: number): Promise<ZaloLabelOption[]> {
    const supabase = runtime.supabase!
    const account = await supabase.getAccount(accountId)
    if (!account || account.flatformType !== 'zalo') throw new Error('Tài khoản không phải Zalo')
    const labels = await runtime.zaloRuntime!.listLabels(accountId)
    if (labels.length === 0) {
      await supabase.deleteContacts(accountId, 'zalo_tag')
    } else {
      await supabase.upsertContacts(labels.map(label => mapZaloLabelToContact(accountId, label)), {
        markMissingDeleted: true
      })
    }
    await supabase.syncZaloLabelMemberships(accountId, labels)
    return labels
  }

  private createEventWindow(runtime: StaffRuntime): BrowserWindow {
    const bridge = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, ...args: unknown[]) => {
          const payload = args.length <= 1 ? args[0] : args
          const operationPayload = this.decorateOperationPayload(runtime, channel, payload)
          const normalizedPayload = markServerCampaignLog(channel, operationPayload)
          if (isUserFacingActivityChannel(channel)) {
            this.emitActivity(runtime.user, channel, normalizedPayload)
          } else if (isLiveUiStateChannel(channel)) {
            this.emitLiveState(runtime.user, channel, normalizedPayload)
          }
        }
      }
    }
    return bridge as unknown as BrowserWindow
  }

  private decorateOperationPayload(runtime: StaffRuntime, channel: string, payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    const value = payload as Record<string, unknown>
    const accountId = Math.floor(Number(value.accountId))
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return payload

    if (channel === IPC_EVENTS.ZALO_LOGIN_QR_EVENT) {
      const operation = this.getBoundRunningOperation(runtime, accountId, command => (
        command === 'zalo.loginQr.start'
      ))
      if (!operation) return payload
      const qrStatus = String(value.status || '')
      const safeResult = {
        status: qrStatus,
        message: typeof value.message === 'string' ? value.message : undefined,
        qrImage: qrStatus === 'qr' && typeof value.qrImage === 'string' ? value.qrImage : undefined,
        displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
        avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : undefined
      }
      if (qrStatus === 'success') {
        this.updateOperation(operation.operationId, 'completed', safeResult)
      } else if (qrStatus === 'cancelled') {
        this.updateOperation(operation.operationId, 'cancelled', safeResult)
      } else if (qrStatus === 'expired' || qrStatus === 'declined' || qrStatus === 'error') {
        this.updateOperation(
          operation.operationId,
          'failed',
          safeResult,
          typeof value.message === 'string' ? value.message : 'Đăng nhập QR không hoàn thành'
        )
      } else {
        this.updateOperation(operation.operationId, 'running', safeResult)
      }
      return { ...value, operationId: operation.operationId }
    }

    if (channel === IPC_EVENTS.CONTACTS_PROGRESS || channel === IPC_EVENTS.CONTACTS_COMPLETED) {
      const operation = this.getBoundRunningOperation(runtime, accountId, command => (
        command === 'contacts.loadFriends' ||
        command === 'contacts.loadGroups' ||
        command === 'contacts.loadZaloGroupMembers'
      ))
      if (operation) {
        if (channel === IPC_EVENTS.CONTACTS_PROGRESS) {
          this.updateOperation(operation.operationId, 'running', {
            message: typeof value.message === 'string' ? value.message : '',
            contactType: typeof value.contactType === 'string' ? value.contactType : undefined,
            runKey: typeof value.runKey === 'string' ? value.runKey : undefined
          })
        }
        return { ...value, operationId: operation.operationId }
      }
    }
    return payload
  }

  private sanitizeControlOperationResult(command: ZaloServerCommandName, result: unknown): unknown {
    if (
      (command !== 'zalo.session.check' && command !== 'zalo.logout') ||
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result)
    ) return result
    const value = { ...(result as Record<string, unknown>) }
    if (value.account && typeof value.account === 'object' && !Array.isArray(value.account)) {
      const account = { ...(value.account as Record<string, unknown>) }
      delete account.password
      delete account.zaloSession
      delete account.zalo_session
      delete account.emailSession
      delete account.email_session
      value.account = account
    }
    return value
  }

  private getBoundRunningOperation(
    runtime: StaffRuntime,
    accountId: number,
    matchesCommand: (command: ZaloServerCommandName) => boolean
  ): ZaloServerOperationSnapshot | null {
    const operationId = runtime.controlOperationIds.get(accountId)
    if (!operationId) return null
    const operation = this.operations.get(operationId)
    if (
      !operation ||
      operation.staffId !== runtime.user.staffId ||
      operation.accountId !== accountId ||
      operation.status !== 'running' ||
      !matchesCommand(operation.command)
    ) return null
    return operation
  }

  private clearBoundControlOperation(
    runtime: StaffRuntime,
    accountId: number,
    operationId: string
  ): void {
    if (runtime.controlOperationIds.get(accountId) === operationId) {
      runtime.controlOperationIds.delete(accountId)
    }
  }

  private updateOperation(
    operationId: string,
    status: ZaloServerOperationStatus,
    result?: unknown,
    error?: string
  ): void {
    const operation = this.operations.get(operationId)
    if (!operation) return
    if (operation.status !== 'running' && status === 'running') return
    const now = new Date().toISOString()
    operation.status = status
    operation.updatedAt = now
    operation.completedAt = status === 'running' ? null : now
    if (result !== undefined) operation.result = result
    if (error) operation.error = error
    else if (status !== 'failed') delete operation.error
    const runtime = this.runtimes.get(operation.staffId)
    if (runtime) this.emitOperationUpdate(runtime.user, operation)
  }

  private emitOperationUpdate(user: AuthUser, operation: ZaloServerOperationSnapshot): void {
    this.emitControlState(user, ZALO_SERVER_OPERATION_UPDATED_CHANNEL, { ...operation })
  }

  private pruneOperations(staffId: number): void {
    const staffOperations = Array.from(this.operations.values())
      .filter(operation => operation.staffId === staffId)
      .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    let excess = staffOperations.length - RECENT_OPERATION_LIMIT_PER_STAFF
    for (const operation of staffOperations) {
      if (excess <= 0) break
      if (operation.status === 'running') continue
      this.operations.delete(operation.operationId)
      excess -= 1
    }
  }

  private settleRunningOperations(staffId: number, reason: string): void {
    for (const operation of this.operations.values()) {
      if (operation.staffId === staffId && operation.status === 'running') {
        this.updateOperation(operation.operationId, 'cancelled', { message: reason }, reason)
      }
    }
  }

  private createEvent(user: AuthUser, channel: string, payload: unknown): ZaloServerRuntimeEvent {
    return {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      staffId: user.staffId,
      organizationId: user.organizationId,
      channel,
      payload
    }
  }

  private emitActivity(user: AuthUser, channel: string, payload: unknown): void {
    const event = this.createEvent(user, channel, payload)
    this.recentEvents.push(event)
    if (this.recentEvents.length > RECENT_EVENT_LIMIT) {
      this.recentEvents.splice(0, this.recentEvents.length - RECENT_EVENT_LIMIT)
    }
    this.options.publishEvent(event)
    const adminWindow = this.options.adminWindow()
    try {
      if (adminWindow && !adminWindow.isDestroyed()) {
        adminWindow.webContents.send(ZALO_SERVER_IPC.RUNTIME_EVENT, event)
      }
    } catch {}
  }

  private emitLiveState(user: AuthUser, channel: string, payload: unknown): void {
    this.options.publishLiveEvent(this.createEvent(user, channel, payload))
  }

  private emitControlState(user: AuthUser, channel: string, payload: unknown): void {
    this.options.publishControlEvent(this.createEvent(user, channel, payload))
  }

  private notifySnapshot(): void {
    this.options.broadcastSnapshot()
    const adminWindow = this.options.adminWindow()
    try {
      if (adminWindow && !adminWindow.isDestroyed()) {
        adminWindow.webContents.send(ZALO_SERVER_IPC.SNAPSHOT_UPDATED, this.getSnapshot())
      }
    } catch {}
  }

  private mapStaffSnapshot(runtime: StaffRuntime): ZaloServerStaffSnapshot {
    return {
      staffId: runtime.user.staffId,
      organizationId: runtime.user.organizationId,
      staffName: runtime.user.name,
      organizationName: runtime.user.organizationName,
      state: runtime.state,
      startedAt: runtime.startedAt,
      lastError: runtime.lastError
    }
  }

  private normalizeAccountId(value: unknown): number {
    return this.normalizePositiveId(value, 'Account ID')
  }

  private normalizePositiveId(value: unknown, label: string): number {
    const id = Math.floor(Number(value))
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} không hợp lệ`)
    return id
  }

  private isStoppingOrStopped(): boolean {
    return this.state === 'stopping' || this.state === 'stopped'
  }

  private assertRuntimeMayStart(runtime: StaffRuntime): void {
    if (
      this.isStoppingOrStopped() ||
      this.runtimes.get(runtime.user.staffId) !== runtime ||
      runtime.state !== 'starting'
    ) {
      throw new Error('akaAgent Zalo Server đang dừng')
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
