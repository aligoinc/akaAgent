/**
 * Giữ không nhận việc mới sau khi máy ngủ (đo 18/11/2026, docs/DESKTOP_SLEEP_GUARD.md).
 *
 * Mac đang ngủ vẫn thức tạm (dark wake) ~16 phút một lần, mỗi lần 4–5 giây. Lúc đó mọi timer quá hạn chạy dồn, bộ lập
 * lịch nhận data, ghi dấu "sắp gửi" rồi máy ngủ lại giữa lệnh gửi: lượt bị đóng stale (`err_engine_interrupted_while_sending`)
 * hoặc báo muộn "không rõ đã tới", data không được gửi lại.
 *
 * Bật "giữ" khi máy báo sắp ngủ (powerMonitor 'suspend') hoặc nhịp đếm trễ từ 60 giây (máy vừa bị đóng băng; kiểm ngay lúc
 * bộ lập lịch hỏi nên không thua các timer chạy dồn). Thôi giữ khi có thao tác bàn phím/chuột sau lần thức, mở khoá màn hình,
 * hoặc máy thức liên tục đủ `awakeMinutes`. Chỉ chặn việc MỚI; lệnh đang gửi chạy nốt.
 *
 * Công tắc theo hệ điều hành ở auto_system_settings `desktop.sleep_guard`, ví dụ {"mac":true,"win":false,"awakeMinutes":10};
 * thiếu dòng / sai = mặc định (Mac bật, Windows tắt, 10 phút). Không import Electron để kiểm offline được.
 */

export type SleepGuardPlatform = 'mac' | 'win'

export interface SleepGuardSwitch {
  mac: boolean
  win: boolean
  /** Thức liên tục bao nhiêu phút (không có thao tác) thì thôi giữ. */
  awakeMinutes: number
}

export const SLEEP_GUARD_SETTING_KEY = 'desktop.sleep_guard'
export const DEFAULT_SLEEP_GUARD_SWITCH: Readonly<SleepGuardSwitch> = Object.freeze({ mac: true, win: false, awakeMinutes: 10 })
/** Nhịp đếm trễ từ mức này coi như máy vừa bị đóng băng (ngủ). Lần thức tạm đo được cách nhau ~16 phút. */
export const SLEEP_GUARD_GAP_MS = 60_000
export const SLEEP_GUARD_BEAT_MS = 1_000
/** Đọc lại công tắc mỗi 10 phút (cả lúc đang giữ, để tắt từ xa cứu được máy đang giữ). */
export const SLEEP_GUARD_SETTING_REFRESH_MS = 10 * 60_000
const MAX_AWAKE_MINUTES = 120

export type SleepHoldReason = 'suspend' | 'clock_gap'
export type SleepReleaseReason = 'user_active' | 'awake' | 'disabled'

export interface SleepHoldSnapshot {
  since: string
  reason: SleepHoldReason
}

/** Giá trị thiết lập (chuỗi JSON hoặc object) → công tắc; thiếu / sai từng khoá thì lấy mặc định của khoá đó. */
export function parseSleepGuardSwitch(raw: unknown): SleepGuardSwitch {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { value = null }
  }
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const minutes = typeof row.awakeMinutes === 'number' ? row.awakeMinutes : Number.NaN
  return {
    mac: typeof row.mac === 'boolean' ? row.mac : DEFAULT_SLEEP_GUARD_SWITCH.mac,
    win: typeof row.win === 'boolean' ? row.win : DEFAULT_SLEEP_GUARD_SWITCH.win,
    awakeMinutes: Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_AWAKE_MINUTES
      ? minutes : DEFAULT_SLEEP_GUARD_SWITCH.awakeMinutes
  }
}

/** process.platform → khoá công tắc; hệ điều hành khác không bật. */
export function sleepGuardPlatform(platform: string): SleepGuardPlatform | null {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return null
}

export interface SystemSleepGuardDeps {
  platform: SleepGuardPlatform | null
  wallNow?: () => number
  monoNow?: () => number
  /** Số giây từ lần bấm phím / di chuột gần nhất (powerMonitor.getSystemIdleTime); null khi không đọc được. */
  idleSeconds?: () => number | null
  onHold?: (reason: SleepHoldReason) => void
  onRelease?: (reason: SleepReleaseReason) => void
}

interface SleepHold {
  sinceWall: number
  reason: SleepHoldReason
  /** Mốc (đồng hồ đơn điệu) bắt đầu lần thức hiện tại; lần ngủ mới thì đặt lại. */
  awakeSinceMono: number
}

