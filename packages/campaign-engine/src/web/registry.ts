/**
 * Quét data từ website (nhatot, batdongsan, Trang Vàng) trên engine v2: chạy trên Desktop bằng tài khoản "Website" (flatform_type = 'web'),
 * chế độ workflow của lõi (nơi chạy làm việc với trang, lõi giữ lease, nhận data, chỉ thị của DB). Phương án docs/WEB_DATA_SCAN_PLAN.md mục 7.
 * Mã ở đây phải khớp src/shared/webScan.ts và migration V618 (bài kiểm scripts/web-scan/runner-smoke.cjs so hai bên).
 */
import type { ClaimContext, TargetRow } from '../contracts.js'
import type { V2Support } from '../zalo/messagePhone.js'

export const WEB_FIND_DATA_NHATOT = 'web_find_data_nhatot'
export const WEB_FIND_DATA_BATDONGSAN = 'web_find_data_batdongsan'
export const WEB_FIND_DATA_YELLOWPAGES = 'web_find_data_yellowpages'
export const WEB_CAMPAIGN_ACTION_IDS: readonly string[] = [WEB_FIND_DATA_NHATOT, WEB_FIND_DATA_BATDONGSAN, WEB_FIND_DATA_YELLOWPAGES]

/** Mã thao tác tính hạn mức của từng loại (mỗi lần hiện SĐT / mở trang một lượt). */
export const WEB_ACTION_CODE_BY_CAMPAIGN: Readonly<Record<string, string>> = {
  [WEB_FIND_DATA_NHATOT]: 'web_nhatot_phone',
  [WEB_FIND_DATA_BATDONGSAN]: 'web_batdongsan_phone',
  [WEB_FIND_DATA_YELLOWPAGES]: 'web_yellowpages_page'
}
export const WEB_ACTION_NAMES: Readonly<Record<string, string>> = {
  web_nhatot_phone: 'Hiện SĐT Nhà Tốt',
  web_batdongsan_phone: 'Hiện SĐT Batdongsan',
  web_yellowpages_page: 'Mở trang Trang Vàng'
}
/** Dòng tổng kết mỗi từ khoá: không gắn thao tác (như Tìm data Facebook). */
export const WEB_FIND_DATA_RESULT_NAME = 'Tìm data'

export function isWebCampaignAction(actionId: string | null | undefined): boolean {
  return WEB_CAMPAIGN_ACTION_IDS.includes(String(actionId || ''))
}

/** Thao tác cho claim: mã của trang, kiểm khoá + hạn mức (mỗi data = một từ khoá / link). */
export function webClaimPlan(actionId: string): Pick<ClaimContext, 'actions'> {
  const code = WEB_ACTION_CODE_BY_CAMPAIGN[actionId]
  return { actions: code ? [{ code }] : [] }
}

/** Nhãn data trong tiến trình: từ khoá (tên) → uid. */
export function webTargetLabel(target: TargetRow): string {
  for (const value of [target.name, target.uid]) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return 'N/A'
}

export function webCampaignV2Support(campaign: { actionId: string; accountId: number | null | undefined }, accountId: number): V2Support {
  if (!isWebCampaignAction(campaign.actionId)) return { ok: false, reason: 'not_web' }
  if (campaign.accountId !== accountId) return { ok: false, reason: 'account_mismatch' }
  return { ok: true }
}
