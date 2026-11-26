// Nút "Lý do đang chờ" / tab Chẩn đoán hiểu trạng thái engine v2 (R17, anh chốt Q21 16/11/2026). Chỉ đọc RAM: kết quả lần nhận lượt
// gần nhất của bộ chạy trên máy này (claim của DB đã xét lease, token bộ cũ, khoá / hạn mức, gói, số tài khoản chạy cùng lúc…).
// Không gọi DB, không nhận lượt. Dùng cho cả Facebook lẫn Zalo chạy bằng engine trên Desktop.
import { campaignParallelWaitReasonText } from '../../shared/campaignParallelRun'
import { getAccountActionName } from '../../shared/campaignActionDescriptors'

export interface EngineClaimObservation {
  accountId: number
  /** UnitResult.reason (bằng status của claim khi chưa nhận được data). */
  reason: string
  /** UnitResult.detail.claim (câu trả lời của claim), nếu có. */
  claim: Record<string, unknown> | null
  /** Lúc quan sát (đồng hồ máy, chỉ để biết quan sát còn mới). */
  at: number
}

/** Quan sát cũ hơn mức này thì bỏ (bộ lập lịch hỏi lại mỗi nhịp; nhớ chờ hạn mức tối đa 5 phút). */
export const ENGINE_OBSERVATION_TTL_MS = 10 * 60_000

/** Lý do kết thúc lượt mà chiến dịch vẫn đứng chờ: nhớ để giải thích. Lý do khác (chạy được, hết data…) thì quên quan sát cũ. */
const WAITING_REASONS = new Set([
  'wait', 'busy', 'legacy_busy', 'entitlement_denied', 'concurrency_limit', 'account_logged_out', 'account_paused', 'staff_time_blocked',
  'gate_unavailable', 'daily_boundary', 'maintenance_required', 'campaign_not_ready', 'data_group_waiting', 'error', 'parallel_wait'
])

export function isEngineWaitingReason(reason: string | null | undefined): boolean {
  return WAITING_REASONS.has(String(reason ?? ''))
}

const formatTime = (value: string | number): string => new Date(value).toLocaleString('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
})

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Câu cho khách theo kết quả nhận lượt gần nhất của engine; null khi không có gì để nói (quan sát cũ, hết hạn chờ, lý do không rõ).
 * platformLabel: "Facebook" / "Zalo trình duyệt"… cho câu giới hạn số tài khoản chạy cùng lúc.
 */
export function engineWaitMessage(observation: EngineClaimObservation | null | undefined, now: number, platformLabel: string): string | null {
  if (!observation || now - observation.at > ENGINE_OBSERVATION_TTL_MS) return null
  const claim = observation.claim ?? {}
  switch (observation.reason) {
    case 'wait': {
      const wait = (claim.wait ?? {}) as { note?: unknown; until?: unknown }
      const until = typeof wait.until === 'string' ? Date.parse(wait.until) : Number.NaN
      if (Number.isFinite(until) && until <= now) return null
      const note = text(wait.note).replace(/^⏳\s*/, '')
      if (note) return note
      return Number.isFinite(until)
        ? `Tài khoản đang tạm nghỉ thao tác hoặc đã đạt giới hạn lượt. Chạy tiếp từ ${formatTime(until)}.`
        : 'Tài khoản đang tạm nghỉ thao tác hoặc đã đạt giới hạn lượt. Chiến dịch sẽ chạy tiếp khi được phép.'
    }
    case 'busy': {
      const expires = typeof claim.expiresAt === 'string' ? Date.parse(claim.expiresAt) : Number.NaN
      return 'Tài khoản đang có lượt chạy chưa kết thúc (ở máy khác hoặc từ lần mở ứng dụng trước).'
        + (Number.isFinite(expires) && expires > now ? ` Chiến dịch sẽ chạy khi lượt đó xong, chậm nhất khoảng ${formatTime(expires)} nếu lượt đó đã dừng.` : ' Chiến dịch sẽ chạy khi lượt đó xong.')
    }
    case 'legacy_busy':
      return claim.scope === 'campaign'
        ? 'Một chiến dịch khác của tài khoản còn lượt chạy chưa kết thúc. Chiến dịch này sẽ chạy khi lượt đó xong.'
        : 'Tài khoản đang có lượt chạy hoặc tác vụ trước chưa kết thúc. Chiến dịch này sẽ chạy khi lượt đó xong.'
    case 'entitlement_denied':
      return 'Gói sử dụng chưa cho phép loại tài khoản này, hoặc gói đã hết hạn.'
    case 'concurrency_limit': {
      const max = Number(claim.max)
      return Number.isInteger(max) && max > 0
        ? `Đã đạt giới hạn ${max} tài khoản ${platformLabel} chạy đồng thời. Đang chờ có chỗ.`
        : `Đã đạt giới hạn số tài khoản ${platformLabel} chạy đồng thời. Đang chờ có chỗ.`
    }
    case 'account_logged_out':
      return 'Tài khoản chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.'
    case 'account_paused':
      return 'Tài khoản đang tạm dừng. Vui lòng tiếp tục tài khoản để chạy chiến dịch.'
    case 'staff_time_blocked':
      return 'Tài khoản nhân viên đã hết hạn sử dụng.'
    case 'gate_unavailable':
      return text(claim.note) || 'Chưa kiểm tra được điều kiện chống gửi lặp. Ứng dụng sẽ tự thử lại.'
    case 'daily_boundary':
      if (claim.reason === 'daily_stop_due' && text(claim.stopTime)) {
        return `Đã quá giờ dừng gửi ${text(claim.stopTime).slice(0, 5)}. Chiến dịch không nhận lượt mới trong hôm nay.`
      }
      if (claim.reason === 'daily_drain_due') return 'Hệ thống dừng nhận lượt mới từ 23:59 để chuyển sang ngày mới.'
      return 'Đang chờ hệ thống cập nhật lịch chạy ngày mới.'
    case 'maintenance_required':
      return 'Đang chờ hệ thống cập nhật lịch chạy ngày mới.'
    case 'campaign_not_ready':
      return 'Chiến dịch đang chuẩn bị data, chưa sẵn sàng chạy.'
    case 'data_group_waiting':
      return text(claim.note) || 'Đang chờ data mới từ Nhóm data.'
    case 'error':
      return 'Lần chạy gần nhất bị gián đoạn (lỗi kết nối hoặc lỗi hệ thống). Ứng dụng sẽ tự thử lại ở lượt sau.'
    case 'parallel_wait':
      // "Chạy cùng lúc" (V670): chiến dịch đang chạy ở làn khác cùng loại / chung thao tác; câu anh duyệt 26/11.
      return campaignParallelWaitReasonText({
        reason: claim.reason === 'same_action' ? 'same_action' : 'same_type',
        campaignName: text(claim.campaignName) || null,
        actionNames: Array.isArray(claim.actionCodes) ? claim.actionCodes.map(code => getAccountActionName(String(code || '').trim())) : []
      })
    default:
      return null
  }
}
