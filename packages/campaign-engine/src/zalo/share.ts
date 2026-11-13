/**
 * Gửi dạng chia sẻ (nhắn bạn bè / group, zaloMessageSendMode 'share'), tách từ bộ chạy Desktop/VPS (executeZaloShareMessageBatchCampaign
 * + processZaloShareMessageBatch, campaignScheduler.ts):
 * - mỗi lô tối đa 50 data (DB tự giới hạn theo lượt còn lại, claim_batch_v1);
 * - bạn bè: kiểm từ chối nhận tin (SĐT của data → đọc hồ sơ theo UID → SĐT hồ sơ → global ID), lưu hồ sơ vào danh bạ; group: không;
 * - nội dung dựng một lần mỗi lô: xoay vòng, spin, định dạng; không biến cá nhân, không link từ chối; AI viết lại chữ thường một lần,
 *   lỗi thì dùng nội dung gốc, không báo khách (như Desktop);
 * - tệp gửi riêng từng người theo thứ tự (không chữ); tệp quá giờ / không rõ đã tới thì báo ngay, chính sách áp đủ, có thể dừng lô;
 * - phần chữ: một lệnh chia sẻ cho mọi người chưa lỗi tệp (forwardMessageToUsers / Groups, mforward);
 * - cả lô báo một lần (report_batch_v1): DB chọn chế độ cho từng người như policyHandling của Desktop và tạm dừng chiến dịch khi cả lô
 *   thất bại.
 * Dòng tiến trình như Desktop: không "▶️" / "✅" từng người; mỗi lỗi khác nhau in một lần "⚠️ <thao tác>: <câu>"; cuối lô
 * "📨 Kết quả chia sẻ tin nhắn Zalo: tổng N, thành công X, thất bại Y" và "⏸ Kết thúc batch: …" khi dừng. Nghỉ giữa hai lô không in.
 * Đặc tả: docs/engine-v2-specs/zalo-other-types.md §3, zalo-media.md §3.4 / §4.2.
 */
import type { OutcomeDecision, RawOutcome, ReportSuccess } from '../contracts.js'
import type { BatchApi, BatchEnd, BatchItem, BatchStep, BatchStop, BatchUnitConfig, StepContext } from '../runUnit.js'
import { CancelledError, DeadlineError, errorMessage, stepFailure, withDeadline } from '../boundary.js'
import { beginZaloEngagement, registerZaloEngagement, type ZaloEngagementPort } from './engagement.js'
import { prepareCampaignContent } from '../content/campaignContentPreparation.js'
import { renderContentSpin, renderContentSpinNonEmpty, splitContentVariants } from '../content/contentSpin.js'
import { splitFormattedContentVariants, supportsFormattedContent, transformFormattedContentText } from '../content/formattedContent.js'
import { convertHtmlToZaloMessage } from '../content/zaloFormattedContent.js'
import { CANCELLED_ERROR_CODE, formatActionLog, outcomeProgress } from '../progress.js'
import { validateZaloContent, type ConfigIssue } from '../validation.js'
import {
  ZaloPortError, mergeZaloProfileTarget, preparationFailure, zaloFailure, zaloPortErrorFrom, zaloTargetFromInput, zaloTargetLabel,
  type ZaloResolvedTarget
} from './common.js'
import {
  campaignDeclaresMedia, campaignMediaName, campaignMediaSourceHint, hasDeclaredMediaSource, selectZaloCampaignMedia, type CampaignMediaItem,
  type ZaloMediaFile
} from './media.js'
import { advancedContentConfigIssue, advancedContentItems, selectAdvancedContentItem, selectAdvancedContentMedia } from './advancedContent.js'
import {
  MESSAGE_FRIEND, ZALO_MESSAGE_FRIEND, ZALO_MESSAGE_FRIEND_ACTION_NAMES, ZALO_MESSAGE_GROUP, ZALO_MESSAGE_GROUP_ACTION_NAMES,
  ZALO_MESSAGE_OPT_OUT_NOTE, stripAiCodeFence, zaloUidTargetLabel,
  type V2Support, type ZaloMessagePhoneCampaign, type ZaloMessagePhoneEnvironment, type ZaloMessagePhonePort, type ZaloOutgoingText
} from './messagePhone.js'
import {
  checkZaloSendExclusion, exclusionProfileTarget, sendExclusionActive, validateSendExclusionConfig, type ZaloSendExclusionPort
} from './sendExclusion.js'
import { checkZaloFriendBlocklist, friendBlocklistActive, validateFriendBlocklistConfig, type ZaloFriendBlocklistPort } from './friendBlocklist.js'

type JsonObject = Record<string, unknown>

/** Lô tối đa 50 data như ZALO_SHARE_MESSAGE_BATCH_SIZE của Desktop. */
export const ZALO_SHARE_BATCH_SIZE = 50
/** Một kết quả cho mỗi data, cũng là khoá dấu "sắp gửi" (một dấu cho tệp + chữ của cùng người). */
export const ZALO_SHARE_STEP_KEY = 'share'
export const ZALO_SHARE_EMPTY_NOTE = 'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo'
const SHARE_INTERRUPTED = 'Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung.'
const FORWARD_UNKNOWN = 'Không xác định được kết quả chia sẻ tin nhắn Zalo cho target này'
const FORWARD_FAILED = 'Chia sẻ tin nhắn Zalo thất bại'

