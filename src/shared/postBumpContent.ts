/**
 * Kiêm up tin Facebook: chọn câu comment cho từng lượt up và đồng bộ "Nội dung up tin".
 *
 * Mỗi tài khoản up tin là một chiến dịch facebook_comment_seeding_post riêng. Nếu để RPC
 * aka_agent_take_campaign_content_index dùng con trỏ của từng chiến dịch, mọi con trỏ cùng bắt đầu từ 0 và mỗi bài
 * nhận một lượt/tài khoản, nên các tài khoản comment cùng một câu trên một bài. Vì vậy lúc thêm các lượt up của một
 * bài, chiến dịch đăng nhóm giao trước chỉ số (con trỏ + i) cho lượt thứ i và ghi vào
 * auto_campaign_input_data.content_rotation_indexes[fb_comment]; RPC dùng chỉ số ghi sẵn trên dòng data (mod số câu
 * của chiến dịch up tin) thay cho con trỏ của chiến dịch. Không mod ở đây: các chiến dịch up tin có thể có số câu khác
 * nhau (khách sửa thẳng chiến dịch up tin), mỗi chiến dịch tự mod theo số câu của nó.
 */

/** Action code mà block fb_comment_current_post dùng khi lấy câu comment (prepareFacebookCampaignContent). */
export const POST_BUMP_COMMENT_ACTION_CODE = 'fb_comment'

/** RPC chỉ nhận chỉ số 1–16 chữ số; quấn con trỏ trước mốc này để luôn hợp lệ. */
const POST_BUMP_CONTENT_CURSOR_LIMIT = 1_000_000_000_000

export function normalizePostBumpContentCursor(value: unknown): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0
  return parsed % POST_BUMP_CONTENT_CURSOR_LIMIT
}

export interface PostBumpContentPlan {
  /** Chỉ số câu của từng lượt up, theo đúng thứ tự lượt. */
  indexes: number[]
  /** Con trỏ cho bài kế tiếp. */
  nextCursor: number
}

/**
 * Lượt thứ i của một bài lấy câu (con trỏ + i). Số lượt không vượt quá số câu thì mọi lượt trên cùng bài khác câu,
 * kể cả khi lượt chia cho nhiều tài khoản; bài sau bắt đầu từ câu kế tiếp.
 */
export function planPostBumpContentIndexes(cursor: unknown, count: number): PostBumpContentPlan {
  const start = normalizePostBumpContentCursor(cursor)
  const safeCount = Number.isSafeInteger(count) && count > 0 ? count : 0
  const indexes = Array.from({ length: safeCount }, (_, i) => (start + i) % POST_BUMP_CONTENT_CURSOR_LIMIT)
  return { indexes, nextCursor: (start + safeCount) % POST_BUMP_CONTENT_CURSOR_LIMIT }
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
