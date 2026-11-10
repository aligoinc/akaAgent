import type { FacebookSearchGroupCard } from './facebookSearchGroupCard'

/**
 * Tab "Data tìm được" của chiến dịch Facebook - Tìm kiếm data bằng search: lúc bấm Xuất Excel, renderer xin main
 * đọc lại chữ gốc của thẻ nhóm trong log chạy (`auto_campaign_run_events`, event `extract_facebook_group_data`) để
 * file có đủ dữ liệu: số bài của tài khoản giao diện tiếng Anh, trạng thái tham gia, bạn bè trong nhóm…
 * Chỉ đọc. Một kênh IPC, không ném lỗi qua IPC. Hợp đồng: docs/FACEBOOK_SEARCH_GROUP_EXPORT_PLAN.md.
 */
export const FOUND_FACEBOOK_GROUP_CARDS_IPC = 'campaign:found-facebook-group-cards'

export interface FoundFacebookGroupCardsRequest {
  campaignId: number
}

export interface FoundFacebookGroupCardEntry {
  /** `facebookGroupUrlKey` của URL nhóm. */
  key: string
  /** Thời điểm thẻ mới nhất của nhóm (ISO). */
  seenAt: string
  /** Gộp các thẻ của nhóm, mỗi trường theo thẻ mới nhất có giá trị. */
  card: FacebookSearchGroupCard
}

export interface FoundFacebookGroupCardsData {
  cards: FoundFacebookGroupCardEntry[]
  /** Số dòng log đã đọc. */
  scannedRows: number
  /** Chưa đọc hết log (quá số dòng tối đa hoặc quá thời gian); phần đã đọc là phần mới nhất. */
  truncated: boolean
}

export type FoundFacebookGroupCardsResult =
  | { ok: true; data: FoundFacebookGroupCardsData }
  | { ok: false; code: string; message: string }