/** Kết quả chia sẻ của một người nhận (ZaloForwardMessageTargetResult của Desktop, results của lệnh forward_message trên Fly). */
export interface ZaloForwardResult {
  threadId: string
  ok: boolean
  errorCode?: string | null
  errorMessage?: string | null
  /** Dòng kết quả của Zalo cho người này (có msgId khi đã gửi được). */
  raw?: unknown
  /** Khớp được đúng dòng của người này trong kết quả chia sẻ (không phải đếm theo thứ tự): mã tin dùng được cho theo dõi tương tác. */
  engagementMapped?: boolean
}

/** Thao tác Zalo mà gửi dạng chia sẻ cần thêm ngoài cổng nhắn tin. */
export interface ZaloSharePort {
  /**
   * Chia sẻ một tin cho nhiều người / group trong một lệnh (mforward). Lỗi của cả lệnh ném ZaloPortError (zaloPortErrorFrom, thao tác
   * gửi); kết quả từng người trả trong results (người không có trong results coi như không rõ đã tới).
   */
  forwardMessage(ctx: StepContext, input: { threadIds: readonly string[]; threadType: 'user' | 'group'; message: ZaloOutgoingText }):
    Promise<{ response: unknown; results: ZaloForwardResult[] }>
}

export type ZaloShareCampaignPort = Pick<ZaloMessagePhonePort, 'getUserProfile' | 'saveResolvedProfile' | 'isOptedOut' | 'takeContentIndex'
  | 'prepareMedia' | 'rewriteMessage' | 'sendMedia' | 'trace'> & ZaloSharePort & ZaloSendExclusionPort & ZaloFriendBlocklistPort & ZaloEngagementPort

export interface ZaloShareBatchOptions {
  /** Nghỉ giữa hai lô (getEffectiveSleepBetweenActions: nhóm tài khoản → actionLimits), giây; chỉ khi còn data. */
  sleepBetweenBatchesSeconds?: number
  /** Thời gian tối đa chờ AI viết lại (mặc định 300 giây). */
  aiRewriteTimeoutMs?: number
  /** Hạn giờ gửi tệp cho một người, kể cả tải tệp (mặc định 390 giây). Hết giờ: không rõ đã tới, không gửi lại. */
  mediaTimeoutMs?: number
  /** Hạn giờ lệnh chia sẻ phần chữ (mặc định 150 giây; Desktop tự cắt ở 90 giây). */
  sendTimeoutMs?: number
  /** Hạn giờ đọc (hồ sơ, từ chối nhận tin, vị trí xoay vòng) của một data (mặc định 60 giây). */
  readTimeoutMs?: number
  random?: () => number
}

/** Lỗi của lời gọi Zalo trong lô → kết quả: lỗi Zalo theo cổng; hết giờ / lỗi khác như bước của lượt thường (stepFailure). */
function failureOf(error: unknown, delivery: boolean, data?: JsonObject): RawOutcome {
  if (error instanceof ZaloPortError) return zaloFailure(error, delivery ? 'after_send' : 'before_send', data)
  const raw = stepFailure(error, delivery)
  return data && !raw.ok ? { ...raw, data } : raw
}

/** Chiến dịch nhắn bạn bè / group đang gửi dạng chia sẻ (shouldUseZaloShareMessageBatch; sinh nhật không có). */
export function isZaloShareCampaign(campaign: Pick<ZaloMessagePhoneCampaign, 'actionId' | 'extraSettings'>): boolean {
  return (campaign.actionId === ZALO_MESSAGE_FRIEND || campaign.actionId === ZALO_MESSAGE_GROUP)
    && campaign.extraSettings.zaloMessageSendMode === 'share'
}

/** Gửi dạng chia sẻ chạy được bằng bộ mới không: tính năng chưa tách thì chiến dịch chạy bộ cũ. */
export function zaloShareV2Support(campaign: ZaloMessagePhoneCampaign, env: ZaloMessagePhoneEnvironment): V2Support {
  const no = (reason: string): V2Support => ({ ok: false, reason })
  if (!isZaloShareCampaign(campaign)) return no('not_share_mode')
  if (campaign.actionId === ZALO_MESSAGE_FRIEND) {
    // "Toàn bộ / theo tag" chưa lấy data: lấy data đầu lượt trước khi chia sẻ (materialize.ts, V505), như Desktop lấy trước khi vào lô.
    // Bộ mới chưa ghi nguồn theo dõi tương tác (zaloEngagementSource của dòng chia sẻ bạn bè).
    if (env.engagementTrackingEnabled && env.engagementSupported !== true) return no('engagement_tracking')
  }
  return { ok: true }
}

/** Như isFormattedContentCampaign của Desktop. */
function formattedOf(campaign: ZaloMessagePhoneCampaign): boolean {
  return campaign.extraSettings.formattedContentEnabled === true && supportsFormattedContent(campaign.actionId)
}

/** Biến thể nội dung như prepareSelectedCampaignContent (nội dung nâng cao: mỗi mục một biến thể; định dạng: tách theo HTML). */
function contentVariants(campaign: ZaloMessagePhoneCampaign): string[] {
  const extra = campaign.extraSettings
  if (extra.advancedContentEnabled === true) return advancedContentItems(extra).map(item => item.content)
  if (formattedOf(campaign)) return splitFormattedContentVariants(campaign.content)
  return splitContentVariants(String(campaign.content ?? ''), { trim: false }).filter(item => item.trim())
}

