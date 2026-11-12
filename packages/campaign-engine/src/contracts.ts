/**
 * Hợp đồng chung giữa lõi engine, adapter (Desktop / Fly) và các RPC của V495.
 * Không phụ thuộc Electron, Supabase client hay pg: host tự nối các cổng (port) bên dưới.
 * Thiết kế: docs/CAMPAIGN_OUTCOME_ENGINE.md.
 */

export type Phase = 'before_send' | 'in_flight' | 'after_send'
export type RuntimeTarget = 'desktop' | 'fly'
export type DeliveryState = 'none' | 'delivered' | 'partial' | 'unknown' | 'not_delivered'
export type NextDirective = 'next_step' | 'next_target' | 'end_unit' | 'stop_account' | 'stop_campaign' | 'ownership_lost'
export type PaceMode = 'full' | 'short' | 'none'
export type SignalKind = 'zalo_code' | 'errno' | 'http_status' | 'timeout' | 'message_like' | 'block' | 'exception' | 'fly_command' | 'engine'

/** Tín hiệu thô từ một lớp bất kỳ. DB đổi tín hiệu thành mã lỗi (auto_outcome_signal_rules). */
export interface Signal {
  kind: SignalKind
  /** Mã thô: mã Zalo, errno, HTTP status, mã lệnh Fly, mã engine… */
  code?: string
  message?: string
  /** Mã nội bộ đã biết chắc (auto_error.error_code), ví dụ do luật kiểm cấu hình sinh ra. */
  errorCode?: string
}

export interface Evidence {
  /** Đã giao được một phần (album gửi được vài tệp, chữ gửi rồi tệp lỗi…). */
  partialDelivery?: boolean
  /** Không xác nhận được kết quả dù lỗi trả về sau khi gửi. */
  deliveryState?: 'unknown'
  msgId?: string | null
  [key: string]: unknown
}

/** Kết quả một bước do adapter trả về. Adapter KHÔNG ném lỗi nền tảng; ngoại lệ còn lại là lỗi code. */
export type RawOutcome =
  | {
      ok: true
      /** Mã trạng thái kết quả (auto_status.code), mặc định campaign_detail_success. */
      statusCode?: string
      customerLog?: string
      evidence?: Evidence
      data?: Record<string, unknown>
      /** Dữ liệu chuyển cho bước sau của cùng data (ví dụ UID tìm được ở bước tra số). */
      state?: Record<string, unknown>
      /**
       * Bước không tạo kết quả nào (như helper Desktop trả { ok, skipped } mà không ghi lịch sử: tag bị bỏ qua vì đã là
       * bạn bè…): không báo DB, không tính là đã thành công; bước sau vẫn chạy.
       */
      noOutcome?: boolean
    }
  | {
      ok: false
      phase: Phase
      signal: Signal
      evidence?: Evidence
      data?: Record<string, unknown>
    }

/** Một kết quả gửi lên aka_agent_engine_report_v1. result_key ổn định nên gửi bù là idempotent. */
export interface ReportOutcome {
  resultKey: string
  actionCode: string
  /** Tên thao tác ghi vào lịch sử và câu tiến trình (như actionName của helper Desktop); thiếu thì DB dùng tên trong danh mục. */
  actionName?: string
  stepKey: string
  ok: boolean
  phase: Phase
  statusCode?: string
  signal?: Signal
  evidence?: Evidence
  data?: Record<string, unknown>
  customerLog?: string
}

export interface OutcomeDecision {
  resultKey: string
  actionCode: string
  /** Tên thao tác đã ghi vào lịch sử (DB cũ không trả thì lõi dùng tên của bước). */
  actionName?: string | null
  ok: boolean
  errorCode: string | null
  publicCode: string | null
  errorClass: string | null
  statusId: number | null
  statusCode: string | null
  reportGroup: string | null
  deliveryState: DeliveryState
  countsTowardLimit: boolean
  detailId: number | null
  log: string
  lockUntil: string | null
  replay?: boolean
}

export interface ReportSuccess {
  ok: true
  dryRun: boolean
  next: NextDirective
  pace: { mode: PaceMode; seconds: number | null } | null
  outcomes: OutcomeDecision[]
  target: { done: boolean; status: string | null; note: string | null; schedule: string | null; morePending?: boolean | null }
  streak?: { effect: string; count: number | null; threshold: number | null; source: string | null } | null
  campaign: { effect: string; note: string | null }
  account: { effect: string; loginEffect: string }
  safety: Array<Record<string, unknown>>
}
export interface ReportRejected { ok: false; reason: string; [key: string]: unknown }
export type ReportResponse = ReportSuccess | ReportRejected

