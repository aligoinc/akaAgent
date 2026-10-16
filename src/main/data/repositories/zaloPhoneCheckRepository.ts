import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import type { ZaloPhoneCheckUsage } from '../../../shared/zaloPhoneCheck'

/** Read the public upload limit without an account, claim or usage reservation. */
export async function getZaloPhoneCheckDailyLimit(signal: AbortSignal): Promise<number> {
  signal.throwIfAborted()
  requireCurrentUser()
  const { data, error } = await getSupabaseClient().from('auto_system_settings')
    .select('value').eq('key', 'zalo.phone_check.daily_limit').eq('is_active', true).eq('is_secret', false)
    .abortSignal(signal).maybeSingle()
  signal.throwIfAborted()
  if (error) throw new Error('Không tải được giới hạn kiểm tra SĐT. Vui lòng thử lại.')
  // Match the existing daily-usage RPC's default and integer range.
  const value = String(data?.value ?? '')
  return /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647 ? Number(value) : 600
}

/** One request, never retried: a lost response may already have consumed a slot. */
export async function getZaloPhoneCheckUsage(accountId: number, runtimeTarget: 'desktop' | 'server',
  claimToken: string | null, consume: boolean, serverClaim: boolean, signal: AbortSignal): Promise<ZaloPhoneCheckUsage> {
  signal.throwIfAborted()
  const user = requireCurrentUser()
  const credentials = serverClaim ? null : requireCurrentUserCredentials()
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || (consume && !claimToken)
    || (serverClaim && (runtimeTarget !== 'server' || !claimToken))) throw new Error('Thông tin lượt kiểm tra SĐT không hợp lệ.')
  const { data, error } = await getSupabaseClient().rpc('aka_agent_zalo_phone_check_usage', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId, p_account_id: accountId,
    p_runtime_target: runtimeTarget, p_claim_token: claimToken, p_consume: consume,
    p_auth_username: credentials?.username ?? null, p_auth_password: credentials?.password ?? null
  }).abortSignal(signal)
  signal.throwIfAborted()
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Database chưa hỗ trợ giới hạn kiểm tra SĐT. Vui lòng cập nhật backend.')
    // Do not leak database/credential details or retry an uncertain increment.
    throw new Error('Không xác nhận được hạn mức kiểm tra SĐT. Đã dừng và chưa gửi tra cứu tiếp theo; lượt vừa xin có thể đã được tính. Vui lòng thử lại sau.')
  }
  const value = data as ZaloPhoneCheckUsage | null
  if (!value || typeof value.allowed !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || !Number.isSafeInteger(value.count) || value.count < 0 || !Number.isSafeInteger(value.limit) || value.limit < 1
    || !Number.isSafeInteger(value.remaining) || value.remaining !== Math.max(0, value.limit-value.count)
    || (value.allowed && (consume ? value.count < 1 || value.count > value.limit : value.count >= value.limit))
    || (!value.allowed && value.remaining !== 0)
    || typeof value.resetAt !== 'string' || !Number.isFinite(Date.parse(value.resetAt))) {
    throw new Error('Hạn mức kiểm tra SĐT trả về không hợp lệ. Đã dừng; lượt vừa xin có thể đã được tính.')
  }
  return value
}
