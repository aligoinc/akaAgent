import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { IPC_EVENTS, type AuthUser, type AutoAccountContact, type ZaloLabelOption } from '../../shared/types'
import {
  ZALO_SERVER_IPC,
  ZALO_SERVER_OPERATION_UPDATED_CHANNEL,
  type ZaloServerCommandName,
  type ZaloServerDesktopHandoffReadyResponse,
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
  loadStaffZaloAccountCapabilitySnapshot,
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
const RECONCILE_LIFECYCLE_CONCURRENCY = 25
const RECENT_EVENT_LIMIT = 1000
const RECENT_OPERATION_LIMIT_PER_STAFF = 200
const SNAPSHOT_BROADCAST_COALESCE_MS = 50
const ZALO_SERVER_MODE_DISABLED_MESSAGE = 'Gói Zalo của doanh nghiệp không còn quyền chạy tài khoản trên server'

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
  ownsZaloRuntimeState: boolean
  stopDeferred: boolean
  gracefulCapabilityLoss: boolean
  acceptsCleanupCommands: boolean
}

interface CleanupRuntimeGuard {
  expectedRuntimeStartedAt: string
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
  private snapshotNotifyTimer: ReturnType<typeof setTimeout> | null = null

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
      const existing = this.runtimes.get(user.staffId)
      if (existing) {
        // A deferred stop may still have commands holding the old AuthUser
        // object through AsyncLocalStorage. Do not overwrite that object with
        // a newly discovered session before the stop has actually settled.
        if (existing.stopDeferred || existing.state === 'stopping') {
          // Capability can be restored while an earlier graceful drain is
          // still finishing its current target/share batch. Retry that same
          // boundary; a non-graceful stop here would turn it into an abort.
          await this.stopRuntime(user.staffId, true)
          if (this.runtimes.has(user.staffId)) return
          await this.startRuntime(user, false)
          if (this.runtimes.get(user.staffId)?.state === 'running') {
            this.handoffRequiredStaffIds.delete(user.staffId)
          }
          return
        }
        Object.assign(existing.user, user)
        if (
          (existing.state === 'running' || existing.state === 'starting') &&
          existing.ownsZaloRuntimeState
        ) {
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
      await this.startRuntime(user, false)
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
        // Authentication intentionally accepts legacy mode=false, but a stale
        // v218 desktop must never stop additive Server accounts when the one
        // selected product grants Web+Server at the same time.
        const liveCapabilities = await loadStaffZaloAccountCapabilitySnapshot(normalizedStaffId)
        if (liveCapabilities.server || await loadStaffZaloServerMode(normalizedStaffId)) {
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
        const wasServerOwned = runtime?.ownsZaloRuntimeState === true

        if (runtime) {
          // This endpoint exists only for legacy global-mode desktops. A v218
          // request can race additive capability changes, so it must use the
          // same drain boundary as normal v219 capability loss: finish the
          // current target/batch, claim nothing new, then recover only Server
          // subtype rows. It must never turn that race into an uncertain abort.
          await this.stopRuntime(normalizedStaffId, true)
        }

        const remainingRuntime = this.runtimes.get(normalizedStaffId)
        const processServerOwned = remainingRuntime?.ownsZaloRuntimeState === true
        const supabase = runtime?.supabase || remainingRuntime?.supabase || new SupabaseService()
        const [liveIsLegacyZaloServer, liveAccountCapabilities] = await Promise.all([
          loadStaffZaloServerMode(normalizedStaffId),
          loadStaffZaloAccountCapabilitySnapshot(normalizedStaffId)
        ])

        if (processServerOwned || liveIsLegacyZaloServer || liveAccountCapabilities.server) {
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

  async acceptDesktopHandoffReady(
    user: ZaloServerRuntimeUser,
    expectedModeRevision: string
  ): Promise<ZaloServerDesktopHandoffReadyResponse> {
    const staffId = this.normalizePositiveId(user.staffId, 'Staff ID')
    const normalizedExpectedRevision = String(expectedModeRevision || '').trim()
    if (!normalizedExpectedRevision) throw new Error('runtime_mode_revision_mismatch')
    const runtimeUser: ZaloServerRuntimeUser = { ...user }

    return this.runStaffLifecycle(staffId, () =>
      runWithCurrentUser(runtimeUser, async (): Promise<ZaloServerDesktopHandoffReadyResponse> => {
        const liveMode = await loadStaffZaloServerModeSnapshot(staffId)
        if (!liveMode.isZaloServer) {
          throw new Error(ZALO_SERVER_MODE_DISABLED_MESSAGE)
        }
        if (liveMode.revision !== normalizedExpectedRevision) {
          throw new Error('runtime_mode_revision_mismatch')
        }
        runtimeUser.isZaloServer = true
        runtimeUser.zaloRuntimeModeRevision = liveMode.revision

        const existing = this.runtimes.get(staffId)
        if (existing?.state === 'running') {
          return {
            success: true,
            serverReady: true,
            serverStarted: false,
            alreadyRunning: true
          }
        }

        if (existing) await this.stopRuntime(staffId)
        if (this.runtimes.has(staffId)) {
          return {
            success: false,
            serverReady: false,
            serverStarted: false,
            alreadyRunning: false
          }
        }

        // Only the server may recover after the desktop declares every local
        // Zalo producer idle. startRuntime revalidates the current entitlement
        // revision and performs recovery before enabling scheduler/commands.
        await this.startRuntime(runtimeUser, false, normalizedExpectedRevision)
        const serverReady = this.runtimes.get(staffId)?.state === 'running'
        if (serverReady) this.handoffRequiredStaffIds.delete(staffId)
        return {
          success: serverReady,
          serverReady,
          serverStarted: serverReady,
          alreadyRunning: false
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
            if (this.operations.get(operation.operationId)?.status === 'running') {
              this.updateOperation(operation.operationId, 'failed', safeResult, reason)
              runtime.eventWindow?.webContents.send(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, {
                accountId,
                status: 'error',
                message: reason
              })
            }
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
        const reason = this.errorMessage(error)
        if (this.operations.get(operation.operationId)?.status === 'running') {
          this.updateOperation(operation.operationId, 'failed', undefined, reason)
          if (command === 'zalo.loginQr.start') {
            runtime.eventWindow?.webContents.send(IPC_EVENTS.ZALO_LOGIN_QR_EVENT, {
              accountId,
              status: 'error',
              message: reason
            })
          }
        }
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
    if (!runtime || !runtime.supabase || !runtime.zaloRuntime || !runtime.contactLoader) {
      throw new Error('Runtime Zalo của staff chưa sẵn sàng')
    }
    if (this.isStoppingOrStopped()) throw new Error('akaAgent Zalo Server đang dừng')

    const cleanupCommand = command === 'contacts.cancel' || command === 'zalo.loginQr.cancel'
    const cleanupGuard = cleanupCommand ? this.parseCleanupRuntimeGuard(args[1]) : null
    const liveCapabilities = await loadStaffZaloAccountCapabilitySnapshot(staffId)
    if (this.isStoppingOrStopped() || this.runtimes.get(staffId) !== runtime) {
      throw new Error('Runtime Zalo của staff đang dừng')
    }

    let queueGracefulStop = false
    if (!liveCapabilities.server) {
      if (!cleanupCommand) throw new Error(ZALO_SERVER_MODE_DISABLED_MESSAGE)
      if (!this.cleanupGuardMatchesRuntime(runtime, cleanupGuard)) {
        throw new Error('Runtime Zalo đã thay đổi; không thể gửi lệnh dọn dẹp vào runtime mới')
      }
      if (runtime.state === 'running') {
        runtime.state = 'stopping'
        runtime.gracefulCapabilityLoss = true
        runtime.acceptsCleanupCommands = true
        runtime.scheduler?.stopAcceptingNewZaloWork()
        runtime.realtimeManager?.stop()
        queueGracefulStop = true
        this.notifySnapshot()
      } else if (
        runtime.state !== 'stopping' ||
        !runtime.gracefulCapabilityLoss ||
        !runtime.acceptsCleanupCommands
      ) {
        throw new Error('Runtime Zalo của staff đang dừng')
      }
    } else if (runtime.state !== 'running') {
      if (
        !cleanupCommand ||
        runtime.state !== 'stopping' ||
        !runtime.gracefulCapabilityLoss ||
        !runtime.acceptsCleanupCommands ||
        !this.cleanupGuardMatchesRuntime(runtime, cleanupGuard)
      ) {
        throw new Error('Runtime Zalo của staff đang dừng')
      }
    } else if (cleanupGuard && !this.cleanupGuardMatchesRuntime(runtime, cleanupGuard)) {
      throw new Error('Runtime Zalo đã thay đổi; không thể gửi lệnh dọn dẹp vào runtime mới')
    }

    let releaseCleanupLease = (): void => {}
    let cleanupLease: Promise<void> | null = null
    if (cleanupCommand) {
      cleanupLease = new Promise<void>(resolve => { releaseCleanupLease = resolve })
      runtime.activeCommands.add(cleanupLease)
    }
    if (queueGracefulStop) {
      void this.runStaffLifecycle(staffId, async () => {
        if (this.runtimes.get(staffId) !== runtime) return
        await this.stopRuntime(staffId, true)
      }).catch(error => {
        console.error(`[ZaloServerRuntimeManager] Failed to drain staff ${staffId} after capability loss:`, error)
      })
    }

    try {
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
      const bypassReservation = cleanupCommand
      const bypassAccountValidation = command === 'zalo.runtime.invalidate'
      const bindsControlEvents = !!controlOperationId && (
        command === 'zalo.loginQr.start' ||
        command === 'contacts.loadFriends' ||
        command === 'contacts.loadGroups' ||
        command === 'contacts.loadZaloGroupMembers'
      )
      if (!bypassAccountValidation) {
        const account = await runWithCurrentUser(runtime.user, () => cleanupCommand
          ? runtime.supabase!.getAccountIgnoringCapability(accountId)
          : runtime.supabase!.getAccount(accountId)
        )
        if (!account || account.flatformType !== 'zalo' || !account.isZaloServer || account.isZaloShowWeb) {
          throw new Error('Tài khoản không thuộc runtime Zalo Server hoặc không còn tồn tại')
        }
        if (this.isStoppingOrStopped() || this.runtimes.get(staffId) !== runtime) {
          throw new Error('Runtime Zalo của staff đang dừng')
        }
        if (runtime.state !== 'running' && !(
          cleanupCommand &&
          runtime.state === 'stopping' &&
          runtime.gracefulCapabilityLoss &&
          runtime.acceptsCleanupCommands &&
          this.cleanupGuardMatchesRuntime(runtime, cleanupGuard)
        )) {
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
                ? ZALO_SERVER_MODE_DISABLED_MESSAGE
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
    } finally {
      if (cleanupLease) runtime.activeCommands.delete(cleanupLease)
      releaseCleanupLease()
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
    // Account ownership is durable from v219 onward. A newly discovered
    // Server capability can start eagerly, even with zero Server accounts;
    // recovery is scoped to account.is_zalo_server and cannot touch Desktop.
    await runWithConcurrency(users, RECONCILE_LIFECYCLE_CONCURRENCY, async user => {
      try {
        await this.ensureUser(user)
      } catch (error) {
        console.error(`[ZaloServerRuntimeManager] Failed to start staff ${user.staffId}:`, error)
      }
    })
    const staleStaffIds = Array.from(this.runtimes.keys())
      .filter(staffId => !activeStaffIds.has(staffId))
    await runWithConcurrency(staleStaffIds, RECONCILE_LIFECYCLE_CONCURRENCY, async staffId => {
      try {
        await this.stopRuntimeSerialized(staffId, true)
      } catch (error) {
        console.error(`[ZaloServerRuntimeManager] Failed to stop staff ${staffId}:`, error)
      }
    })
    this.lastDiscoveredStaffIds = activeStaffIds
    this.initialDiscoveryComplete = true
    this.notifySnapshot()
  }

  private async startRuntime(
    user: ZaloServerRuntimeUser,
    waitForDesktopHandoff: boolean,
    expectedModeRevision?: string
  ): Promise<void> {
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
      ownsZaloRuntimeState: false,
      stopDeferred: false,
      gracefulCapabilityLoss: false,
      acceptsCleanupCommands: false
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
          const updatedCampaigns = await supabase.maintainZaloServerCampaignSchedules(
            user.zaloRuntimeModeRevision
          )
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
          {
            runtimeTarget: 'server',
            // The mutable runtime user is refreshed by discovery and again
            // after warmup, so every DB ownership check sees the live revision.
            runtimeModeRevision: () => user.zaloRuntimeModeRevision,
            maintenanceCoordinator: maintenance,
            onRuntimeOwnershipLost: () => {
              // A unit claim is a stronger/faster ownership signal than the
              // discovery interval. Queue the normal graceful lifecycle stop;
              // it waits for this scheduler turn to return, then recovers only
              // Server-subtype rows even if capability was already restored.
              // Recheck the captured runtime *inside* the serialized task so a
              // delayed callback from an old generation cannot stop a newer one.
              void this.runStaffLifecycle(user.staffId, async () => {
                if (this.runtimes.get(user.staffId) !== runtime) return
                await this.stopRuntime(user.staffId, true)
              }).catch(error => {
                console.error(
                  `[ZaloServerRuntimeManager] Failed to reconcile ownership loss for staff ${user.staffId}:`,
                  error
                )
              })
            }
          }
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

        const liveModeBeforeRecovery = await loadStaffZaloAccountCapabilitySnapshot(user.staffId)
        this.assertRuntimeMayStart(runtime)
        if (!liveModeBeforeRecovery.server) {
          throw new Error(ZALO_SERVER_MODE_DISABLED_MESSAGE)
        }
        if (expectedModeRevision && liveModeBeforeRecovery.revision !== expectedModeRevision) {
          throw new Error('runtime_mode_revision_mismatch')
        }
        // The revision belongs to the effective organization entitlement.
        // While Server capability remains true, adopt the latest revision;
        // per-account DB guards prevent either runtime from crossing owners.
        user.zaloRuntimeModeRevision = liveModeBeforeRecovery.revision
        await supabase.recoverServerZaloRunningState(user.staffId, {
          expectedModeRevision: liveModeBeforeRecovery.revision,
          requireServerMode: true
        })
        // The atomic recovery succeeded, so this runtime is now authorized to
        // settle subsequent server claims. Persist before maintenance/warmup;
        // if the process dies afterwards, only this VPS marker may recover.
        this.options.ownershipStore.claim(user.staffId, liveModeBeforeRecovery.revision)
        runtime.ownsZaloRuntimeState = true
        this.assertRuntimeMayStart(runtime)
        await maintenance.ensureReady()
        this.assertRuntimeMayStart(runtime)
        await zaloRuntime.warmStoredSessions('server')
        this.assertRuntimeMayStart(runtime)
        const liveModeAfterWarmup = await loadStaffZaloAccountCapabilitySnapshot(user.staffId)
        this.assertRuntimeMayStart(runtime)
        if (!liveModeAfterWarmup.server) {
          throw new Error(ZALO_SERVER_MODE_DISABLED_MESSAGE)
        }
        if (expectedModeRevision && liveModeAfterWarmup.revision !== expectedModeRevision) {
          throw new Error('runtime_mode_revision_mismatch')
        }
        user.zaloRuntimeModeRevision = liveModeAfterWarmup.revision
        this.options.ownershipStore.claim(user.staffId, liveModeAfterWarmup.revision)
        this.assertRuntimeMayStart(runtime)
        realtimeManager.start()
        // Spread database discovery/claim bursts when many staff runtimes are
        // created together after a VPS restart. This is only an initial delay;
        // it does not cap staff, accounts or concurrent workers.
        scheduler.start({ initialDelayMs: Math.floor(Math.random() * 30_001) })
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

  private async stopRuntime(staffId: number, gracefulCapabilityLoss = false): Promise<void> {
    const runtime = this.runtimes.get(staffId)
    if (!runtime) return
    const wasWaitingForDesktop = runtime.state === 'waiting'
    const wasAlreadyStopping = runtime.state === 'stopping'
    if (!wasAlreadyStopping) {
      runtime.gracefulCapabilityLoss = gracefulCapabilityLoss
      runtime.acceptsCleanupCommands = gracefulCapabilityLoss
    } else if (!gracefulCapabilityLoss) {
      // App Server shutdown and explicit forced handoff always win over a
      // capability-loss drain. No command may enter once forced stop begins.
      runtime.gracefulCapabilityLoss = false
      runtime.acceptsCleanupCommands = false
    }
    runtime.state = 'stopping'
    this.notifySnapshot()
    await runWithCurrentUser(runtime.user, async () => {
      try {
        if (wasWaitingForDesktop) return
        if (runtime.gracefulCapabilityLoss) {
          runtime.scheduler?.stopAcceptingNewZaloWork()
        } else {
          runtime.contactLoader?.stopAll()
          runtime.scheduler?.blockZaloRuntimeForRestart(null)
          runtime.scheduler?.stop()
        }
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
        runtime.acceptsCleanupCommands = false
        const cleanupCommands = Array.from(runtime.activeCommands)
        const [cleanupCommandsSettled, finalQrSettled, finalContactLoaderIdle] = await Promise.all([
          cleanupCommands.length === 0
            ? Promise.resolve(true)
            : Promise.race([
                Promise.allSettled(cleanupCommands).then(() => true),
                new Promise<false>(resolve => setTimeout(() => resolve(false), 30_000))
              ]),
          runtime.zaloRuntime?.cancelAllLoginQrAndWait() ?? Promise.resolve(true),
          runtime.contactLoader?.waitForIdle(30_000, 'zalo') ?? Promise.resolve(true)
        ])
        if (!cleanupCommandsSettled || !finalQrSettled || !finalContactLoaderIdle) {
          if (runtime.gracefulCapabilityLoss && !this.isStoppingOrStopped()) {
            runtime.acceptsCleanupCommands = true
          }
          runtime.stopDeferred = true
          runtime.lastError = 'Đang chờ tác vụ Zalo hiện tại kết thúc an toàn'
          return
        }
        // All current work has settled. These calls now only release cached
        // resources and cannot turn a graceful entitlement drain into an
        // uncertain mid-target abort.
        runtime.contactLoader?.stopAll()
        runtime.scheduler?.stop()
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
        if (runtime.supabase && runtime.ownsZaloRuntimeState) {
          await runtime.supabase.recoverServerZaloRunningState(staffId)
          runtime.ownsZaloRuntimeState = false
          this.options.ownershipStore.release(staffId)
        }
        runtime.stopDeferred = false
        runtime.gracefulCapabilityLoss = false
        runtime.acceptsCleanupCommands = false
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

  private stopRuntimeSerialized(staffId: number, gracefulCapabilityLoss = false): Promise<void> {
    return this.runStaffLifecycle(staffId, () => this.stopRuntime(staffId, gracefulCapabilityLoss))
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
    if (!account || account.flatformType !== 'zalo' || !account.isZaloServer || account.isZaloShowWeb) {
      throw new Error('Tài khoản không thuộc runtime Zalo Server')
    }
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
    if (this.snapshotNotifyTimer) return
    this.snapshotNotifyTimer = setTimeout(() => {
      this.snapshotNotifyTimer = null
      this.flushSnapshot()
    }, SNAPSHOT_BROADCAST_COALESCE_MS)
  }

  private flushSnapshot(): void {
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

  private parseCleanupRuntimeGuard(value: unknown): CleanupRuntimeGuard | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const expectedRuntimeStartedAt = String(
      (value as Partial<CleanupRuntimeGuard>).expectedRuntimeStartedAt || ''
    ).trim()
    return expectedRuntimeStartedAt ? { expectedRuntimeStartedAt } : null
  }

  private cleanupGuardMatchesRuntime(
    runtime: StaffRuntime,
    guard: CleanupRuntimeGuard | null
  ): boolean {
    return !!runtime.startedAt && guard?.expectedRuntimeStartedAt === runtime.startedAt
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

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item)
    }
  }))
}
