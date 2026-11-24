// Ô "Ý nghĩa bài viết / comment là (dùng AI)" của Comment seeding, Tìm data trong group, Tìm data bằng search (docs/FB_AI_FILTER_PLAN.md mục 2.1,
// phương án chốt 24/11/2026). Không thêm ô mới: chỉ chữ mờ ví dụ, dòng dặn cách viết và báo lỗi khi tích AI mà để trống (block lọc bỏ qua AI
// khi ô trống nên khách tưởng đang lọc mà thật ra không).

export type CampaignAiFilterKind = 'post' | 'comment'

export const CAMPAIGN_AI_FILTER_PLACEHOLDER: Record<CampaignAiFilterKind, string> = {
  post: 'Ví dụ: Người đăng đang cần thuê phòng trọ ở Hà Nội cho chính mình. Loại bỏ: bài cho thuê của chủ nhà hoặc môi giới.',
  comment: 'Ví dụ: Người comment đang hỏi giá hoặc xin tư vấn. Loại bỏ: comment quảng cáo, comment chỉ gắn tên bạn bè.'
}

export const CAMPAIGN_AI_FILTER_HINT: Record<CampaignAiFilterKind, string> = {
  post: 'Viết như đang dặn nhân viên. Muốn bỏ loại bài nào thì ghi “Loại bỏ: …”.',
  comment: 'Viết như đang dặn nhân viên. Muốn bỏ loại comment nào thì ghi “Loại bỏ: …”.'
}

export const CAMPAIGN_AI_FILTER_EMPTY_ERROR = 'Nhập mô tả cho AI hoặc bỏ tích ô này.'

export const CAMPAIGN_AI_FILTER_LABEL: Record<CampaignAiFilterKind, string> = {
  post: 'Ý nghĩa bài viết là (dùng AI)',
  comment: 'Ý nghĩa comment là (dùng AI)'
}

/** Ô AI đang tích mà chưa có chữ (chỉ khoảng trắng cũng tính là trống, như block lọc). */
export function isCampaignAiFilterEmpty(enabled: boolean | undefined, text: string | undefined | null): boolean {
  return enabled === true && String(text ?? '').trim().length === 0
}

export interface CampaignAiFilterSaveInput {
  /** Phần bài viết đang dùng (Comment seeding, hoặc Tìm data đang tìm ở bài / comment / link bài). */
  postApplies: boolean
  isFindPostByContentAI?: boolean
  postContentAI?: string | null
  /** Phần comment đang dùng (Tìm data đang tìm trong comment). */
  commentApplies: boolean
  isFindCommentByContentAI?: boolean
  commentContentAI?: string | null
}

/** Ô AI nào chặn lưu (null = được lưu). Ô của phần không dùng thì bỏ qua vì lúc lưu bị xoá. */
export function campaignAiFilterSaveError(input: CampaignAiFilterSaveInput): { kind: CampaignAiFilterKind; message: string } | null {
  if (input.postApplies && isCampaignAiFilterEmpty(input.isFindPostByContentAI, input.postContentAI)) {
    return { kind: 'post', message: `${CAMPAIGN_AI_FILTER_LABEL.post}: ${CAMPAIGN_AI_FILTER_EMPTY_ERROR}` }
  }
  if (input.commentApplies && isCampaignAiFilterEmpty(input.isFindCommentByContentAI, input.commentContentAI)) {
    return { kind: 'comment', message: `${CAMPAIGN_AI_FILTER_LABEL.comment}: ${CAMPAIGN_AI_FILTER_EMPTY_ERROR}` }
  }
  return null
}
