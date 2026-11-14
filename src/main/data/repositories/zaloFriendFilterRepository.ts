import { DATA_GROUP_AGENT_SETTING_KEY, parseDataGroupAgentAudience, parseDataGroupAgentCampaignForm } from '../../../shared/dataGroupAgent'
import type { DataGroupAgentSetting } from '../../../shared/dataGroupAgentIpc'
import type { ZaloFriendRecipient } from '../../../shared/zaloFriendFilter'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

/**
 * Lớp gọi DB của Agent lọc bạn bè Zalo trên Desktop (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md). Mọi lượt đi qua client HTTP
 * sẵn có của tiến trình bằng token Desktop; hàm DB (V533–V538) xác thực bằng token + mật khẩu tự động hóa của nhân viên
 * (`auto_assert_automation_identity`), quyền EXECUTE của token Desktop cấp ở V539. Không client/pool/kết nối mới.
 */
const client = () => getSupabaseClient()

export interface FriendRpcError { code?: string; message?: string; details?: string | null; hint?: string | null }

/** Lỗi trả nguyên mã PostgREST/Postgres để service đổi thành mã IPC. `transport`: lỗi đường truyền hoặc bị hủy. */
export class FriendRpcFailure extends Error {
  constructor(readonly error: FriendRpcError, readonly transport = false) {
    super(String(error.message || 'friend_rpc_failed'))
    this.name = 'FriendRpcFailure'
  }
}

/** Công tắc `web.data_group_agent` (một dòng không bí mật, chung với Web). Thiếu dòng/sai = tắt. Đọc lỗi thì ném. */
export async function readDataGroupAgentSetting(signal: AbortSignal): Promise<DataGroupAgentSetting> {
  requireCurrentUser()
  const { data, error } = await client().from('auto_system_settings').select('value')
    .eq('key', DATA_GROUP_AGENT_SETTING_KEY).eq('is_active', true).eq('is_secret', false)
    .abortSignal(signal).maybeSingle()
  if (error) throw new FriendRpcFailure({ code: error.code, message: error.message }, !error.code)
  return { audience: parseDataGroupAgentAudience(data?.value), campaignForm: parseDataGroupAgentCampaignForm(data?.value) }
}

/** Một lượt RPC của nhóm hàm lọc bạn bè, danh tính lấy từ phiên Desktop (không nhận từ renderer). */
export async function callFriendRpc(name: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  let response
  try {
    response = await client().rpc(name, {
      p_staff_id: user.staffId, p_organization_id: user.organizationId,
      p_auth_username: credentials.username, p_auth_password: credentials.password, ...params
    }).abortSignal(signal)
  } catch (error) {
    throw new FriendRpcFailure({ message: error instanceof Error ? error.message : String(error) }, true)
  }
  if (response.error) throw new FriendRpcFailure(response.error as FriendRpcError, !response.error.code)
  return response.data
}

/**
 * "Agent chọn bạn bè": UID và tên theo khóa chính, kèm điều kiện tài khoản, nhân viên, tổ chức, còn là bạn bè (như API Web).
 * Người đã hủy kết bạn hay bị xóa giữa hai bước thì không có trong kết quả.
 */
export async function readFriendRecipientBatch(accountId: number, ids: number[], signal: AbortSignal): Promise<ZaloFriendRecipient[]> {
  const user = requireCurrentUser()
  let response
  try {
    response = await client().from('auto_account_contacts').select('id,uid,name')
      .in('id', ids).eq('account_id', accountId).eq('staff_id', user.staffId).eq('organization_id', user.organizationId)
      .eq('contact_type', 'person').eq('is_friend', true).not('is_delete', 'is', true)
      .abortSignal(signal)
  } catch (error) {
    throw new FriendRpcFailure({ message: error instanceof Error ? error.message : String(error) }, true)
  }
  if (response.error) throw new FriendRpcFailure(response.error as FriendRpcError, !response.error.code)
  return ((response.data ?? []) as Record<string, unknown>[]).flatMap(row => {
    const contactId = typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0 ? row.id : null
    const uid = typeof row.uid === 'string' ? row.uid.trim() : ''
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, 255) : ''
    return contactId !== null && uid ? [{ contactId, uid, name: name || null }] : []
  })
}