export interface GateDecision {
  decision: 'allow' | 'wait' | 'skip'
  gate?: string
  errorCode?: string | null
  until?: string | null
  required: boolean
  /** Câu cho khách khi phải chờ (tên lý do, giờ chạy tiếp, mã), không có emoji. */
  note?: string | null
}

/** Cấu hình một cổng kiểm (auto_engine_gates): open = lỗi kiểm vẫn cho gửi; closed = chờ rồi thử lại. */
export interface GateSetting { onError: 'open' | 'closed' }

export interface ClaimContext {
  staffId: number
  accountId: number
  campaignId: number
  runnerId: string
  runtimeTarget: RuntimeTarget
  leaseToken?: string | null
  /**
   * Thao tác của loại chiến dịch theo thứ tự; required=false thì bị chặn vẫn nhận data (bước đó bị bỏ qua).
   * skippableGates giới hạn loại cổng được bỏ qua (ví dụ chỉ 'quota'); cổng khác vẫn chặn như bắt buộc.
   */
  actions: Array<{ code: string; required?: boolean; skippableGates?: string[]
    /** false: chỉ kiểm khoá, không kiểm hạn mức (V505; huỷ lời mời kết bạn: limit_check_action_codes rỗng ở bản cũ). */
    quota?: boolean }>
  /** Cần ít nhất một thao tác trong nhóm không phải chờ; cả nhóm chờ thì không nhận data. */
  requireAny?: string[]
  // Hạn mức không do bộ chạy truyền: DB tính trong claim theo đúng công thức Desktop/VPS (aka_agent_engine_action_limit).
}

export interface TargetRow {
  id: number
  campaign_id: number
  name: string | null
  phone: string | null
  uid: string | null
  email: string | null
  [column: string]: unknown
}

/** Data bị chống gửi lặp N ngày tạm dừng ngay trong claim (RPC của bộ cũ đã ghi trạng thái/ghi chú cho data). */
export interface CooldownPause { inputDataId: number; name: string | null; phone: string | null; uid: string | null; email: string | null; note: string }

