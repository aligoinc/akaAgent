import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import { parseCampaignRepeatState, type CampaignRepeatState, type CampaignRepeatUnit } from '../../../shared/campaignRepeat'

/**
 * RPC của "Lặp lại sau khi chạy xong" (V556, docs/CAMPAIGN_REPEAT_V556.md). DB chưa có V556 (PostgREST PGRST202 / Postgres
 * 42883) được coi là "chưa có tính năng": bộ chạy hoàn thành chiến dịch như thường, form lưu như cũ.
 */
const client = () => getSupabaseClient()

const isMissing = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function/i.test(String(error?.message ?? ''))

const campaignIdOf = (value: unknown): number => {
  const id = Math.floor(Number(value))
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Campaign ID must be a positive integer for campaign repeat')
  return id
}

/** Quyết định của DB sau một lượt chạy hết danh sách (`aka_agent_campaign_repeat_decide_v1`). */
export interface CampaignRepeatDecision {
  ok: boolean
  /** Khi `ok = false`: `not_found` | `not_running`. */
  reason?: string
  /** Chiến dịch có cài đặt lặp hợp lệ. */
  enabled?: boolean
  /** true: đặt lại data và hẹn lịch tới `next`; false: hoàn thành chiến dịch. */
  repeat?: boolean
  /** Lượt vừa chạy xong (tính cả lượt đầu) và số lượt tối đa. */
  run?: number
  maxRuns?: number
  every?: number
  unit?: CampaignRepeatUnit
  /** Giờ lượt kế tiếp (ISO) khi `repeat = true`. */
  next?: string
}

/**
 * Bộ chạy gọi khi một lượt vừa chạy hết danh sách và chiến dịch còn "đang chạy": DB đếm lượt rồi trả quyết định.
 * Trả null khi DB chưa có V556. Lỗi khác thì ném ra để nơi gọi quyết định (không tự coi là "không lặp").
 */
export async function decideCampaignRepeat(campaignId: number): Promise<CampaignRepeatDecision | null> {
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_campaign_repeat_decide_v1', {
    p_staff_id: u.staffId,
    p_campaign_id: campaignIdOf(campaignId)
  })
  if (error) {
    if (isMissing(error)) return null
    throw new Error(`Failed to decide campaign repeat: ${error.message}`)
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data as CampaignRepeatDecision : { ok: false, reason: 'invalid_response' }
}

/**
 * Gọi sau khi form lưu chiến dịch: đăng ký (hoặc gỡ) lặp theo cài đặt vừa lưu. Bộ quét dự phòng chỉ xét chiến dịch đã đăng ký.
 * Trả false khi DB chưa có V556.
 */
export async function syncCampaignRepeat(campaignId: number): Promise<boolean> {
  const u = requireCurrentUser()
  const { error } = await client().rpc('aka_agent_campaign_repeat_sync_v1', {
    p_staff_id: u.staffId,
    p_campaign_id: campaignIdOf(campaignId)
  })
  if (!error) return true
  if (isMissing(error)) return false
  throw new Error(`Failed to sync campaign repeat: ${error.message}`)
}

/** Bộ đếm lượt của các chiến dịch (≤ 200) của nhân viên đang đăng nhập. DB chưa có V556 thì trả mảng rỗng. */
export async function getCampaignRepeatStates(campaignIds: readonly number[]): Promise<CampaignRepeatState[]> {
  const ids = Array.from(new Set(campaignIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))).slice(0, 200)
  if (ids.length === 0) return []
  const u = requireCurrentUser()
  const { data, error } = await client().rpc('aka_agent_campaign_repeat_state_v1', { p_staff_id: u.staffId, p_campaign_ids: ids })
  if (error) {
    if (isMissing(error)) return []
    throw new Error(`Failed to read campaign repeat state: ${error.message}`)
  }
  return (Array.isArray(data) ? data : []).map(parseCampaignRepeatState).filter((row): row is CampaignRepeatState => row !== null)
}
