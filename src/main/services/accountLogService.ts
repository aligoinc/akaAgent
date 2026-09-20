import { createAccountLogRecorder, type AccountLogEvent } from '../../shared/accountLog'
import { getSupabaseClient } from '../data/supabaseClient'

type Snapshot = { id: number; loginStatus?: string | null; status?: string | null; flatformType?: string }
type CampaignSnapshot = { id: number; accountId: number; name?: string; status: string; note?: string | null }
const accounts = new Map<number, Snapshot>()
const campaigns = new Map<number, CampaignSnapshot>()
const activeCampaigns = new Map<number, number>()
// Only repeated account-check observations are deduplicated here. Discrete
// warnings (QR attempts, API/listener events) must not share this baseline.
const polledWarnings = new Map<number, string>()
let source = 'desktop'

// Source describes the emitting process, never inferred from the account subtype.
export function setAccountLogSource(value: string): void { source = value }

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.size >= 5_000 && !map.has(key)) map.delete(map.keys().next().value as K)
  map.set(key, value)
}

const send = createAccountLogRecorder((row, signal) =>
  getSupabaseClient().from('auto_account_logs').insert(row).abortSignal(signal)
)

export function recordAccountLog(event: Omit<AccountLogEvent, 'source'> & { source?: string }): void {
  try {
    const accountId = Number(event.accountId)
    let snapshot = accounts.get(accountId)
    if (event.loginStatus !== undefined || event.accountStatus !== undefined) {
      snapshot = { id: accountId,
        loginStatus: event.loginStatus === undefined ? snapshot?.loginStatus : event.loginStatus,
        status: event.accountStatus === undefined ? snapshot?.status : event.accountStatus }
      remember(accounts, accountId, snapshot)
    }
    const campaignId = event.campaignId === undefined ? activeCampaigns.get(accountId) : event.campaignId
    send({
      ...event, source: event.source ?? source,
      loginStatus: event.loginStatus === undefined ? snapshot?.loginStatus : event.loginStatus,
      accountStatus: event.accountStatus === undefined ? snapshot?.status : event.accountStatus,
      campaignId,
      details: { campaign_name: campaignId == null ? undefined : campaigns.get(Number(campaignId))?.name, ...event.details }
    })
  } catch { /* best effort, including context capture */ }
}

export function rememberAccountLogSnapshot<T extends Snapshot>(account: T): T {
  try {
    remember(accounts, account.id, { id: account.id, loginStatus: account.loginStatus, status: account.status })
  } catch {}
  return account
}

export function recordAccountState<T extends Snapshot>(account: T, previous?: Snapshot, reason?: string | null): T {
  try {
    const old = previous ?? accounts.get(account.id)
    const snapshot = { id: account.id, loginStatus: account.loginStatus ?? old?.loginStatus, status: account.status ?? old?.status }
    remember(accounts, account.id, snapshot)
    if (account.loginStatus !== undefined && account.loginStatus !== old?.loginStatus) {
      recordAccountLog({ accountId: account.id, loginStatus: account.loginStatus, accountStatus: account.status,
        eventType: account.loginStatus === 'đã đăng nhập' ? 'login' : account.loginStatus === 'chưa đăng nhập' ? 'logout' : 'login_status_changed',
        message: `Trạng thái đăng nhập: ${old?.loginStatus ?? '?'} → ${account.loginStatus ?? '?'}`,
        details: { previous_login_status: old?.loginStatus, reason } })
    }
    if (account.status !== undefined && account.status !== old?.status) {
      recordAccountLog({ accountId: account.id, loginStatus: account.loginStatus, accountStatus: account.status,
        eventType: 'status_changed', message: `Trạng thái tài khoản: ${old?.status ?? '?'} → ${account.status ?? '?'}`,
        details: { previous_account_status: old?.status, reason } })
    }
    if (reason) {
      const eventType = account.flatformType === 'zalo' ? 'zalo_warning' : 'session_error'
      const signature = `${eventType}:${reason}`
      if (polledWarnings.get(account.id) !== signature) {
        remember(polledWarnings, account.id, signature)
        recordAccountWarning(account.id, reason, undefined, eventType)
      }
    } else polledWarnings.delete(account.id)
  } catch {}
  return account
}

