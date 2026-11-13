/**
 * Kiêm gửi SMS (internalSmsEnabled / externalSmsEnabled), tách từ bộ chạy Desktop/VPS (pushZaloMilestoneToSms,
 * pushZaloDetailToInternalSmsIfNeeded, pushZaloDetailToExternalSmsIfNeeded): sau mỗi dòng lịch sử vừa ghi của chiến dịch "Nhắn tin theo
 * SĐT" / "Nhắn tin thành viên nhóm" (EXTERNAL_SMS_ZALO_ACTION_IDS), nếu dòng thuộc thao tác và trạng thái đã chọn thì đẩy SĐT sang SMS:
 * - nội bộ: một data vào chiến dịch SMS con của từng tài khoản SMS đã chọn (tạo chiến dịch con lần đầu, mở lại khi đã hoàn thành), qua
 *   RPC V506 aka_agent_engine_sms_push_v1;
 * - akaBiz Sms (bên ngoài): một dòng vào chiến dịch SMS của từng shop đã chọn, chỉ khi cổng có pushExternalSms (Desktop; Fly khi worker có
 *   client akaBiz). Cổng không có thì chiến dịch chạy bộ cũ (zaloCampaignV2Support: sms_push_external).
 * Mỗi data chỉ đẩy một lần trong một lượt (khoá theo data như getExternalSmsPushKey). Câu tiến trình như Desktop; lỗi chỉ cảnh báo,
 * không đổi kết quả của data.
 *
 * Không bao giờ đẩy chồng cho cùng một data. Desktop gọi pushZaloMilestoneToSms tuần tự ngay trong bước nên lần đẩy của dòng kết bạn chỉ
 * bắt đầu sau khi lần đẩy của dòng nhắn tin xong. Ở lõi, bước kiêm SMS có hạn (afterReport của runUnit) mà cổng không huỷ lời gọi đã gửi
 * (akaBiz hạn 30 giây mỗi shop, chạy tiếp sau khi hết hạn): akaBiz treo với từ 2 shop thì bước kế tiếp của data chạy khi lần đẩy cũ còn bay.
 * Khi đó bước sau không đẩy (trace sms_push_in_flight), kể cả nếu lần cũ rốt cuộc lỗi hết: không biết akaBiz đã ghi hay chưa, đẩy lại có
 * thể thành hai tin SMS. Lần đẩy cũ đã xong thì như Desktop: có shop thành công thì thôi, lỗi hết thì dòng sau thử lại.
 */
import type { AfterReportInfo } from '../runUnit.js'
import type { OutcomeDecision, TargetRow } from '../contracts.js'
import { errorMessage } from '../boundary.js'
import { splitContentVariants } from '../content/contentSpin.js'
import { getVietnamMobileCarrier } from '../content/phone.js'
import { firstNormalizedVietnamMobilePhone, firstString, renderZaloTemplateText, templateUsesDatabaseDate, type ZaloResolvedTarget } from './common.js'

type JsonObject = Record<string, unknown>

/** EXTERNAL_SMS_ZALO_ACTION_IDS của Desktop. */
const SMS_PUSH_ACTION_IDS = new Set(['zalo_message_phone', 'zalo_message_group_member'])
/** EXTERNAL_SMS_STATUS_VALUES của Desktop. */
const SMS_PUSH_STATUS_VALUES = new Set(['thành công', 'thất bại', 'không tồn tại'])
/** Chữ trạng thái của dòng lịch sử theo mã (auto_status, chữ không trùng giữa các trạng thái). */
const STATUS_VALUE_BY_CODE: Readonly<Record<string, string>> = {
  campaign_detail_success: 'thành công', campaign_detail_failed: 'thất bại', campaign_detail_not_found: 'không tồn tại'
}
const FIND_PHONE = 'zalo_find_phone_user'
const MESSAGE_STRANGER = 'zalo_message_stranger'
const ADD_FRIEND = 'zalo_add_friend'

export interface SmsPushContext {
  targetRunId: number
  leaseToken: string
  signal: AbortSignal
}

/** Một data SMS như getZaloDetailSmsInputSnapshot của Desktop (chuỗi rỗng = không có). */
export interface SmsSnapshotRow {
  name: string
  phone: string
  phoneCarrier: string | null
  uid: string
  email: string
  info1: string
  info2: string
  info3: string
  info4: string
  info5: string
}

export interface ZaloSmsPushPort {
  /** V506: thêm data vào chiến dịch SMS con của từng tài khoản SMS (tạo / mở lại chiến dịch con). Kết quả theo từng tài khoản. */
  pushInternalSms(ctx: SmsPushContext, input: { accountIds: readonly number[]; row: SmsSnapshotRow; content: string }):
    Promise<Array<{ accountId: number; ok: boolean; error?: string | null }>>
  /** akaBiz Sms (addSmsCampaignDetail): Desktop; Fly khi worker có client akaBiz. integrationMissing: chưa tích hợp akaBiz Sms. */
  pushExternalSms?(ctx: SmsPushContext, input: { shopIds: readonly number[]; phone: string; name: string; content: string }):
    Promise<{ integrationMissing?: boolean; integrationError?: string | null; results: Array<{ shopId: number; ok: boolean; error?: string | null }> }>
  /** Giờ nghiệp vụ từ DB (getDatabaseBusinessNow). */
  smsBusinessNow(ctx: SmsPushContext): Promise<Date>
}

