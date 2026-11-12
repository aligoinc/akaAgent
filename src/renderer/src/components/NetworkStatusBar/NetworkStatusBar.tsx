import { useEffect, useState } from 'react'
import { Loader2, Wifi, WifiOff } from 'lucide-react'
import { NETWORK_LONG_OFFLINE_FAILED_CHECKS, NETWORK_RECHECK_SECONDS, checkNetworkNow, useNetworkStatus } from '../../lib/networkStatus'
import './NetworkStatusBar.css'

const RECHECK_MS = NETWORK_RECHECK_SECONDS * 1000
const remainingMs = (deadline: number | null) => deadline === null ? 0 : Math.max(0, Math.min(RECHECK_MS, deadline - Date.now()))

/**
 * Dòng báo mất mạng (docs/NETWORK_STATUS_BAR_DESKTOP.md, port Web #212): thẻ nhỏ treo ngay dưới thanh tiêu đề cửa sổ,
 * giữa màn hình. Đếm ngược tới lượt kiểm tra lại kèm vạch ngắn dần; từ lượt thử thất bại thứ 3 gợi ý việc cần làm.
 */
export default function NetworkStatusBar() {
  const { phase, checking, nextCheckAt, failedChecks } = useNetworkStatus()
  const counting = phase === 'offline' && !checking && nextCheckAt !== null
  // Số giây tính từ mốc kiểm tra kế tiếp ở mỗi lần vẽ; bộ đếm này chỉ để vẽ lại mỗi giây.
  const [, setTick] = useState(0)
  const remaining = remainingMs(nextCheckAt)
  const seconds = Math.ceil(remaining / 1000)

  useEffect(() => {
    if (!counting) return
    const interval = window.setInterval(() => setTick((tick) => tick + 1), 1000)
    return () => window.clearInterval(interval)
  }, [counting, nextCheckAt])

  if (phase === 'online') return null
  if (phase === 'restored') return <div className="network-status-bar is-restored">
    <Wifi className="network-status-icon" aria-hidden="true" />
    <span className="network-status-message" role="status"><strong>Đã có mạng trở lại.</strong></span>
  </div>

  const waiting = counting && seconds > 0
  const longOffline = failedChecks >= NETWORK_LONG_OFFLINE_FAILED_CHECKS
  return <div className={`network-status-bar is-offline${longOffline ? ' is-long' : ''}`}>
    <WifiOff className="network-status-icon" aria-hidden="true" />
    <div className="network-status-text">
      <span className="network-status-message" role="status">
        <strong>{longOffline ? 'Vẫn chưa có mạng.' : 'Mất kết nối mạng.'}</strong>
        {longOffline && <span className="network-status-hint">Hãy xem lại wifi hoặc dây mạng.</span>}
      </span>
      {/* Số giây đổi mỗi giây nên nằm ngoài vùng role="status", tránh trình đọc màn hình đọc lại liên tục. */}
      {waiting
        ? <span className="network-status-countdown">Kiểm tra lại sau <strong>{seconds}</strong> giây</span>
        : <span className="network-status-countdown is-checking"><Loader2 className="animate-spin" size={13} aria-hidden="true" />Đang kiểm tra lại…</span>}
    </div>
    {/* Phần nhìn thấy là nhãn bên trong; vùng bấm cao bằng cả thẻ, không tràn xuống đè lên nút của trang bên dưới. */}
    {waiting && <button type="button" className="network-status-retry" onClick={checkNetworkNow}>
      <span className="network-status-retry-label">Kiểm tra ngay</span>
    </button>}
    {waiting && <span className="network-status-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${remaining / RECHECK_MS})` }} />
    </span>}
  </div>
}
