import { useEffect, useRef, useState } from 'react'
import type { CampaignLimitProgressItem } from '../../../shared/campaignLimitProgress'

export interface CampaignLimitProgressState {
  /** false khi DB chưa có hàm đọc: ẩn số, không coi là lỗi. */
  ready: boolean
  /** Giờ máy chủ = Date.now() + clockOffsetMs (tránh lệch đồng hồ của máy người dùng). */
  clockOffsetMs: number
  checkedAtMs: number
  nextDayStartsAtMs: number
  byCampaign: ReadonlyMap<number, CampaignLimitProgressItem>
  /** Lượt đọc gần nhất lỗi: giữ số cũ và làm mờ. */
  stale: boolean
}

const TICK_MS = 20_000
/** Khoảng cách tối thiểu giữa hai lượt đọc cùng tập chiến dịch (danh sách Desktop tự tải lại mỗi ~30 giây). */
export const CAMPAIGN_LIMIT_PROGRESS_MIN_INTERVAL_MS = 60_000

/**
 * Tiến độ giới hạn ngày/giờ của các chiến dịch đang hiện (port từ Web). Đọc sau lượt danh sách tải xong
 * (`revision` đổi) nhưng tối đa một lượt/60 giây cho cùng tập chiến dịch; đổi tập chiến dịch hoặc `force` đổi
 * (bấm Làm mới, vừa sửa giới hạn, vừa mở khóa hành động) thì đọc ngay. Không có bộ hẹn giờ gọi mạng riêng,
 * không tự thử lại. Đổi phiên (`scope`) thì bỏ dữ liệu và phản hồi muộn của phiên cũ. Lỗi giữ số liệu cũ.
 */
export function useCampaignLimitProgress(
  ids: readonly number[], revision: unknown, force: unknown, scope: string | null, enabled = true
): CampaignLimitProgressState | null {
  const [state, setState] = useState<{ scope: string; value: CampaignLimitProgressState } | null>(null)
  const idsKey = ids.join(',')
  const idsRef = useRef(ids)
  idsRef.current = ids
  const last = useRef<{ key: string; force: unknown; at: number } | null>(null)
  // Lượt đọc mới nhất; lượt bị bỏ qua vì chưa đủ 60 giây không được hủy lượt đang chờ của cùng tập chiến dịch.
  const latest = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!enabled || !scope || !idsKey || !window.electronAPI?.getCampaignLimitProgress) return
    const key = `${scope}|${idsKey}`
    const previous = last.current
    if (previous && previous.key === key && previous.force === force && Date.now() - previous.at < CAMPAIGN_LIMIT_PROGRESS_MIN_INTERVAL_MS) return
    last.current = { key, force, at: Date.now() }
    const request = ++latest.current
    const cancelled = () => !mounted.current || latest.current !== request
    void window.electronAPI.getCampaignLimitProgress([...idsRef.current]).then(result => {
      if (cancelled()) return
      const checkedAtMs = Date.parse(result.checkedAt)
      const nextDayStartsAtMs = Date.parse(result.nextDayStartsAt)
      if (!Number.isFinite(checkedAtMs) || !Number.isFinite(nextDayStartsAtMs) || !Array.isArray(result.items)) throw new Error('invalid limit progress')
      setState({ scope, value: {
        ready: result.ready === true, clockOffsetMs: checkedAtMs - Date.now(), checkedAtMs, nextDayStartsAtMs,
        byCampaign: new Map(result.items.map(item => [item.campaignId, item])), stale: false
      } })
    }).catch(() => {
      // Lỗi mạng hoặc phản hồi sai dạng: giữ số cũ (làm mờ), không báo lỗi, không thử lại; lượt danh sách kế tiếp đọc lại.
      if (cancelled()) return
      if (last.current?.key === key) last.current = { ...last.current, at: 0 }
      setState(current => current && current.scope === scope ? { scope, value: { ...current.value, stale: true } } : current)
    })
  }, [enabled, scope, idsKey, revision, force])
  return state && state.scope === scope && enabled ? state.value : null
}

/**
 * Giờ máy chủ (ms), cập nhật mỗi 20 giây khi cửa sổ đang hiện và ngay khi quay lại. Chỉ tính tại chỗ: số
 * "trong giờ" tự giảm khi từng lượt rời khung mà không gọi mạng.
 */
export function useServerClock(clockOffsetMs: number | null | undefined, active = true): number {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active || clockOffsetMs == null) return
    const update = () => { if (document.visibilityState !== 'hidden') setTick(value => value + 1) }
    const timer = window.setInterval(update, TICK_MS)
    document.addEventListener('visibilitychange', update)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update) }
  }, [active, clockOffsetMs])
  // Tính lúc vẽ: khung hình đầu tiên sau khi nhận số liệu đã dùng đúng giờ máy chủ.
  return Date.now() + (clockOffsetMs ?? 0)
}
