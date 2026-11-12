/**
 * Cổng dữ liệu của engine v2 trên Desktop: gọi các RPC V495 bằng Supabase client của phiên đăng nhập.
 * Mọi lời gọi nhận AbortSignal từ lõi (withDeadline), nên không lời gọi nào chờ mãi. Lỗi giữ mã PostgREST/SQLSTATE
 * và HTTP status để lõi phân biệt lỗi tạm thời (chờ rồi gửi bù) với lỗi cứng.
 */
import { getSupabaseClient } from '../data/supabaseClient'
import {
  MaterializeRpcError, SendExclusionRpcError, type BatchClaimResponse, type BatchReportResponse, type CallOptions, type ClaimContext, type ClaimResponse,
  type EngineDataPort, type FinishResponse, type HeartbeatResponse, type MarkResponse, type ReleaseResponse, type ReportOutcome,
  type ReportResponse
} from '../../../packages/campaign-engine/src/index'

function rpcError(name: string, error: { message?: string; code?: string } | null, status: number): Error {
  return Object.assign(new Error(`${name}: ${error?.message || 'RPC lỗi'}`), { code: error?.code || '', status })
}

async function call<T>(name: string, args: Record<string, unknown>, opts: CallOptions): Promise<T> {
  const { data, error, status } = await getSupabaseClient().rpc(name, args).abortSignal(opts.signal)
  if (error) throw rpcError(name, error, status)
  if (data === null || data === undefined) throw rpcError(name, { message: 'RPC không trả kết quả' }, status)
  return data as T
}

export const desktopEngineData: EngineDataPort = {
  claimTarget: (ctx: ClaimContext, opts) =>
    call<ClaimResponse>('aka_agent_engine_claim_target_v1', { p_ctx: ctx }, opts),
  markSending: (targetRunId, leaseToken, actionCode, stepKey, opts) =>
    call<MarkResponse>('aka_agent_engine_mark_sending_v1',
      { p_target_run_id: targetRunId, p_lease_token: leaseToken, p_action_code: actionCode, p_step_key: stepKey }, opts),
  report: (targetRunId, leaseToken, outcomes: ReportOutcome[], final, opts) =>
    call<ReportResponse>('aka_agent_engine_report_v1',
      { p_target_run_id: targetRunId, p_lease_token: leaseToken, p_outcomes: outcomes, p_final: final, p_dry_run: false }, opts),
  heartbeat: (accountId, leaseToken, opts) =>
    call<HeartbeatResponse>('aka_agent_engine_heartbeat_v1', { p_account_id: accountId, p_lease_token: leaseToken }, opts),
  release: (accountId, leaseToken, opts) =>
    call<ReleaseResponse>('aka_agent_engine_release_v1', { p_account_id: accountId, p_lease_token: leaseToken }, opts),
  recordWait: async (targetRunId, leaseToken, errorCode, until, seconds, opts) => {
    await call<unknown>('aka_agent_engine_record_wait_v1',
      { p_target_run_id: targetRunId, p_lease_token: leaseToken, p_error_code: errorCode, p_until: until, p_seconds: seconds }, opts)
  },
  // Gửi dạng chia sẻ (V503): nhận / báo cả lô.
  claimBatch: (ctx, opts) =>
    call<BatchClaimResponse>('aka_agent_engine_claim_batch_v1', { p_ctx: ctx }, opts),
  reportBatch: (leaseToken, items, batchSize, alreadyStopped, opts) =>
    call<BatchReportResponse>('aka_agent_engine_report_batch_v1',
      { p_lease_token: leaseToken, p_items: items, p_batch_size: batchSize, p_already_stopped: alreadyStopped }, opts)
}

/**
 * Loại trừ gửi (V504, aka_agent_engine_send_exclusion_v1): cấu hình ('snapshot') hoặc dữ kiện trong DB ('facts') của người nhận, xác
 * thực bằng lease engine. DB từ chối ({ ok: false, reason }) thì ném SendExclusionRpcError để lõi phân biệt cấu hình hỏng.
 */
