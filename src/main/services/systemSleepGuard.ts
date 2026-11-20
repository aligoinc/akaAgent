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
 * Từ 20/11/2026 (máy Mac 10.0.0 của một khách: 22 lần thức tạm trong một buổi chiều, lọt 5 lần ở các lần thức 4–15 giây): mọi đường
 * thôi giữ theo người dùng đều đòi máy đã thức LIỀN MẠCH đủ `settleSeconds` (mặc định 60). "Liền mạch" đo bằng nhịp đếm: trong lúc
 * giữ, nhịp trễ từ 5 giây là máy vừa đứng, đếm lại từ đầu (thời gian đứng không được tính là đã thức). Thao tác trong 5 giây đầu sau
 * khi thức không tính là có người (hệ điều hành có thể tự đặt lại bộ đếm "không thao tác" lúc thức). `settleSeconds: 0` = như bản cũ.
 *
 * Công tắc theo hệ điều hành ở auto_system_settings `desktop.sleep_guard`, ví dụ
 * {"mac":true,"win":false,"awakeMinutes":10,"settleSeconds":60}; thiếu dòng / sai = mặc định (Mac bật, Windows tắt, 10 phút, 60 giây).
 * Không import Electron để kiểm offline được.
 */

export type SleepGuardPlatform = 'mac' | 'win'

export interface SleepGuardSwitch {
  mac: boolean
  win: boolean
  /** Thức liên tục bao nhiêu phút (không có thao tác) thì thôi giữ. */
  awakeMinutes: number
  /** Máy phải thức liền mạch bao nhiêu giây thì thao tác / mở khoá mới được tính là có người; 0 = thôi giữ ngay như bản đầu. */
  settleSeconds: number
}

export const SLEEP_GUARD_SETTING_KEY = 'desktop.sleep_guard'
export const DEFAULT_SLEEP_GUARD_SWITCH: Readonly<SleepGuardSwitch> = Object.freeze({ mac: true, win: false, awakeMinutes: 10, settleSeconds: 60 })
/** Nhịp đếm trễ từ mức này coi như máy vừa bị đóng băng (ngủ). Lần thức tạm đo được cách nhau ~16 phút. */
export const SLEEP_GUARD_GAP_MS = 60_000
export const SLEEP_GUARD_BEAT_MS = 1_000
/** Trong lúc giữ, nhịp đếm trễ từ mức này là máy vừa đứng (thức tạm chập chờn): thời gian thức liền mạch đếm lại từ đầu. */
export const SLEEP_GUARD_STALL_MS = 5_000
/** Thao tác trong khoảng này sau khi thức không tính là có người (hệ điều hành có thể tự đặt lại bộ đếm "không thao tác" lúc thức). */
export const SLEEP_GUARD_WAKE_NOISE_MS = 5_000
/** Đọc lại công tắc mỗi 10 phút (cả lúc đang giữ, để tắt từ xa cứu được máy đang giữ). */
export const SLEEP_GUARD_SETTING_REFRESH_MS = 10 * 60_000
const MAX_AWAKE_MINUTES = 120
const MAX_SETTLE_SECONDS = 600

export type SleepHoldReason = 'suspend' | 'clock_gap'
export type SleepReleaseReason = 'user_active' | 'awake' | 'disabled'

export interface SleepHoldSnapshot {
  since: string
  reason: SleepHoldReason
}

/** Lần thôi giữ gần nhất (để tra từ presence khi máy vẫn nhận việc lúc thức tạm): lý do và đã thức liền mạch bao lâu lúc thôi giữ. */
export interface SleepReleaseSnapshot {
  at: string
  reason: SleepReleaseReason
  heldSince: string
  awakeSeconds: number
}

/** Giá trị thiết lập (chuỗi JSON hoặc object) → công tắc; thiếu / sai từng khoá thì lấy mặc định của khoá đó. */
export function parseSleepGuardSwitch(raw: unknown): SleepGuardSwitch {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { value = null }
  }
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const minutes = typeof row.awakeMinutes === 'number' ? row.awakeMinutes : Number.NaN
  const settle = typeof row.settleSeconds === 'number' ? row.settleSeconds : Number.NaN
  return {
    mac: typeof row.mac === 'boolean' ? row.mac : DEFAULT_SLEEP_GUARD_SWITCH.mac,
    win: typeof row.win === 'boolean' ? row.win : DEFAULT_SLEEP_GUARD_SWITCH.win,
    awakeMinutes: Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_AWAKE_MINUTES
      ? minutes : DEFAULT_SLEEP_GUARD_SWITCH.awakeMinutes,
    settleSeconds: Number.isSafeInteger(settle) && settle >= 0 && settle <= MAX_SETTLE_SECONDS
      ? settle : DEFAULT_SLEEP_GUARD_SWITCH.settleSeconds
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
  /** Mốc (đồng hồ đơn điệu) bắt đầu lần thức liền mạch hiện tại; lần ngủ mới hoặc máy vừa đứng thì đặt lại. */
  awakeSinceMono: number
  /** Đã có sự kiện mở khoá / phiên người dùng hoạt động trong lần thức này; chờ thức đủ `settleSeconds` mới thôi giữ. */
  userSeen: boolean
}