interface SmsCampaign { actionId: string; extraSettings: JsonObject }

/** Kiểu kiêm SMS của chiến dịch như pushZaloMilestoneToSms: nội bộ được ưu tiên; không bật thì null. */
export function smsPushMode(campaign: SmsCampaign): 'internal' | 'external' | null {
  if (!SMS_PUSH_ACTION_IDS.has(campaign.actionId)) return null
  if (campaign.extraSettings.internalSmsEnabled === true) return 'internal'
  if (campaign.extraSettings.externalSmsEnabled === true) return 'external'
  return null
}

const positiveIds = (value: unknown): number[] =>
  [...new Set((Array.isArray(value) ? value : []).map(Number).filter(id => Number.isFinite(id) && id > 0))]
const statusesOf = (value: unknown): Set<string> => new Set((Array.isArray(value) ? value : [])
  .map(item => String(item || '').trim().toLocaleLowerCase('vi-VN')).filter(item => SMS_PUSH_STATUS_VALUES.has(item)))
const record = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const text = (...values: unknown[]): string => firstString(...values) ?? ''

/** Như renderExternalSmsLegacyTokens của Desktop. */
export function renderSmsLegacyTokens(content: string, inputData: JsonObject, target: unknown): string {
  const t = record(target)
  const displayName = text(t.displayName, inputData.name)
  const originalName = text(t.originalName, displayName)
  const phone = firstNormalizedVietnamMobilePhone(t.phone, inputData.phone)
  return String(content || '')
    .replace(/\[fullname_web\]/g, displayName)
    .replace(/\[fullname_original\]/g, originalName)
    .replace(/\[fullname\]/g, text(inputData.name, displayName))
    .replace(/\[phone\]/g, phone)
    .replace(/\[mobile\]/g, phone)
    .replace(/\[email\]/g, text(inputData.email))
    .replace(/\[info1\]/g, text(inputData.info1))
    .replace(/\[info2\]/g, text(inputData.info2))
    .replace(/\[info3\]/g, text(inputData.info3))
    .replace(/\[info4\]/g, text(inputData.info4))
    .replace(/\[info5\]/g, text(inputData.info5))
}

/** Như getZaloSmsContentForDetail: biến thể theo id dòng lịch sử, dựng mẫu Zalo rồi các thẻ SMS cũ. */
export function smsContentForDetail(content: unknown, input: JsonObject, detailId: number | null, data: JsonObject, businessNow?: Date): string {
  const variants = splitContentVariants(String(content ?? ''), { fallbackToRaw: true })
  const index = variants.length > 0 ? Math.abs(Number(detailId) || 0) % variants.length : 0
  const target = record(data.target)
  const detailInput = record(data.inputData)
  const merged: JsonObject = {
    id: input.id,
    name: text(detailInput.name, input.name), phone: text(detailInput.phone, input.phone), uid: text(detailInput.uid, input.uid),
    email: text(detailInput.email, input.email), info1: text(detailInput.info1, input.info1), info2: text(detailInput.info2, input.info2),
    info3: text(detailInput.info3, input.info3), info4: text(detailInput.info4, input.info4), info5: text(detailInput.info5, input.info5)
  }
  const rendered = renderZaloTemplateText(variants[index] || '', merged, data.target ? target as unknown as ZaloResolvedTarget : null, businessNow)
  return renderSmsLegacyTokens(rendered, merged, data.target)
}

/** Như getZaloDetailSmsName. */
function smsName(data: JsonObject, input: JsonObject): string {
  const target = record(data.target)
  const detailInput = record(data.inputData)
  return text(target.displayName, target.originalName, detailInput.name, input.name, target.uid, input.uid)
}

/**
 * Bước kiêm SMS sau mỗi dòng lịch sử (UnitConfig.afterReport); null khi chiến dịch không bật. `targetLabel`: nhãn data như
 * getInputDataDisplayName (câu "thiếu SĐT").
 */
