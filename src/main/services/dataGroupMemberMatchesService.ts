import {
  DATA_GROUP_MATCHES_MAX_VALUE_LENGTH, validateDataGroupMemberMatchesRequest,
  type DataGroupMemberMatchesRequest, type DataGroupMemberMatchesResult
} from '../../shared/dataGroupMemberMatches'
import type {
  DataGroupMemberMatchesIpcRequest, DataGroupMemberMatchesIpcResponses, DataGroupMemberMatchesIpcResult
} from '../../shared/dataGroupMemberMatchesIpc'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import * as repo from '../data/repositories/dataGroupMemberMatchesRepository'
import { DataGroupMatchesReadError, SESSION_INVALID } from '../data/repositories/dataGroupMemberMatchesRepository'

/**
 * Cửa sổ "Thêm data từ file" của Nhóm data → "Bỏ data đã có trong nhóm này / ở nhóm data khác" (V519 + V522). Chỉ
 * chạy khi khách bấm "Kiểm tra dữ liệu" hoặc "Thêm vào nhóm": mỗi lượt đọc lại công tắc (một dòng) rồi một lượt RPC chỉ
 * đọc ≤ 2.000 định danh (giới hạn RPC; renderer gửi lượt 1.000) qua client HTTP sẵn có của tiến trình. DB đặt trần 15 s
 * cho hàm; hạn cả lượt ở đây 20 s. Tối đa 2 lượt cùng lúc mỗi tiến trình (renderer gửi tuần tự từng lượt), quá thì báo
 * bận, không xếp hàng. Không cache, không hẹn giờ, không client/kết nối mới.
 */
export const DATA_GROUP_MATCHES_DEADLINE_MS = 20_000
export const DATA_GROUP_MATCHES_MAX_FLIGHTS = 2
export const DATA_GROUP_MATCHES_BUSY = 'Hệ thống đang đối chiếu nhiều danh sách. Vui lòng thử lại sau ít giây.'

let flights = 0

const invalid = () => new DataGroupMatchesReadError('invalid_data_group_matches_request', repo.DATA_GROUP_MATCHES_INVALID)

/** Mở cửa sổ: công tắc đọc lỗi thì coi như tắt (cửa sổ nhập như trước V522, không chặn việc thêm data). */
async function readSetting(): Promise<{ enabled: boolean }> {
  try {
    return { enabled: await repo.readDataGroupMemberMatchesEnabled(AbortSignal.timeout(DATA_GROUP_MATCHES_DEADLINE_MS)) }
  } catch (error) {
    if (error instanceof DataGroupMatchesReadError) return { enabled: false }
    throw error
  }
}

async function check(groupId: unknown, body: unknown): Promise<DataGroupMemberMatchesResult> {
  requireCurrentUser()
  // Công tắc đọc lại mỗi lượt (không cache): `groupMatches: false` có hiệu lực ngay như API Web. Đọc lỗi thì báo lỗi
  // để khách thử lại hoặc chọn thêm không đối chiếu, không âm thầm bỏ bước đối chiếu.
  const enabled = await repo.readDataGroupMemberMatchesEnabled(AbortSignal.timeout(DATA_GROUP_MATCHES_DEADLINE_MS))
  if (!enabled) throw new DataGroupMatchesReadError('data_group_matches_disabled', repo.DATA_GROUP_MATCHES_DISABLED)
  if (typeof groupId !== 'number' || !Number.isSafeInteger(groupId) || groupId <= 0) throw invalid()
  let request: DataGroupMemberMatchesRequest
  try {
    request = validateDataGroupMemberMatchesRequest(body)
  } catch {
    throw invalid()
  }
  // Định danh rỗng hoặc quá dài không thể là data đã có: thay bằng chuỗi rỗng để giữ vị trí (hàm DB bỏ qua chuỗi rỗng).
  const values = request.values.map(value => value.length > DATA_GROUP_MATCHES_MAX_VALUE_LENGTH ? '' : value)
  if (values.length === 0 || values.every(value => !value.trim())) {
    return { checkedAt: new Date().toISOString(), valueCount: values.length, items: [] }
  }
  if (flights >= DATA_GROUP_MATCHES_MAX_FLIGHTS) throw new DataGroupMatchesReadError('data_group_matches_busy', DATA_GROUP_MATCHES_BUSY)
  flights++
  try {
    return await repo.readDataGroupMemberMatchesRpc(groupId, { ...request, values }, AbortSignal.timeout(DATA_GROUP_MATCHES_DEADLINE_MS))
  } finally {
    flights--
  }
}

export async function handleDataGroupMemberMatchesRequest<R extends DataGroupMemberMatchesIpcRequest>(request: R):
  Promise<DataGroupMemberMatchesIpcResult<DataGroupMemberMatchesIpcResponses[R['kind']]>> {
  type Data = DataGroupMemberMatchesIpcResponses[R['kind']]
  try {
    const user = requireCurrentUser()
    if (request?.kind === 'setting') return { ok: true, data: await runWithCurrentUser(user, readSetting) as Data }
    if (request?.kind === 'check') {
      return { ok: true, data: await runWithCurrentUser(user, () => check(request.groupId, request.request)) as Data }
    }
    return { ok: false, code: 'invalid_data_group_matches_request', message: repo.DATA_GROUP_MATCHES_INVALID }
  } catch (error) {
    if (error instanceof DataGroupMatchesReadError) return { ok: false, code: error.code, message: error.message }
    const message = error instanceof Error ? error.message : String(error)
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) return { ok: false, code: 'session_invalid', message: SESSION_INVALID }
    console.warn('[dataGroupMemberMatches] request failed:', message)
    return { ok: false, code: 'data_group_matches_unavailable', message: repo.DATA_GROUP_MATCHES_UNAVAILABLE }
  }
}
