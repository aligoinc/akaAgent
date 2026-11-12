/**
 * Nghỉ giữa 2 lần gửi theo chỉ thị của DB (pace_mode), chỉ khi còn data đến hạn phía sau.
 * Không có hạn mức kiểu mới: hạn mức hiện có vẫn do cổng claim kiểm.
 */
import type { PaceMode } from './contracts.js'

export interface PaceSettings {
  /** "Nghỉ giữa 2 lần" của chiến dịch (actionLimits.sleepBetweenActions, fallback timeSleepBetween2), giây. */
  fullSeconds: number
  /** Nghỉ ngắn khi chính sách chọn short, giây (mặc định 5). */
  shortSeconds?: number
}

/**
 * full: pace_seconds nếu DB khai, không thì "Nghỉ giữa 2 lần" của chiến dịch. short: pace_seconds (mặc định shortSeconds)
 * nhưng không bao giờ dài hơn "Nghỉ giữa 2 lần" của chiến dịch (nghỉ ngắn là để nhanh hơn, không chậm hơn cấu hình của khách).
 */
export function paceDelayMs(pace: { mode: PaceMode; seconds: number | null } | null | undefined, settings: PaceSettings): number {
  if (!pace) return 0
  if (pace.mode === 'none') return 0
  const explicit = typeof pace.seconds === 'number' && Number.isFinite(pace.seconds) && pace.seconds >= 0 ? pace.seconds : null
  const full = Number.isFinite(settings.fullSeconds) ? Math.max(0, settings.fullSeconds) : 0
  const seconds = pace.mode === 'short' ? Math.min(explicit ?? settings.shortSeconds ?? 5, full) : explicit ?? full
  return Math.max(0, Math.round(seconds * 1000))
}
