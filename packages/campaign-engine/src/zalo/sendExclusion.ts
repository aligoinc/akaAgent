/**
 * Loại trừ gửi (gateSendExclusion của Desktop, src/main/services/campaignScheduler.ts): trước khi gửi cho một người nhận, kiểm danh
 * sách Zalo ID loại trừ và nhóm điều kiện mà khách đặt cho tài khoản. Luật đánh giá là bản chép nguyên văn
 * src/shared/campaignSendExclusion.ts (sendExclusionRules.ts, script kiểm giữ hai bản giống nhau); cấu hình và dữ kiện trong DB
 * đọc qua RPC aka_agent_engine_send_exclusion_v1 (V504) xác thực bằng lease của bộ mới.
 *
 * Như Desktop: thuộc điều kiện loại trừ hoặc chưa đủ dữ liệu để kết luận thì không gửi, data tạm dừng kèm câu (EXC01 / EXC02), chặn cả
 * nhắn tin lẫn kết bạn; cấu hình hỏng thì tạm dừng chiến dịch (CFG18). Khác Desktop: nguồn dữ liệu đọc lỗi thì báo đúng lỗi đó cho DB
 * quyết định (thường là data về hàng đợi để chạy lại) thay vì tạm dừng data; DB của mình lỗi khi kiểm thì theo on_error của cổng
 * send_exclusion (V504 đặt closed: data về hàng đợi, chạy lại sau), không gửi khi chưa kiểm được.
 */
import type { RawOutcome } from '../contracts.js'
import type { StepContext } from '../runUnit.js'
import { CancelledError, errorMessage, stepFailure, withDeadline } from '../boundary.js'
import type { ConfigIssue } from '../validation.js'
import { ZaloPortError, zaloFailure, type ZaloFoundUser, type ZaloResolvedTarget } from './common.js'
import {
  evaluateSendExclusion, exclusionSelection, hasSendExclusions, readFriendship, ruleDefinition, supportsSendExclusion,
  validateExclusionGroup, zaloProfileFacts, type ExclusionFacts, type SendExclusionSnapshot
} from './sendExclusionRules.js'

/** Mã cổng trong auto_engine_gates. */
export const SEND_EXCLUSION_GATE = 'send_exclusion'
export const SEND_EXCLUDED_ERROR_CODE = 'err_engine_send_excluded'
export const SEND_EXCLUSION_UNKNOWN_ERROR_CODE = 'err_engine_send_exclusion_unknown'
export const SEND_EXCLUSION_CONFIG_ERROR_CODE = 'err_cfg_send_exclusion_invalid'

/** RPC V504 trả { ok: false, reason }: config_invalid (cấu hình hỏng), ownership_lost / run_closed (lượt không còn của mình). */
export class SendExclusionRpcError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message || reason)
    this.name = 'SendExclusionRpcError'
  }
}

export interface ZaloSendExclusionPort {
  /** V504 'snapshot': danh mục điều kiện, nhóm điều kiện của tài khoản, danh sách Zalo ID loại trừ. Ném SendExclusionRpcError. */
  sendExclusionSnapshot(ctx: StepContext): Promise<SendExclusionSnapshot>
  /** V504 'facts': tag akaBiz (tags) / số ngày từ lần gửi gần nhất (days) của người nhận. Ném SendExclusionRpcError. */
  sendExclusionFacts(ctx: StepContext, payload: { uid: string; tags?: boolean; days?: number }): Promise<ExclusionFacts>
  /**
   * Tag Zalo của người nhận ({ ids, availableValues }) từ một lần đọc tag của tài khoản, dùng chung cho cả data (cả lô khi chia sẻ)
   * như CampaignLabelContext của Desktop; contextRunId là lượt data giữ ngữ cảnh, nơi chạy dọn ở onTargetEnd của lượt đó.
   */
  labelMembership(ctx: StepContext, contextRunId: number, uid: string): Promise<unknown>
  /** Trạng thái kết bạn thô (getFriendRequestStatus), đọc khi hồ sơ không có cờ bạn bè. */
  friendRequestStatus(ctx: StepContext, uid: string): Promise<unknown>
  getUserProfile(ctx: StepContext, uid: string): Promise<ZaloFoundUser | null>
}

type JsonObject = Record<string, unknown>

interface ExclusionCampaign { id: number; actionId: string; accountId: number; extraSettings: JsonObject }