/**
 * Luật kiểm đầu lượt của gửi dạng chia sẻ (executeZaloShareMessageBatchCampaign trước lô đầu): nội dung nâng cao sai (CFG16); nội dung
 * cơ bản: biến thể đầu rỗng và không chọn media → CFG17 "Vui lòng nhập nội dung hoặc chọn media để gửi Zalo"; Zalo Web chỉ gửi ảnh (CFG10).
 */
export function validateZaloShare(campaign: ZaloMessagePhoneCampaign, env: { zaloWeb: boolean }): ConfigIssue[] {
  const extra = campaign.extraSettings
  const formatted = formattedOf(campaign)
  // Như Desktop lúc bắt đầu lượt: cấu hình loại trừ gửi hỏng (bạn bè) thì tạm dừng chiến dịch (CFG18).
  const exclusion = validateSendExclusionConfig(campaign)
  if (exclusion.length > 0) return exclusion
  const blocklist = validateFriendBlocklistConfig(campaign)
  if (blocklist.length > 0) return blocklist
  if (extra.advancedContentEnabled === true) {
    const advanced = advancedContentConfigIssue(extra, formatted)
    if (advanced) return [advanced]
  } else {
    const base = contentVariants(campaign)[0] ?? ''
    const text = formatted ? convertHtmlToZaloMessage(base).msg : base
    if (!text.trim() && !campaignDeclaresMedia(campaign)) {
      return [{ errorCode: 'err_cfg_share_content_empty', publicCode: 'CFG17', scope: 'campaign', message: ZALO_SHARE_EMPTY_NOTE }]
    }
  }
  if (!env.zaloWeb) return []
  const media: CampaignMediaItem[] = extra.advancedContentEnabled === true
    ? advancedContentItems(extra).filter(item => item.mediaOption !== 'none').flatMap(item => item.mediaItems.filter(hasDeclaredMediaSource))
    : campaignDeclaresMedia(campaign) ? (campaign.images ?? []).filter(hasDeclaredMediaSource) : []
  return validateZaloContent({ zaloWeb: true, attachments: media.map(campaignMediaSourceHint).filter(Boolean) })
}

const outgoingText = (message: ZaloOutgoingText): string => typeof message === 'string' ? message : message.msg

/** Lô theo cấu hình của chiến dịch; host gắn vào UnitConfig.batch. */
export function buildZaloShareBatch(campaign: ZaloMessagePhoneCampaign, port: ZaloShareCampaignPort, opts: ZaloShareBatchOptions = {}): BatchUnitConfig {
  return { maxTargets: ZALO_SHARE_BATCH_SIZE, run: api => runZaloShareBatch(campaign, port, api, opts) }
}

interface ValidTarget { item: BatchItem; threadId: string; target: ZaloResolvedTarget }

const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}

/** Chỉ thị của DB (data đã chốt) → lý do kết thúc lượt. */
function endReason(next: ReportSuccess['next']): BatchStop['reason'] {
  return next === 'next_target' || next === 'next_step' ? 'end_unit' : next
}

interface ShareState {
  marked: Set<number>
  reported: Set<number>
  bail(stop?: BatchStop): Promise<BatchStop>
}

/**
 * Một lô. Dừng giữa lô (thoát app, mất lease) hay lỗi code: data chưa ghi dấu "sắp gửi" về hàng đợi (settleZaloShareBatchRuntimeStop
 * của Desktop); data đã ghi dấu thì để aka_agent_engine_close_stale_v1 đóng (không rõ đã tới, không gửi lại).
 */
export async function runZaloShareBatch(campaign: ZaloMessagePhoneCampaign, port: ZaloShareCampaignPort, api: BatchApi,
  opts: ZaloShareBatchOptions = {}): Promise<BatchEnd> {
  const actionCode = campaign.actionId === ZALO_MESSAGE_GROUP ? ZALO_MESSAGE_GROUP : MESSAGE_FRIEND
  const cancelOutcome: RawOutcome = { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'cancelled', errorCode: 'err_engine_cancelled' } }
  const state: ShareState = {
    marked: new Set<number>(),
    reported: new Set<number>(),
    bail: async stop => {
      for (const item of api.items) {
        if (state.marked.has(item.targetRunId) || state.reported.has(item.targetRunId)) continue
        state.reported.add(item.targetRunId)
        const res = await api.reportOne(item, { key: '__cancelled', actionCode }, cancelOutcome)
        if ('stop' in res) break
      }
      return stop ?? { stop: true, reason: 'cancelled' }
    }
  }
  try {
    return await shareBatchBody(campaign, port, api, opts, state)
  } catch (error) {
    if (error instanceof CancelledError || api.signal.aborted) return state.bail()
    const detail = { error: errorMessage(error) }
    port.trace?.({ type: 'share_batch_error', ...detail })
    try { await state.bail() } catch (bailError) { port.trace?.({ type: 'share_batch_bail_failed', error: errorMessage(bailError) }) }
    return { stop: true, reason: 'error', detail }
  }
}