export type ClaimResponse =
  | {
      status: 'claimed'
      targetRunId: number
      leaseToken: string
      leaseExpiresAt: string
      target: TargetRow
      targetKey: string | null
      actions: Record<string, GateDecision>
      /** Cấu hình cổng kiểm theo mã cổng (opt_out, send_exclusion…); DB cũ không trả thì coi như rỗng. */
      gates?: Record<string, GateSetting>
      campaign: { id: number; actionId: string; status: string }
      cooldownPaused?: CooldownPause[]
    }
  /** Khoá/hạn mức bắt buộc: không nhận data, lịch chiến dịch giữ nguyên (V501); nơi chạy tự không hỏi lại tới wait.until. */
  | { status: 'wait'; leaseToken: string; wait: GateDecision; actions: Record<string, GateDecision>; cooldownPaused?: CooldownPause[] }
  /** Đã tạm dừng nhiều data vì chống gửi lặp trong một lần gọi: gọi lại ngay để nhận data kế tiếp. */
  | { status: 'cooldown_scan'; leaseToken: string; cooldownPaused: CooldownPause[] }
  /** Không kiểm được cổng đóng-khi-lỗi (chống gửi lặp): chiến dịch chờ kèm ghi chú (note), tự thử lại ở nhịp sau. */
  | { status: 'gate_unavailable'; leaseToken: string; gate: string; note: string; cooldownPaused?: CooldownPause[] }
  /**
   * Không còn data chưa thử trong lượt. dueTried: data đến hạn đã thử trong lượt này và về hàng đợi (lượt sau thử lại);
   * dataGroup: chiến dịch theo Nhóm data (chờ data mới, không tự hoàn thành).
   */
  | { status: 'no_target'; leaseToken: string; nextSchedule: string | null; runningTargets: number; hasTargets?: boolean; dueTried?: number; dataGroup?: boolean;
      cooldownPaused?: CooldownPause[] }
  | { status: 'not_due'; leaseToken: string; schedule: string }
  | { status: 'campaign_paused' | 'campaign_not_runnable'; leaseToken: string; campaignStatus?: string }
  /** Chiến dịch đang nạp data ban đầu (provisioning_state khác ready). */
  | { status: 'campaign_not_ready'; leaseToken: string; provisioningState?: string | null }
  /** Lịch còn là ngày cũ mà chưa qua bảo trì lịch ngày mới: nơi chạy cập nhật lịch rồi chạy lại (daily_maintenance_required của bản cũ). */
  | { status: 'maintenance_required'; leaseToken: string; schedule: string }
  /** Nhóm data đã hết hạn nhận và chạy data mới: bộ quét hết hạn của bản cũ kết thúc chiến dịch. */
  /** Nhóm data hết hạn: DB đã gọi hàm kết thúc Nhóm data của bản cũ (finalize.completed = đã hoàn thành chiến dịch). */
  | { status: 'data_group_hard_end'; leaseToken: string; finalize?: { completed?: boolean; status?: string; reason?: string } | null }
  /** Nhóm data đang chờ data mới khi bắt đầu lượt: không nhận lượt, không ghi gì (như claim của bản cũ). */
  | { status: 'data_group_waiting'; note?: string | null }
  | { status: 'busy'; runnerId: string; expiresAt: string }
  /** Bộ chạy cũ còn giữ tài khoản (token thao tác) hoặc một chiến dịch của tài khoản: chờ, không chạy chồng. */
  | { status: 'legacy_busy'; scope: 'account' | 'campaign' }
  /** Sau giờ dừng trong ngày hoặc qua ngày mới: không nhận data tới nextAt (bảo trì ngày mới chạy trước). stopTime: giờ dừng đã cấu hình. */
  | { status: 'daily_boundary'; leaseToken: string; nextAt: string; reason: 'daily_stop_due' | 'daily_drain_due' | 'vietnam_day_changed'; stopTime?: string | null }
  | { status: 'not_enabled' | 'not_found' | 'account_mismatch' | 'account_not_found' | 'invalid_request' | 'runtime_not_owner' | 'staff_time_blocked' }
  | { status: 'account_logged_out'; loginStatus?: string | null }
  /** Tài khoản đang tạm dừng (hoặc trạng thái khác "chờ xử lý"/"đang chạy"). */
  | { status: 'account_paused'; accountStatus?: string | null }
  /** Gói của tổ chức không cho loại tài khoản Zalo này (QR / trình duyệt / Server). */
  | { status: 'entitlement_denied' }
  /** Đã đủ số tài khoản Zalo (trình duyệt) chạy đồng thời của nhân viên. */
  | { status: 'concurrency_limit'; max?: number }
  | { status: 'app_access_denied'; reason: string }

/** Một data của lô nhận cùng lúc (gửi dạng chia sẻ, aka_agent_engine_claim_batch_v1). */
export interface BatchClaimItem {
  targetRunId: number
  target: TargetRow
  targetKey: string | null
  actions: Record<string, GateDecision>
}

/**
 * Nhận cả lô (V503): nhận được thì có items (tối đa min(50, maxTargets, lượt còn lại trong ngày / khung giờ)); lần nhận đầu không
 * được thì như claim_target_v1.
 */
export type BatchClaimResponse =
  | {
      status: 'claimed'
      leaseToken: string
      leaseExpiresAt: string
      items: BatchClaimItem[]
      capacity: number
      gates?: Record<string, GateSetting>
      campaign: { id: number; actionId: string; status: string }
      cooldownPaused?: CooldownPause[]
    }
  | Exclude<ClaimResponse, { status: 'claimed' }>

/** Kết quả của một data trong lô (chốt data). */
export interface BatchReportItem { targetRunId: number; outcomes: ReportOutcome[] }

/** Chế độ DB đã chọn cho data trong lô (policyHandling của Desktop). */
export type BatchScope = 'full' | 'target_only' | 'batch_followup'

export interface BatchReportSuccess {
  ok: true
  /** Chỉ thị cho cả lượt sau lô (dừng chiến dịch / tài khoản / lượt, hoặc next_target = chạy lô tiếp). */
  next: NextDirective
  items: Array<{ targetRunId: number; scope: BatchScope; response: ReportSuccess }>
  summary: { items: number; succeeded: number; anyDelivered: boolean; paused: boolean }
  /** Câu dừng sau lô ("⏸ Kết thúc batch: …"): ghi chú chiến dịch của chính sách dừng, hoặc câu "Toàn bộ N target…". */
  stopNote: string | null
  /** Còn data đến hạn chưa thử trong lượt: nghỉ giữa hai lô chỉ khi còn. */
  morePending: boolean
}
export type BatchReportResponse = BatchReportSuccess | ReportRejected