export class SystemSleepGuard {
  private switchValue: SleepGuardSwitch = { ...DEFAULT_SLEEP_GUARD_SWITCH }
  private hold: SleepHold | null = null
  private lastBeat: { wall: number; mono: number } | null = null
  private readonly wallNow: () => number
  private readonly monoNow: () => number

  constructor(private readonly deps: SystemSleepGuardDeps) {
    this.wallNow = deps.wallNow ?? (() => Date.now())
    this.monoNow = deps.monoNow ?? (() => performance.now())
  }

  get enabled(): boolean {
    const platform = this.deps.platform
    return platform !== null && this.switchValue[platform] === true
  }

  get switchState(): Readonly<SleepGuardSwitch> {
    return this.switchValue
  }

  /** Công tắc đọc từ DB; tắt khi đang giữ thì thôi giữ ngay. */
  setSwitch(value: SleepGuardSwitch): void {
    this.switchValue = parseSleepGuardSwitch(value)
    if (!this.enabled && this.hold) this.release('disabled')
  }

  /** powerMonitor 'suspend': máy sắp ngủ. */
  noteSuspend(): void {
    this.engage('suspend', this.wallNow(), this.monoNow())
  }

  /** powerMonitor 'resume' (kể cả lần thức tạm): chỉ kiểm nhịp, không tự thôi giữ. */
  noteResume(): void {
    this.beat()
  }

  /** Mở khoá màn hình / phiên người dùng hoạt động lại: có người dùng thật. */
  noteUserActive(): void {
    if (this.hold) this.release('user_active')
  }

  /** Nhịp đếm mỗi giây: nhịp trễ từ 60 giây là máy vừa bị đóng băng; còn lại thì xét thôi giữ. */
  beat(): void {
    const wall = this.wallNow()
    const mono = this.monoNow()
    const last = this.lastBeat
    this.lastBeat = { wall, mono }
    // Đồng hồ máy lùi (chỉnh giờ) cho khoảng âm: không tính là ngủ.
    if (last && Math.max(wall - last.wall, mono - last.mono) >= SLEEP_GUARD_GAP_MS) {
      this.engage('clock_gap', wall, mono)
      return
    }
    this.evaluate(mono)
  }

  /** Bộ lập lịch hỏi trước khi bắt đầu việc mới. Kiểm nhịp ngay tại đây, vì lúc máy thức các timer quá hạn chạy dồn trước nhịp đếm. */
  canStartWork(): boolean {
    if (!this.enabled) return true
    this.beat()
    return this.hold === null
  }

  /**
   * Trạng thái giữ cho ảnh chụp runtime gửi kèm presence; không giữ thì null. Kiểm nhịp trước, vì lần thức tạm chỉ có một
   * ping presence và ping đó có thể chạy trước nhịp đếm.
   */
  snapshot(): SleepHoldSnapshot | null {
    if (!this.enabled) return null
    this.beat()
    if (!this.hold) return null
    return { since: new Date(this.hold.sinceWall).toISOString(), reason: this.hold.reason }
  }

  private engage(reason: SleepHoldReason, wall: number, mono: number): void {
    if (!this.enabled) return
    if (this.hold) {
      // Ngủ thêm lần nữa: đếm lại thời gian thức, giữ lý do và mốc bắt đầu giữ.
      this.hold.awakeSinceMono = mono
      return
    }
    this.hold = { sinceWall: wall, reason, awakeSinceMono: mono }
    this.deps.onHold?.(reason)
  }

  private evaluate(mono: number): void {
    const hold = this.hold
    if (!hold) return
    const awakeMs = mono - hold.awakeSinceMono
    let idle: number | null = null
    try { idle = this.deps.idleSeconds?.() ?? null } catch { idle = null }
    // Có thao tác sau lần thức: thời gian không thao tác ngắn hơn thời gian đã thức. Lần thức tạm không có thao tác nào.
    // Hệ điều hành trả số giây làm tròn xuống, nên cộng 1 giây để lần thức tạm ngay sau thao tác cuối không bị tính là có người.
    if (idle !== null && Number.isFinite(idle) && idle >= 0 && (idle + 1) * 1000 <= awakeMs) {
      this.release('user_active')
      return
    }
    if (awakeMs >= this.switchValue.awakeMinutes * 60_000) this.release('awake')
  }

  private release(reason: SleepReleaseReason): void {
    this.hold = null
    this.deps.onRelease?.(reason)
  }
}