async function shareBatchBody(campaign: ZaloMessagePhoneCampaign, port: ZaloShareCampaignPort, api: BatchApi,
  opts: ZaloShareBatchOptions, state: ShareState): Promise<BatchEnd> {
  const extra = campaign.extraSettings
  const isGroup = campaign.actionId === ZALO_MESSAGE_GROUP
  const actionCode = isGroup ? ZALO_MESSAGE_GROUP : MESSAGE_FRIEND
  const step: BatchStep = { key: ZALO_SHARE_STEP_KEY, actionCode,
    actionName: (isGroup ? ZALO_MESSAGE_GROUP_ACTION_NAMES : ZALO_MESSAGE_FRIEND_ACTION_NAMES)[actionCode] ?? actionCode }
  const threadType: 'user' | 'group' = isGroup ? 'group' : 'user'
  const inputData = (item: BatchItem): JsonObject => item.target as unknown as JsonObject
  const { marked, reported, bail } = state
  const exclusionOn = !isGroup && sendExclusionActive(campaign)
  // Danh sách không gửi tin kiểu cũ (bạn bè): người trong danh sách không vào lô; Desktop không in từng người mà in một dòng tổng.
  const blocklistOn = !isGroup && friendBlocklistActive(campaign)
  let blocklisted = 0
  const blocklistLine = (): void => {
    if (blocklisted > 0) api.progress(`🚫 Đã bỏ qua ${blocklisted} bạn bè Zalo trong danh sách không gửi tin`, 'info')
  }

  // Mỗi lỗi khác nhau in một lần trong lô: "⚠️ <thao tác>: <câu>" (recordZaloShareActionDetail của Desktop).
  const shown = new Set<string>()
  const showFailure = (decision: OutcomeDecision, inputDataId: number | null): void => {
    if (decision.ok || decision.errorCode === CANCELLED_ERROR_CODE) return
    const text = `⚠️ ${formatActionLog(decision.actionName || step.actionName, decision.log)}`
    if (shown.has(text)) return
    shown.add(text)
    api.progress(text, 'warning', inputDataId)
  }
  /** Data báo riêng ngoài lô (từ chối nhận tin, mục tiêu đã nhớ): in như lượt thường. */
  const showSingle = (res: ReportSuccess, item: BatchItem): void => {
    for (const decision of res.outcomes) {
      const line = outcomeProgress(0, item.target.id, decision, { actionName: step.actionName ?? actionCode, targetLabel: zaloUidTargetLabel(item.target) })
      if (line) api.progress(line.text, line.level, item.target.id)
    }
  }
  const cancelOutcome: RawOutcome = { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'cancelled', errorCode: 'err_engine_cancelled' } }
  /** Lỗi chung của cả lô trước khi gửi (nội dung, tệp): data đầu chịu chính sách, các data khác về hàng đợi; dừng lượt. */
  const failWhole = async (first: BatchItem, raw: RawOutcome): Promise<BatchEnd> => {
    reported.add(first.targetRunId)
    const res = await api.reportOne(first, step, raw)
    if ('stop' in res) return res
    for (const decision of res.outcomes) showFailure(decision, first.target.id)
    if (res.campaign.note) api.progress(`⚠️ ${res.campaign.note}`, 'warning')
    await bail()
    return { stop: true, reason: endReason(res.next) }
  }

  // ---- 1. Từng data: mục tiêu đã nhớ, ID, từ chối nhận tin, hồ sơ ------------------------------------------------------
  const valid: ValidTarget[] = []
  const invalid: BatchItem[] = []
  for (const item of api.items) {
    if (api.signal.aborted) return bail()
    const gate = item.actions[actionCode]
    if (gate?.decision === 'skip') {
      // V499: người nhận đã gặp lỗi nhớ theo tài khoản (Desktop không có): bỏ qua, báo riêng.
      reported.add(item.targetRunId)
      const res = await api.reportOne(item, step, { ok: true, statusCode: 'campaign_detail_skipped',
        data: { gate: gate.gate ?? null, rememberedErrorCode: gate.errorCode ?? null } })
      if ('stop' in res) return res
      showSingle(res, item)
      continue
    }
    if (blocklistOn) {
      const listed = await checkZaloFriendBlocklist(port, item.ctx, campaign, String(item.target.uid ?? ''), opts.readTimeoutMs ?? 60_000)
      if (listed.kind === 'blocked') {
        reported.add(item.targetRunId)
        const res = await api.reportOne(item, step, listed.outcome)
        if ('stop' in res) return res
        if (res.outcomes.some(decision => decision.errorCode === 'err_engine_friend_blocklisted')) blocklisted++
        else showSingle(res, item)
        continue
      }
    }
    const raw = String(item.target.uid ?? '').trim()
    // Như getZaloShareMessageThreadId: group bỏ tiền tố "g".
    const threadId = isGroup ? raw.replace(/^g/i, '') : raw
    if (!threadId) { invalid.push(item); continue }
    let target = zaloTargetFromInput(threadId, inputData(item), isGroup ? { type: 'group' } : {}, !isGroup)
    if (!isGroup) {
      let optOut: OptOutCheck
      try {
        optOut = await withDeadline('share_opt_out', opts.readTimeoutMs ?? 60_000, api.signal,
          s => checkOptOut(port, { ...item, ctx: { ...item.ctx, signal: s } }, target, api))
      } catch (error) {
        if (error instanceof CancelledError || api.signal.aborted) throw error
        // Hết giờ khi kiểm (chưa gửi gì): báo riêng, DB quyết định data đi đâu.
        reported.add(item.targetRunId)
        const res = await api.reportOne(item, step, failureOf(error, false))
        if ('stop' in res) return res
        showSingle(res, item)
        continue
      }
      if (optOut.kind === 'blocked' || optOut.kind === 'unavailable') {
        reported.add(item.targetRunId)
        const res = await api.reportOne(item, step, optOut.kind === 'blocked'
          ? { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'recipient_opted_out', message: ZALO_MESSAGE_OPT_OUT_NOTE } }
          : { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'gate_unavailable', message: optOut.message }, data: { gate: 'opt_out' } })
        if ('stop' in res) return res
        showSingle(res, item)
        continue
      }
      target = optOut.target
      // Loại trừ gửi (preflightZaloMessageOptOut của Desktop, sharedBatch): sau từ chối nhận tin; một lần đọc tag Zalo cho cả lô
      // (ngữ cảnh tag giữ ở data đầu lô). Bị loại trừ / chưa đủ dữ liệu: báo riêng, data tạm dừng, không vào lô.
      if (exclusionOn) {
        const exclusion = await checkZaloSendExclusion(port, item.ctx, { campaign, uid: target.uid,
          profileTarget: exclusionProfileTarget(target, true), labelContextRunId: api.items[0]!.targetRunId, readTimeoutMs: opts.readTimeoutMs ?? 60_000 })
        if (exclusion.kind === 'blocked') {
          reported.add(item.targetRunId)
          const res = await api.reportOne(item, step, exclusion.outcome)
          if ('stop' in res) return res
          showSingle(res, item)
          continue
        }
        if (exclusion.warning) item.ctx.progress(`⚠️ "${zaloUidTargetLabel(item.target)}": ${exclusion.warning}`)
      }
      // Như upsertZaloResolvedProfileTarget: lưu hồ sơ vào danh bạ; lỗi ghi DB của mình không đổi kết quả (F1).
      if (Object.keys(object(object(target.raw).profile)).length > 0) {
        try {
          await withDeadline('share_save_profile', opts.readTimeoutMs ?? 60_000, api.signal, s => port.saveResolvedProfile({ ...item.ctx, signal: s }, target))
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) return bail()
          port.trace?.({ type: 'save_resolved_profile_failed', inputDataId: item.target.id, error: errorMessage(error) })
        }
      }
    }
    valid.push({ item, threadId, target })
  }
  const batchSize = valid.length + invalid.length
  if (batchSize === 0) { blocklistLine(); return { stop: false, paceMs: 0 } }

  // ---- 2. Nội dung và tệp: một lần cho cả lô -----------------------------------------------------------------------------
  const lead = (valid[0] ?? null)?.item ?? invalid[0]!
  let message: ZaloOutgoingText = ''
  let files: ZaloMediaFile[] = []
  let attachmentNames: string[] = []
  if (valid.length > 0) {
    const formatted = formattedOf(campaign)
    const advanced = extra.advancedContentEnabled === true
    const variants = contentVariants(campaign)
    let rotationCause: unknown = null
    let media: CampaignMediaItem[] = []
    try {
      const prepared = await prepareCampaignContent<never, ZaloOutgoingText>({
        variantCount: variants.length,
        takeIndex: async count => {
          try {
            return await withDeadline('share_content_index', opts.readTimeoutMs ?? 60_000, api.signal,
              s => port.takeContentIndex({ ...lead.ctx, signal: s }, actionCode, count))
          } catch (error) { rotationCause = error; throw error }
        },
        variant: index => ({ content: variants[index] ?? '', media: [] }),
        prepare: async (variant, index) => {
          // Media chọn sau khi biết biến thể (nội dung nâng cao lấy tệp của đúng mục), rồi mới dựng chữ (biết có tệp hay không).
          media = advanced ? selectAdvancedContentMedia(selectAdvancedContentItem(extra, index), opts.random) : selectZaloCampaignMedia(campaign, opts.random)
          return { content: await shareMessage(variant.content, formatted, media.length > 0), media: [] }
        },
        signal: api.signal
      })
      message = prepared.content
    } catch (error) {
      if (api.signal.aborted) return bail()
      const cause = rotationCause ?? error
      return failWhole(lead, cause instanceof DeadlineError ? failureOf(cause, false) : preparationFailure(cause))
    }
    // Như getZaloShareMessageForBatch: AI viết lại chữ thường một lần; lỗi thì dùng nội dung gốc, không báo khách.
    if (extra.rewriteContentEachRun === true && typeof message === 'string' && message.trim()) {
      const original = message.trim()
      try {
        if (!port.rewriteMessage) throw new Error('Nơi chạy chưa hỗ trợ AI viết lại nội dung.')
        const rewriter = port.rewriteMessage
        const rewritten = stripAiCodeFence(await withDeadline('ai_rewrite', opts.aiRewriteTimeoutMs ?? 300_000, api.signal,
          s => rewriter({ ...lead.ctx, signal: s }, original)))
        if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')
        message = rewritten
      } catch (error) {
        if (api.signal.aborted) return bail()
        port.trace?.({ type: 'share_ai_rewrite_failed', error: errorMessage(error) })
      }
    }
    attachmentNames = media.map(campaignMediaName)
    if (media.length > 0) {
      try {
        files = await withDeadline('share_prepare_media', opts.mediaTimeoutMs ?? 390_000, api.signal,
          s => port.prepareMedia({ ...lead.ctx, signal: s }, media))
      } catch (error) {
        if (error instanceof CancelledError || api.signal.aborted) return bail()
        // Không dùng được tệp (pauseCampaignForMediaError của Desktop): CFG01 do DB quyết định, chưa gửi gì.
        return failWhole(lead, failureOf(error, false, { attachments: attachmentNames }))
      }
    }
    if (!outgoingText(message).trim() && files.length === 0) {
      return failWhole(lead, { ok: false, phase: 'before_send',
        signal: { kind: 'engine', code: 'CFG17', errorCode: 'err_cfg_share_content_empty', message: ZALO_SHARE_EMPTY_NOTE } })
    }
  }
  const text = outgoingText(message).trim()
  const baseData = (v: ValidTarget): JsonObject => ({ target: v.target, threadId: v.threadId, message: text ? message : '', attachments: attachmentNames,
    sendMode: 'share' })

  // Theo dõi tương tác (chia sẻ cho bạn bè, không áp cho group): giữ chỗ cho cả lô trước khi gửi như Desktop (engagementByInput); người gửi
  // được nhận nguồn kèm mã tin của tệp / dòng chia sẻ khớp đúng người, người khác bỏ giữ chỗ.
  const engagements = new Map<number, ReturnType<typeof beginZaloEngagement>>()
  if (!isGroup) for (const v of valid) engagements.set(v.item.targetRunId, beginZaloEngagement(port, v.item.ctx, v.threadId, 'message'))
  try {
    // ---- 3. Tệp: gửi riêng từng người, không chữ ------------------------------------------------------------------------------
    const mediaResponses = new Map<number, unknown>()
    const mediaFailures = new Map<number, RawOutcome>()
    const refused = new Map<number, RawOutcome>()
    let immediateFailures = 0
    let mediaStop: BatchStop | null = null
    let stopNote: string | null = null
    const mark = async (v: ValidTarget): Promise<'ok' | 'refused' | BatchStop> => {
      const res = await api.markSending(v.item, step)
      if (res === 'ok') { marked.add(v.item.targetRunId); return 'ok' }
      if ('stop' in res) return res
      refused.set(v.item.targetRunId, { ok: false, phase: 'before_send', signal: { kind: 'engine', code: `mark_${res.refused}`, message: res.refused } })
      return 'refused'
    }
    if (files.length > 0) {
      // Như bộ chạy cũ của Fly: tệp tải một lần cho cả lô (mediaCacheKey), nhả ở người cuối.
      const mediaCacheKey = `share-${lead.targetRunId}`
      for (const [index, v] of valid.entries()) {
        if (api.signal.aborted) return bail()
        const marking = await mark(v)
        if (marking === 'refused') continue
        if (marking !== 'ok') return marking
        try {
          engagements.get(v.item.targetRunId)?.markSending()
          const sent = await withDeadline('share_media', opts.mediaTimeoutMs ?? 390_000, api.signal,
            s => port.sendMedia({ ...v.item.ctx, signal: s }, { threadId: v.threadId, threadType, files, stepKey: 'share_media', mediaCacheKey,
              releaseMediaCache: index === valid.length - 1 }))
          mediaResponses.set(v.item.targetRunId, sent.response)
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) return bail()
          const raw = failureOf(error, true, { ...baseData(v), sendMode: 'share_media' })
          if (!raw.ok && (raw.phase === 'in_flight' || raw.evidence?.deliveryState === 'unknown')) {
            // Như Desktop: tệp quá giờ / không rõ đã tới ghi ngay theo thứ tự gửi, chính sách áp đủ (không gửi lại người này).
            reported.add(v.item.targetRunId)
            immediateFailures++
            const res = await api.reportOne(v.item, step, raw)
            if ('stop' in res) return res
            for (const decision of res.outcomes) showFailure(decision, v.item.target.id)
            if (res.next !== 'next_target') {
              mediaStop = { stop: true, reason: endReason(res.next) }
              stopNote = res.campaign.note ?? res.target.note ?? null
              break
            }
          } else {
            mediaFailures.set(v.item.targetRunId, raw)
          }
        }
      }
    }

    // ---- 4. Chữ: một lệnh chia sẻ cho cả lô ---------------------------------------------------------------------------------
    let forward: { response: unknown; results: ZaloForwardResult[] } | null = null
    let forwardError: RawOutcome | null = null
    if (!mediaStop && text) {
      const textTargets = valid.filter(v => !reported.has(v.item.targetRunId) && !mediaFailures.has(v.item.targetRunId) && !refused.has(v.item.targetRunId))
      if (files.length === 0) {
        for (const v of textTargets) {
          if (api.signal.aborted) return bail()
          const marking = await mark(v)
          if (marking !== 'ok' && marking !== 'refused') return marking
        }
      }
      const sendTo = textTargets.filter(v => marked.has(v.item.targetRunId) && !refused.has(v.item.targetRunId))
      if (sendTo.length > 0) {
        if (api.signal.aborted) return bail()
        try {
          // Không có tệp thì lệnh chia sẻ này là lệnh gửi đầu tiên tới từng người (như bộ chạy cũ: sentAt đặt tại đây).
          if (files.length === 0) for (const v of sendTo) engagements.get(v.item.targetRunId)?.markSending()
          forward = await withDeadline('share_forward', opts.sendTimeoutMs ?? 150_000, api.signal,
            s => port.forwardMessage({ ...sendTo[0]!.item.ctx, signal: s }, { threadIds: sendTo.map(v => v.threadId), threadType, message }))
        } catch (error) {
          if (error instanceof CancelledError || api.signal.aborted) return bail()
          forwardError = failureOf(error, true)
        }
      }
    }

    // ---- 5. Kết quả từng người, báo cả lô ------------------------------------------------------------------------------------
    const entries: Array<{ item: BatchItem; step: BatchStep; raw: RawOutcome }> = []
    if (mediaStop) {
      // Như Desktop: lô dừng khi gửi tệp thì data chưa bắt đầu (và data thiếu ID) về hàng đợi.
      for (const v of valid) {
        if (marked.has(v.item.targetRunId) || reported.has(v.item.targetRunId)) continue
        reported.add(v.item.targetRunId)
        const res = await api.reportOne(v.item, { key: '__cancelled', actionCode }, cancelOutcome)
        if ('stop' in res) return res
      }
      for (const item of invalid) {
        reported.add(item.targetRunId)
        const res = await api.reportOne(item, { key: '__cancelled', actionCode }, cancelOutcome)
        if ('stop' in res) return res
      }
    } else {
      for (const item of invalid) {
        entries.push({ item, step, raw: { ok: false, phase: 'before_send', data: { inputData: inputData(item) },
          signal: { kind: 'engine', code: 'target_missing_identity', message: isGroup ? 'ID group Zalo không hợp lệ' : 'UID bạn bè Zalo không hợp lệ' } } })
      }
    }
    const partial = (raw: RawOutcome, v: ValidTarget): RawOutcome => {
      if (raw.ok || !mediaResponses.has(v.item.targetRunId)) return raw
      // Đã nhận tệp mà chưa nhận được chữ (finalizeZaloPartialSendDetail): giao một phần, không gửi lại, luôn tính lượt.
      const mediaResponse = mediaResponses.get(v.item.targetRunId) ?? null
      return { ...raw,
        evidence: { ...(raw.evidence ?? {}), partialDelivery: true, partialStage: 'content_after_media', sequence: 'media_then_content' },
        data: { ...(raw.data ?? {}), partialSend: { stage: 'content_after_media', sequence: 'media_then_content', mediaResponse,
          error: raw.signal.message ?? null } } }
    }
    for (const v of valid) {
      const id = v.item.targetRunId
      if (reported.has(id)) continue
      if (mediaStop && !marked.has(id)) continue
      const data = baseData(v)
      let raw: RawOutcome
      if (mediaFailures.has(id)) {
        raw = mediaFailures.get(id)!
      } else if (refused.has(id)) {
        raw = { ...refused.get(id)!, data }
      } else if (!text) {
        raw = withEngagement(shareSuccess(v, data, mediaResponses.get(id) ?? null, null, isGroup), engagements.get(id), [mediaResponses.get(id) ?? null])
      } else if (mediaStop) {
        raw = partial({ ok: false, phase: 'after_send', signal: { kind: 'engine', code: 'share_interrupted', message: SHARE_INTERRUPTED }, data }, v)
      } else if (forwardError) {
        raw = partial({ ...forwardError, data }, v)
      } else {
        const result = forward?.results.find(row => String(row.threadId) === v.threadId) ?? null
        if (result?.ok) {
          raw = withEngagement(shareSuccess(v, data, mediaResponses.get(id) ?? null, forward?.response ?? null, isGroup), engagements.get(id),
            [mediaResponses.get(id) ?? null, result.engagementMapped ? result.raw : null])
        } else if (!result) {
          // Không khớp được kết quả của người này: không rõ đã tới (không gửi lại).
          raw = partial({ ok: false, phase: 'in_flight', signal: { kind: 'message_like', message: FORWARD_UNKNOWN }, evidence: { deliveryState: 'unknown' },
            data: { ...data, forwardResponse: forward?.response ?? null } }, v)
        } else {
          // Câu trả lời của Zalo cho riêng người này (createZaloForwardFailureDetail): mã số là mã Zalo, không mã thì theo câu.
          const answer = Object.assign(new Error(String(result.errorMessage || FORWARD_FAILED)),
            result.errorCode ? { code: String(result.errorCode) } : {})
          const failure = zaloFailure(zaloPortErrorFrom(answer, { operation: 'send', answered: true }), 'after_send')
          raw = partial({ ...failure, data: { ...data, forwardTargetResult: result, forwardResponse: forward?.response ?? null } }, v)
        }
      }
      entries.push({ item: v.item, step, raw })
    }

    let succeeded = 0
    let failed = immediateFailures
    let next: BatchEnd = mediaStop ?? { stop: false, paceMs: 0 }
    if (entries.length > 0) {
      for (const entry of entries) reported.add(entry.item.targetRunId)
      // Đã dừng khi gửi tệp: không ai trong lô áp thêm chính sách, không thêm câu "toàn bộ thất bại" (stoppedDuringMedia của Desktop).
      const res = await api.reportBatch(entries, batchSize, { alreadyStopped: mediaStop !== null })
      if ('stop' in res) return res
      succeeded = res.summary.succeeded
      failed += entries.length - res.summary.succeeded
      for (const row of res.items) {
        const entry = entries.find(candidate => candidate.item.targetRunId === row.targetRunId)
        for (const decision of row.response.outcomes) showFailure(decision, entry?.item.target.id ?? null)
        // Dòng lịch sử đã ghi: đăng ký nguồn tương tác (recordCampaignEngagementDetail của Desktop / bộ ghi tương tác của Fly).
        if (entry?.raw.ok) registerZaloEngagement(port, row.response.outcomes, entry.raw.data)
      }
      if (!mediaStop) {
        if (res.next === 'next_target') {
          const seconds = Math.max(0, Math.floor(opts.sleepBetweenBatchesSeconds ?? 0))
          next = { stop: false, paceMs: res.morePending && seconds > 0 ? seconds * 1000 : 0 }
        } else {
          next = { stop: true, reason: endReason(res.next) }
          stopNote = res.stopNote ?? stopNote
        }
      }
    }
    api.progress(`📨 Kết quả chia sẻ tin nhắn Zalo: tổng ${batchSize}, thành công ${succeeded}, thất bại ${failed}`, 'info')
    blocklistLine()
    if (next.stop && stopNote) api.progress(`⏸ Kết thúc batch: ${stopNote}`, 'info')
    return next
  } finally {
    for (const engagement of engagements.values()) engagement.abandon()
  }
}

