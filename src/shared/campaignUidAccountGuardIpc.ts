import type { UidAccountGuardCheckResponse } from './campaignUidAccountGuard'

/**
 * Kiểm danh sách người nhận Zalo có thuộc đúng tài khoản gửi không (DAT04, V679) trên Desktop: một kênh IPC, không ném lỗi.
 * - `check` theo danh sách: tài khoản định dùng + UID (hoặc `assignments` khi chia người nhận cho từng tài khoản).
 * - `check` theo chiến dịch: đổi tài khoản của chiến dịch đã lưu; `check-resume`: bấm Tiếp tục.
 * - `allow-skip`: khách chọn "Bỏ N người này"; lần lưu / Tiếp tục kế tiếp của chiến dịch đó được đi qua rồi giữ lại người sai.
 * Hợp đồng chung (luật chọn chiến dịch, câu chữ) ở `campaignUidAccountGuard.ts`, chép nguyên văn từ akaAgentWebApp control-api.
 */
export const CAMPAIGN_UID_ACCOUNT_GUARD_IPC = 'campaign:uid-account-guard'

export type UidAccountGuardIpcRequest =
  | { action: 'check'; actionId: string; accountIds: number[]; uids: Array<string | null> }
  | { action: 'check'; actionId: string; assignments: Array<{ accountId: number; uids: Array<string | null> }> }
  | { action: 'check'; campaignId: number; accountId: number }
  /** Bấm Tiếp tục: người đang chờ của chiến dịch với tài khoản hiện tại. */
  | { action: 'check-resume'; campaignId: number }
  | { action: 'allow-skip'; campaignId: number; accountId?: number | null }

export type UidAccountGuardIpcResult =
  | { ok: true; data: UidAccountGuardCheckResponse }
  | { ok: false; message: string }