/** Chiến dịch có loại trừ gửi cho tài khoản chạy (supportsSendExclusion && hasSendExclusions); cấu hình hỏng cũng coi là có. */
export function sendExclusionActive(campaign: ExclusionCampaign): boolean {
  if (!supportsSendExclusion(campaign.actionId, campaign.extraSettings)) return false
  try {
    return hasSendExclusions(campaign.extraSettings, campaign.accountId)
  } catch {
    // Cấu hình hỏng: kiểm cấu hình đầu lượt (validateSendExclusionConfig) tạm dừng chiến dịch với đúng câu.
    return true
  }
}

/** Như lúc bắt đầu lượt của Desktop: cấu hình loại trừ hỏng thì tạm dừng chiến dịch "Không thể tải cấu hình loại trừ: …" (CFG18). */
export function validateSendExclusionConfig(campaign: ExclusionCampaign): ConfigIssue[] {
  if (!supportsSendExclusion(campaign.actionId, campaign.extraSettings)) return []
  try {
    exclusionSelection(campaign.extraSettings, campaign.accountId)
    return []
  } catch (error) {
    return [{ errorCode: SEND_EXCLUSION_CONFIG_ERROR_CODE, publicCode: 'CFG18', scope: 'campaign',
      message: `Không thể tải cấu hình loại trừ: ${errorMessage(error)}` }]
  }
}

// Cấu hình loại trừ đọc một lần cho mỗi lượt chạy (sendExclusionRuns của Desktop), theo lease + chiến dịch.
const SNAPSHOT_LIMIT = 64
const snapshots = new Map<string, SendExclusionSnapshot>()
function rememberSnapshot(key: string, snapshot: SendExclusionSnapshot): void {
  snapshots.set(key, snapshot)
  while (snapshots.size > SNAPSHOT_LIMIT) {
    const oldest = snapshots.keys().next().value
    if (oldest === undefined) break
    snapshots.delete(oldest)
  }
}

/** Nguồn dữ liệu đọc lỗi: dừng đánh giá, xử lý ngoài evaluateSendExclusion. */
class SourceFailure extends Error {
  constructor(readonly source: string, readonly failure: unknown) {
    super(errorMessage(failure))
    this.name = 'SourceFailure'
  }
}

export type SendExclusionResult =
  | { kind: 'allowed'; warning?: string }
  | { kind: 'blocked'; outcome: RawOutcome }

export interface SendExclusionInput {
  campaign: ExclusionCampaign
  /** Zalo ID của người nhận (UID tìm được, hoặc UID của data). */
  uid: string
  /** Mục tiêu đã có hồ sơ (tra số / getUserProfile thành công); null thì đọc hồ sơ khi điều kiện cần, như Desktop. */
  profileTarget: ZaloResolvedTarget | null
  /** Lượt data giữ ngữ cảnh tag: data đang chạy, hoặc data đầu lô khi gửi dạng chia sẻ. */
  labelContextRunId: number
  readTimeoutMs?: number
}

/** Mục tiêu có hồ sơ của Zalo (tra số, hoặc đã ghép hồ sơ đọc theo UID); mục tiêu chỉ dựng từ data thì không. */
export function exclusionProfileTarget(target: ZaloResolvedTarget, fromInput: boolean): ZaloResolvedTarget | null {
  if (!fromInput) return target
  const profile = target.raw?.profile
  return profile && typeof profile === 'object' && !Array.isArray(profile) && Object.keys(profile).length > 0 ? target : null
}

const blocked = (code: string, message: string, data: JsonObject = {}): SendExclusionResult =>
  ({ kind: 'blocked', outcome: { ok: false, phase: 'before_send', signal: { kind: 'engine', code, message }, data: { gate: SEND_EXCLUSION_GATE, ...data } } })

/**
 * Kiểm một người nhận. Không có cấu hình loại trừ thì cho gửi. Huỷ (dừng từ ngoài) ném CancelledError.
 */