/** Như getZaloShareMessageForBatch: chỉ spin (không biến cá nhân), định dạng thì đổi sang { msg, styles }; không tệp mà rỗng thì spin lại không rỗng. */
async function shareMessage(raw: string, formatted: boolean, hasMedia: boolean): Promise<ZaloOutgoingText> {
  const render = (spin: (text: string) => string): ZaloOutgoingText => formatted
    ? convertHtmlToZaloMessage(transformFormattedContentText(raw, spin))
    : spin(raw)
  let original = render(text => renderContentSpin(text))
  if (!hasMedia && !outgoingText(original).trim()) original = render(text => renderContentSpinNonEmpty(text))
  return original
}

/** Gửi được: thêm nguồn tương tác vào dữ liệu dòng lịch sử (rỗng khi không theo dõi). */
function withEngagement(raw: RawOutcome, engagement: ReturnType<typeof beginZaloEngagement> | undefined, responses: unknown[]): RawOutcome {
  if (!raw.ok || !engagement) return raw
  const extra = engagement.finish(responses)
  return Object.keys(extra).length > 0 ? { ...raw, data: { ...(raw.data ?? {}), ...extra } } : raw
}

function shareSuccess(v: ValidTarget, data: JsonObject, mediaResponse: unknown, forwardResponse: unknown, isGroup: boolean): RawOutcome {
  return {
    ok: true,
    customerLog: isGroup ? `Đã chia sẻ tin nhắn vào group ${zaloTargetLabel(v.target)}` : `Đã chia sẻ tin nhắn đến ${zaloTargetLabel(v.target)}`,
    data: { ...data, mediaResponse, forwardResponse }
  }
}

