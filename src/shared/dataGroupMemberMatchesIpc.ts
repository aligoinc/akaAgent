import type { DataGroupMemberMatchesRequest, DataGroupMemberMatchesResult } from './dataGroupMemberMatches'

/**
 * Cửa sổ "Thêm data từ file" của Nhóm data trên Desktop → "Bỏ data đã có trong nhóm này / ở nhóm data khác":
 * một kênh IPC, không bao giờ ném lỗi qua IPC.
 * - `setting`: trường tùy chọn `groupMatches` của công tắc `web.campaign_input_duplicates` (đọc mỗi lần mở cửa sổ;
 *   thiếu dòng/thiếu trường = bật, chỉ `false` mới tắt; đọc lỗi = tắt, cửa sổ nhập như trước).
 * - `check`: một lượt ≤ 2.000 định danh (giới hạn RPC), gọi RPC chỉ đọc V519 bằng token Desktop (cấp ở V522);
 *   renderer chia lượt tuần tự 1.000 định danh.
 * Hợp đồng chung (giới hạn, kiểu, chia lượt, công tắc) ở `dataGroupMemberMatches.ts`, chép nguyên văn từ
 * akaAgentWebApp control-api.
 */
export const DATA_GROUP_MEMBER_MATCHES_IPC = 'data-group:member-matches'

export type DataGroupMemberMatchesIpcRequest =
  | { kind: 'setting' }
  | { kind: 'check'; groupId: number; request: DataGroupMemberMatchesRequest }

export interface DataGroupMemberMatchesIpcResponses {
  setting: { enabled: boolean }
  check: DataGroupMemberMatchesResult
}

export type DataGroupMemberMatchesIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

/**
 * DB chưa có hàm V519, token Desktop chưa được cấp quyền (V522 chưa apply/đã rollback) hoặc công tắc tắt: cửa sổ
 * nhập trở về cách thêm trước V522, không báo lỗi.
 */
export const dataGroupMemberMatchesUnavailable = (code: string): boolean =>
  code === 'data_group_matches_not_ready' || code === 'data_group_matches_disabled'
