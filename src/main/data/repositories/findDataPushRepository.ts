import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import {
  FIND_DATA_PUSH_RPC,
  parseFindDataPushResponse,
  type FindDataPushRequest,
  type FindDataPushResponse
} from '../../../shared/findDataPush'

const client = () => getSupabaseClient()
const FIND_DATA_PUSH_TIMEOUT_MS = 30_000
/** DB chưa có V608: nhớ trong 10 phút rồi hỏi lại (apply V608 thì app đang chạy tự chuyển sang đường mới). */
const NOT_INSTALLED_RECHECK_MS = 10 * 60_000

let notInstalledUntil = 0

export class FindDataPushError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'FindDataPushError'
  }
}

const isMissingFunction = (error: { code?: string | null; message?: string | null }): boolean =>
  error.code === 'PGRST202' || error.code === '42883' ||
  /could not find the function|schema cache/i.test(String(error.message || ''))

/**
 * `aka_agent_find_data_push_v1` (V608). Trả null khi DB chưa có hàm (bên gọi dùng cách đẩy cũ); lỗi khác ném FindDataPushError
 * (không gửi lại: một lượt đẩy có thể đã ghi xong mà mất câu trả lời; lần gọi sau với cùng data chỉ ra "đã có").
 */
export async function pushFindDataToLinkedCampaigns(request: FindDataPushRequest): Promise<FindDataPushResponse | null> {
  requireCurrentUser()
  if (Date.now() < notInstalledUntil) return null
  const { data, error } = await client()
    .rpc(FIND_DATA_PUSH_RPC, { p_payload: request })
    .abortSignal(AbortSignal.timeout(FIND_DATA_PUSH_TIMEOUT_MS))
  if (error) {
    if (isMissingFunction(error)) {
      notInstalledUntil = Date.now() + NOT_INSTALLED_RECHECK_MS
      return null
    }
    throw new FindDataPushError(error.message || 'Không đẩy được data sang chiến dịch đích', error.code || null)
  }
  const parsed = parseFindDataPushResponse(data)
  if (!parsed) throw new FindDataPushError('Kết quả đẩy data không hợp lệ', 'invalid_response')
  notInstalledUntil = 0
  return parsed
}

/** Chỉ cho bài kiểm thử. */
export function resetFindDataPushAvailabilityForTest(): void {
  notInstalledUntil = 0
}