export async function checkZaloSendExclusion(port: ZaloSendExclusionPort, ctx: StepContext, input: SendExclusionInput): Promise<SendExclusionResult> {
  const timeoutMs = input.readTimeoutMs ?? 60_000
  const closedOnError = ctx.gateSettings[SEND_EXCLUSION_GATE]?.onError !== 'open'
  const unavailable = (error: unknown): SendExclusionResult => {
    const message = errorMessage(error) || 'Lỗi không xác định'
    return closedOnError
      ? blocked('gate_unavailable', `Không thể kiểm tra loại trừ gửi: ${message}`)
      : { kind: 'allowed', warning: `Không thể kiểm tra loại trừ gửi; vẫn tiếp tục gửi: ${message}` }
  }
  const configInvalid = (error: unknown): SendExclusionResult => ({ kind: 'blocked', outcome: { ok: false, phase: 'before_send',
    signal: { kind: 'engine', code: 'send_exclusion_config_invalid', errorCode: SEND_EXCLUSION_CONFIG_ERROR_CODE,
      message: `Không thể tải cấu hình loại trừ: ${errorMessage(error) || 'Lỗi không xác định'}` }, data: { gate: SEND_EXCLUSION_GATE } } })
  const cancelled = (error: unknown): boolean => error instanceof CancelledError || ctx.signal.aborted

  const key = `${ctx.leaseToken}:${input.campaign.id}`
  let snapshot = snapshots.get(key)
  if (!snapshot) {
    let loaded: SendExclusionSnapshot
    try {
      loaded = await withDeadline('send_exclusion_snapshot', timeoutMs, ctx.signal, s => port.sendExclusionSnapshot({ ...ctx, signal: s }))
    } catch (error) {
      if (cancelled(error)) throw error instanceof CancelledError ? error : new CancelledError('send_exclusion')
      if (error instanceof SendExclusionRpcError && error.reason === 'config_invalid') return configInvalid(error)
      return unavailable(error)
    }
    try {
      if (loaded.group) validateExclusionGroup(loaded.catalog, loaded.group)
    } catch (error) {
      return configInvalid(error)
    }
    snapshot = loaded
    rememberSnapshot(key, snapshot)
  }

  const current = snapshot
  const uid = String(input.uid || '').trim()
  const profile = input.profileTarget
  const days = (source: string): number => Math.max(1, ...(current.group?.rules ?? [])
    .filter(rule => rule.isEnabled && ruleDefinition(current.catalog, rule).field.sourceKey === source).map(rule => Number(rule.value)))
  const read = <T>(label: string, fn: (s: AbortSignal) => Promise<T>): Promise<T> => withDeadline(label, timeoutMs, ctx.signal, fn)
  try {
    const decision = await evaluateSendExclusion(current, uid, async source => {
      if (source === 'zalo_labels') {
        return uid ? read('send_exclusion_labels', s => port.labelMembership({ ...ctx, signal: s }, input.labelContextRunId, uid)) : null
      }
      if (source === 'zalo_friendship') {
        const known = readFriendship(profile?.raw)
        if (known) return known
        if (!uid) return null
        return readFriendship(await read('send_exclusion_friendship', s => port.friendRequestStatus({ ...ctx, signal: s }, uid)))
      }
      if (source === 'zalo_profile') {
        if (profile) return zaloProfileFacts(profile.raw)
        if (!uid) return null
        const found = await read('send_exclusion_profile', s => port.getUserProfile({ ...ctx, signal: s }, uid))
        return zaloProfileFacts(found?.raw ?? null)
      }
      if (source === 'akabiz_contact' || source === 'campaign_delivery') {
        const facts = await read('send_exclusion_facts', s => port.sendExclusionFacts({ ...ctx, signal: s },
          source === 'akabiz_contact' ? { uid, tags: true } : { uid, days: days(source) }))
        return facts[source]
      }
      return null
    }, () => { if (ctx.signal.aborted) throw new CancelledError('send_exclusion') }, async (source, error) => {
      throw new SourceFailure(source, error)
    })
    if (decision.decision === 'allowed') return { kind: 'allowed' }
    return blocked(decision.decision === 'excluded' ? 'send_excluded' : 'send_exclusion_unknown', decision.note)
  } catch (error) {
    if (cancelled(error)) throw error instanceof CancelledError ? error : new CancelledError('send_exclusion')
    if (!(error instanceof SourceFailure)) throw error
    const cause = error.failure
    if (cause instanceof CancelledError) throw cause
    // Đọc tag / bạn bè / hồ sơ từ Zalo lỗi: báo đúng lỗi đó, DB quyết định (pha trước khi gửi, chưa gửi gì).
    if (error.source.startsWith('zalo_')) {
      if (cause instanceof ZaloPortError) return { kind: 'blocked', outcome: zaloFailure(cause, 'before_send', { gate: SEND_EXCLUSION_GATE, source: error.source }) }
      const raw = stepFailure(cause, false)
      return { kind: 'blocked', outcome: raw.ok ? raw : { ...raw, data: { gate: SEND_EXCLUSION_GATE, source: error.source } } }
    }
    // Dữ kiện trong DB (tag akaBiz, lần gửi gần nhất): cổng theo on_error.
    return unavailable(cause)
  }
}
