// Đổi kết quả của workflow Facebook ra kết quả engine (phương án mục 3.3 "Pha của kết quả", mục 5.2 "Tín hiệu FB gửi lên engine").
// Không I/O: dòng lịch sử do bộ dựng của bộ cũ tạo (logMilestonesV2 / logExplicitActionResultStep chạy ở chế độ thu lại) đổi thành
// RawOutcome; block lỗi / mốc đã ghi dấu mà không có dòng nào đổi theo vết thao tác.
import type { Phase, RawOutcome, Signal } from '../../../../packages/campaign-engine/src/index'
import type { CreateCampaignDetailInput } from '../../../shared/types'
import type { PageTraceSnapshot } from './pageTrace'

/**
 * Trạng thái lịch sử (auto_status component campaign_detail, đọc production 16/11/2026): chữ bộ cũ ghi → mã, mã → nhóm báo cáo.
 * DB vẫn là nơi quyết định (report_v1 từ chối mã lạ); bảng này chỉ để chọn ok / lỗi khi block không trả actionResult.
 */
export const FACEBOOK_DETAIL_STATUS_CODES: Readonly<Record<string, string>> = {
  'thành công': 'campaign_detail_success', 'thất bại': 'campaign_detail_failed', 'lỗi': 'campaign_detail_error',
  'đã click': 'campaign_detail_clicked', 'đã gửi': 'campaign_detail_sent', 'đã gửi lời mời': 'campaign_detail_invitation_sent',
  'đã gửi lời mời kết bạn': 'campaign_detail_friend_request_sent', 'đã gửi tin nhắn': 'campaign_detail_message_sent',
  'đã là bạn bè': 'campaign_detail_already_friend', 'đã là thành viên': 'campaign_detail_already_member', 'đã tham gia': 'campaign_detail_joined',
  'không tồn tại': 'campaign_detail_not_found', 'tham số không hợp lệ': 'campaign_detail_invalid_parameter', 'bỏ qua': 'campaign_detail_skipped',
  'chờ duyệt bài': 'campaign_detail_post_pending', 'đã duyệt bài': 'campaign_detail_post_approved'
}

/** Mã trạng thái → chữ trạng thái bộ cũ ghi (ngược của FACEBOOK_DETAIL_STATUS_CODES). */
export const FACEBOOK_STATUS_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FACEBOOK_DETAIL_STATUS_CODES).map(([value, code]) => [code, value]))

export const FACEBOOK_STATUS_GROUPS: Readonly<Record<string, 'success' | 'failure' | 'skipped' | 'pending'>> = {
  campaign_detail_success: 'success', campaign_detail_failed: 'failure', campaign_detail_error: 'failure',
  campaign_detail_clicked: 'success', campaign_detail_sent: 'success', campaign_detail_invitation_sent: 'skipped',
  campaign_detail_friend_request_sent: 'success', campaign_detail_message_sent: 'success', campaign_detail_already_friend: 'skipped',
  campaign_detail_already_member: 'skipped', campaign_detail_joined: 'skipped', campaign_detail_not_found: 'failure',
  campaign_detail_invalid_parameter: 'failure', campaign_detail_skipped: 'skipped', campaign_detail_post_pending: 'pending',
  campaign_detail_post_approved: 'success', campaign_detail_received: 'success', campaign_detail_viewed: 'success',
  campaign_detail_tag_not_found: 'failure', campaign_detail_tag_applied: 'success', campaign_detail_alias_changed: 'success'
}

