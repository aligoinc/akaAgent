/**
 * "Chạy cùng lúc" (V670, anh chốt 26/11/2026). Chiến dịch có tích "Chạy cùng lúc" (auto_campaigns.parallel_run_enabled) mà loại được akaBiz
 * bật (auto_campaign_actions.allow_parallel_run) chạy ở làn riêng của loại đó; mọi chiến dịch khác chạy ở làn chính như trước.
 *
 * Hàm nhận lượt của DB (aka_agent_engine_claim_target_v1) mới là nơi quyết định làn thật và giữ quy tắc "mỗi loại một cái, chung thao tác
 * thì chờ". Hàm ở đây chỉ để nơi chạy (Desktop, Fly) chia hàng đợi của một tài khoản theo làn. Nếu lệch với DB (akaBiz vừa đổi cột), DB trả
 * busy / parallel_wait, hàng đợi kết thúc sớm, không có hai lượt chạy chồng.
 */
export const PARALLEL_RUN_MAIN_LANE = 'main'

export interface ParallelRunCampaign {
  actionId: string
  parallelRunEnabled?: boolean | null
}

/** Làn của chiến dịch: mã loại chiến dịch khi khách tích và loại được akaBiz bật, ngược lại làn chính. */
export function campaignRunLane(campaign: ParallelRunCampaign, allowParallelRun: boolean | null | undefined): string {
  const actionId = String(campaign.actionId || '').trim()
  return campaign.parallelRunEnabled === true && allowParallelRun === true && actionId ? actionId : PARALLEL_RUN_MAIN_LANE
}
