/**
 * "Chạy cùng lúc" (anh chốt 26/11/2026; DB: V670). Hợp đồng dùng chung Web, iOS và Desktop: câu chữ anh đã duyệt và điều kiện hiện ô.
 * Bản gốc: akaAgentWebApp packages/control-api/src/campaignParallelRun.ts. Desktop chép nguyên văn sang src/shared/campaignParallelRun.ts
 * (sửa ở WebApp trước rồi chép lại; bài kiểm so md5 hai bản).
 *
 * Cột DB: auto_campaign_actions.allow_parallel_run (akaBiz bật theo loại, khách không sửa), auto_campaigns.parallel_run_enabled (khách tích).
 * Chạy cùng lúc chỉ có ở engine v2 (Desktop, Fly), nên ô chỉ hiện ở tổ chức đã bật engine v2 (org_organization.use_new_zalo_runtime).
 * Quy tắc chạy nằm ở hàm nhận lượt của DB: mỗi tài khoản, mỗi loại chỉ một chiến dịch chạy tại một lúc; chiến dịch dùng chung thao tác thì chờ.
 */

/** Ô tích trên form Desktop và Web. */
export const CAMPAIGN_PARALLEL_RUN_LABEL = 'Chạy cùng lúc với chiến dịch khác của tài khoản'
/** Dòng bật / tắt trên iOS, và tên dòng ở chi tiết chiến dịch. */
export const CAMPAIGN_PARALLEL_RUN_SHORT_LABEL = 'Chạy cùng lúc'
/** Dòng giải thích dưới ô (Desktop, Web) và dòng phụ (iOS). */
export const CAMPAIGN_PARALLEL_RUN_HINT = 'Không chờ chiến dịch khác chạy xong. Chiến dịch cùng loại vẫn chạy lần lượt.'

export interface CampaignParallelRunVisibility {
  /** auto_campaign_actions.allow_parallel_run của loại chiến dịch đang chọn. */
  allowParallelRun?: boolean | null
  /** Tổ chức đã bật engine v2 (org_organization.use_new_zalo_runtime). */
  engineV2?: boolean | null
}

/** Hiện ô "Chạy cùng lúc" khi loại được akaBiz bật và tổ chức đã bật engine v2. */
export function canShowCampaignParallelRun(input: CampaignParallelRunVisibility): boolean {
  return input.allowParallelRun === true && input.engineV2 === true
}

/** Dòng ở chi tiết chiến dịch (phần Lịch chạy): "Chạy cùng lúc: Có" / "Chạy cùng lúc: Không". */
export function campaignParallelRunDetail(enabled: boolean | null | undefined): string {
  return `${CAMPAIGN_PARALLEL_RUN_SHORT_LABEL}: ${enabled === true ? 'Có' : 'Không'}`
}

export type CampaignParallelWaitReason = 'same_type' | 'same_action'

export interface CampaignParallelWait {
  reason: CampaignParallelWaitReason
  /** Tên chiến dịch đang chạy mà chiến dịch này phải chờ. */
  campaignName?: string | null
  /** Tên các thao tác dùng chung (ví dụ "Nhắn tin người lạ"), chỉ dùng khi reason = same_action. */
  actionNames?: readonly string[] | null
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLocaleLowerCase('vi-VN') + text.slice(1) : text
}

/** Câu "Lý do đang chờ" khi chiến dịch phải chờ một chiến dịch đang chạy cùng loại, hoặc dùng chung thao tác. */
export function campaignParallelWaitReasonText(wait: CampaignParallelWait): string {
  const name = String(wait.campaignName || '').trim()
  const campaign = name ? `chiến dịch "${name}"` : 'một chiến dịch'
  if (wait.reason === 'same_type') {
    return `Tài khoản đang chạy ${campaign} cùng loại. Chiến dịch này sẽ chạy khi chiến dịch đó xong.`
  }
  const actions = (wait.actionNames || []).map(item => String(item || '').trim()).filter(Boolean).map(lowerFirst)
  return actions.length
    ? `Đang chờ ${campaign} chạy xong, vì hai chiến dịch cùng ${actions.join(', ')}.`
    : `Đang chờ ${campaign} chạy xong.`
}