export interface MilestoneOutcome {
  actionCode: string
  actionName?: string
  raw: RawOutcome
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

function phaseOf(state: string | null | undefined, fallback: Phase): Phase {
  if (state === 'not_committed') return 'before_send'
  if (state === 'unknown') return 'in_flight'
  if (state === 'committed') return 'after_send'
  return fallback
}

/**
 * Một dòng lịch sử mà bộ dựng của bộ cũ định ghi (createCampaignDetail) → kết quả engine. Thành công / bỏ qua / chờ duyệt: ok, câu và
 * data giữ nguyên như bộ cũ. Lỗi: mã lỗi block trả (actionResult.errorCode) là tín hiệu đã biết chắc; không có mã thì tín hiệu theo trạng thái
 * (status:<mã>), luật FB đổi ra "Thao tác Facebook thất bại". Pha theo operationState; dòng kiểu cũ (block chạy xong và tự báo thất bại)
 * là after_send như bộ cũ (data hoàn thành, không thử lại).
 */
export function detailInputOutcome(action: CreateCampaignDetailInput, fallbackActionCode: string): MilestoneOutcome {
  const output = action.resultOutput
  const statusCode = output?.statusCode || FACEBOOK_DETAIL_STATUS_CODES[String(action.status ?? '')] || 'campaign_detail_failed'
  const group = FACEBOOK_STATUS_GROUPS[statusCode] ?? 'failure'
  const errorCode = (output?.errorCode ?? action.errorCode ?? null) || null
  const actionCode = String(output?.actionCode || action.actionCode || fallbackActionCode)
  const data: Record<string, unknown> = { ...object(action.data) }
  if (action.postUrl) data.postUrl = action.postUrl
  if (output?.subStatusCode) data.subStatusCode = output.subStatusCode
  const named = action.actionName ? { actionName: action.actionName } : {}
  if (!errorCode && group !== 'failure') {
    return { actionCode, ...named, raw: { ok: true, statusCode, ...(action.log ? { customerLog: action.log } : {}), data } }
  }
  const signal: Signal = errorCode
    ? { kind: 'block', code: errorCode, errorCode, ...(action.log ? { message: action.log } : {}) }
    : { kind: 'block', code: `status:${statusCode}`, ...(action.log ? { message: action.log } : {}) }
  return { actionCode, ...named, raw: { ok: false, phase: phaseOf(output?.operationState, 'after_send'), signal, statusCode, data } }
}

/** Trang hiện tại là trang xác minh / đăng nhập của Facebook (đúng mẫu facebookSessionRequest.routeState). */
export function facebookPageStateSignal(url: string | null | undefined): Signal | null {
  try {
    const parsed = new URL(String(url ?? ''))
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null
    if (/^\/(checkpoint|challenge|two_step_verification|two_factor|recover|confirmemail)(\/|$)/.test(parsed.pathname)) {
      return { kind: 'engine', code: 'fb_checkpoint', message: 'Facebook yêu cầu xác minh tài khoản' }
    }
    if (/^\/login(?:\.php|\/|$)/.test(parsed.pathname)) return { kind: 'engine', code: 'fb_logged_out', message: 'Tài khoản Facebook đã đăng xuất' }
    return null
  } catch {
    return null
  }
}

export interface BlockFailureInput {
  /** Câu lỗi của block (ném lỗi, hoặc { ok: false, error } kiểu cũ). */
  error: string | null
  /** Block ném lỗi (true) hay trả { ok: false, error } (false). */
  threw: boolean
  /** Tín hiệu từ vết thao tác (PageTrace.failureSignal); null khi không có vết. */
  traced: { code: string; message: string; trace: PageTraceSnapshot } | null
  /** Mốc đã ghi dấu "sắp gửi" trước khi block chạy (mức 1 / 2) hay block đã gọi commitPoint (mức 3). */
  marked: boolean
  /** Mức 2: cú bấm gửi đã thật sự chạy chưa (vết thao tác); null khi không theo dõi. */
  sendAttempted: boolean | null
  /** Trang checkpoint / đăng nhập lúc block lỗi. */
  pageState: Signal | null
  /** Cửa sổ ẩn đã chết / bị huỷ vì block treo. */
  browserGone?: 'browser_gone' | 'block_hang' | null
  /**
   * Dấu hiệu có mặt của một lỗi cụ thể ở pha này (errorSigns.ts: chữ trên trang lúc block lỗi, câu lỗi do chính block viết); null = không có,
   * kết quả như hôm nay.
   */
  signFor?: (phase: Phase) => { code: string } | null
}

/**
 * Block lỗi mà không có dòng lịch sử nào (mốc đã ghi dấu, hoặc block lỗi trước mốc). Pha: chưa ghi dấu → before_send; đã ghi dấu mà vết
 * cho thấy cú bấm gửi chưa chạy (mức 2) → before_send; còn lại không rõ kết quả (in_flight, đóng data, không gửi lại).
 */
export function blockFailureOutcome(input: BlockFailureInput): { phase: Phase; signal: Signal } {
  const phase: Phase = !input.marked ? 'before_send' : input.sendAttempted === false ? 'before_send' : 'in_flight'
  if (input.browserGone) {
    return { phase, signal: { kind: 'engine', code: input.browserGone, message: input.browserGone === 'block_hang'
      ? 'Block không có thao tác nào quá lâu, đã đóng cửa sổ chạy ngầm' : 'Cửa sổ chạy ngầm đã đóng' } }
  }
  if (input.pageState) return { phase, signal: input.pageState }
  const trace = input.traced?.trace
  // Dấu hiệu có mặt (anh chốt 17/11): mã cụ thể thay mã chung; chính sách của mã đó giữ cách xử lý như mã chung ở pha này (V559).
  const sign = input.signFor?.(phase) ?? null
  if (sign) {
    const message = String(input.error || input.traced?.message || 'Lỗi không xác định').slice(0, 500)
    return { phase, signal: { kind: 'block', code: sign.code, errorCode: sign.code, message, ...(trace && trace.ops.length ? { trace } : {}) } }
  }
  if (input.traced && input.traced.code !== 'throw') {
    return { phase, signal: { kind: 'block', code: input.traced.code, message: input.traced.message, ...(trace ? { trace } : {}) } }
  }
  const message = String(input.traced?.message || input.error || 'Lỗi không xác định').slice(0, 500)
  return { phase, signal: { kind: input.threw ? 'exception' : 'message_like', message, ...(trace && trace.ops.length ? { trace } : {}) } }
}
