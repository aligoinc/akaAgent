import { BrowserWindow } from 'electron'
import { GroupEventType, ThreadType } from 'zca-js'
import type { GroupEvent, Message, Reaction } from 'zca-js'
import { Campaign, IPC_EVENTS, type CampaignSummaryRefreshSignal } from '../../shared/types'
import type { CampaignRuntimeTarget } from '../data/repositories/campaignRepository'
import { SupabaseService } from './supabase'
import { ZaloRuntimeService, type ZaloListenerStatusEvent } from './zaloRuntimeService'

const ACTION_ID = 'zalo_message_group_realtime'
const REFRESH_INTERVAL_MS = 30_000
const SESSION_CHECK_DEBOUNCE_MS = 5_000
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

type TriggerType = 'join' | 'leave' | 'interact'

interface RealtimeCampaignConfig {
  campaign: Campaign
  accountId: number
  groupIds: Set<string>
  groupNamesById: Map<string, string>
  triggers: Set<TriggerType>
  endDateKey: string
}

interface AccountSubscription {
  unsubscribe: () => void
  degraded: boolean
}

interface VietnamDateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export class ZaloRealtimeGroupCampaignManager {
  private running = false
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private refreshInFlight: Promise<void> | null = null
  private campaignsByAccount = new Map<number, RealtimeCampaignConfig[]>()
  private subscriptions = new Map<number, AccountSubscription>()
  private listenerEnsureOperations = new Map<number, Promise<void>>()
  private sessionCheckTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private activeOperations = new Set<Promise<unknown>>()
  private generation = 0
  private zaloRuntimeClaimsAbandoned = false

  constructor(
    private readonly supabase: SupabaseService,
    private readonly zaloRuntime: ZaloRuntimeService,
    private readonly mainWindow: BrowserWindow,
    private readonly runtimeTarget: CampaignRuntimeTarget = 'desktop'
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.generation += 1
    void this.refresh('start')
    this.refreshTimer = setInterval(() => {
      void this.refresh('interval')
    }, REFRESH_INTERVAL_MS)
  }

  stop(): void {
    this.running = false
    this.generation += 1
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    for (const timer of this.sessionCheckTimers.values()) clearTimeout(timer)
    this.sessionCheckTimers.clear()
    for (const subscription of this.subscriptions.values()) {
      try { subscription.unsubscribe() } catch {}
    }
    this.subscriptions.clear()
    this.campaignsByAccount.clear()
  }

  abandonZaloRuntimeClaims(): void {
    this.zaloRuntimeClaimsAbandoned = true
  }

  resetZaloRuntimeClaims(): void {
    this.zaloRuntimeClaimsAbandoned = false
  }

  refreshSoon(reason = 'manual'): void {
    if (!this.running) return
    void this.refresh(reason)
  }

