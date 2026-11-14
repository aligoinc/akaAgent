import type {
  CampaignResultActions, CampaignResultRecipient, CampaignResultRecipientKeys, CampaignResultRecipientPage, CampaignResultRecipientSort
} from './campaignResultActions'
import type { EngagementFilter } from './zaloCampaignEngagement'

/**
 * Bộ lọc "Hành động" và "Gộp hành động vào một dòng" ở tab Kết quả chạy (Desktop): một kênh IPC, không bao giờ ném lỗi
 * qua IPC. Main gọi hàm chỉ đọc V539 `aka_agent_read_campaign_result_recipients` (cấp cho token Desktop ở V540) bằng
 * token Desktop và mật khẩu tự động hóa; luật hiển thị và Excel dùng chung với WebApp ở `campaignResultActions.ts`.
 * Lọc một hành động không qua kênh này: đó là `listCampaignDetailsPage({ actionCode })` (hàm v3, cũng V539/V540).
 */
export const CAMPAIGN_RESULT_ACTIONS_IPC = 'campaign:result-actions' as const

/**
 * Bộ lọc của chế độ gộp, giống các bộ lọc của tab Kết quả chạy trên Desktop. Khác WebApp: ngày là mốc ISO đầy đủ (renderer
 * đã tính đầu/cuối ngày theo giờ máy như danh sách "Tất cả"), không phải yyyy-mm-dd.
 */
export interface CampaignResultRecipientIpcQuery {
  search?: string
  status?: string
  dateFrom?: string | null
  dateTo?: string | null
  engagementFilter?: EngagementFilter
  sort?: CampaignResultRecipientSort
}

export type CampaignResultActionsIpcRequest =
  | { kind: 'actions'; campaignId: number }
  | { kind: 'page'; campaignId: number; query: CampaignResultRecipientIpcQuery; page: number; pageSize?: number }
  | { kind: 'keys'; campaignId: number; query: CampaignResultRecipientIpcQuery }
  | { kind: 'byKeys'; campaignId: number; ids: number[] }

export interface CampaignResultActionsIpcResponses {
  actions: CampaignResultActions
  page: CampaignResultRecipientPage
  keys: CampaignResultRecipientKeys
  byKeys: { items: CampaignResultRecipient[] }
}

/**
 * Mã lỗi ổn định: `campaign_result_actions_not_ready` (DB chưa có hàm hoặc token Desktop chưa được cấp quyền: chỉ còn
 * "Tất cả"), `campaign_result_recipients_busy`, `campaign_result_recipients_timeout`, `invalid_campaign_result_query`,
 * `campaign_not_found`, `report_access_denied`, `session_invalid`, `campaign_result_recipients_unavailable`.
 */
export type CampaignResultActionsIpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }
