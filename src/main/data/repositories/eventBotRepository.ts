/**
 * Bot sự kiện (docs/EVENT_BOT_TECH.md mục 5): bốn RPC của nơi chạy.
 *   - App Desktop: bản theo phiên `aka_agent_desktop_event_bot_*_v1` (nhân viên lấy từ phiên, chỉ tài khoản Zalo QR / trình duyệt của
 *     chính nhân viên).
 *   - App Server: bản `service_role` `aka_agent_event_bot_*_v1(p_source = 'server', …)` (chỉ tài khoản Zalo Server không đi Fly).
 * Mọi hàm trả nguyên `data` (jsonb `{ok, …}`) hoặc ném lỗi PostgREST; bộ chạy tự đọc / xếp lỗi. Không đọc bảng nào trực tiếp.
 */
import { getSupabaseClient } from '../supabaseClient'
import type { EventBotSendResult } from '../../../shared/eventBot'

export type EventBotSource = 'desktop' | 'server'

export const EVENT_BOT_RPC = {
  desktop: {
    sync: 'aka_agent_desktop_event_bot_sync_v1',
    birthdays: 'aka_agent_desktop_event_bot_birthdays_v1',
    claim: 'aka_agent_desktop_event_bot_claim_v1',
    report: 'aka_agent_desktop_event_bot_report_v1'
  },
  server: {
    sync: 'aka_agent_event_bot_sync_v1',
    birthdays: 'aka_agent_event_bot_birthdays_v1',
    claim: 'aka_agent_event_bot_claim_v1',
    report: 'aka_agent_event_bot_report_v1'
  }
} as const

const SYNC_TIMEOUT_MS = 10_000
const BIRTHDAYS_TIMEOUT_MS = 20_000
const CLAIM_TIMEOUT_MS = 15_000
const REPORT_TIMEOUT_MS = 15_000

async function call(name: string, args: Record<string, unknown> | undefined, timeoutMs: number): Promise<unknown> {
  const request = args ? getSupabaseClient().rpc(name, args) : getSupabaseClient().rpc(name)
  const { data, error } = await request.abortSignal(AbortSignal.timeout(timeoutMs))
  if (error) throw error
  return data
}

export interface EventBotRepository {
  sync(accountIds: number[]): Promise<unknown>
  birthdays(accountId: number, people: Array<{ uid: string; name: string }>): Promise<unknown>
  claim(runnerId: string, accountIds: number[], limit: number): Promise<unknown>
  report(jobId: number, claimToken: string, result: EventBotSendResult): Promise<unknown>
}

export function createEventBotRepository(source: EventBotSource): EventBotRepository {
  if (source === 'desktop') {
    const rpc = EVENT_BOT_RPC.desktop
    return {
      sync: () => call(rpc.sync, undefined, SYNC_TIMEOUT_MS),
      birthdays: (accountId, people) => call(rpc.birthdays, { p_account_id: accountId, p_people: people }, BIRTHDAYS_TIMEOUT_MS),
      claim: (runnerId, accountIds, limit) =>
        call(rpc.claim, { p_runner_id: runnerId, p_account_ids: accountIds, p_limit: limit }, CLAIM_TIMEOUT_MS),
      report: (jobId, claimToken, result) =>
        call(rpc.report, { p_job_id: jobId, p_claim_token: claimToken, p_result: result }, REPORT_TIMEOUT_MS)
    }
  }
  const rpc = EVENT_BOT_RPC.server
  return {
    sync: accountIds => call(rpc.sync, { p_source: 'server', p_account_ids: accountIds }, SYNC_TIMEOUT_MS),
    birthdays: (accountId, people) =>
      call(rpc.birthdays, { p_source: 'server', p_account_id: accountId, p_people: people }, BIRTHDAYS_TIMEOUT_MS),
    claim: (runnerId, accountIds, limit) =>
      call(rpc.claim, { p_source: 'server', p_runner_id: runnerId, p_account_ids: accountIds, p_limit: limit }, CLAIM_TIMEOUT_MS),
    report: (jobId, claimToken, result) =>
      call(rpc.report, { p_source: 'server', p_job_id: jobId, p_claim_token: claimToken, p_result: result }, REPORT_TIMEOUT_MS)
  }
}

/** DB chưa có hàm (chưa apply V672): bộ chạy tắt im lặng. */
export function isEventBotRpcMissing(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null
  const code = String(value?.code ?? '')
  return code === 'PGRST202' || code === '42883' || /Could not find the function/i.test(String(value?.message ?? ''))
}
