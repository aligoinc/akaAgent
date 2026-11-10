import type { CampaignAccountActionsResult } from '../../shared/campaignAccountActions'
import { getDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { readPendingReasonAccount, readPendingReasonAction, readPendingReasonCampaign } from '../data/repositories/campaignPendingReasonRepository'
import { readCampaignAccountActionRows } from '../data/repositories/campaignDiagnosticsRepository'

/** Lỗi được phép hiện nguyên văn ở tab; lỗi khác (mạng/SQL) đổi thành thông báo chung ở IPC. */
export class CampaignAccountActionsError extends Error {}

/**
 * Tab "Hành động" trong chi tiết chiến dịch. Chỉ đọc qua client Supabase hiện có: chiến dịch (câu đọc hẹp của
 * "Tại sao CD không chạy?"), tài khoản + nhóm (cùng luật akaChat), loại chiến dịch, giờ DB (đã cache), rồi trạng
 * thái và số lượt khung giờ của từng hành động. Không cache kết quả, không polling, không ghi DB.
 */
export async function readCampaignAccountActions(id: number, signal: AbortSignal): Promise<CampaignAccountActionsResult> {
  const found = await readPendingReasonCampaign(id, signal)
  if (!found || found.campaign.isDelete) throw new CampaignAccountActionsError('Không tìm thấy chiến dịch trong tài khoản của bạn.')
  const { campaign } = found
  if (!campaign.accountId) throw new CampaignAccountActionsError('Không tìm thấy tài khoản của chiến dịch.')
  const [accountState, action, clock] = await Promise.all([
    readPendingReasonAccount(campaign.accountId, signal),
    readPendingReasonAction(campaign.actionId, signal),
    getDatabaseRuntimeClock()
  ])
  signal.throwIfAborted()
  if (!accountState) throw new CampaignAccountActionsError('Không tìm thấy tài khoản của chiến dịch.')
  if (accountState.account.isDelete) throw new CampaignAccountActionsError('Tài khoản của chiến dịch đã bị xóa.')
  const { account, isChatManaged } = accountState
  const actions = await readCampaignAccountActionRows(account, campaign, action, clock, isChatManaged, signal)
  signal.throwIfAborted()
  return {
    campaignId: campaign.id,
    accountId: account.id,
    checkedAt: clock.dbNow,
    nextDayStartsAt: clock.nextVietnamMidnight,
    runtime: isChatManaged ? 'chat' : 'scheduler',
    groupApplied: !!account.accountGroupSettings,
    continueWhenActionLimitReached: campaign.extraSettings?.actionLimits?.continueWhenActionLimitReached === true,
    actions
  }
}
