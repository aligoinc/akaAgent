/**
 * Kiêm up tin Facebook: chọn câu comment cho từng lượt up và đồng bộ "Nội dung up tin".
 *
 * Mỗi tài khoản up tin là một chiến dịch facebook_comment_seeding_post riêng. Nếu để RPC
 * aka_agent_take_campaign_content_index dùng con trỏ của từng chiến dịch, mọi con trỏ cùng bắt đầu từ 0 và mỗi bài
 * nhận một lượt/tài khoản, nên các tài khoản comment cùng một câu trên một bài. Vì vậy lúc thêm các lượt up của một
 * bài, chiến dịch đăng nhóm giao trước chỉ số (bắt đầu + i) cho lượt thứ i và ghi vào
 * auto_campaign_input_data.content_rotation_indexes[fb_comment]; RPC dùng chỉ số ghi sẵn trên dòng data (mod số câu
 * của chiến dịch up tin) thay cho con trỏ của chiến dịch. Không mod ở đây: các chiến dịch up tin có thể có số câu khác
 * nhau (khách sửa thẳng chiến dịch up tin), mỗi chiến dịch tự mod theo số câu của nó.
 *
 * Mỗi bài bắt đầu từ một câu ngẫu nhiên (anh chốt 18/11/2026, "miễn sao ko trùng trong 1 bài là được"). Con trỏ tiến đều
 * theo bài (bản đầu của V531) làm con trỏ tài khoản và con trỏ câu cùng tiến N mỗi bài, nên khi số tài khoản = số câu mỗi tài
 * khoản luôn đứng yên ở một câu; bắt đầu ngẫu nhiên thì tài khoản đổi câu giữa các bài (có thể trùng câu của bài trước).
 */

/** Action code mà block fb_comment_current_post dùng khi lấy câu comment (prepareFacebookCampaignContent). */
export const POST_BUMP_COMMENT_ACTION_CODE = 'fb_comment'

/** Tên chiến dịch up tin do "Kiêm up tin" tạo (createPostBumpTargetCampaign): "Up tin cho chiến dịch <nguồn> - <tài khoản>". */
export const POST_BUMP_TARGET_NAME_PREFIX = 'Up tin cho chiến dịch '

/** Nghỉ giữa hai comment của chiến dịch up tin mới tạo, giây (anh chốt 18/11/2026; bằng mức khách hay đặt cho comment vào bài). */
export const POST_BUMP_SLEEP_BETWEEN_COMMENTS_SECONDS = 30

/** Mã lỗi block fb_comment_current_post (V472) trả khi bài không còn trên Facebook. */
export const POST_BUMP_POST_NOT_FOUND_ERROR_CODE = 'err_fb_comment_unavailable_post_not_found'

/** Ghi chú dòng data cho lượt up tin bị đóng vì bài không còn: đúng câu lỗi khách đã thấy trong lịch sử (anh chốt 18/11/2026). */
export const POST_BUMP_POST_NOT_FOUND_NOTE = 'Không tìm thấy bài Facebook để bình luận'

/**
 * Chiến dịch up tin do "Kiêm up tin" tạo. Nhận theo loại + tên, vì form sửa chiến dịch dựng lại extraSettings nên cờ riêng
 * không giữ được. Chiến dịch khách tự chọn ở chế độ "chọn chiến dịch có sẵn" (hoặc đã đổi tên) không tính.
 */
export function isPostBumpTargetCampaign(campaign: { actionId?: string | null; name?: string | null } | null | undefined): boolean {
  return campaign?.actionId === 'facebook_comment_seeding_post'
    && String(campaign?.name || '').startsWith(POST_BUMP_TARGET_NAME_PREFIX)
}

/**
 * Bảo trì lịch ngày mới cho chiến dịch up tin đang chờ: lịch theo lượt chờ sớm nhất, lượt đã quá hạn thì đầu ngày hôm nay (chạy
 * ngay), thay vì dời về giờ:phút lúc tạo chiến dịch (anh chốt 18/11/2026). null = không còn lượt chờ, bảo trì giữ cách cũ.
 */
