import type { BrowserWindow } from 'electron'
import { IPC_EVENTS, type AuthUser, type AutoAccountContact, type ZaloLabelOption } from '../../shared/types'
import {
  ZALO_SERVER_IPC,
  type ZaloServerCommandName,
  type ZaloServerRuntimeEvent,
  type ZaloServerRuntimeHandoffResponse,
  type ZaloServerRuntimeState,
  type ZaloServerSnapshot,
  type ZaloServerStaffSnapshot
} from '../../shared/zaloServerProtocol'
import { requireCurrentUser, runWithCurrentUser } from '../../main/data/currentUser'
import type { StaffZaloRunningState } from '../../main/data/repositories/accountRepository'
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
  stopDeferred: boolean
}

export interface ZaloServerRuntimeManagerOptions {
  adminWindow(): BrowserWindow | null
  publishEvent(event: ZaloServerRuntimeEvent): void
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

  async executeCommand(staffId: number, command: ZaloServerCommandName, args: unknown[]): Promise<unknown> {
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
    if (!bypassReservation && !runtime.scheduler?.tryReserveExternalAccount(accountId)) {
      throw new Error('Tài khoản Zalo đang thực hiện một tác vụ khác')
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
            if (result.success) this.watchQrCompletion(runtime, accountId)
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
            this.emitRuntimeState(runtime, this.formatDesktopHandoffWaitMessage(runningState))
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
      this.emitRuntimeState(runtime, 'Runtime Zalo server đã bắt đầu')
    } catch (error) {
      runtime.state = 'error'
      runtime.lastError = this.errorMessage(error)
      this.emitRuntimeState(runtime, `Không khởi động được runtime: ${runtime.lastError}`)
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
        runtime.scheduler?.blockZaloRuntimeForRestart()
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
          this.emitRuntimeState(runtime, runtime.lastError)
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
    this.emitRuntimeState(runtime, 'Runtime Zalo server đã dừng')
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

  private formatDesktopHandoffWaitMessage(state: StaffZaloRunningState): string {
    const runningCount = state.accountsRunning +
      state.campaignsRunning +
      state.campaignInputsRunning +
      state.campaignInputDataRunning
    return `Đang chờ app desktop dừng và dọn ${runningCount} trạng thái Zalo đang chạy`
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

  private watchQrCompletion(runtime: StaffRuntime, accountId: number): void {
    const completion = runWithCurrentUser(runtime.user, async () => {
      await runtime.zaloRuntime?.waitForLoginQrIdle(accountId)
      await this.releaseQrAccountClaim(runtime, accountId)
      runtime.scheduler?.releaseExternalAccount(accountId)
      runtime.eventWindow?.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
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
          this.emit(runtime.user, channel, markServerCampaignLog(channel, payload))
        }
      }
    }
    return bridge as unknown as BrowserWindow
  }

  private emit(user: AuthUser, channel: string, payload: unknown): void {
    const event: ZaloServerRuntimeEvent = {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      staffId: user.staffId,
      organizationId: user.organizationId,
      channel,
      payload
    }
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

  private emitRuntimeState(runtime: StaffRuntime, message: string): void {
    this.emit(runtime.user, 'zalo-server:runtime-state', {
      state: runtime.state,
      message,
      error: runtime.lastError
    })
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
