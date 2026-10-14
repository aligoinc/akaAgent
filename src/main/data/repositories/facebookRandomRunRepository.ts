import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { ensureCurrentUserCanUseCampaignAction, ensureCurrentUserFeatureActive } from './entitlementRepository'
import { listCampaignActions } from './campaignActionRepository'
import { validateFacebookRandomConfig, type FacebookRandomConfig, type FacebookRandomSettings, type FacebookRandomDay, type FacebookRandomPlan, type FacebookRandomReadQuery, type FacebookRandomTurn } from '../../../shared/facebookRandomRun'

/** Runtime operations are intentionally absent from preload / renderer IPC. */
export async function randomRunRpc<T>(accountId: number, operation: string, input: Record<string, unknown> = {}): Promise<T> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Tài khoản không hợp lệ.')
  const user = requireCurrentUser()
  const auth = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_facebook_random_run', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: auth.username, p_auth_password: auth.password,
    p_account_id: accountId, p_operation: operation, p_input: input
  }).abortSignal(AbortSignal.timeout(30_000))
  if (error) {
    if (error.message.includes('random_config_conflict')) throw new Error('Cấu hình đã thay đổi trên máy khác. Hãy tải lại trước khi lưu.')
    throw new Error(`Không thể xử lý chạy ngẫu nhiên: ${error.message}`)
  }
  return data as T
}
export async function getRandomSettings(accountId: number): Promise<FacebookRandomSettings> {
  await ensureCurrentUserFeatureActive('facebookCore')
  return randomRunRpc(accountId, 'get')
}
export async function saveRandomSettings(accountId: number, value: unknown): Promise<FacebookRandomSettings> {
  const actions = await listCampaignActions()
  const config = validateFacebookRandomConfig(value, actions.filter(a => a.flatformType === 'facebook').map(a => a.id))
  for (const id of new Set(config.rules.map(r => r.campaignActionId))) await ensureCurrentUserCanUseCampaignAction(id)
  return randomRunRpc(accountId, 'save', { config })
}
export async function setRandomEnabled(accountId: number, enabled: boolean, revision: number): Promise<FacebookRandomSettings> {
  if (typeof enabled !== 'boolean' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Trạng thái không hợp lệ.')
  await ensureCurrentUserFeatureActive('facebookCore')
  return randomRunRpc(accountId, 'toggle', { enabled, revision })
}
export function readRandomDay(accountId: number, query: FacebookRandomReadQuery): Promise<FacebookRandomDay> {
  if (!query || !/^\d{4}-\d{2}-\d{2}$/.test(query.date) || !Number.isFinite(Date.parse(query.date))
    || new Date(query.date).toISOString().slice(0, 10) !== query.date
    || (query.campaignId != null && (!Number.isSafeInteger(query.campaignId) || query.campaignId <= 0))
    || !Number.isSafeInteger(query.page ?? 1) || (query.page ?? 1) < 1) throw new Error('Bộ lọc kế hoạch không hợp lệ.')
  return randomRunRpc(accountId, 'day', { ...query })
}
export function listRandomDates(accountId: number, before?: string): Promise<string[]> {
  if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('Ngày không hợp lệ.')
  return randomRunRpc(accountId, 'dates', { before })
}
export function planRandomRound(accountId: number, config: FacebookRandomConfig, choices: Array<{ ruleIndex: number; campaignId: number }>): Promise<FacebookRandomPlan> {
  return randomRunRpc(accountId, 'plan', { revision: config.revision, choices })
}
export function finishRandomTurn(accountId: number, turn: FacebookRandomTurn, reason?: string): Promise<FacebookRandomTurn> {
  return randomRunRpc(accountId, 'finish', { turnId: turn.id, claimToken: turn.claimToken ?? null, reason: reason ?? null })
}