type OptOutCheck = { kind: 'ok'; target: ZaloResolvedTarget } | { kind: 'blocked' } | { kind: 'unavailable'; message: string }

/**
 * Như preflightZaloMessageOptOut(…, true) cho bạn bè: SĐT của data → đọc hồ sơ theo UID → SĐT hồ sơ → global ID. Lỗi kiểm thì vẫn gửi
 * kèm cảnh báo (cổng opt_out mở khi lỗi); đặt đóng khi lỗi thì data chờ rồi chạy lại.
 */
async function checkOptOut(port: ZaloShareCampaignPort, item: BatchItem, target: ZaloResolvedTarget, api: BatchApi): Promise<OptOutCheck> {
  const ctx = item.ctx
  const label = zaloUidTargetLabel(item.target)
  const warnings: string[] = []
  const closedOnError = api.gateSettings.opt_out?.onError === 'closed'
  let unavailable: string | null = null
  const flush = (): void => { for (const warning of warnings.splice(0)) ctx.progress(`⚠️ "${label}": ${warning}`) }
  const check = async (identity: { phone?: string; globalId?: string }, by: string): Promise<boolean> => {
    try {
      return await port.isOptedOut(ctx, identity)
    } catch (error) {
      if (ctx.signal.aborted) throw new CancelledError('opt_out')
      const message = errorMessage(error) || 'Lỗi không xác định'
      if (closedOnError) unavailable ??= `Không thể kiểm tra từ chối nhận tin Zalo theo ${by}: ${message}`
      else warnings.push(`Không thể kiểm tra từ chối nhận tin Zalo theo ${by}; vẫn tiếp tục gửi: ${message}`)
      return false
    }
  }
  const blocked = (): OptOutCheck => { flush(); return { kind: 'blocked' } }
  const inputPhone = String(item.target.phone ?? '').trim()
  if (inputPhone && await check({ phone: inputPhone }, 'SĐT')) return blocked()
  if (unavailable) { flush(); return { kind: 'unavailable', message: unavailable } }
  let resolved = target
  try {
    resolved = mergeZaloProfileTarget(target, await port.getUserProfile(ctx, target.uid))
  } catch (error) {
    if (ctx.signal.aborted) throw new CancelledError('opt_out')
    // Đọc hồ sơ bị treo: như hạn share_opt_out của Desktop, chỉ người này về hàng đợi (lô báo riêng), không gửi khi chưa kiểm global ID.
    if (error instanceof DeadlineError) throw error
    warnings.push(`Không lấy được Zalo global ID để kiểm tra từ chối nhận tin; vẫn tiếp tục xử lý target: ${errorMessage(error) || 'Lỗi không xác định'}`)
  }
  const profilePhone = String(resolved.phone ?? '').trim()
  if (profilePhone && profilePhone !== inputPhone && await check({ phone: profilePhone }, 'SĐT hồ sơ')) return blocked()
  if (unavailable) { flush(); return { kind: 'unavailable', message: unavailable } }
  const globalId = String(resolved.globalId ?? '').trim()
  if (!globalId) {
    if (!warnings.some(warning => warning.includes('Không lấy được Zalo global ID'))) {
      warnings.push('Không lấy được Zalo global ID; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi.')
    }
  } else if (await check({ globalId }, 'Zalo global ID')) {
    return blocked()
  }
  if (unavailable) { flush(); return { kind: 'unavailable', message: unavailable } }
  flush()
  return { kind: 'ok', target: resolved }
}
