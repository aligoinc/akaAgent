/**
 * Công tắc engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server, V667; docs/ENGINE_V2_VPS_ZALO_SERVER_PLAN.md).
 *
 * Đọc aka_agent_engine_server_enabled_orgs_v1() (thiết lập engine.zalo_server_vps) 60 giây một lần, dùng chung cho mọi nhân viên trong
 * tiến trình App Server. Đây chỉ là bước lọc trước: claim (nơi chạy 'server') kiểm lại mỗi lần nhận lượt và trả not_enabled khi công tắc
 * vừa tắt, khi đó bộ chạy cho chiến dịch chạy bộ cũ một lúc.
 *   - Chưa đọc được lần nào: 'loading' (bộ lập lịch bỏ qua chiến dịch tới lượt quét sau, không để bộ cũ chạy chiến dịch của tổ chức đã bật).
 *   - DB chưa có hàm (chưa apply V667): coi như tắt, mọi chiến dịch chạy bộ cũ như trước.
 *   - Lỗi tạm (mạng, DB chậm): giữ kết quả lần đọc trước, thử lại ở lần hỏi sau 60 giây.
 */
import { getSupabaseClient } from '../data/supabaseClient'
import { monotonicNow } from '../../shared/monotonicNow'

export type ServerEngineGateMode = 'off' | 'orgs' | 'all'
export type ServerEngineGateState = 'enabled' | 'disabled' | 'loading'
export interface ServerEngineGateSnapshot { mode: ServerEngineGateMode; organizationIds: ReadonlySet<number> }

export const SERVER_ENGINE_GATE_REFRESH_MS = 60_000
/** Chưa đọc được công tắc lần nào sau ngần này thì coi như tắt (bộ cũ chạy), để lỗi đọc kéo dài không làm đứng mọi chiến dịch trên VPS. */
const LOADING_GRACE_MS = 120_000
const READ_TIMEOUT_MS = 15_000
const OFF: ServerEngineGateSnapshot = Object.freeze({ mode: 'off', organizationIds: new Set<number>() })

/** Kết quả RPC → trạng thái công tắc. Sai định dạng = tắt. */
export function parseServerEngineGate(raw: unknown): ServerEngineGateSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return OFF
  const value = raw as { mode?: unknown; organizationIds?: unknown }
  if (value.mode === 'all') return { mode: 'all', organizationIds: new Set() }
  if (value.mode !== 'orgs' || !Array.isArray(value.organizationIds)) return OFF
  const ids = new Set<number>()
  for (const item of value.organizationIds) {
    const id = typeof item === 'number' ? item : typeof item === 'string' && /^[0-9]{1,18}$/.test(item.trim()) ? Number(item.trim()) : Number.NaN
    if (Number.isSafeInteger(id) && id > 0) ids.add(id)
  }
  return { mode: 'orgs', organizationIds: ids }
}

export function serverEngineGateAllows(snapshot: ServerEngineGateSnapshot, organizationId: number | null | undefined): boolean {
  if (snapshot.mode === 'all') return organizationId != null
  if (snapshot.mode !== 'orgs' || organizationId == null) return false
  return snapshot.organizationIds.has(Number(organizationId))
}

type Reader = () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>

/** Bộ nhớ đệm công tắc; tách khỏi module để bài kiểm dựng bộ riêng với đồng hồ / bộ đọc giả. */
export class ServerEngineGate {
  private snapshot: ServerEngineGateSnapshot | null = null
  private loadedAt: number | null = null
  private attemptedAt: number | null = null
  private firstAttemptAt: number | null = null
  private pending: Promise<void> | null = null

  constructor(private readonly read: Reader, private readonly now: () => number = monotonicNow,
    private readonly refreshMs: number = SERVER_ENGINE_GATE_REFRESH_MS, private readonly loadingGraceMs: number = LOADING_GRACE_MS) {}

  /**
   * Trạng thái của tổ chức theo lần đọc gần nhất; tới hạn thì đọc lại ở nền (không chờ). Chưa đọc được lần nào quá LOADING_GRACE_MS (lỗi
   * kéo dài ngay từ đầu) thì coi như tắt để bộ cũ vẫn chạy, vẫn thử đọc lại mỗi 60 giây.
   */
  state(organizationId: number | null | undefined): ServerEngineGateState {
    this.refreshIfDue()
    if (!this.snapshot) {
      return this.firstAttemptAt !== null && this.now() - this.firstAttemptAt > this.loadingGraceMs ? 'disabled' : 'loading'
    }
    return serverEngineGateAllows(this.snapshot, organizationId) ? 'enabled' : 'disabled'
  }

  /** Đã đọc được trong 60 giây qua thì xong ngay; chưa thì đọc (App Server gọi trước lượt quét đầu của mỗi nhân viên). Không ném lỗi. */
  async ensureLoaded(): Promise<void> {
    if (this.loadedAt !== null && this.now() - this.loadedAt < this.refreshMs) return
    await this.refresh()
  }

  /** Đọc ngay (dùng lúc App Server khởi động runtime, trước lượt quét đầu). Không ném lỗi. */
  async refresh(): Promise<void> {
    if (this.pending) return this.pending
    this.attemptedAt = this.now()
    if (this.firstAttemptAt === null) this.firstAttemptAt = this.attemptedAt
    const run = async (): Promise<void> => {
      try {
        const { data, error } = await this.read()
        if (error) {
          const code = String(error.code ?? '')
          // DB chưa có V667: mọi chiến dịch chạy bộ cũ. Lỗi khác: giữ lần đọc trước (chưa có thì vẫn 'loading').
          if (code === 'PGRST202' || code === '42883') { this.snapshot = OFF; this.loadedAt = this.now() }
          else console.warn('[ServerEngineGate] read failed', { code, message: error.message })
          return
        }
        this.snapshot = parseServerEngineGate(data)
        this.loadedAt = this.now()
      } catch (err) {
        console.warn('[ServerEngineGate] read failed', { message: err instanceof Error ? err.message : String(err) })
      }
    }
    // Gỡ pending sau khi đã gán (finally chạy ở microtask sau), kể cả khi bộ đọc ném lỗi ngay.
    const pending: Promise<void> = run().finally(() => { if (this.pending === pending) this.pending = null })
    this.pending = pending
    return pending
  }

  private refreshIfDue(): void {
    if (this.pending) return
    const last = Math.max(this.loadedAt ?? Number.NEGATIVE_INFINITY, this.attemptedAt ?? Number.NEGATIVE_INFINITY)
    if (Number.isFinite(last) && this.now() - last < this.refreshMs) return
    void this.refresh()
  }
}

let shared: ServerEngineGate | null = null

/** Công tắc dùng chung của tiến trình App Server. */
export function serverEngineGate(): ServerEngineGate {
  if (!shared) {
    shared = new ServerEngineGate(async () => {
      const { data, error } = await getSupabaseClient().rpc('aka_agent_engine_server_enabled_orgs_v1').abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS))
      return { data, error }
    })
  }
  return shared
}