export function planPostBumpMaintenanceSchedule(earliestPending: Date | null, todayStart: Date): Date | null {
  if (!earliestPending || Number.isNaN(earliestPending.getTime())) return null
  return earliestPending.getTime() <= todayStart.getTime() ? todayStart : earliestPending
}

/**
 * Câu bắt đầu chọn trong [0, khoảng này). RPC nhận chỉ số 1–16 chữ số và mod theo số câu của chiến dịch up tin; khoảng lớn
 * so với số câu (≤ vài chục) nên câu bắt đầu gần như đều nhau sau khi mod.
 */
const POST_BUMP_CONTENT_START_RANGE = 1_000_000_000

export interface PostBumpContentPlan {
  /** Chỉ số câu của từng lượt up, theo đúng thứ tự lượt. */
  indexes: number[]
}

/**
 * Lượt thứ i của một bài lấy câu (bắt đầu + i), bắt đầu ngẫu nhiên mỗi bài. Số lượt không vượt quá số câu thì mọi lượt trên
 * cùng bài khác câu, kể cả khi lượt chia cho nhiều tài khoản.
 */
export function planPostBumpContentIndexes(count: number, random: () => number = Math.random): PostBumpContentPlan {
  const safeCount = Number.isSafeInteger(count) && count > 0 ? count : 0
  const raw = Math.floor(Number(random()) * POST_BUMP_CONTENT_START_RANGE)
  const start = Number.isSafeInteger(raw) && raw >= 0 ? raw % POST_BUMP_CONTENT_START_RANGE : 0
  return { indexes: Array.from({ length: safeCount }, (_, i) => start + i) }
}

/** Nội dung up tin được chép sang chiến dịch up tin (cùng cách createPostBumpTargetCampaign). */
export function normalizePostBumpContent(value: unknown): string {
  return String(value ?? '').trim()
}

interface PostBumpSourceSettings {
  postBumpMode?: string
  postBumpContent?: string
  postBumpCreatedCampaignIdsByAccount?: Record<string, number>
}

export interface PostBumpContentSyncPlan {
  content: string
  targetCampaignIds: number[]
}

/**
 * Chỉ đồng bộ khi khách đổi "Nội dung up tin" của chiến dịch đăng nhóm (so với bản đang lưu trong DB). Không đổi thì
 * không ghi gì, để giữ nội dung khách sửa thẳng trong chiến dịch up tin.
 */
export function planPostBumpContentSync(
  actionId: string | null | undefined,
  before: PostBumpSourceSettings | null | undefined,
  after: PostBumpSourceSettings | null | undefined
): PostBumpContentSyncPlan | null {
  // Không đọc được bản cũ thì không biết khách có đổi hay không: không ghi đè chiến dịch up tin.
  if (actionId !== 'facebook_group_post' || !before || !after) return null
  if ((after.postBumpMode || 'create') !== 'create') return null
  const content = normalizePostBumpContent(after.postBumpContent)
  if (!content) return null
  if (normalizePostBumpContent(before.postBumpContent) === content) return null
  const targetCampaignIds = Array.from(new Set(
    Object.values(after.postBumpCreatedCampaignIdsByAccount || {})
      .map(id => Math.floor(Number(id)))
      .filter(id => Number.isSafeInteger(id) && id > 0)
  ))
  if (targetCampaignIds.length === 0) return null
  return { content, targetCampaignIds }
}

interface PostBumpTargetSnapshot {
  actionId?: string
  isDelete?: boolean
  staffId?: number | null
  content?: string | null
  extraSettings?: { commentContent?: string; advancedContentEnabled?: boolean } | null
}

/** Chiến dịch up tin nhận nội dung mới khi còn sống, đúng loại, cùng nhân viên, dùng nội dung cơ bản và đang khác. */
export function shouldSyncPostBumpTarget(
  target: PostBumpTargetSnapshot | null | undefined,
  sourceStaffId: number | null | undefined,
  content: string
): boolean {
  if (!target || target.isDelete) return false
  if (target.actionId !== 'facebook_comment_seeding_post') return false
  if (sourceStaffId != null && target.staffId != null && Number(target.staffId) !== Number(sourceStaffId)) return false
  if (target.extraSettings?.advancedContentEnabled === true) return false
  return normalizePostBumpContent(target.extraSettings?.commentContent) !== content
}
