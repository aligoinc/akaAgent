import { randomUUID } from 'crypto'
import type {
  AutomationDataType,
  AutomationUpdatedEvent,
  Campaign,
  CampaignInputData,
  ContactType
} from '../../shared/types'
import {
  isValidEmailInputDataValue,
  normalizeEmailInputDataValue
} from '../../shared/types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone } from '../../shared/phone'
import { renderSmsInputContent } from '../../shared/smsContent'
import { normalizeAccountContactUid } from '../data/repositories/accountContactRepository'
import {
  claimAutomationDetails,
  materializeAutomationDetail,
  recoverStaleAutomationDetails,
  reconcileAutomationEnqueueFailures,
  retryAutomationDetail,
  type AutomationRepositoryContext,
  type AutomationRuntimeTarget,
  type ClaimedAutomationDetail
} from '../data/repositories/automationRepository'

const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_BATCH_SIZE = 25
const TARGET_RUNNING_RETRY_SECONDS = 30
const TRANSIENT_RETRY_SECONDS = 30
const MAX_TRANSIENT_ATTEMPTS = 5
const STALE_AFTER_SECONDS = 120
const MAX_STOP_WAIT_MS = 30_000
const CONTACT_TYPES = new Set<ContactType>([
  'person',
  'group',
  'page',
  'page_inbox_customer',
  'zalo_tag',
  'phone',
  'email',
  'campaign_input'
])

type JsonRecord = Record<string, unknown>

export interface AutomationProcessorOptions {
  runtimeTarget: AutomationRuntimeTarget
  pollIntervalMs?: number
  batchSize?: number
  repositoryContext?: AutomationRepositoryContext
  runInContext?: <T>(operation: () => Promise<T>) => Promise<T>
  onUpdated?: (event: AutomationUpdatedEvent) => void
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function firstDefined(row: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key]
  }
  return undefined
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function nullableText(value: unknown): string | null {
  const normalized = text(value)
  return normalized || null
}

function copyTextField(target: JsonRecord, source: JsonRecord, camelKey: string, snakeKey: string): void {
  const value = nullableText(firstDefined(source, camelKey, snakeKey))
  if (value !== null) target[camelKey] = value
}

function getTargetCampaignSnapshot(claim: ClaimedAutomationDetail): JsonRecord {
  const snapshot = claim.configSnapshot
  const nested = firstDefined(snapshot, 'targetCampaign', 'target_campaign')
  return Object.keys(asRecord(nested)).length > 0 ? asRecord(nested) : snapshot
}

function getTargetContactType(claim: ClaimedAutomationDetail): ContactType {
  const value = text(firstDefined(claim.configSnapshot, 'targetContactType', 'target_contact_type')) as ContactType
  return CONTACT_TYPES.has(value) ? value : 'person'
}

function normalizeAutomationValue(dataType: AutomationDataType, rawValue: unknown): string {
  if (dataType === 'phone') return normalizeVietnamMobilePhone(rawValue)
  if (dataType === 'email') return normalizeEmailInputDataValue(rawValue)
  return text(rawValue)
}

function invalidDataMessage(dataType: AutomationDataType): string {
  if (dataType === 'phone') return 'Dữ liệu nguồn không có số điện thoại hợp lệ.'
  if (dataType === 'email') return 'Dữ liệu nguồn không có email hợp lệ.'
  if (dataType === 'zalo_uid') return 'Dữ liệu nguồn không có UID Zalo.'
  return 'Dữ liệu nguồn không có UID Facebook.'
}

