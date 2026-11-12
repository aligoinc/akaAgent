/**
 * Thao tác phụ của chiến dịch Zalo, tách từ bộ chạy Desktop/VPS (campaignScheduler.ts: tag/đổi tên 16195-16403,
 * tag akaBiz 8122-8226; đặc tả docs/engine-v2-specs/zalo-aux-actions.md):
 * - Gắn tag Zalo (zalo_tag_contact) và đổi tên gợi nhớ (zalo_change_alias) chạy sau nhắn tin / kết bạn, KỂ CẢ khi hai
 *   bước đó lỗi; bỏ qua im lặng khi chưa có hồ sơ (UID) hoặc khi DB đã chốt data (bỏ các bước còn lại: không rõ kết quả…).
 * - Không tính hạn mức, không đếm chuỗi lỗi (V495 chặn theo thao tác), không đưa vào kế hoạch claim: Desktop không kiểm
 *   khoá / hạn mức cho hai thao tác này.
 * - Tag akaBiz chỉ ghi DB, không có dòng lịch sử: một bước cổng luôn cho qua, chỉ in dòng tiến trình.
 * - Thay đổi đã duyệt so với Desktop: cắt tên gợi nhớ còn tối đa 50 ký tự (Zalo trả 112 "Lỗi không xác định" khi dài hơn;
 *   docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md).
 */
import type { RawOutcome } from '../contracts.js'
import type { EngineStep, StepContext } from '../runUnit.js'
import { CancelledError, errorMessage } from '../boundary.js'
import { readZaloApiFriendStatus, resolveZaloAccountTagSettings } from '../content/zaloAuxiliaryActions.js'
import {
  preparationFailure, renderZaloTemplateText, templateUsesDatabaseDate, zaloFailure, zaloTargetLabel, type ZaloResolvedTarget
} from './common.js'

export const ZALO_TAG_CONTACT = 'zalo_tag_contact'
export const ZALO_CHANGE_ALIAS = 'zalo_change_alias'
/** Zalo từ chối tên gợi nhớ dài hơn 50 ký tự (mã 112). */
export const ZALO_ALIAS_MAX_LENGTH = 50
const NAME_TAG = 'Gắn tag Zalo'
const NAME_ALIAS = 'Đổi tên Zalo'
export const ZALO_AUXILIARY_ACTION_NAMES: Readonly<Record<string, string>> = {
  [ZALO_TAG_CONTACT]: NAME_TAG,
  [ZALO_CHANGE_ALIAS]: NAME_ALIAS
}

export type ZaloLabelApplyResult =
  /** Đã gắn (kể cả đã có sẵn trong tag, không cần gửi cập nhật). */
  | { kind: 'applied'; labelText: string | null }
  /** Mục tiêu đang có một trong các tag loại trừ: không ghi gì. */
  | { kind: 'excluded'; matchedLabelNames: string[] }
  /** Tag không còn trong Zalo (câu lỗi chứa "Tag Zalo không tồn tại"). */
  | { kind: 'label_not_found'; message: string }

/** Thao tác thật cho bước phụ; mỗi nơi chạy cài (Desktop: zaloRuntimeService + repository; Fly: lệnh runtime + SQL). */
export interface ZaloAuxiliaryPort {
  /** Có phải bạn bè của tài khoản đang chạy không; null = không xác định. Không ném lỗi (trừ khi bị huỷ). */
  friendStatus(ctx: StepContext, uid: string): Promise<boolean | null>
  /**
   * Chuyển UID vào tag (một hội thoại một tag), trừ khi đang ở một tag loại trừ (so với ảnh chụp tag đầu data).
   * Lỗi Zalo/đường truyền: ZaloPortError (thao tác gửi).
   */
  applyLabel(ctx: StepContext, uid: string, labelId: string, skipLabelIds: readonly string[]): Promise<ZaloLabelApplyResult>
  /** Ghi thêm tag vào danh bạ (auto_account_contacts.extra_data); lỗi chỉ ghi vết. */
  mirrorLabel(ctx: StepContext, uid: string, label: { id: string; name: string }): Promise<void>
  /** Đổi tên gợi nhớ. Lỗi Zalo/đường truyền: ZaloPortError (thao tác gửi). */
  changeAlias(ctx: StepContext, uid: string, alias: string): Promise<unknown>
  /** Gắn tag akaBiz vào danh bạ đã có; trả số danh bạ đổi. Lỗi DB thì ném (bước tự bắt). */
  applyAkaBizTags(ctx: StepContext, contactType: 'person' | 'group', uid: string, tagIds: readonly number[]): Promise<number>
  /** Giờ nghiệp vụ của DB; chỉ gọi khi mẫu có #{TODAY(...)}… */
  businessNow(ctx: StepContext): Promise<Date>
  trace?(event: { type: string; [key: string]: unknown }): void
}

