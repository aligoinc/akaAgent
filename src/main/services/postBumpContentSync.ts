import type { Campaign, CampaignExtraSettings } from '../../shared/types'
import { planPostBumpContentSync, shouldSyncPostBumpTarget } from '../../shared/postBumpContent'
import type { SupabaseService } from './supabase'

type PostBumpSyncStore = Pick<SupabaseService, 'getCampaign' | 'updateCampaign' | 'appendCampaignLog'>

export interface PostBumpContentSyncResult {
  updatedCampaignIds: number[]
  failedCampaignIds: number[]
}

/**
 * "Nội dung up tin" chỉ được chép sang chiến dịch up tin lúc tạo. Khi khách đổi nội dung này ở chiến dịch đăng nhóm
 * (chế độ tạo mới), chép nội dung mới sang các chiến dịch up tin đã tạo. Không đổi thì không ghi gì, để giữ nội dung
 * khách sửa thẳng trong chiến dịch up tin. Lỗi không làm hỏng lần lưu chiến dịch đăng nhóm: chỉ ghi lịch sử chạy.
 */
export async function syncPostBumpTargetContent(
  store: PostBumpSyncStore,
  before: { extraSettings?: CampaignExtraSettings | null } | null,
  after: Campaign
): Promise<PostBumpContentSyncResult> {
  const result: PostBumpContentSyncResult = { updatedCampaignIds: [], failedCampaignIds: [] }
  const plan = planPostBumpContentSync(after.actionId, before?.extraSettings, after.extraSettings)
  if (!plan) return result

  for (const targetId of plan.targetCampaignIds) {
    try {
      const target = await store.getCampaign(targetId)
      if (!target || !shouldSyncPostBumpTarget(target, after.staffId, plan.content)) continue
      await store.updateCampaign(targetId, {
        content: plan.content,
        extraSettings: { ...(target.extraSettings || {}), commentContent: plan.content }
      })
      result.updatedCampaignIds.push(targetId)
      await store.appendCampaignLog(targetId, `✅ Đã cập nhật nội dung up tin từ chiến dịch "${after.name}"`)
        .catch(err => console.error('Failed log post bump content sync on target:', err))
    } catch (err) {
      console.error(`Failed sync post bump content to campaign ${targetId}:`, err)
      result.failedCampaignIds.push(targetId)
    }
  }

  const lines: string[] = []
  if (result.updatedCampaignIds.length > 0) {
    lines.push(`✅ Đã cập nhật nội dung up tin cho ${result.updatedCampaignIds.length} chiến dịch up tin`)
  }
  if (result.failedCampaignIds.length > 0) {
    lines.push(`⚠️ Chưa cập nhật được nội dung up tin cho ${result.failedCampaignIds.length} chiến dịch up tin, vui lòng sửa trực tiếp trong chiến dịch up tin`)
  }
  for (const line of lines) {
    await store.appendCampaignLog(after.id, line)
      .catch(err => console.error('Failed log post bump content sync on source:', err))
  }
  return result
}