function buildTargetInput(claim: ClaimedAutomationDetail): JsonRecord {
  const source = claim.sourceInputSnapshot
  const rawValue = claim.dataValue || firstDefined(
    source,
    claim.dataType === 'phone' ? 'phone' : claim.dataType === 'email' ? 'email' : 'uid'
  )
  const dataValue = normalizeAutomationValue(claim.dataType, rawValue)
  const isValid = claim.dataType === 'email'
    ? isValidEmailInputDataValue(dataValue)
    : dataValue.length > 0
  if (!isValid) throw new AutomationSkippedError(invalidDataMessage(claim.dataType))

  const target: JsonRecord = {}
  copyTextField(target, source, 'name', 'name')
  copyTextField(target, source, 'phone', 'phone')
  copyTextField(target, source, 'uid', 'uid')
  copyTextField(target, source, 'email', 'email')
  copyTextField(target, source, 'info1', 'info1')
  copyTextField(target, source, 'info2', 'info2')
  copyTextField(target, source, 'info3', 'info3')
  copyTextField(target, source, 'info4', 'info4')
  copyTextField(target, source, 'info5', 'info5')

  if (claim.dataType === 'phone') {
    target.phone = dataValue
    target.phoneCarrier = getVietnamMobileCarrier(dataValue)
  } else if (claim.dataType === 'email') {
    target.email = dataValue
  } else {
    target.uid = dataValue
  }

  const sourcePhoneCarrier = nullableText(firstDefined(source, 'phoneCarrier', 'phone_carrier'))
  if (sourcePhoneCarrier && claim.dataType !== 'phone') target.phoneCarrier = sourcePhoneCarrier

  // Campaign input UID stays as the raw workflow target (often a Facebook
  // URL), while contactUid follows the contact-type-aware catalog identity so
  // group membership does not create duplicate URL-shaped contacts.
  const contactUid = claim.dataType === 'facebook_uid'
    ? normalizeAccountContactUid(dataValue, getTargetContactType(claim))
    : dataValue
  if (!contactUid) throw new AutomationSkippedError(invalidDataMessage(claim.dataType))
  target.contactUid = contactUid
  if (claim.dataType === 'facebook_uid' && /^https?:\/\//i.test(dataValue)) {
    target.contactUrl = dataValue
  }
  if (!target.name) target.name = dataValue

  if (claim.targetActionId === 'sms_send') {
    const campaign = getTargetCampaignSnapshot(claim)
    const inputRow = target as Partial<CampaignInputData>
    const content = renderSmsInputContent({
      content: text(campaign.content),
      schedule: nullableText(campaign.schedule) || undefined,
      originalSchedule: nullableText(firstDefined(campaign, 'originalSchedule', 'original_schedule')),
      extraSettings: asRecord(firstDefined(campaign, 'extraSettings', 'extra_settings')) as Campaign['extraSettings']
    }, inputRow, claim.targetRowIndex, claim.scheduledAt)
    if (!content) throw new Error('Chiến dịch SMS đích chưa có nội dung hợp lệ.')
    target.content = content
  }

  return target
}

function friendlyProcessorError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/fetch failed|network|econnreset|enotfound|timeout|timed out/i.test(message)) {
    return 'Không thể kết nối cơ sở dữ liệu. Hệ thống sẽ tự thử lại.'
  }
  return message.trim().slice(0, 2000) || 'Không thể xử lý dữ liệu tự động hóa.'
}

class AutomationSkippedError extends Error {}

export class AutomationProcessor {
  private readonly workerId: string
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private cyclePromise: Promise<void> | null = null
  private lastPollError = ''
  private generation = 0

  constructor(private readonly options: AutomationProcessorOptions) {
    this.workerId = `automation:${options.runtimeTarget}:${process.pid}:${randomUUID()}`
    this.pollIntervalMs = Math.max(1_000, Math.floor(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS))
    this.batchSize = Math.min(50, Math.max(1, Math.floor(options.batchSize || DEFAULT_BATCH_SIZE)))
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    const generation = ++this.generation
    this.schedule(0, generation)
  }

  async stop(timeoutMs = MAX_STOP_WAIT_MS): Promise<boolean> {
    this.running = false
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const cycle = this.cyclePromise
    if (!cycle) return true
    const settled = await this.waitForCycle(
      cycle,
      Math.min(MAX_STOP_WAIT_MS, Math.max(0, timeoutMs))
    )
    if (!settled) {
      console.warn(
        `[AutomationProcessor:${this.options.runtimeTarget}] ` +
        'Stop timed out; remaining claimed rows will be recovered from the durable queue.'
      )
    }
    return settled
  }

  async waitForIdle(timeoutMs = 30_000): Promise<boolean> {
    const cycle = this.cyclePromise
    if (!cycle) return true
    return Promise.race([
      cycle.then(() => true, () => true),
      new Promise<false>(resolve => setTimeout(() => resolve(false), Math.max(0, timeoutMs)))
    ])
  }