  async waitForIdle(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (this.activeOperations.size > 0 || this.refreshInFlight) {
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return true
  }

  private async refresh(reason: string): Promise<void> {
    if (!this.running) return
    if (this.refreshInFlight) return this.refreshInFlight

    const generation = this.generation
    this.refreshInFlight = this.doRefresh(reason, generation)
      .catch((err) => {
        console.warn('[ZaloRealtimeGroupCampaignManager] Refresh failed', {
          reason,
          message: this.getErrorMessage(err)
        })
      })
      .finally(() => {
        this.refreshInFlight = null
      })

    return this.refreshInFlight
  }

  private async doRefresh(_reason: string, generation: number): Promise<void> {
    const [clock, snapshots] = await Promise.all([
      this.supabase.getRuntimeClock(),
      this.supabase.listZaloRealtimeGroupCampaignSnapshots(this.runtimeTarget)
    ])
    if (!this.isActiveGeneration(generation)) return
    const nextByAccount = new Map<number, RealtimeCampaignConfig[]>()

    for (const snapshot of snapshots) {
      const config = this.normalizeCampaign(snapshot.campaign)
      if (!config) continue
      if (snapshot.accountLoginStatus !== 'đã đăng nhập') continue
      if (snapshot.accountStatus !== 'chờ xử lý' && snapshot.accountStatus !== 'đang chạy') continue
      if (!snapshot.accountIsActive) continue
      if (!this.isReceivingWindowActive(config, clock.vietnamDateKey)) continue

      const items = nextByAccount.get(config.accountId) || []
      items.push(config)
      nextByAccount.set(config.accountId, items)
    }

    this.campaignsByAccount = nextByAccount

    for (const accountId of Array.from(this.subscriptions.keys())) {
      if (nextByAccount.has(accountId)) continue
      const subscription = this.subscriptions.get(accountId)
      try { subscription?.unsubscribe() } catch {}
      this.subscriptions.delete(accountId)
    }

    for (const accountId of nextByAccount.keys()) {
      if (!this.isActiveGeneration(generation)) return
      this.ensureAccountSubscription(accountId)
      this.ensureAccountListener(accountId)
    }
  }

  private normalizeCampaign(campaign: Campaign): RealtimeCampaignConfig | null {
    if (campaign.actionId !== ACTION_ID) return null
    const extra = campaign.extraSettings || {}
    const triggers = new Set(
      (Array.isArray(extra.zaloRealtimeTriggers) ? extra.zaloRealtimeTriggers : [])
        .map(item => String(item || '').trim())
        .filter((item): item is TriggerType => item === 'join' || item === 'leave' || item === 'interact')
    )
    const rawGroupIds = Array.isArray(extra.zaloRealtimeGroupIds) ? extra.zaloRealtimeGroupIds : []
    const rawGroupNames = Array.isArray(extra.zaloRealtimeGroupNames) ? extra.zaloRealtimeGroupNames : []
    const groupIds = new Set<string>()
    const groupNamesById = new Map<string, string>()

    rawGroupIds.forEach((raw, index) => {
      const groupId = normalizeZaloGroupId(raw)
      if (!groupId) return
      groupIds.add(groupId)
      const name = String(rawGroupNames[index] || '').trim()
      if (name) groupNamesById.set(groupId, name)
    })

    const endDateKey = normalizeDateKey(extra.zaloRealtimeEndDate)
    if (!endDateKey || triggers.size === 0 || groupIds.size === 0) return null

    return {
      campaign,
      accountId: campaign.accountId,
      groupIds,
      groupNamesById,
      triggers,
      endDateKey
    }
  }

  private ensureAccountSubscription(accountId: number): void {
    if (this.subscriptions.has(accountId)) return

    const unsubscribe = this.zaloRuntime.subscribeRealtimeListener(accountId, {
      groupEvent: event => { void this.trackOperation(this.handleGroupEvent(accountId, event)) },
      message: message => { void this.trackOperation(this.handleMessage(accountId, message)) },
      reaction: reaction => { void this.trackOperation(this.handleReaction(accountId, reaction)) },
      status: event => this.handleListenerStatus(event)
    })

    this.subscriptions.set(accountId, { unsubscribe, degraded: false })
  }

  private ensureAccountListener(accountId: number): void {
    if (this.listenerEnsureOperations.has(accountId)) return
    const generation = this.generation
    const listenerSetup = (async () => {
      let previousStatus: 'chờ xử lý' | 'tạm dừng' | null = null
      try {
        if (this.zaloRuntimeClaimsAbandoned) return
        const claim = await this.supabase.claimZaloAccountRuntimeOperation(
          accountId,
          this.runtimeTarget,
          true
        )
        if (!claim.claimed || !claim.previousStatus) return
        previousStatus = claim.previousStatus
        if (!this.isActiveGeneration(generation)) return
        await this.zaloRuntime.ensureRealtimeListenerReady(accountId)
        if (!this.isActiveGeneration(generation)) return
        const subscription = this.subscriptions.get(accountId)
        if (subscription) subscription.degraded = false
      } catch (err) {
        console.warn('[ZaloRealtimeGroupCampaignManager] Failed to ensure listener', {
          accountId,
          message: this.getErrorMessage(err)
        })
        if (this.isActiveGeneration(generation)) this.scheduleSessionCheck(accountId)
      } finally {
        if (previousStatus && !this.zaloRuntimeClaimsAbandoned) {
          await this.supabase.releaseZaloAccountRuntimeOperation(
            accountId,
            this.runtimeTarget,
            previousStatus
          ).catch(err => {
            console.warn('[ZaloRealtimeGroupCampaignManager] Failed to release listener claim', {
              accountId,
              message: this.getErrorMessage(err)
            })
          })
        }
      }
    })()
    const operation = listenerSetup.finally(() => {
      if (this.listenerEnsureOperations.get(accountId) === operation) {
        this.listenerEnsureOperations.delete(accountId)
      }
    })
    this.listenerEnsureOperations.set(accountId, operation)
    void this.trackOperation(operation)
  }

  private handleListenerStatus(event: ZaloListenerStatusEvent): void {
    const subscription = this.subscriptions.get(event.accountId)
    if (!subscription) return

    if (event.status === 'running' && event.ready) {
      subscription.degraded = false
      return
    }

    if (event.status === 'disconnected' || event.status === 'starting') {
      subscription.degraded = true
      return
    }

    if (event.status === 'closed' || event.status === 'error') {
      subscription.degraded = true
      this.scheduleSessionCheck(event.accountId)
    }
  }

  private scheduleSessionCheck(accountId: number): void {
    if (this.sessionCheckTimers.has(accountId)) return
    const timer = setTimeout(() => {
      this.sessionCheckTimers.delete(accountId)
      void this.trackOperation(this.verifySessionAfterListenerFailure(accountId, this.generation))
    }, SESSION_CHECK_DEBOUNCE_MS)
    this.sessionCheckTimers.set(accountId, timer)
  }

  private async verifySessionAfterListenerFailure(accountId: number, generation: number): Promise<void> {
    if (!this.isActiveGeneration(generation)) return
    let previousStatus: 'chờ xử lý' | 'tạm dừng' | null = null
    try {
      if (this.zaloRuntimeClaimsAbandoned) return
      const claim = await this.supabase.claimZaloAccountRuntimeOperation(accountId, this.runtimeTarget, true)
      if (!claim.claimed || !claim.previousStatus) return
      previousStatus = claim.previousStatus
      if (!this.isActiveGeneration(generation)) return
      const result = await this.zaloRuntime.checkSession(accountId)
      if (!this.isActiveGeneration(generation)) return
      this.broadcastAccountStatusUpdated()
      if (result.loggedIn) {
        this.ensureAccountListener(accountId)
        return
      }
      await this.notePendingCampaignsLoggedOut(accountId)
      await this.refresh('session-failed')
    } catch (err) {
      console.warn('[ZaloRealtimeGroupCampaignManager] Session check failed after listener failure', {
        accountId,
        message: this.getErrorMessage(err)
      })
    } finally {
      if (previousStatus && !this.zaloRuntimeClaimsAbandoned) {
        await this.supabase.releaseZaloAccountRuntimeOperation(
          accountId,
          this.runtimeTarget,
          previousStatus
        ).catch(err => {
          console.warn('[ZaloRealtimeGroupCampaignManager] Failed to release session-check claim', {
            accountId,
            message: this.getErrorMessage(err)
          })
        })
      }
    }
  }

  private async notePendingCampaignsLoggedOut(accountId: number): Promise<void> {
    const campaigns = this.campaignsByAccount.get(accountId) || []
    const note = 'Tài khoản Zalo bị đăng xuất, tạm dừng nhận data theo thời gian thực'
    for (const item of campaigns) {
      if (item.campaign.status !== 'chờ xử lý') continue
      try {
        const updated = await this.supabase.updateCampaign(item.campaign.id, { note })
        this.broadcastCampaign(updated)
      } catch (err) {
        console.warn('[ZaloRealtimeGroupCampaignManager] Failed to update campaign logout note', {
          campaignId: item.campaign.id,
          message: this.getErrorMessage(err)
        })
      }
    }
  }

  private async handleGroupEvent(accountId: number, event: GroupEvent): Promise<void> {
    if (!this.running) return
    const data = (event.data || {}) as Record<string, any>
    const members = Array.isArray(data.updateMembers) ? data.updateMembers : []
    const trigger = event.type === GroupEventType.JOIN
      ? 'join'
      : event.type === GroupEventType.LEAVE || event.type === GroupEventType.REMOVE_MEMBER
        ? 'leave'
        : null
    if (!trigger) return

    const groupId = normalizeZaloGroupId(event.threadId || data.groupId || data.group_id)
    if (!groupId) return
    if (members.length === 0) return

    const campaigns = this.getMatchingCampaigns(accountId, groupId, trigger)
    if (campaigns.length === 0) return

    for (const member of members) {
      const targetUid = normalizeZaloMemberId(member?.id)
      if (!targetUid || targetUid === '0') continue
      const targetName = String(member?.dName || '').trim()
      for (const campaign of campaigns) {
        await this.enqueueEvent(campaign, {
          groupId,
          trigger,
          targetUid,
          targetName,
          rawPayload: {
            event: serializeGroupEvent(event),
            member
          }
        })
      }
    }
  }

  private async handleMessage(accountId: number, message: Message): Promise<void> {
    if (!this.running) return
    if (message.isSelf || message.type !== ThreadType.Group) return
    const groupId = normalizeZaloGroupId(message.threadId)
    const targetUid = normalizeZaloMemberId(message.data?.uidFrom)
    if (!groupId || !targetUid || targetUid === '0') return

    await this.enqueueInteract(accountId, groupId, targetUid, message.data?.dName, {
      message: serializeMessage(message)
    })
  }

  private async handleReaction(accountId: number, reaction: Reaction): Promise<void> {
    if (!this.running) return
    if (reaction.isSelf || !reaction.isGroup) return
    const groupId = normalizeZaloGroupId(reaction.threadId)
    const targetUid = normalizeZaloMemberId(reaction.data?.uidFrom)
    if (!groupId || !targetUid || targetUid === '0') return

    await this.enqueueInteract(accountId, groupId, targetUid, reaction.data?.dName, {
      reaction: serializeReaction(reaction)
    })
  }

  private async enqueueInteract(
    accountId: number,
    groupId: string,
    targetUid: string,
    rawName: unknown,
    rawPayload: Record<string, unknown>
  ): Promise<void> {
    if (!this.running) return
    const campaigns = this.getMatchingCampaigns(accountId, groupId, 'interact')
    if (campaigns.length === 0) return
    const targetName = String(rawName || '').trim()

    for (const campaign of campaigns) {
      await this.enqueueEvent(campaign, {
        groupId,
        trigger: 'interact',
        targetUid,
        targetName,
        rawPayload
      })
    }
  }

  private getMatchingCampaigns(accountId: number, groupId: string, trigger: TriggerType): RealtimeCampaignConfig[] {
    const normalizedGroupId = normalizeZaloGroupId(groupId)
    if (!normalizedGroupId) return []
    return (this.campaignsByAccount.get(accountId) || [])
      .filter(item => item.triggers.has(trigger))
      .filter(item => item.groupIds.has(normalizedGroupId))
  }

  private async enqueueEvent(
    item: RealtimeCampaignConfig,
    input: {
      groupId: string
      trigger: TriggerType
      targetUid: string
      targetName: string
      rawPayload: Record<string, unknown>
    }
  ): Promise<void> {
    const generation = this.generation
    if (!this.isActiveGeneration(generation)) return
    try {
      const clock = await this.supabase.getRuntimeClock()
      if (!this.isReceivingWindowActive(item, clock.vietnamDateKey)) {
        this.refreshSoon('receiving-window-ended')
        return
      }
      const eventTime = new Date(clock.dbNow)
      if (!Number.isFinite(eventTime.getTime())) {
        throw new Error('DB runtime clock is invalid')
      }
      const scheduleAt = this.getNextInputSchedule(item.campaign, eventTime)
      const result = await this.supabase.enqueueZaloRealtimeGroupEvent({
        runtimeTarget: this.runtimeTarget,
        campaignId: item.campaign.id,
        accountId: item.accountId,
        groupId: input.groupId,
        groupName: item.groupNamesById.get(input.groupId) || '',
        triggerType: input.trigger,
        targetUid: input.targetUid,
        targetName: input.targetName,
        eventTime: clock.dbNow,
        scheduleAt: scheduleAt.toISOString(),
        rawPayload: input.rawPayload
      })
      if (!this.isActiveGeneration(generation)) return
      await this.logRealtimeReceiveHistory(item, input, result.inserted)
      if (!this.isActiveGeneration(generation)) return
      if (result.inserted) {
        const updated = await this.supabase.getCampaign(item.campaign.id)
        if (updated) this.broadcastCampaign(updated)
      }
    } catch (err) {
      const message = this.getErrorMessage(err)
      if (message.includes('runtime_control_paused')) {
        // Pause can race an event already delivered by the Zalo listener. The
        // database rejected it before insert; refresh subscriptions quietly.
        this.refreshSoon('runtime-control-paused')
        return
      }
      console.warn('[ZaloRealtimeGroupCampaignManager] Failed to enqueue event', {
        campaignId: item.campaign.id,
        groupId: input.groupId,
        trigger: input.trigger,
        targetUid: input.targetUid,
        message
      })
    }
  }

  private isActiveGeneration(generation: number): boolean {
    return this.running && this.generation === generation
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.activeOperations.add(operation)
    void operation.finally(() => {
      this.activeOperations.delete(operation)
    }).catch(() => {})
    return operation
  }

  private async logRealtimeReceiveHistory(
    item: RealtimeCampaignConfig,
    input: {
      groupId: string
      trigger: TriggerType
      targetUid: string
      targetName: string
      rawPayload: Record<string, unknown>
    },
    inserted: boolean
  ): Promise<void> {
    const triggerLabel = getTriggerLabel(input.trigger)
    const groupName = item.groupNamesById.get(input.groupId) || input.groupId
    const targetLabel = input.targetName || input.targetUid
    const log = inserted
      ? `Đã nhận data theo thời gian thực (${triggerLabel}) từ group "${groupName}": ${targetLabel}`
      : `Đã nhận data theo thời gian thực (${triggerLabel}) từ group "${groupName}" nhưng data "${targetLabel}" đã tồn tại trong chiến dịch, không thêm lại data`

    try {
      const updated = await this.supabase.appendCampaignLog(item.campaign.id, log)
      this.broadcastCampaign(updated)
    } catch (err) {
      console.warn('[ZaloRealtimeGroupCampaignManager] Failed to log group event receive history', {
        campaignId: item.campaign.id,
        groupId: input.groupId,
        trigger: input.trigger,
        targetUid: input.targetUid,
        inserted,
        message: this.getErrorMessage(err)
      })
    }
  }

  private getNextInputSchedule(campaign: Campaign, eventTime: Date): Date {
    const eventDay = startOfVietnamDay(eventTime)
    const nextDay = new Date(eventDay.getTime() + 24 * 60 * 60 * 1000)
    const anchor = campaign.originalSchedule || campaign.schedule || eventTime.toISOString()
    const anchorDate = new Date(anchor)
    const anchorParts = Number.isNaN(anchorDate.getTime())
      ? getVietnamDateTimeParts(eventTime)
      : getVietnamDateTimeParts(anchorDate)
    const nextDayParts = getVietnamDateTimeParts(nextDay)
    return new Date(
      `${nextDayParts.year}-${pad2(nextDayParts.month)}-${pad2(nextDayParts.day)}T${pad2(anchorParts.hour)}:${pad2(anchorParts.minute)}:${pad2(anchorParts.second)}+07:00`
    )
  }

  private isReceivingWindowActive(item: RealtimeCampaignConfig, vietnamDateKey: string): boolean {
    return vietnamDateKey <= item.endDateKey
  }

  private broadcastCampaign(
    campaign: Pick<Campaign, 'id' | 'updatedAt' | 'status' | 'note'> & {
      schedule?: string | null
      lastRunAt?: string | null
    }
  ): void {
    try {
      if (!this.mainWindow.isDestroyed()) {
        const signal: CampaignSummaryRefreshSignal = {
          id: campaign.id,
          updatedAt: campaign.updatedAt,
          status: campaign.status,
          note: campaign.note
        }
        if ('schedule' in campaign) signal.schedule = campaign.schedule ?? null
        if ('lastRunAt' in campaign) signal.lastRunAt = campaign.lastRunAt ?? null
        this.mainWindow.webContents.send(IPC_EVENTS.CAMPAIGN_STATUS_UPDATED, signal)
      }
    } catch {}
  }

  private broadcastAccountStatusUpdated(): void {
    try {
      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC_EVENTS.ACCOUNT_STATUS_UPDATED)
      }
    } catch {}
  }

  private getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}

