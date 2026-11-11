import type { InputDuplicatesCheckRequest, InputDuplicatesCheckResult, InputDuplicatesSetting } from './campaignInputDuplicates'

/**
 * "Lọc trùng dữ liệu" của cửa sổ Upload dữ liệu trên Desktop: một kênh IPC, không bao giờ ném lỗi qua IPC.
 * - `setting`: công tắc `web.campaign_input_duplicates` (đọc mỗi lần mở cửa sổ; thiếu/lỗi = tắt).
 * - `check`: một lượt ≤ 2.000 SĐT (giới hạn RPC), gọi RPC chỉ đọc V491 bằng token Desktop (cấp ở V493); renderer chia lượt
 *   tuần tự 1.000 số.
 * Hợp đồng chung (giới hạn, kiểu, nhãn) ở `campaignInputDuplicates.ts`, chép nguyên văn từ akaAgentWebApp control-api.
 */
export const CAMPAIGN_INPUT_DUPLICATES_IPC = 'campaign:input-duplicates'

export type CampaignInputDuplicatesIpcRequest =
  | { kind: 'setting' }
  | { kind: 'check'; request: InputDuplicatesCheckRequest }

export interface CampaignInputDuplicatesIpcResponses {
  setting: InputDuplicatesSetting
  check: InputDuplicatesCheckResult
}

export type CampaignInputDuplicatesIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }
