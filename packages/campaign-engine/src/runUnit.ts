/**
 * Một lượt chạy của một tài khoản trên một chiến dịch, dùng chung cho Desktop và Fly:
 * gửi bù nhật ký → nhận data → kiểm cấu hình (lần đầu) → các bước → báo kết quả → làm theo chỉ thị → nghỉ.
 *
 * Bất biến:
 * - Bước gửi chỉ gọi nền tảng sau khi DB xác nhận dấu "sắp gửi" (deliver). Không ghi được dấu thì không gửi.
 * - Mỗi data kết thúc bằng ít nhất một kết quả; không có kết quả nào thì báo no_outcome (không "thành công giả").
 * - DB/mạng lỗi tạm thời: chờ và thử lại, kết quả nằm trong nhật ký; không đổi trạng thái chiến dịch.
 * - Mất quyền giữ chỗ (lease): dừng ngay, không nhả lease của người khác.
 * - Mọi lời gọi ra ngoài có hạn giờ; ngoại lệ của bước được bọc thành kết quả.
 */
import type {
  BatchClaimResponse, BatchReportSuccess, ClaimContext, ClaimResponse, EngineClock, EngineDataPort, EngineEvents, GateDecision, GateSetting,
  LocalJournal, OutcomeDecision, ProgressLevel, RawOutcome, ReportOutcome, ReportResponse, ReportSuccess, RuntimeTarget, TargetRow, TraceEvent
} from './contracts.js'
import { CancelledError, errorMessage, stepFailure, withDeadline } from './boundary.js'
import { callUntilAvailable, DEFAULT_RETRY, OutcomeReporter, type OutageHandler, type RetryPolicy } from './reporter.js'
import { paceDelayMs, type PaceSettings } from './pacing.js'
import {
  accountStopProgress, campaignNoteProgress, cooldownPauseProgress, campaignPausedProgress, campaignWaitProgress, configIssueProgress, dailyBoundaryProgress,
  finishProgress, formatVietnamDateTime, gateSkipProgress, outageProgress, outcomeProgress, paceProgress, recoveredProgress, targetDoneProgress,
  targetStartProgress, unitStartProgress
} from './progress.js'
import type { ConfigIssue } from './validation.js'

export interface StepContext {
  /** Lượt chạy data (auto_engine_target_runs.id): khoá idempotency cho lệnh gửi của adapter. */
  targetRunId: number
  /** Lease đang giữ: RPC phụ của adapter (ví dụ lấy nội dung xoay vòng) xác thực bằng lease này. */
  leaseToken: string
  target: TargetRow
  /** Trạng thái chia sẻ giữa các bước của cùng data (RawOutcome.state của bước trước được gộp vào đây). */
  state: Record<string, unknown>
  signal: AbortSignal
  gate: GateDecision | undefined
  /** Cấu hình cổng kiểm từ DB (on_error); bước cổng đọc để quyết định khi kiểm bị lỗi. */
  gateSettings: Readonly<Record<string, GateSetting>>
  /** Một dòng tiến trình cho khách gắn với data này (cảnh báo của cổng kiểm…). */
  progress(text: string, level?: ProgressLevel): void
}

export interface EngineStep {
  key: string
  actionCode: string
  /** Tên thao tác ghi vào lịch sử và câu tiến trình, như actionName của helper Desktop ("Tìm SĐT"…). */
  actionName?: string
  /** Bước giao tới người nhận: phải ghi dấu "sắp gửi" trước khi gọi nền tảng. */
  delivery: boolean
  /**
   * Cổng kiểm (từ chối nhận tin, loại trừ gửi…): qua thì không báo kết quả nào; chặn thì trả RawOutcome lỗi
   * và DB quyết định data đi đâu. Cổng tự xử lý lỗi kiểm theo on_error (mở khi lỗi như hiện nay).
   */
  gate?: boolean
  /** Các bước phải thành công trước; không đạt thì bỏ qua bước này (không báo kết quả). */
  requires?: readonly string[]
  /** Bước bị tắt trong cấu hình chiến dịch thì bỏ qua. */
  enabled?(ctx: StepContext): boolean
  /** Hạn giờ riêng của bước (gửi tệp: tải tệp + 180 giây gửi + gửi chữ); không có thì dùng stepTimeoutMs của lượt. */
  timeoutMs?: number
  /**
   * Thao tác không bắt buộc của bước đang bị khoá / hết lượt: 'skip' (mặc định) bỏ qua bước cho data này; 'requeue' trả data về
   * hàng đợi và dừng lượt (tín hiệu engine `action_waiting`, như Desktop kiểm khoá "Tìm SĐT" lúc chạy cho data chỉ có SĐT).
   */
  onGateWait?: 'skip' | 'requeue'
  run(ctx: StepContext): Promise<RawOutcome>
}

export interface UnitDeps { data: EngineDataPort; journal: LocalJournal; clock: EngineClock; events: EngineEvents }

/** Một data của lô (gửi dạng chia sẻ). ctx: ngữ cảnh như một bước, để dùng lại cổng của lõi (lượt data, lease, tín hiệu huỷ). */
export interface BatchItem {
  targetRunId: number
  target: TargetRow
  targetKey: string | null
  actions: Record<string, GateDecision>
  ctx: StepContext
}

/** Bước của kết quả trong lô (khoá kết quả, mã thao tác, tên ghi lịch sử). */
export interface BatchStep { key: string; actionCode: string; actionName?: string }

export type BatchStop = { stop: true; reason: UnitEndReason; detail?: Record<string, unknown> }

/** Những gì lõi cho một lô (cfg.batch.run): ghi dấu "sắp gửi", báo riêng một data, báo cả lô, dòng tiến trình. */
export interface BatchApi {
  readonly leaseToken: string
  readonly items: readonly BatchItem[]
  readonly gateSettings: Readonly<Record<string, GateSetting>>
  readonly signal: AbortSignal
  /**
   * Ghi dấu "sắp gửi" của data (bất biến: chỉ gọi nền tảng sau khi DB xác nhận). { refused }: DB không cho gửi data này (không gửi);
   * BatchStop: mất lease, lượt dừng ngay.
   */
  markSending(item: BatchItem, step: BatchStep): Promise<'ok' | { refused: string } | BatchStop>
  /** Báo và chốt riêng một data (chế độ thường: chính sách áp đủ). */
  reportOne(item: BatchItem, step: BatchStep, raw: RawOutcome): Promise<ReportSuccess | BatchStop>
  /**
   * Báo và chốt cả lô; DB chọn chế độ cho từng data (report_batch_v1). batchSize: cỡ lô cho câu tạm dừng. alreadyStopped: lô đã dừng theo
   * chính sách khi gửi tệp, không ai áp thêm chính sách, không tạm dừng "toàn bộ thất bại".
   */
  reportBatch(entries: ReadonlyArray<{ item: BatchItem; step: BatchStep; raw: RawOutcome }>, batchSize: number,
    options?: { alreadyStopped?: boolean }): Promise<BatchReportSuccess | BatchStop>
  progress(text: string, level?: ProgressLevel, inputDataId?: number | null): void
  trace(event: { type: string; [key: string]: unknown }): void
}

export type BatchEnd = { stop: false; paceMs: number } | BatchStop

/** Gửi dạng chia sẻ: nhận cả lô (claim_batch_v1) và chạy cả lô một lần thay cho các bước của từng data. */
export interface BatchUnitConfig {
  /** Tối đa số data mỗi lô (Desktop: 50). */
  maxTargets: number
  run(api: BatchApi): Promise<BatchEnd>
}

export interface PrepareTargetsApi {
  leaseToken: string
  signal: AbortSignal
  /** Chiến dịch còn dòng data nào (kể cả đã xong) theo claim. */
  hasTargets: boolean
  sleep(ms: number, signal?: AbortSignal): Promise<boolean>
  progress(text: string, level?: ProgressLevel): void
  trace(event: TraceEvent): void
  /** In "🚀 Bắt đầu chiến dịch …" (một lần mỗi lượt) trước câu lấy data, như Desktop in trước executeCampaignV2. */
  markStarted(): void
}

/** Kết quả một bước vừa được DB ghi (kiêm SMS đọc dòng lịch sử vừa tạo, như pushZaloMilestoneToSms của Desktop). */
export interface AfterReportInfo {
  targetRunId: number
  leaseToken: string
  target: TargetRow
  actionCode: string
  raw: RawOutcome
  decisions: readonly OutcomeDecision[]
  signal: AbortSignal
  /** Một dòng tiến trình gắn với data này. */
  progress(text: string, level?: ProgressLevel): void
  /** Vết cho người vận hành (không hiện cho khách); runUnit gắn targetRunId. */
  trace?(event: TraceEvent): void
}

export type PrepareTargetsResult =
  | { kind: 'retry' }
  | { kind: 'none'; note?: string | null }
  | { kind: 'end'; reason: UnitEndReason; detail?: Record<string, unknown> }

export interface UnitConfig {
  runnerId: string
  runtimeTarget: RuntimeTarget
  staffId: number
  accountId: number
  campaignId: number
  /** Loại chiến dịch (action_id): chọn nhãn data trong câu "⏸️ Bỏ qua" của chống gửi lặp như Desktop. */
  actionId?: string
  /** Tên chiến dịch, tài khoản cho câu tiến trình "🚀 Bắt đầu chiến dịch ..." như Desktop. */
  campaignName: string
  accountName: string
  /** Ghi chú hiện tại của chiến dịch: không in lại "Chưa thể chạy chiến dịch" khi lý do chờ không đổi. */
  campaignNote?: string | null
  /** Nhãn data trong câu tiến trình (getInputDataDisplayName của Desktop); mặc định tên → UID → SĐT. */
  targetLabel?(target: TargetRow): string
  actions: ClaimContext['actions']
  /**
   * Cần ít nhất một thao tác trong nhóm không phải chờ (thao tác gửi khi "tiếp tục khi chạm giới hạn"); cả nhóm chờ thì DB không
   * nhận data, hẹn lại theo thao tác mở sớm nhất (như preflight của Desktop: hết lượt mọi thao tác gửi thì không chạy data).
   */
  requireAny?: ClaimContext['requireAny']
  buildSteps(target: TargetRow): readonly EngineStep[]
  /** Kiểm cấu hình cấp chiến dịch; chạy một lần ngay sau lần nhận data đầu. */
  validateCampaign?(): readonly ConfigIssue[] | Promise<readonly ConfigIssue[]>
  pacing: PaceSettings
  stepTimeoutMs: number
  heartbeatMs: number
  retry?: RetryPolicy
  /** Hạn giờ báo kết quả khi đang dừng (không chờ DB). */
  drainTimeoutMs?: number
  /**
   * Dừng mềm: kiểm giữa hai data (yêu cầu tạm dừng còn trong RAM của nơi chạy, nơi chạy ngừng nhận việc…).
   * Data đang xử lý chạy xong rồi mới dừng, như Desktop.
   */
  shouldStopAfterTarget?(): boolean
  maxTargets?: number
  /**
   * Hết data khi còn giữ lease: host quyết định kết thúc / hẹn lại chiến dịch (ví dụ aka_agent_engine_finish_campaign_v1).
   * Lỗi được ghi vết, không làm hỏng lượt; lease vẫn được nhả sau đó.
   */
  onNoTarget?(info: { leaseToken: string; nextSchedule: string | null; runningTargets: number; hasTargets: boolean; dueTried: number; dataGroup: boolean;
    note?: string | null }, signal: AbortSignal): Promise<Record<string, unknown> | undefined>
  /**
   * Lấy data đầu lượt (bạn bè toàn bộ / theo tag, sinh nhật, đề xuất Zalo, huỷ lời mời): gọi khi claim đầu tiên của lượt không còn data
   * nào để chạy, lúc còn giữ lease (heartbeat chạy trong lúc đọc Zalo). 'retry': đã thêm data, claim lại một lần; 'none': không thêm
   * gì, kết thúc lượt như thường (note: ghi chú khi kết thúc chiến dịch); 'end': host đã tự xử lý chiến dịch, dừng lượt.
   */
  prepareTargets?(api: PrepareTargetsApi): Promise<PrepareTargetsResult>
  /**
   * Sau khi DB ghi kết quả của một bước (từng data, không dùng cho lô chia sẻ): việc kèm theo dòng lịch sử vừa tạo, ví dụ kiêm SMS.
   * Lỗi chỉ ghi vết, không đổi kết quả của data; có hạn giờ.
   */
  afterReport?(info: AfterReportInfo): Promise<void>
  resultKeyPrefix?: string
  actionName?(actionCode: string): string
  formatTime?(iso: string): string
  /** Ngày giờ trong câu kết thúc lượt ("HH:mm dd/MM/yyyy" như Desktop); mặc định formatVietnamDateTime. */
  formatDateTime?(iso: string): string
  /**
   * Data kết thúc (xong, lỗi hoặc bị dừng): host dọn tài nguyên giữ theo data (ngữ cảnh tag Zalo, tệp media tạm…).
   * Chạy cả khi lượt đang dừng; lỗi chỉ ghi vết.
   */
  onTargetEnd?(info: { targetRunId: number; inputDataId: number }, signal: AbortSignal): Promise<void>
  /**
   * Gửi dạng chia sẻ: chạy theo lô (nhận cả lô, chạy lô, báo cả lô) thay cho buildSteps. Nghỉ giữa hai lô không in "⏳ Nghỉ"
   * (như Desktop).
   */
  batch?: BatchUnitConfig
}

export type UnitEndReason =
  | 'no_target' | 'not_due' | 'wait' | 'end_unit' | 'stop_account' | 'stop_campaign' | 'ownership_lost' | 'cancelled'
  | 'config_invalid' | 'max_targets' | 'campaign_paused' | 'campaign_not_runnable' | 'busy' | 'legacy_busy' | 'not_enabled' | 'not_found'
  | 'account_mismatch' | 'account_not_found' | 'invalid_request' | 'app_access_denied' | 'report_rejected' | 'error'
  | 'daily_boundary' | 'runtime_not_owner' | 'staff_time_blocked' | 'account_logged_out' | 'stopped'
  | 'maintenance_required' | 'campaign_not_ready' | 'data_group_hard_end' | 'data_group_waiting' | 'account_paused' | 'entitlement_denied'
  | 'concurrency_limit'
  | 'gate_unavailable' | 'cooldown_scan'

export interface UnitResult {
  reason: UnitEndReason
  targets: number
  leaseToken: string | null
  released: boolean
  detail?: Record<string, unknown>
}

type Claimed = Extract<ClaimResponse, { status: 'claimed' }>
type TargetEnd = { stop: false; paceMs: number } | { stop: true; reason: UnitEndReason; detail?: Record<string, unknown> }

export async function runUnit(deps: UnitDeps, cfg: UnitConfig, signal: AbortSignal): Promise<UnitResult> {
  const retry = cfg.retry ?? DEFAULT_RETRY
  const unit = new AbortController()
  const onParentAbort = () => unit.abort(signal.reason)
  if (signal.aborted) unit.abort(signal.reason)
  signal.addEventListener('abort', onParentAbort, { once: true })

  let outageShown = false
  const outage: OutageHandler = {
    onOutage(label, attempt, err) {
      if (!outageShown) { outageShown = true; deps.events.progress(outageProgress(cfg.campaignId)) }
      deps.events.trace({ type: 'db_outage', label, attempt, error: errorMessage(err) })
    },
    onRecovered(label, attempts) {
      if (outageShown) { outageShown = false; deps.events.progress(recoveredProgress(cfg.campaignId)) }
      deps.events.trace({ type: 'db_recovered', label, attempts })
    }
  }
  const reporter = new OutcomeReporter(deps, retry, outage)

  let leaseToken: string | null = null
  let ownershipLost = false
  let stopAfterTarget: UnitEndReason | null = null
  /** Lý do dừng do điều khiển từ ngoài (heartbeat), để in đúng câu của Desktop/VPS sau data đang xử lý. */
  let controlStop: { kind: 'campaign_paused' } | { kind: 'account'; reason: 'logged_out' | 'paused'; status: string | null } | null = null
  let targets = 0
  let validated = false
  let prepared = false
  let paceMs = 0
  const heartbeatStop = new AbortController()
  let heartbeat: Promise<void> | null = null

  const startHeartbeat = (): void => {
    if (heartbeat) return
    heartbeat = (async () => {
      while (!heartbeatStop.signal.aborted) {
        if (!(await deps.clock.sleep(cfg.heartbeatMs, heartbeatStop.signal))) return
        const token = leaseToken
        if (!token) continue
        try {
          const hb = await withDeadline('heartbeat', retry.callTimeoutMs, heartbeatStop.signal,
            s => deps.data.heartbeat(cfg.accountId, token, { signal: s, timeoutMs: retry.callTimeoutMs }))
          if (!hb.ok) {
            ownershipLost = true
            deps.events.trace({ type: 'ownership_lost', via: 'heartbeat', reason: hb.reason })
            unit.abort(new CancelledError('ownership_lost'))
            return
          }
          const c = hb.control
          // Dừng sau data đang xử lý, giống Desktop hiện nay khi tạm dừng từ Web.
          if (c?.campaignDeleted || c?.campaignStatus === 'tạm dừng') {
            stopAfterTarget ??= 'campaign_paused'
            if (!c?.campaignDeleted) controlStop ??= { kind: 'campaign_paused' }
          }
          if (c?.accountDeleted || c?.accountStatus === 'tạm dừng' || c?.loginStatus === 'chưa đăng nhập' || c?.loginStatus === 'checkpoint') {
            stopAfterTarget ??= 'stop_account'
            if (!c?.accountDeleted) {
              controlStop ??= { kind: 'account', reason: c?.loginStatus === 'chưa đăng nhập' || c?.loginStatus === 'checkpoint' ? 'logged_out' : 'paused',
                status: c?.accountStatus ?? null }
            }
          }
        } catch (err) {
          // DB tạm lỗi: lease còn tới hạn; lần sau thử lại. Hết hạn thì mark/report sẽ báo mất quyền.
          if (!heartbeatStop.signal.aborted) deps.events.trace({ type: 'heartbeat_failed', error: errorMessage(err) })
        }
      }
    })()
  }

  const finish = async (reason: UnitEndReason, detail?: Record<string, unknown>): Promise<UnitResult> => {
    heartbeatStop.abort()
    await heartbeat?.catch(() => undefined)
    let released = false
    if (leaseToken && !ownershipLost && reason !== 'ownership_lost') {
      try {
        const res = await withDeadline('release', retry.callTimeoutMs, undefined,
          s => deps.data.release(cfg.accountId, leaseToken as string, { signal: s, timeoutMs: retry.callTimeoutMs }))
        released = res.ok
        if (!res.ok) deps.events.trace({ type: 'release_refused', reason: res.reason, openRuns: res.openRuns })
      } catch (err) {
        deps.events.trace({ type: 'release_failed', error: errorMessage(err) }) // lease tự hết hạn, pg_cron dọn
      }
    }
    return { reason, targets, leaseToken, released, ...(detail ? { detail } : {}) }
  }

  const resultKey = (claim: Claimed, stepKey: string): string => `${cfg.resultKeyPrefix ?? 'v2'}:${claim.targetRunId}:${stepKey}`
  const formatTime = cfg.formatTime ?? ((iso: string) => iso)
  const formatDateTime = cfg.formatDateTime ?? formatVietnamDateTime
  /** Câu dừng do điều khiển từ ngoài: chỉ khi lượt đã thật sự chạy data (đã in "🚀 Bắt đầu chiến dịch"). */
  const printControlStop = (): void => {
    if (!started || !controlStop) return
    deps.events.progress(controlStop.kind === 'campaign_paused'
      ? campaignPausedProgress(cfg.campaignId, cfg.campaignName, cfg.runtimeTarget)
      : accountStopProgress(cfg.campaignId, cfg.campaignName, cfg.runtimeTarget, controlStop.reason, controlStop.status))
    controlStop = null
  }
  const actionNameOf = (code: string): string => cfg.actionName?.(code) ?? code
  const labelOf = (target: TargetRow): string => {
    if (cfg.targetLabel) return cfg.targetLabel(target)
    for (const value of [target.name, target.uid, target.phone]) {
      const text = String(value ?? '').trim()
      if (text) return text
    }
    return 'N/A'
  }
  let started = false
  const skipLogged = new Set<string>()
  const markStarted = (): void => {
    if (started) return
    started = true
    deps.events.progress(unitStartProgress(cfg.campaignId, cfg.campaignName, cfg.accountName))
    deps.events.trace({ type: 'unit_started', campaignId: cfg.campaignId, accountId: cfg.accountId })
  }

  const toReport = (claim: Claimed, step: Pick<EngineStep, 'key' | 'actionCode' | 'actionName'>, raw: RawOutcome): ReportOutcome => {
    const named = step.actionName ? { actionName: step.actionName } : {}
    return raw.ok
      ? { resultKey: resultKey(claim, step.key), actionCode: step.actionCode, ...named, stepKey: step.key, ok: true, phase: 'after_send',
          ...(raw.statusCode ? { statusCode: raw.statusCode } : {}), ...(raw.evidence ? { evidence: raw.evidence } : {}),
          ...(raw.data ? { data: raw.data } : {}), ...(raw.customerLog ? { customerLog: raw.customerLog } : {}) }
      : { resultKey: resultKey(claim, step.key), actionCode: step.actionCode, ...named, stepKey: step.key, ok: false, phase: raw.phase,
          signal: raw.signal, ...(raw.evidence ? { evidence: raw.evidence } : {}), ...(raw.data ? { data: raw.data } : {}) }
  }

  /** Báo kết quả; đang dừng thì chỉ thử một lần, phần còn lại nằm trong nhật ký. */
  const send = async (claim: Claimed, outcomes: ReportOutcome[], final: boolean): Promise<ReportResponse | null> => {
    if (unit.signal.aborted) return reporter.reportOnce(claim.targetRunId, claim.leaseToken, outcomes, final, cfg.drainTimeoutMs ?? 10_000)
    return reporter.report(claim.targetRunId, claim.leaseToken, outcomes, final, unit.signal)
  }

  const isRawOutcome = (value: unknown): value is RawOutcome => {
    if (!value || typeof value !== 'object') return false
    const v = value as { ok?: unknown; phase?: unknown; signal?: unknown }
    if (v.ok === true) return true
    return v.ok === false && typeof v.phase === 'string' && !!v.signal && typeof v.signal === 'object'
  }

  const runStep = async (step: EngineStep, ctx: StepContext): Promise<RawOutcome> => {
    try {
      const raw = await withDeadline(`step:${step.key}`, step.timeoutMs ?? cfg.stepTimeoutMs, unit.signal, s => step.run({ ...ctx, signal: s }))
      return isRawOutcome(raw) ? raw : stepFailure(new Error(`Bước ${step.key} trả kết quả không hợp lệ`), step.delivery)
    } catch (err) {
      return stepFailure(err, step.delivery)
    }
  }

  /** Data có thao tác gửi lỗi mà đã giao một phần / không rõ đã tới: Desktop đóng data không in "✅ Hoàn thành" (CS:4732-4741). */
  const uncertainTargets = new Set<number>()
  const afterTarget = (claim: Claimed, res: ReportSuccess): TargetEnd => {
    // Như Desktop: data chạy xong (kể cả thao tác lỗi) in "✅ Hoàn thành"; về hàng đợi, tạm dừng, hay đóng vì không gửi lại
    // được (giao một phần, không rõ kết quả) thì không.
    if (res.target.done && res.target.status === 'hoàn thành' && !uncertainTargets.delete(claim.targetRunId)) {
      deps.events.progress(targetDoneProgress(cfg.campaignId, claim.target.id, labelOf(claim.target)))
    }
    if (res.campaign.note) deps.events.progress(campaignNoteProgress(cfg.campaignId, res.campaign.note))
    const paceMs = res.next === 'next_target' && res.target.morePending ? paceDelayMs(res.pace, cfg.pacing) : 0
    deps.events.trace({ type: 'target_done', targetRunId: claim.targetRunId, inputDataId: claim.target.id, status: res.target.status,
      next: res.next, safety: res.safety, streak: res.streak ?? null, paceMs })
    switch (res.next) {
      case 'next_target':
        return { stop: false, paceMs }
      case 'next_step':
        // DB chưa chốt data dù runtime đã hết bước: coi là lỗi hợp đồng, dừng lượt để lease/pg_cron xử lý.
        return { stop: true, reason: 'error', detail: { error: 'target_not_closed' } }
      case 'ownership_lost':
        ownershipLost = true
        return { stop: true, reason: 'ownership_lost' }
      default:
        return { stop: true, reason: res.next }
    }
  }

  const handleResponse = (claim: Claimed, res: ReportResponse | null): ReportSuccess | TargetEnd => {
    if (res === null) return { stop: true, reason: ownershipLost ? 'ownership_lost' : 'cancelled' }
    if (!res.ok) return { stop: true, reason: 'report_rejected', detail: { reason: res.reason, targetRunId: claim.targetRunId } }
    for (const decision of res.outcomes) {
      if (!decision.ok && (decision.deliveryState === 'partial' || decision.deliveryState === 'unknown')) uncertainTargets.add(claim.targetRunId)
      const progress = outcomeProgress(cfg.campaignId, claim.target.id, decision,
        { actionName: actionNameOf(decision.actionCode), targetLabel: labelOf(claim.target) })
      if (progress) deps.events.progress(progress)
    }
    return res
  }

  const runTarget = async (claim: Claimed): Promise<TargetEnd> => {
    try {
      return await runTargetSteps(claim)
    } finally {
      const onTargetEnd = cfg.onTargetEnd
      if (onTargetEnd) {
        // Tín hiệu riêng: dọn dẹp chạy cả khi lượt đang dừng (thoát app, đăng xuất), có hạn giờ.
        try {
          await withDeadline('on_target_end', retry.callTimeoutMs, new AbortController().signal,
            s => onTargetEnd({ targetRunId: claim.targetRunId, inputDataId: Number(claim.target.id) }, s))
        } catch (err) {
          deps.events.trace({ type: 'on_target_end_failed', targetRunId: claim.targetRunId, error: errorMessage(err) })
        }
      }
    }
  }

  const runTargetSteps = async (claim: Claimed): Promise<TargetEnd> => {
    deps.events.progress(targetStartProgress(cfg.campaignId, claim.target.id, labelOf(claim.target), cfg.campaignName))
    const steps = cfg.buildSteps(claim.target)
    const state: Record<string, unknown> = {}
    const progress = (text: string, level: ProgressLevel = 'warning'): void =>
      deps.events.progress({ campaignId: cfg.campaignId, inputDataId: claim.target.id, text, code: /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(text)?.[1] ?? null, level })
    const succeeded = new Set<string>()
    let reported = 0
    for (const step of steps) {
      // Cổng kiểm không chịu khoá/hạn mức của thao tác: nó chỉ quyết định có cho gửi hay không.
      const gate = step.gate ? undefined : claim.actions[step.actionCode]
      const ctx: StepContext = { targetRunId: claim.targetRunId, leaseToken: claim.leaseToken, target: claim.target, state,
        signal: unit.signal, gate, gateSettings: claim.gates ?? {}, progress }
      if (step.requires?.some(key => !succeeded.has(key))) continue
      if (step.enabled && !step.enabled(ctx)) continue
      let waitRequeue = false
      if (gate?.decision === 'wait') {
        // Thao tác không bắt buộc đang bị khoá/hết lượt: bỏ qua bước này cho data này; mỗi thao tác báo một lần trong lượt.
        if (!skipLogged.has(step.actionCode)) {
          skipLogged.add(step.actionCode)
          deps.events.progress(gateSkipProgress(cfg.campaignId, claim.target.id, step.actionName ?? actionNameOf(step.actionCode), gate, formatTime))
        }
        if (step.onGateWait !== 'requeue') continue
        waitRequeue = true
      }
      if (unit.signal.aborted) {
        // Đang dừng trước một bước: báo "đã dừng" cho bước đó để DB chốt data đúng (chưa giao thì trả về
        // hàng đợi, đã giao thì hoàn thành), thay vì chốt như thể các bước còn lại đã chạy.
        if (ownershipLost) return { stop: true, reason: 'ownership_lost' }
        const res = handleResponse(claim, await send(claim, [toReport(claim, step,
          { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'cancelled', errorCode: 'err_engine_cancelled' } })], true))
        if (!('ok' in res)) return res
        return afterTarget(claim, res)
      }

      let raw: RawOutcome | null = null
      if (waitRequeue) {
        // Chưa gọi nền tảng: data về hàng đợi, dừng lượt (DB: luật engine action_waiting).
        raw = { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'action_waiting', message: gate?.note ?? '' },
          data: { gate: gate?.gate ?? null, until: gate?.until ?? null, errorCode: gate?.errorCode ?? null } }
      } else if (gate?.decision === 'skip') {
        raw = { ok: true, statusCode: 'campaign_detail_skipped', data: { gate: gate.gate ?? null, rememberedErrorCode: gate.errorCode ?? null } }
      } else if (step.delivery && !step.gate) {
        const mark = await callUntilAvailable('mark_sending',
          opts => deps.data.markSending(claim.targetRunId, claim.leaseToken, step.actionCode, step.key, opts),
          deps.clock, retry, unit.signal, outage)
        if (!mark.ok) {
          if (mark.reason === 'ownership_lost' || mark.reason === 'run_closed') {
            ownershipLost = true
            deps.events.trace({ type: 'ownership_lost', via: 'mark_sending', reason: mark.reason, step: step.key })
            return { stop: true, reason: 'ownership_lost' }
          }
          raw = { ok: false, phase: 'before_send', signal: { kind: 'engine', code: `mark_${mark.reason}`, message: mark.reason } }
        }
      }
      raw ??= await runStep(step, ctx)
      if (raw.ok && raw.state) Object.assign(state, raw.state)
      // Bước không tạo kết quả (bỏ qua im lặng như helper Desktop): không báo DB, không tính là đã thành công.
      if (raw.ok && raw.noOutcome && !step.gate) continue
      if (step.gate && raw.ok) {
        // Cổng qua: không tạo kết quả, không ghi lịch sử; bước sau chạy như bình thường.
        succeeded.add(step.key)
        continue
      }

      const res = handleResponse(claim, await send(claim, [toReport(claim, step, raw)], false))
      if (!('ok' in res)) return res
      reported++
      const afterReport = cfg.afterReport
      if (afterReport && !unit.signal.aborted) {
        // Như pushZaloMilestoneToSms của Desktop: ngay sau dòng lịch sử của bước, trước "✅ Hoàn thành" của data. Hết hạn thì lõi đi tiếp
        // nhưng lời gọi cổng đã gửi (akaBiz) vẫn chạy: việc sau của cùng data phải tự tránh làm chồng (smsPush.ts).
        try {
          await withDeadline('after_report', retry.callTimeoutMs * 2, unit.signal, s => afterReport({ targetRunId: claim.targetRunId,
            leaseToken: claim.leaseToken, target: claim.target, actionCode: step.actionCode, raw, decisions: res.outcomes, signal: s, progress,
            trace: event => deps.events.trace({ ...event, targetRunId: claim.targetRunId }) }))
        } catch (err) {
          deps.events.trace({ type: 'after_report_failed', targetRunId: claim.targetRunId, actionCode: step.actionCode, error: errorMessage(err) })
        }
      }
      // Bước bị bỏ qua do cổng (mục tiêu đã biết là hỏng) không tạo đầu ra: bước phụ thuộc cũng bỏ qua.
      if (raw.ok && gate?.decision !== 'skip') succeeded.add(step.key)
      if (res.next === 'ownership_lost') { ownershipLost = true; return { stop: true, reason: 'ownership_lost' } }
      if (res.target.done) return afterTarget(claim, res)
    }

    // Hết bước mà DB chưa chốt data: chốt (các bước còn lại bị bỏ), hoặc báo no_outcome nếu chưa có kết quả nào.
    const firstAction = steps[0]?.actionCode ?? cfg.actions[0]?.code
    if (!firstAction) return { stop: true, reason: 'error', detail: { error: 'no_steps' } }
    const outcomes = reported > 0 ? [] : [toReport(claim, { key: '__no_outcome', actionCode: firstAction },
      { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'no_outcome', errorCode: 'err_engine_no_outcome' } })]
    const res = handleResponse(claim, await send(claim, outcomes, true))
    if (!('ok' in res)) return res
    return afterTarget(claim, res)
  }

  // ---- Gửi dạng chia sẻ: một lô ------------------------------------------------------------------------------------------
  type BatchClaimed = Extract<BatchClaimResponse, { status: 'claimed' }>
  /** Data của lô dưới dạng một lần nhận (để dùng lại toReport / send của lượt thường). */
  const claimOf = new Map<number, Claimed>()
  const batchItems = (claim: BatchClaimed): BatchItem[] => claim.items.map(item => {
    const claimed: Claimed = { status: 'claimed', targetRunId: item.targetRunId, leaseToken: claim.leaseToken, leaseExpiresAt: claim.leaseExpiresAt,
      target: item.target, targetKey: item.targetKey, actions: item.actions, ...(claim.gates ? { gates: claim.gates } : {}), campaign: claim.campaign }
    claimOf.set(item.targetRunId, claimed)
    const progress = (text: string, level: ProgressLevel = 'warning'): void =>
      deps.events.progress({ campaignId: cfg.campaignId, inputDataId: item.target.id, text, code: /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(text)?.[1] ?? null, level })
    return { targetRunId: item.targetRunId, target: item.target, targetKey: item.targetKey, actions: item.actions,
      ctx: { targetRunId: item.targetRunId, leaseToken: claim.leaseToken, target: item.target, state: {}, signal: unit.signal,
        gate: item.actions[cfg.actions[0]?.code ?? ''], gateSettings: claim.gates ?? {}, progress } }
  })
  const stopFrom = (res: ReportResponse | null, targetRunId: number): BatchStop | null => {
    if (res === null) return { stop: true, reason: ownershipLost ? 'ownership_lost' : 'cancelled' }
    if (!res.ok) return { stop: true, reason: 'report_rejected', detail: { reason: res.reason, targetRunId } }
    if (res.next === 'ownership_lost') { ownershipLost = true; return { stop: true, reason: 'ownership_lost' } }
    return null
  }
  const batchApi = (claim: BatchClaimed, items: BatchItem[]): BatchApi => ({
    leaseToken: claim.leaseToken,
    items,
    gateSettings: claim.gates ?? {},
    signal: unit.signal,
    markSending: async (item, step) => {
      const mark = await callUntilAvailable('mark_sending',
        opts => deps.data.markSending(item.targetRunId, claim.leaseToken, step.actionCode, step.key, opts), deps.clock, retry, unit.signal, outage)
      if (mark.ok) return 'ok'
      if (mark.reason === 'ownership_lost' || mark.reason === 'run_closed') {
        ownershipLost = true
        deps.events.trace({ type: 'ownership_lost', via: 'mark_sending', reason: mark.reason, step: step.key, targetRunId: item.targetRunId })
        return { stop: true, reason: 'ownership_lost' }
      }
      deps.events.trace({ type: 'mark_refused', reason: mark.reason, targetRunId: item.targetRunId })
      return { refused: mark.reason }
    },
    reportOne: async (item, step, raw) => {
      const claimed = claimOf.get(item.targetRunId)!
      const res = await send(claimed, [toReport(claimed, step, raw)], true)
      return stopFrom(res, item.targetRunId) ?? (res as ReportSuccess)
    },
    reportBatch: async (entries, batchSize, options = {}) => {
      const items = entries.map(entry => {
        const claimed = claimOf.get(entry.item.targetRunId)!
        return { targetRunId: entry.item.targetRunId, outcomes: [toReport(claimed, entry.step, entry.raw)] }
      })
      if (unit.signal.aborted) {
        // Đang dừng: không chờ DB; từng data còn trong nhật ký để gửi bù.
        for (const item of items) await reporter.reportOnce(item.targetRunId, claim.leaseToken, item.outcomes, true, cfg.drainTimeoutMs ?? 10_000)
        return { stop: true, reason: ownershipLost ? 'ownership_lost' : 'cancelled' }
      }
      const res = await reporter.reportBatch(claim.leaseToken, items, batchSize, options.alreadyStopped === true, unit.signal)
      if (!res.ok) return { stop: true, reason: 'report_rejected', detail: { ...res } }
      if (res.next === 'ownership_lost') { ownershipLost = true; return { stop: true, reason: 'ownership_lost' } }
      return res
    },
    progress: (text, level = 'info', inputDataId = null) =>
      deps.events.progress({ campaignId: cfg.campaignId, inputDataId, text, code: /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(text)?.[1] ?? null, level }),
    trace: event => deps.events.trace(event)
  })
  /** Data của lô bị dừng trước khi gửi (chưa ghi dấu "sắp gửi"): về hàng đợi. Data đã ghi dấu thì để aka_agent_engine_close_stale_v1 đóng. */
  const cancelOutcome: RawOutcome = { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'cancelled', errorCode: 'err_engine_cancelled' } }

  const runBatch = async (claim: BatchClaimed, batch: BatchUnitConfig): Promise<BatchEnd> => {
    const items = batchItems(claim)
    try {
      if (!validated) {
        validated = true
        const issue = (await cfg.validateCampaign?.())?.find(item => item.scope === 'campaign')
        if (issue) {
          deps.events.progress(configIssueProgress(cfg.campaignId, issue))
          const action = cfg.actions[0]?.code ?? 'unknown'
          const api = batchApi(claim, items)
          const first = await api.reportOne(items[0]!, { key: '__config', actionCode: action },
            { ok: false, phase: 'before_send', signal: { kind: 'engine', code: issue.publicCode, errorCode: issue.errorCode, message: issue.message } })
          if ('stop' in first) return first
          for (const item of items.slice(1)) {
            const res = await api.reportOne(item, { key: '__cancelled', actionCode: action }, cancelOutcome)
            if ('stop' in res) return res
          }
          if (first.campaign.note) deps.events.progress(campaignNoteProgress(cfg.campaignId, first.campaign.note))
          return { stop: true, reason: 'config_invalid', detail: { issue } }
        }
      }
      targets += items.length
      return await batch.run(batchApi(claim, items))
    } finally {
      const onTargetEnd = cfg.onTargetEnd
      if (onTargetEnd) {
        for (const item of items) {
          try {
            await withDeadline('on_target_end', retry.callTimeoutMs, new AbortController().signal,
              s => onTargetEnd({ targetRunId: item.targetRunId, inputDataId: Number(item.target.id) }, s))
          } catch (err) {
            deps.events.trace({ type: 'on_target_end_failed', targetRunId: item.targetRunId, error: errorMessage(err) })
          }
        }
      }
    }
  }

  try {
    const flushed = await reporter.flush(unit.signal)
    if (flushed.sent || flushed.rejected) deps.events.trace({ type: 'journal_flushed', ...flushed })

    for (;;) {
      if (unit.signal.aborted) return await finish(ownershipLost ? 'ownership_lost' : 'cancelled')
      if (stopAfterTarget) { printControlStop(); return await finish(stopAfterTarget) }
      if (cfg.shouldStopAfterTarget?.()) return await finish('stopped')
      if (cfg.maxTargets && targets >= cfg.maxTargets) return await finish('max_targets')
      if (paceMs > 0) {
        const delay = paceMs
        paceMs = 0
        // Gửi dạng chia sẻ: Desktop nghỉ giữa hai lô không in dòng nào.
        if (!cfg.batch) deps.events.progress(paceProgress(cfg.campaignId, Math.round(delay / 1000)))
        // Như sleepBetweenTargets của Desktop: yêu cầu tạm dừng / dừng trong lúc nghỉ có hiệu lực ngay (kiểm mỗi 500 ms),
        // không chạy thêm data nào. Nơi chạy không khai shouldStopAfterTarget thì nghỉ một lần (dừng từ heartbeat kiểm sau nghỉ).
        if (cfg.shouldStopAfterTarget) {
          let left = delay
          while (left > 0 && !unit.signal.aborted && !stopAfterTarget && !cfg.shouldStopAfterTarget()) {
            const chunk = Math.min(left, 500)
            if (!(await deps.clock.sleep(chunk, unit.signal))) break
            left -= chunk
          }
        } else {
          await deps.clock.sleep(delay, unit.signal)
        }
        continue
      }

      const claimCtx: ClaimContext = {
        staffId: cfg.staffId, accountId: cfg.accountId, campaignId: cfg.campaignId, runnerId: cfg.runnerId,
        runtimeTarget: cfg.runtimeTarget, leaseToken, actions: cfg.actions, ...(cfg.requireAny?.length ? { requireAny: cfg.requireAny } : {})
      }
      const batch = cfg.batch
      const claim: ClaimResponse | BatchClaimResponse = batch
        ? await callUntilAvailable('claim_batch', opts => {
            if (!deps.data.claimBatch) throw new Error('Nơi chạy chưa hỗ trợ nhận cả lô (claim_batch_v1)')
            return deps.data.claimBatch({ ...claimCtx, maxTargets: batch.maxTargets }, opts)
          }, deps.clock, retry, unit.signal, outage)
        : await callUntilAvailable('claim', opts => deps.data.claimTarget(claimCtx, opts), deps.clock, retry, unit.signal, outage)
      if ('leaseToken' in claim && claim.leaseToken) leaseToken = claim.leaseToken
      // Chống gửi lặp N ngày: data đã gửi gần đây bị tạm dừng ngay trong claim (trước "▶️ Xử lý", không nghỉ), như Desktop.
      const cooldownPaused = 'cooldownPaused' in claim && Array.isArray(claim.cooldownPaused) ? claim.cooldownPaused : []
      for (const entry of cooldownPaused) deps.events.progress(cooldownPauseProgress(cfg.campaignId, cfg.actionId, entry))
      if (claim.status === 'cooldown_scan') continue
      // Như Desktop: "🚀 Bắt đầu chiến dịch" chỉ khi thật sự nhận được data để chạy.
      if (claim.status === 'claimed') markStarted()
      if (claim.status !== 'claimed') {
        if (claim.status === 'gate_unavailable') {
          // Như Desktop: "⚠️ Không thể kiểm tra giới hạn gửi/đăng lặp; …"; chỉ in khi câu chờ đổi (ghi chú chiến dịch).
          const note = claim.note?.trim()
          if (note && String(cfg.campaignNote ?? '').trim() !== note) deps.events.progress(campaignNoteProgress(cfg.campaignId, note))
        }
        if (claim.status === 'wait') {
          deps.events.trace({ type: 'claim_wait', wait: claim.wait })
          const note = claim.wait.note?.trim()
          if (note && String(cfg.campaignNote ?? '').replace(/^⏳ /, '').trim() !== note) {
            deps.events.progress(campaignWaitProgress(cfg.campaignId, note))
          }
        }
        let finished: Record<string, unknown> | undefined
        const heldToken = leaseToken
        let noTargetNote: string | null = null
        const prepareTargets = cfg.prepareTargets
        if (claim.status === 'no_target' && prepareTargets && heldToken && !prepared && targets === 0 && !unit.signal.aborted) {
          // Lấy data đầu lượt (Desktop: trước vòng data của executeCampaignV2), một lần mỗi lượt, khi lượt chưa chạy data nào.
          prepared = true
          startHeartbeat()
          let prep: PrepareTargetsResult
          try {
            prep = await prepareTargets({ leaseToken: heldToken, signal: unit.signal, hasTargets: claim.hasTargets ?? true,
              sleep: (ms, s) => deps.clock.sleep(ms, s ?? unit.signal),
              progress: (text, level = 'info') => deps.events.progress({ campaignId: cfg.campaignId, inputDataId: null, text,
                code: /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(text)?.[1] ?? null, level }),
              trace: event => deps.events.trace(event), markStarted })
          } catch (err) {
            if (err instanceof CancelledError || unit.signal.aborted) return await finish(ownershipLost ? 'ownership_lost' : 'cancelled')
            deps.events.trace({ type: 'prepare_targets_failed', error: errorMessage(err) })
            return await finish('error', { error: errorMessage(err) })
          }
          if (prep.kind === 'retry') continue
          if (prep.kind === 'end') return await finish(prep.reason, prep.detail)
          noTargetNote = prep.note ?? null
        }
        const onNoTarget = cfg.onNoTarget
        if (claim.status === 'no_target' && onNoTarget && heldToken && !unit.signal.aborted) {
          // Còn giữ lease: host kết thúc / hẹn lại chiến dịch trước khi nhả.
          const info = { leaseToken: heldToken, nextSchedule: claim.nextSchedule, runningTargets: claim.runningTargets,
            hasTargets: claim.hasTargets ?? true, dueTried: Number(claim.dueTried ?? 0), dataGroup: claim.dataGroup === true,
            ...(noTargetNote ? { note: noTargetNote } : {}) }
          try {
            finished = await withDeadline('on_no_target', retry.callTimeoutMs, unit.signal, s => onNoTarget(info, s))
            const done = finished ? finishProgress(cfg.campaignId, cfg.campaignName, finished, cfg.runtimeTarget, formatDateTime) : null
            // Kết thúc lượt mà chiến dịch vẫn chờ với cùng ghi chú (ví dụ bạn bè tự lấy data nhưng chưa có data): không in lại mỗi
            // lần quét, như câu chờ của claim.
            const unchangedNote = finished?.reason === 'friend_auto_no_data'
              && String(cfg.campaignNote ?? '').trim() === 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy'
            if (done && !unchangedNote) deps.events.progress(done)
          } catch (err) {
            deps.events.trace({ type: 'on_no_target_failed', error: errorMessage(err) })
          }
        }
        // Câu dừng như Desktop/VPS, chỉ khi lượt đã chạy data (nhận lượt ngay lúc vượt mốc thì không có gì để báo).
        if (started && claim.status === 'daily_boundary') deps.events.progress(dailyBoundaryProgress(cfg.campaignId, claim.stopTime))
        // Như finalizeDataGroupCampaignAtHardEnd: chỉ in khi hàm kết thúc Nhóm data đã hoàn thành chiến dịch.
        if (claim.status === 'data_group_hard_end' && claim.finalize?.completed === true) {
          deps.events.progress({ campaignId: cfg.campaignId, inputDataId: null, text: '⏹ Chiến dịch đã hết thời hạn nhận và chạy data mới', code: null, level: 'info' })
        }
        if (claim.status === 'campaign_paused') { controlStop ??= { kind: 'campaign_paused' }; printControlStop() }
        if (claim.status === 'account_paused' || claim.status === 'account_logged_out') {
          controlStop ??= { kind: 'account', reason: claim.status === 'account_logged_out' ? 'logged_out' : 'paused',
            status: claim.status === 'account_paused' ? claim.accountStatus ?? null : null }
          printControlStop()
        }
        return await finish(claim.status, { claim, ...(finished ? { finished } : {}) })
      }

      startHeartbeat()
      if ('items' in claim) {
        // Gửi dạng chia sẻ: chạy cả lô (claim_batch_v1 chỉ trả items khi nơi chạy gọi chế độ lô).
        if (!batch) return await finish('error', { error: 'batch_claim_without_batch_config' })
        const end = await runBatch(claim, batch)
        if (end.stop) {
          if (!unit.signal.aborted && (end.reason === 'stop_account' || end.reason === 'campaign_paused')) printControlStop()
          return await finish(unit.signal.aborted && !ownershipLost ? 'cancelled' : end.reason, end.detail)
        }
        paceMs = end.paceMs
        continue
      }
      if (!validated) {
        validated = true
        const issue = (await cfg.validateCampaign?.())?.find(item => item.scope === 'campaign')
        if (issue) {
          deps.events.progress(configIssueProgress(cfg.campaignId, issue))
          const action = cfg.actions[0]?.code ?? 'unknown'
          const res = handleResponse(claim, await send(claim, [toReport(claim, { key: '__config', actionCode: action },
            { ok: false, phase: 'before_send', signal: { kind: 'engine', code: issue.publicCode, errorCode: issue.errorCode, message: issue.message } })], true))
          if (!('ok' in res)) return await finish(res.stop ? res.reason : 'error', res.stop ? res.detail : undefined)
          afterTarget(claim, res)
          return await finish('config_invalid', { issue })
        }
      }

      targets++
      const end = await runTarget(claim)
      // Bị dừng từ ngoài thì lý do kết thúc là "đã dừng", dù DB chỉ thị end_unit cho data đang dở.
      if (end.stop) {
        if (!unit.signal.aborted && (end.reason === 'stop_account' || end.reason === 'campaign_paused')) printControlStop()
        return await finish(unit.signal.aborted && !ownershipLost ? 'cancelled' : end.reason, end.detail)
      }
      paceMs = end.paceMs
    }
  } catch (err) {
    if (err instanceof CancelledError) return await finish(ownershipLost ? 'ownership_lost' : 'cancelled')
    deps.events.trace({ type: 'unit_error', error: errorMessage(err) })
    return await finish('error', { error: errorMessage(err) })
  } finally {
    heartbeatStop.abort()
    signal.removeEventListener('abort', onParentAbort)
  }
}