function normalizeZaloGroupId(value: unknown): string {
  return String(value || '').trim().replace(/^g/i, '')
}

function normalizeZaloMemberId(value: unknown): string {
  return String(value || '').trim().replace(/_0$/i, '')
}

function getTriggerLabel(trigger: TriggerType): string {
  if (trigger === 'join') return 'tham gia group'
  if (trigger === 'leave') return 'rời group'
  return 'tương tác trong group'
}

function normalizeDateKey(value: unknown): string {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return ''
  return getVietnamDateKey(date)
}

function getVietnamDateKey(date: Date): string {
  const parts = getVietnamDateTimeParts(date)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function startOfVietnamDay(date: Date): Date {
  const parts = getVietnamDateTimeParts(date)
  return new Date(`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T00:00:00+07:00`)
}

function getVietnamDateTimeParts(date: Date): VietnamDateParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function serializeGroupEvent(event: GroupEvent): Record<string, unknown> {
  return {
    type: event.type,
    act: event.act,
    threadId: event.threadId,
    isSelf: event.isSelf,
    data: event.data
  }
}

function serializeMessage(message: Message): Record<string, unknown> {
  return {
    type: message.type,
    threadId: message.threadId,
    isSelf: message.isSelf,
    data: message.data
  }
}

function serializeReaction(reaction: Reaction): Record<string, unknown> {
  return {
    threadId: reaction.threadId,
    isSelf: reaction.isSelf,
    isGroup: reaction.isGroup,
    data: reaction.data
  }
}