export function buildZaloSmsPush(campaign: SmsCampaign, port: ZaloSmsPushPort, opts: { targetLabel(target: TargetRow): string }):
  ((info: AfterReportInfo) => Promise<void>) | null {
  const mode = smsPushMode(campaign)
  if (!mode) return null
  const extra = campaign.extraSettings
  const statuses = statusesOf(mode === 'internal' ? extra.internalSmsStatuses : extra.externalSmsStatuses)
  const ids = positiveIds(mode === 'internal' ? extra.internalSmsAccountIds : extra.externalSmsShopIds)
  // Mỗi data đẩy một lần trong lượt (internalSmsPushedDetailKeys / externalSmsPushedDetailKeys, xoá khi lượt kết thúc).
  const pushed = new Set<string>()
  // Data đang có lần đẩy chưa xong (kể cả lần đã bị hạn của bước kiêm SMS cắt mà lời gọi vẫn chạy): không đẩy chồng.
  const inFlight = new Set<string>()

  const pushOne = async (info: AfterReportInfo, decision: OutcomeDecision): Promise<void> => {
    const status = STATUS_VALUE_BY_CODE[String(decision.statusCode ?? '')] ?? ''
    const eligible = decision.actionCode === FIND_PHONE ? status === 'không tồn tại'
      : decision.actionCode === MESSAGE_STRANGER || decision.actionCode === ADD_FRIEND
    if (!eligible || !statuses.has(status) || ids.length === 0) return
    const input = info.target as unknown as JsonObject
    const data = record(info.raw.data)
    const phone = firstNormalizedVietnamMobilePhone(record(data.target).phone, record(data.inputData).phone, input.phone)
    if (!phone) {
      info.progress(`⚠️ Không thể kiêm gửi SMS vì thiếu SĐT cho ${opts.targetLabel(info.target)}`, 'warning')
      return
    }
    const id = Number(input.id)
    const key = Number.isFinite(id) && id > 0 ? `input:${id}` : `phone:${phone}`
    if (pushed.has(key)) return
    if (inFlight.has(key)) {
      info.trace?.({ type: 'sms_push_in_flight', mode, actionCode: decision.actionCode, inputDataId: Number.isFinite(id) && id > 0 ? id : null })
      return
    }
    inFlight.add(key)
    try {
      await deliver(info, decision, key, phone, input, data)
    } finally {
      inFlight.delete(key)
    }
  }

  /** Đẩy SĐT của một data (đã qua kiểm điều kiện, chưa đẩy, không có lần đẩy nào đang chạy). */
  const deliver = async (info: AfterReportInfo, decision: OutcomeDecision, key: string, phone: string, input: JsonObject,
    data: JsonObject): Promise<void> => {
    const ctx: SmsPushContext = { targetRunId: info.targetRunId, leaseToken: info.leaseToken, signal: info.signal }

    if (mode === 'internal') {
      const now = await port.smsBusinessNow(ctx)
      const content = smsContentForDetail(extra.internalSmsContent, input, decision.detailId, data, now)
      const target = record(data.target)
      const detailInput = record(data.inputData)
      const row: SmsSnapshotRow = {
        name: smsName(data, input), phone, phoneCarrier: getVietnamMobileCarrier(phone) || null,
        uid: text(target.uid, detailInput.uid, input.uid), email: text(detailInput.email, input.email),
        info1: text(detailInput.info1, input.info1), info2: text(detailInput.info2, input.info2), info3: text(detailInput.info3, input.info3),
        info4: text(detailInput.info4, input.info4), info5: text(detailInput.info5, input.info5)
      }
      const results = await port.pushInternalSms(ctx, { accountIds: ids, row, content })
      for (const r of results.filter(item => !item.ok)) {
        info.progress(`⚠️ Không thể kiêm gửi SMS sang tài khoản Sms #${r.accountId}${r.error ? `: ${r.error}` : ''}`, 'warning')
      }
      const ok = results.filter(item => item.ok).length
      if (ok > 0) {
        pushed.add(key)
        info.progress(`✅ Đã kiêm gửi SMS cho ${phone} sang ${ok} tài khoản Sms`, 'success')
      }
      return
    }

    if (!port.pushExternalSms) return
    const templateNow = templateUsesDatabaseDate(String(extra.externalSmsContent ?? '')) ? await port.smsBusinessNow(ctx) : undefined
    const content = smsContentForDetail(extra.externalSmsContent, input, decision.detailId, data, templateNow)
    const result = await port.pushExternalSms(ctx, { shopIds: ids, phone, name: smsName(data, input), content })
    if (result.integrationMissing) {
      // Như loadAkaBizIntegrationsForCampaign rồi kiểm integrations.sms: tải lỗi thì có thêm dòng lỗi trước.
      if (result.integrationError) info.progress(`⚠️ Không thể tải tích hợp akaBiz: ${result.integrationError}`, 'warning')
      info.progress('⚠️ Chưa tích hợp akaBiz Sms nên không thể kiêm gửi SMS.', 'warning')
      return
    }
    for (const r of result.results.filter(item => !item.ok)) {
      info.progress(`⚠️ Không thể kiêm gửi SMS sang tài khoản #${r.shopId}${r.error ? `: ${r.error}` : ''}`, 'warning')
    }
    const ok = result.results.filter(item => item.ok).length
    if (ok > 0) {
      pushed.add(key)
      info.progress(`✅ Đã kiêm gửi SMS cho ${phone} sang ${ok} tài khoản akaBiz Sms`, 'success')
    }
  }

  return async info => {
    // Như pushZaloMilestoneToSms: mỗi dòng lịch sử vừa tạo (dòng không ghi lịch sử thì không có).
    for (const decision of info.decisions) {
      if (decision.detailId === null || decision.detailId === undefined || decision.replay) continue
      try {
        await pushOne(info, decision)
      } catch (error) {
        if (info.signal.aborted) throw error
        info.progress(`⚠️ Không thể xử lý kiêm gửi SMS: ${errorMessage(error)}`, 'warning')
      }
    }
  }
}