export function recordAccountWarning(accountId: number, message: string, details?: Record<string, unknown>, eventType = 'zalo_warning'): void {
  try {
    recordAccountLog({ accountId, eventType, message, details })
  } catch {}
}

export function recordCampaignState(campaign: CampaignSnapshot, account?: Snapshot): void {
  try {
    if (!Number.isSafeInteger(campaign.accountId)) return
    const previous = campaigns.get(campaign.id)
    if (previous && previous.accountId !== campaign.accountId) clearAccountCampaignLogContext(previous.accountId, campaign.id)
    remember(campaigns, campaign.id, { id: campaign.id, accountId: campaign.accountId, name: campaign.name ?? previous?.name, status: campaign.status })
    if (campaign.status === 'đang chạy') remember(activeCampaigns, campaign.accountId, campaign.id)
    if (previous?.status !== campaign.status) {
      recordAccountLog({ accountId: campaign.accountId, campaignId: campaign.id,
        loginStatus: account?.loginStatus ?? null, accountStatus: account?.status ?? null,
        eventType: 'campaign', message: `Chiến dịch ${campaign.name ?? campaign.id}: ${previous?.status ?? '?'} → ${campaign.status}`,
        details: { campaign_name: campaign.name, campaign_status: campaign.status, previous_campaign_status: previous?.status } })
    }
    // A DB-first pause may still be draining its current target. The scheduler
    // clears context only after the runtime has actually unwound.
  } catch {}
}

export function clearAccountCampaignLogContext(accountId: number, campaignId: number): void {
  if (activeCampaigns.get(accountId) === campaignId) activeCampaigns.delete(accountId)
}

export function rememberCampaignLogSnapshot<T extends CampaignSnapshot>(campaign: T): T {
  try {
    const previous = campaigns.get(campaign.id)
    if (previous && previous.accountId !== campaign.accountId) clearAccountCampaignLogContext(previous.accountId, campaign.id)
    remember(campaigns, campaign.id, {
      id: campaign.id, accountId: campaign.accountId, name: campaign.name ?? previous?.name,
      // Reads refresh identity, but must not consume a transition before its
      // post-write broadcast reaches recordCampaignState.
      status: previous?.accountId === campaign.accountId ? previous.status : campaign.status
    })
  } catch {}
  return campaign
}

export function recordKnownCampaignLog(campaignId: number, eventType: string, message: string, accountStatus?: string | null): void {
  try {
    const campaign = campaigns.get(campaignId)
    if (campaign) recordAccountLog({ accountId: campaign.accountId, campaignId, eventType, message, accountStatus })
  } catch {}
}

/** Aggregate recovery RPCs return counts, not changed IDs. Observe scoped state
 * afterwards in an independent diagnostic request; never claim a specific row
 * was reset or reconstruct a before-image from this post-recovery read. */
export function recordRecoverySnapshots(staffId: number, target: 'server' | 'desktop', excludeZalo = false): void {
  const observedSource = source
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    timer = setTimeout(() => controller.abort(), 5_000)
    timer.unref?.()
    let query = getSupabaseClient().from('auto_accounts').select('id,login_status,status')
      .eq('staff_id', staffId).eq('is_delete', false).neq('flatform_type', 'sms')
    if (target === 'server') query = query.eq('flatform_type', 'zalo').eq('is_zalo_server', true)
    else query = excludeZalo ? query.neq('flatform_type', 'zalo') : query.eq('is_zalo_server', false)
    void Promise.resolve(query.limit(1_000).abortSignal(controller.signal)).then(({ data, error }) => {
      if (error || controller.signal.aborted) return
      for (const row of data ?? []) recordAccountLog({
        accountId: row.id, campaignId: null, loginStatus: row.login_status, accountStatus: row.status,
        source: observedSource, eventType: 'runtime_recovery_observed',
        message: 'Ghi nhận trạng thái tài khoản sau vòng phục hồi runtime.'
      })
    }).catch(() => {}).finally(() => { if (timer) clearTimeout(timer) })
  } catch { if (timer) clearTimeout(timer) }
}