export async function engineSendExclusion<T>(targetRunId: number, leaseToken: string, operation: 'snapshot' | 'facts' | 'friend_blocklist',
  payload: Record<string, unknown>, opts: CallOptions): Promise<T> {
  const result = await call<{ ok?: boolean; reason?: string; message?: string; snapshot?: unknown; facts?: unknown; blocklist?: unknown }>(
    'aka_agent_engine_send_exclusion_v1',
    { p_target_run_id: targetRunId, p_lease_token: leaseToken, p_operation: operation, p_payload: payload }, opts)
  if (result.ok !== true) throw new SendExclusionRpcError(result.reason || 'invalid_response', result.message || undefined)
  return (operation === 'snapshot' ? result.snapshot : operation === 'facts' ? result.facts : result.blocklist) as T
}

/**
 * Lấy data đầu lượt (V505, aka_agent_engine_materialize_v1): 'state' / 'clear' / 'insert' / 'hold' của chiến dịch đang giữ lease, xác
 * thực bằng lease engine của tài khoản. DB từ chối ({ ok: false, reason }) thì ném MaterializeRpcError để lõi dừng lượt đúng lý do.
 */
export async function engineMaterialize(accountId: number, leaseToken: string, operation: 'state' | 'clear' | 'insert' | 'hold',
  payload: Record<string, unknown>, opts: CallOptions): Promise<Record<string, unknown>> {
  const result = await call<Record<string, unknown>>('aka_agent_engine_materialize_v1',
    { p_account_id: accountId, p_lease_token: leaseToken, p_operation: operation, p_payload: payload }, opts)
  if (result.ok !== true) {
    throw new MaterializeRpcError(typeof result.reason === 'string' ? result.reason : 'invalid_response',
      typeof result.message === 'string' ? result.message : undefined)
  }
  return result
}

/**
 * Kiêm SMS nội bộ (V506, aka_agent_engine_sms_push_v1): một data vào chiến dịch SMS con của từng tài khoản SMS, xác thực bằng lease của lượt
 * data. DB từ chối cả lời gọi thì ném lỗi kèm lý do; lỗi từng tài khoản nằm trong kết quả.
 */
export async function engineSmsPush(targetRunId: number, leaseToken: string, payload: Record<string, unknown>,
  opts: CallOptions): Promise<Array<{ accountId: number; ok: boolean; error?: string | null }>> {
  const result = await call<{ ok?: boolean; reason?: string; results?: Array<{ accountId?: unknown; ok?: unknown; error?: unknown }> }>(
    'aka_agent_engine_sms_push_v1', { p_target_run_id: targetRunId, p_lease_token: leaseToken, p_payload: payload }, opts)
  if (result.ok !== true) throw new Error(`Không kiêm gửi SMS được: ${result.reason || 'không rõ'}`)
  return (result.results ?? []).map(item => ({ accountId: Number(item.accountId), ok: item.ok === true,
    ...(typeof item.error === 'string' ? { error: item.error } : {}) }))
}

/** Vị trí nội dung xoay vòng của data (như aka_agent_take_campaign_content_index, xác thực bằng lease engine). */
export async function takeEngineContentIndex(targetRunId: number, leaseToken: string, actionCode: string, variantCount: number,
  opts: CallOptions): Promise<number> {
  const result = await call<{ ok?: boolean; index?: unknown; reason?: string }>('aka_agent_engine_take_content_index_v1',
    { p_target_run_id: targetRunId, p_lease_token: leaseToken, p_action_code: actionCode, p_variant_count: variantCount }, opts)
  const index = Number(result.index)
  if (result.ok !== true || !Number.isSafeInteger(index)) {
    throw new Error(`Không lấy được nội dung xoay vòng: ${result.reason || 'không rõ'}`)
  }
  return index
}

/**
 * Hết data khi còn giữ lease: DB kết thúc lượt như Desktop (hẹn theo data tương lai, hết ngày kết thúc, nhiều khung giờ,
 * gửi lặp lại, còn data chờ → chưa hoàn thành) và trả lý do; lõi in câu theo lý do (V501).
 */
export function finishEngineCampaign(accountId: number, leaseToken: string, note: string | null,
  opts: CallOptions): Promise<FinishResponse> {
  return call('aka_agent_engine_finish_campaign_v2', { p_account_id: accountId, p_lease_token: leaseToken, p_note: note }, opts)
}