  private schedule(delayMs: number, generation: number): void {
    if (!this.isGenerationActive(generation)) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.isGenerationActive(generation)) return
      if (this.cyclePromise) {
        this.schedule(this.pollIntervalMs, generation)
        return
      }
      const cycle = this.inContext(() => this.runCycle(generation))
      this.cyclePromise = cycle
      void cycle.finally(() => {
        if (this.cyclePromise === cycle) this.cyclePromise = null
        if (this.isGenerationActive(generation)) this.schedule(this.pollIntervalMs, generation)
      }).catch(() => {})
    }, Math.max(0, delayMs))
  }

  private async runCycle(generation: number): Promise<void> {
    try {
      if (!this.isGenerationActive(generation)) return
      await recoverStaleAutomationDetails(STALE_AFTER_SECONDS, this.options.repositoryContext)
      if (!this.isGenerationActive(generation)) return
      const reconcile = await reconcileAutomationEnqueueFailures(
        this.workerId,
        100,
        this.options.repositoryContext
      )
      if (!this.isGenerationActive(generation)) return
      if (reconcile.failed > 0) {
        console.warn(
          `[AutomationProcessor:${this.options.runtimeTarget}] ` +
          `Reconcile still has ${reconcile.failed} failed enqueue rows.`
        )
      }
      const claims = await claimAutomationDetails(
        this.workerId,
        this.batchSize,
        this.options.repositoryContext
      )
      if (this.lastPollError) {
        console.info(`[AutomationProcessor:${this.options.runtimeTarget}] Database connection restored.`)
        this.lastPollError = ''
      }
      for (const claim of claims) {
        if (!this.isGenerationActive(generation)) break
        await this.processClaim(claim)
      }
    } catch (error) {
      this.logPollError(error)
    }
  }

  private async processClaim(claim: ClaimedAutomationDetail): Promise<void> {
    try {
      const targetInput = buildTargetInput(claim)
      const result = await materializeAutomationDetail(
        claim.automationDetailId,
        this.workerId,
        targetInput,
        this.options.repositoryContext
      )
      if (result.code === 'target_running') {
        await retryAutomationDetail(claim.automationDetailId, this.workerId, {
          error: 'target_campaign_running',
          delaySeconds: TARGET_RUNNING_RETRY_SECONDS,
          countAttempt: false
        }, this.options.repositoryContext)
        this.emitUpdated(claim)
        return
      }
      if (result.code === 'materialized' || result.code === 'already_materialized') {
        this.emitUpdated(claim)
        return
      }
      if (result.code === 'not_claimed') return
      throw new Error(result.error || 'Không thể thêm dữ liệu vào chiến dịch B.')
    } catch (error) {
      const skipped = error instanceof AutomationSkippedError
      const terminal = !skipped && claim.attemptCount >= MAX_TRANSIENT_ATTEMPTS
      try {
        await retryAutomationDetail(claim.automationDetailId, this.workerId, {
          error: friendlyProcessorError(error),
          delaySeconds: skipped || terminal ? 0 : TRANSIENT_RETRY_SECONDS,
          terminal,
          skip: skipped,
          countAttempt: !skipped
        }, this.options.repositoryContext)
        this.emitUpdated(claim)
      } catch (retryError) {
        console.error(
          `[AutomationProcessor:${this.options.runtimeTarget}] Cannot settle execution ${claim.automationDetailId}:`,
          retryError
        )
      }
    }
  }

  private emitUpdated(claim: ClaimedAutomationDetail): void {
    this.options.onUpdated?.({
      automationId: claim.automationId,
      executionId: claim.automationDetailId,
      reason: 'execution_changed'
    })
  }

  private inContext<T>(operation: () => Promise<T>): Promise<T> {
    return this.options.runInContext ? this.options.runInContext(operation) : operation()
  }

  private isGenerationActive(generation: number): boolean {
    return this.running && this.generation === generation
  }

  private waitForCycle(cycle: Promise<void>, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
      let settled = false
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      void cycle.then(() => finish(true), () => finish(true))
    })
  }

  private logPollError(error: unknown): void {
    const message = friendlyProcessorError(error)
    if (message === this.lastPollError) return
    this.lastPollError = message
    console.error(`[AutomationProcessor:${this.options.runtimeTarget}] Poll failed:`, error)
  }
}
