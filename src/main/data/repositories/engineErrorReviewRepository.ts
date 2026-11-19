import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import { EngineErrorReviewError, type EngineErrorReviewAction } from '../../../shared/engineErrorReview'

const client = () => getSupabaseClient()
// Hàm DB đặt trần 8 giây; chừa thêm cho đường mạng.
const ENGINE_ERROR_REVIEW_TIMEOUT_MS = 12_000

/**
 * `aka_agent_engine_error_review(p_action, p_payload)` (V588): sổ ca lỗi của bộ kiểm lỗi chiến dịch Facebook, chỉ admin akaBiz.
 * Hàm DB tự kiểm quyền theo phiên Desktop; chỗ này chặn sớm để tài khoản thường không sinh request.
 * Trả nguyên dữ liệu hàm trả (bên gọi đọc bằng bộ đọc ở `shared/engineErrorReview.ts`). DB chưa có hàm → `not_ready`.
 */
export async function callEngineErrorReview(action: EngineErrorReviewAction, payload: Record<string, unknown>): Promise<unknown> {
  const user = requireCurrentUser()
  if (!user.isAdminAkabiz) throw new EngineErrorReviewError('forbidden')
  let result: { data: unknown; error: { code?: string } | null }
  try {
    result = await client()
      .rpc('aka_agent_engine_error_review', { p_action: action, p_payload: payload })
      .abortSignal(AbortSignal.timeout(ENGINE_ERROR_REVIEW_TIMEOUT_MS))
  } catch {
    throw new EngineErrorReviewError('unavailable')
  }
  if (result.error) {
    if (result.error.code === 'PGRST202') throw new EngineErrorReviewError('not_ready')
    console.warn('[EngineErrorReview] Không gọi được hàm duyệt lỗi:', result.error.code || 'unknown')
    throw new EngineErrorReviewError('unavailable')
  }
  return result.data
}