/**
 * Kết quả kết thúc lượt (aka_agent_engine_finish_campaign_v2), theo thứ tự của Desktop. Lõi in câu theo reason.
 * ok=false: không đổi gì (mất lease, chiến dịch đã bị đổi trạng thái, còn data đang chạy, loại chưa hỗ trợ).
 */
export interface FinishResponse {
  ok: boolean
  reason: string
  schedule?: string
  slot?: string
  suffix?: string
  pendingCount?: number
  campaignStatus?: string
  accountStatus?: string | null
}

export interface HeartbeatResponse {
  ok: boolean
  reason?: string
  expiresAt?: string
  control?: {
    campaignStatus: string | null
    campaignDeleted: boolean | null
    accountStatus: string | null
    loginStatus: string | null
    accountDeleted: boolean | null
  }
}
export interface ReleaseResponse { ok: boolean; reason?: string; pendingTargets?: number; openRuns?: number }
export type MarkResponse = { ok: true; markedAt?: string; replay?: boolean } | { ok: false; reason: string }

export interface CallOptions { signal: AbortSignal; timeoutMs: number }

/**
 * Cổng dữ liệu. Desktop: Supabase client có timeout; Fly: pool pg hiện có.
 * Ném lỗi = không gọi được DB (mạng, timeout, Supabase sập); trả {ok:false} = DB từ chối.
 */
export interface EngineDataPort {
  claimTarget(ctx: ClaimContext, opts: CallOptions): Promise<ClaimResponse>
  markSending(targetRunId: number, leaseToken: string, actionCode: string, stepKey: string, opts: CallOptions): Promise<MarkResponse>
  report(targetRunId: number, leaseToken: string, outcomes: ReportOutcome[], final: boolean, opts: CallOptions): Promise<ReportResponse>
  heartbeat(accountId: number, leaseToken: string, opts: CallOptions): Promise<HeartbeatResponse>
  release(accountId: number, leaseToken: string, opts: CallOptions): Promise<ReleaseResponse>
  recordWait?(targetRunId: number, leaseToken: string, errorCode: string | null, until: string | null, seconds: number, opts: CallOptions): Promise<void>
  /** Gửi dạng chia sẻ (V503): nhận cả lô trong cùng lease. */
  claimBatch?(ctx: ClaimContext & { maxTargets: number }, opts: CallOptions): Promise<BatchClaimResponse>
  /**
   * Gửi dạng chia sẻ (V503): báo và chốt cả lô; batchSize = cỡ lô (kể cả data đã báo riêng) cho câu tạm dừng; alreadyStopped = lô đã dừng
   * theo chính sách khi gửi tệp (không ai áp thêm chính sách).
   */
  reportBatch?(leaseToken: string, items: BatchReportItem[], batchSize: number, alreadyStopped: boolean, opts: CallOptions): Promise<BatchReportResponse>
}

/** Nhật ký trên máy: kết quả đã có nằm đây tới khi DB xác nhận (Desktop: SQLite; Fly: journal). */
export interface JournalEntry {
  id: string
  targetRunId: number
  leaseToken: string
  outcomes: ReportOutcome[]
  final: boolean
  createdAt: number
  attempts: number
}
export interface LocalJournal {
  append(entry: JournalEntry): Promise<void>
  update(entry: JournalEntry): Promise<void>
  remove(id: string): Promise<void>
  pending(): Promise<JournalEntry[]>
}

export interface EngineClock {
  now(): number
  /** Trả false nếu bị huỷ giữa chừng. */
  sleep(ms: number, signal?: AbortSignal): Promise<boolean>
}

export type ProgressLevel = 'info' | 'success' | 'warning' | 'error'
export interface ProgressLine {
  campaignId: number
  inputDataId: number | null
  text: string
  /** Mã công khai (Z122, NET01…) nếu có. */
  code: string | null
  level: ProgressLevel
}
export interface TraceEvent { type: string; [key: string]: unknown }
export interface EngineEvents {
  progress(line: ProgressLine): void
  trace(event: TraceEvent): void
}
