import type {
  CreateDataGroupFromFriendFilterRequest, CreateDataGroupFromFriendFilterResult, ZaloFriendAccount, ZaloFriendFilterRequest,
  ZaloFriendFilterResult, ZaloFriendRecipientsRequest, ZaloFriendRecipientsResult
} from './zaloFriendFilter'
import type { DataGroupAgentAudience, DataGroupAgentRequest, DataGroupAgentResult } from './dataGroupAgent'

/**
 * "Thêm nhóm data bằng Agent" (Nhóm data) và "Agent chọn bạn bè" (form chiến dịch) trên Desktop: một kênh IPC, không bao
 * giờ ném lỗi qua IPC. Hợp đồng nghiệp vụ ở `zaloFriendFilter.ts` và `dataGroupAgent.ts` (chép nguyên văn từ
 * akaAgentWebApp control-api). Hàm DB: akaAgent V533–V538 (WebApp), quyền token Desktop và cấu hình AI: V539.
 * Hướng dẫn: docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md.
 *
 * - `setting`: công tắc `web.data_group_agent` (chung với Web; thiếu/sai = tắt; đọc lỗi = tắt).
 * - `accounts`: tài khoản Zalo của nhân viên kèm số bạn bè (một lượt khi mở cửa sổ).
 * - `turn`: một lượt chat = một lần gọi AI qua proxy của API Web (dòng `ai_form_configs` có desktop_section_id).
 * - `filter`: đếm thử / 20 người đầu (count | page | ids), chỉ đọc.
 * - `recipients`: form chiến dịch, UID và tên của mọi người khớp (≤ 5.000), chỉ đọc.
 * - `create`: tạo nhóm data + nạp thành viên trong một giao dịch; cùng requestId thì DB trả kết quả cũ.
 * `cancel(requestId)` hủy lượt `turn`/`filter`/`recipients` đang chạy (tạo nhóm không hủy giữa chừng).
 */
export const DATA_GROUP_AGENT_IPC = {
  request: 'data-group-agent:request',
  cancel: 'data-group-agent:cancel'
} as const

export type DataGroupAgentIpcRequest =
  | { kind: 'setting' }
  | { kind: 'accounts' }
  | { kind: 'turn'; request: DataGroupAgentRequest }
  | { kind: 'filter'; request: ZaloFriendFilterRequest }
  | { kind: 'recipients'; request: ZaloFriendRecipientsRequest }
  | { kind: 'create'; request: CreateDataGroupFromFriendFilterRequest }

export interface DataGroupAgentSetting {
  audience: DataGroupAgentAudience
  /** Thiếu trường = bật; chỉ `false` mới ẩn nút "Agent chọn bạn bè" trong form chiến dịch. */
  campaignForm: boolean
}

export interface DataGroupAgentIpcResponses {
  setting: DataGroupAgentSetting
  accounts: { accounts: ZaloFriendAccount[] }
  turn: DataGroupAgentResult
  filter: ZaloFriendFilterResult
  recipients: ZaloFriendRecipientsResult
  create: CreateDataGroupFromFriendFilterResult
}

export type DataGroupAgentIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> }

/** Câu chữ Desktop: hợp đồng dùng chung viết theo Web ("nhóm khách hàng"); Desktop gọi là "nhóm data". Chỉ dùng khi hiển thị. */
export function dataGroupAgentDesktopWording(text: string): string {
  return text.replace(/([Nn])hóm khách hàng/g, (_, first: string) => `${first}hóm data`)
}