export class SystemSleepGuard {
  private switchValue: SleepGuardSwitch = { ...DEFAULT_SLEEP_GUARD_SWITCH }
  private hold: SleepHold | null = null
  private lastRelease: SleepReleaseSnapshot | null = null
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

  /**
   * Mở khoá màn hình / phiên người dùng hoạt động lại. Chỉ ghi nhận; thôi giữ khi máy đã thức liền mạch đủ `settleSeconds`
   * (sự kiện này có thể đến trong một lần thức tạm vài giây mà không có ai ngồi máy).
   */
  noteUserActive(): void {
    if (!this.hold) return
    this.hold.userSeen = true
    this.beat()
  }

  /** Nhịp đếm mỗi giây: nhịp trễ từ 60 giây là máy vừa bị đóng băng; còn lại thì xét thôi giữ. */
  beat(): void {
    const wall = this.wallNow()
    const mono = this.monoNow()
    const last = this.lastBeat
    this.lastBeat = { wall, mono }
    // Đồng hồ máy lùi (chỉnh giờ) cho khoảng âm: không tính là ngủ.
    const gap = last ? Math.max(wall - last.wall, mono - last.mono) : 0
    if (gap >= SLEEP_GUARD_GAP_MS) {
      this.engage('clock_gap', wall, mono)
      return
    }
    // Đang giữ mà nhịp trễ vài giây: máy vừa đứng giữa một lần thức tạm. Thời gian đứng không phải thời gian thức: đếm lại.
    if (this.hold && gap >= SLEEP_GUARD_STALL_MS) {
      this.hold.awakeSinceMono = mono
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

  /** Lần thôi giữ gần nhất của tiến trình này (null khi chưa có); gửi kèm presence để tra vì sao máy nhận việc sau khi ngủ. */
  releaseSnapshot(): SleepReleaseSnapshot | null {
    return this.lastRelease
  }

  private engage(reason: SleepHoldReason, wall: number, mono: number): void {
    if (!this.enabled) return
    if (this.hold) {
      // Ngủ thêm lần nữa: đếm lại thời gian thức, giữ lý do và mốc bắt đầu giữ.
      this.hold.awakeSinceMono = mono
      this.hold.userSeen = false
      return
    }
    this.hold = { sinceWall: wall, reason, awakeSinceMono: mono, userSeen: false }
    this.deps.onHold?.(reason)
  }

  private evaluate(mono: number): void {
    const hold = this.hold
    if (!hold) return
    const awakeMs = mono - hold.awakeSinceMono
    const settleMs = this.switchValue.settleSeconds * 1000
    // Chưa thức liền mạch đủ lâu: lần thức tạm (đo được 1–15 giây) không bao giờ tới đây, dù có sự kiện mở khoá hay bộ đếm
    // "không thao tác" vừa bị hệ điều hành đặt lại.
    if (awakeMs >= settleMs) {
      if (hold.userSeen) {
        this.release('user_active', awakeMs)
        return
      }
      let idle: number | null = null
      try { idle = this.deps.idleSeconds?.() ?? null } catch { idle = null }
      // Có thao tác sau lần thức: thời gian không thao tác ngắn hơn thời gian đã thức. Lần thức tạm không có thao tác nào.
      // Hệ điều hành trả số giây làm tròn xuống, nên cộng 1 giây để lần thức tạm ngay sau thao tác cuối không bị tính là có người.
      // Có `settleSeconds` thì thao tác còn phải đến sau 5 giây đầu của lần thức (bộ đếm có thể bị đặt lại lúc thức).
      const noiseMs = settleMs > 0 ? SLEEP_GUARD_WAKE_NOISE_MS : 0
      if (idle !== null && Number.isFinite(idle) && idle >= 0 && (idle + 1) * 1000 + noiseMs <= awakeMs) {
        this.release('user_active', awakeMs)
        return
      }
    }
    if (awakeMs >= this.switchValue.awakeMinutes * 60_000) this.release('awake', awakeMs)
  }

  private release(reason: SleepReleaseReason, awakeMs = 0): void {
    const hold = this.hold
    this.hold = null
    if (hold) {
      this.lastRelease = { at: new Date(this.wallNow()).toISOString(), reason, heldSince: new Date(hold.sinceWall).toISOString(),
        awakeSeconds: Math.max(0, Math.round(awakeMs / 1000)) }
    }
    this.deps.onRelease?.(reason)
  }
}