type JsonObject = Record<string, unknown>
interface AuxCampaign { actionId: string; extraSettings: JsonObject }
export interface ZaloAuxiliaryAccount { id: number; name: string }

const NO_OUTCOME: RawOutcome = { ok: true, noOutcome: true }

/** Cắt tên gợi nhớ còn tối đa `max` ký tự UTF-16, không cắt đôi cặp surrogate (emoji), bỏ khoảng trắng cuối. */
export function truncateZaloAlias(alias: string, max = ZALO_ALIAS_MAX_LENGTH): string {
  if (alias.length <= max) return alias
  let cut = alias.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut.trimEnd()
}

/** Như getAkaBizTagIdsForCampaign (CS:8122-8142): id hữu hạn > 0, không trùng; sinh nhật và gửi dạng chia sẻ không gắn. */
export function akaBizTagIds(campaign: AuxCampaign): number[] {
  const extra = campaign.extraSettings
  if (campaign.actionId === 'zalo_message_birthday' || extra.zaloMessageSendMode === 'share' || extra.enableAkaBizTag !== true) return []
  const raw = Array.isArray(extra.akaBizTagIds) ? extra.akaBizTagIds : []
  return [...new Set(raw.map(Number).filter(id => Number.isFinite(id) && id > 0))]
}

function resolvedTarget(ctx: StepContext): ZaloResolvedTarget | null {
  const target = ctx.state.zaloTarget as ZaloResolvedTarget | undefined
  return target?.uid ? target : null
}

/**
 * Tag và đổi tên sau bước gửi. `requires`: bước phải qua trước (thường là cổng từ chối nhận tin / bước tìm mục tiêu).
 * `account`: tài khoản ĐANG chạy (cấu hình tag theo tài khoản, tên trong câu tiến trình).
 */
export function buildZaloAuxiliarySteps(campaign: AuxCampaign, port: ZaloAuxiliaryPort,
  opts: { requires: readonly string[]; account: ZaloAuxiliaryAccount }): readonly EngineStep[] {
  const extra = campaign.extraSettings
  const accountLabel = opts.account.name || String(opts.account.id)

  /** Trạng thái bạn bè dùng chung cho tag và đổi tên trong một data (Desktop đọc tối đa một lần, lỗi coi như không rõ). */
  const friend = (ctx: StepContext, target: ZaloResolvedTarget): Promise<boolean | null> => {
    const cached = ctx.state.zaloAuxFriendStatus as Promise<boolean | null> | undefined
    if (cached) return cached
    const pending = (async () => {
      const known = readZaloApiFriendStatus(target.raw)
      if (known !== null) return known
      const status = await port.friendStatus(ctx, target.uid)
      if (status === null) {
        ctx.progress(`⚠️ Không xác định được trạng thái bạn bè của ${zaloTargetLabel(target)} sau khi kiểm tra bổ sung; vẫn thực hiện gắn tag/đổi tên theo cấu hình`, 'warning')
      }
      return status
    })()
    ctx.state.zaloAuxFriendStatus = pending
    return pending
  }

  const tag: EngineStep = {
    key: 'zalo_tag',
    actionCode: ZALO_TAG_CONTACT,
    actionName: NAME_TAG,
    delivery: false,
    requires: opts.requires,
    enabled: () => extra.enableZaloTag === true,
    run: async ctx => {
      const target = resolvedTarget(ctx)
      if (!target) return NO_OUTCOME
      const label = zaloTargetLabel(target)
      if (extra.zaloTagSkipIfFriend === true && await friend(ctx, target) === true) {
        ctx.progress(`Bỏ qua gắn tag Zalo cho ${label}: đã là bạn bè`, 'info')
        return NO_OUTCOME
      }
      const hasMap = extra.zaloTagSettingsByAccountId !== undefined
      const settings = resolveZaloAccountTagSettings({ ...extra, zaloTagId: extra.zaloTagId ?? null, zaloTagName: extra.zaloTagName || '' },
        opts.account.id)
      if (!settings || (hasMap && !settings.zaloTagId)) {
        ctx.progress(`Không thể gắn tag Zalo cho ${label}: chưa chọn tag cần gắn cho tài khoản ${accountLabel}`, 'warning')
        return NO_OUTCOME
      }
      // Không có bản đồ theo tài khoản: Desktop dùng nguyên giá trị phẳng extra.zaloTagId (không chuẩn hoá).
      const labelId = hasMap ? settings.zaloTagId : (extra.zaloTagId ?? null)
      if (labelId === null || labelId === undefined || labelId === '' || labelId === 0) {
        return { ok: true, statusCode: 'campaign_detail_tag_not_found', customerLog: 'Tag Zalo không tồn tại', data: { target, labelId: labelId ?? null } }
      }
      const skipOn = extra.zaloTagSkipIfHasSelectedTags === true
      const skip = skipOn ? settings.zaloTagSkipTagIds : []
      if (skipOn && skip.length === 0) {
        ctx.progress(`⚠️ Chưa cấu hình tag loại trừ cho tài khoản ${accountLabel}; vẫn gắn tag Zalo cho ${label} theo cấu hình`, 'warning')
      }
      let result: ZaloLabelApplyResult
      try {
        result = await port.applyLabel(ctx, target.uid, String(labelId), skip)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return zaloFailure(error, 'after_send', { target, labelId })
      }
      if (result.kind === 'excluded') {
        ctx.progress(`Bỏ qua gắn tag Zalo cho ${label}: đã có tag ${result.matchedLabelNames.join(', ')}`, 'info')
        return NO_OUTCOME
      }
      if (result.kind === 'label_not_found') {
        return { ok: true, statusCode: 'campaign_detail_tag_not_found', customerLog: 'Tag Zalo không tồn tại',
          data: { target, labelId, error: result.message } }
      }
      const labelName = result.labelText || settings.zaloTagName || ''
      try {
        await port.mirrorLabel(ctx, target.uid, { id: String(labelId), name: labelName })
      } catch (error) {
        if (ctx.signal.aborted) throw error
        // Desktop chỉ ghi console.warn khi không chép được tag vào danh bạ.
        port.trace?.({ type: 'mirror_label_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
      }
      return { ok: true, customerLog: `Đã gắn tag "${labelName || labelId}" cho ${label}`, data: { target, labelId, labelName } }
    }
  }

  const alias: EngineStep = {
    key: 'zalo_alias',
    actionCode: ZALO_CHANGE_ALIAS,
    actionName: NAME_ALIAS,
    delivery: false,
    requires: opts.requires,
    enabled: () => extra.enableZaloAlias === true,
    run: async ctx => {
      const target = resolvedTarget(ctx)
      if (!target) return NO_OUTCOME
      const label = zaloTargetLabel(target)
      if (extra.zaloAliasSkipIfFriend === true && await friend(ctx, target) === true) {
        ctx.progress(`Bỏ qua đổi tên Zalo cho ${label}: đã là bạn bè`, 'info')
        return NO_OUTCOME
      }
      const template = String(extra.zaloAliasTemplate || '')
      let rendered: string
      try {
        const businessNow = templateUsesDatabaseDate(template) ? await port.businessNow(ctx) : undefined
        rendered = renderZaloTemplateText(template, ctx.target as unknown as JsonObject, target, businessNow).trim()
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return preparationFailure(error, { target })
      }
      const value = truncateZaloAlias(rendered)
      if (!value) {
        return { ok: true, statusCode: 'campaign_detail_invalid_parameter', customerLog: 'Tên Zalo mới không hợp lệ', data: { target, alias: value } }
      }
      try {
        const response = await port.changeAlias(ctx, target.uid, value)
        return { ok: true, customerLog: `Đã đổi tên ${label} thành "${value}"`,
          data: { target, alias: value, response: response ?? null, ...(value !== rendered ? { aliasTruncatedFrom: rendered } : {}) } }
      } catch (error) {
        if (ctx.signal.aborted) throw error
        return zaloFailure(error, 'after_send', { target, alias: value })
      }
    }
  }

  return [tag, alias]
}

/**
 * Tag akaBiz (chỉ DB): bước cổng luôn cho qua, chỉ in dòng tiến trình như Desktop; không có dòng lịch sử, không chịu
 * khoá/hạn mức (cổng không tra quyết định claim). `actionCode` chỉ để định danh bước (cổng không báo kết quả).
 */
export function buildAkaBizTagStep(campaign: AuxCampaign, port: ZaloAuxiliaryPort,
  opts: { requires: readonly string[]; contactType: 'person' | 'group'; actionCode: string }): EngineStep {
  const ids = akaBizTagIds(campaign)
  return {
    key: 'akabiz_tag',
    actionCode: opts.actionCode,
    actionName: 'Gắn tag akaBiz',
    delivery: false,
    gate: true,
    requires: opts.requires,
    enabled: () => ids.length > 0,
    run: async ctx => {
      const target = resolvedTarget(ctx)
      if (!target) return { ok: true }
      const label = zaloTargetLabel(target)
      try {
        const count = await port.applyAkaBizTags(ctx, opts.contactType, target.uid, ids)
        if (count > 0) ctx.progress(`🏷️ Đã gắn tag akaBiz cho ${opts.contactType === 'group' ? `group ${label}` : label}`, 'success')
        else port.trace?.({ type: 'akabiz_tag_no_contact', inputDataId: ctx.target.id })
      } catch (error) {
        if (error instanceof CancelledError || ctx.signal.aborted) throw error
        ctx.progress(`⚠️ Không thể gắn tag akaBiz cho ${label}: ${errorMessage(error)}`, 'warning')
      }
      return { ok: true }
    }
  }
}
