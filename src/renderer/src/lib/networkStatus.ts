import { useEffect, useSyncExternalStore } from 'react'

/**
 * Theo dõi việc app còn tới được máy chủ dữ liệu hay không, cho dòng báo mất mạng (docs/NETWORK_STATUS_BAR_DESKTOP.md).
 *
 * Port từ Web (akaAgentWebApp `apps/web/src/lib/networkStatus.ts`, #212), khác ở hai chỗ:
 * - lượt thử gọi main qua IPC (`probeNetwork`: `GET <máy chủ dữ liệu>/auth/v1/health`) thay vì `fetch('/healthz')`;
 * - request lỗi mạng / có phản hồi do main báo sang (`onNetworkRequestSignal`), vì request đi từ main chứ không từ trang.
 *
 * Không hẹn giờ khi đang có mạng. Chỉ thử kết nối khi có dấu hiệu mất mạng: trình duyệt báo offline, hoặc main báo
 * một request lỗi mạng. Khi đã mất mạng thì 60 giây thử lại một lần.
 */
export type NetworkPhase = 'online' | 'offline' | 'restored'

export interface NetworkStatusSnapshot {
  phase: NetworkPhase
  /** Đang thử lại kết nối; chỉ có nghĩa khi `phase` là `offline`. */
  checking: boolean
  /** Mốc thời gian (ms) của lượt thử lại kế tiếp khi đang mất mạng. */
  nextCheckAt: number | null
  /** Số lượt thử thất bại liên tiếp kể từ khi mất mạng (lượt làm hiện dòng báo là 1). */
  failedChecks: number
}

export const NETWORK_RECHECK_SECONDS = 60
/** Từ lượt thử thất bại thứ 3 (lần thử lại thứ 2, khoảng 2 phút sau khi mất mạng) dòng báo gợi ý việc cần làm. */
export const NETWORK_LONG_OFFLINE_FAILED_CHECKS = 3
export const NETWORK_RESTORED_NOTICE_MS = 4_000
/** Main tự cắt lượt thử ở 8 giây; mốc này chỉ phòng IPC không trả lời. */
const PROBE_TIMEOUT_MS = 10_000
/** Một request lỗi trong khi máy chủ vẫn trả lời không được kéo theo lượt thử liên tục. */
const REQUEST_FAILURE_PROBE_COOLDOWN_MS = 15_000

const ONLINE: NetworkStatusSnapshot = { phase: 'online', checking: false, nextCheckAt: null, failedChecks: 0 }

let snapshot = ONLINE
const listeners = new Set<() => void>()
let users = 0
let timer: number | null = null
/** Lượt thử đang chạy; dừng theo dõi thì bỏ trống để lượt cũ không ghi đè trạng thái. */
let activeCheck: object | null = null
let probeAgain = false
let lastConfirmedAt = 0
let lastRequestSuccessAt = 0
/** Có request lỗi mạng (hoặc đang mất mạng) lúc chưa có dòng báo nào được gắn, ví dụ lúc đổi từ màn đăng nhập sang app; thử ngay khi gắn. */
let failureBeforeStart = false
let unsubscribeMain: (() => void) | null = null

const emit = (next: NetworkStatusSnapshot) => {
  snapshot = next
  listeners.forEach((listener) => listener())
}

const clearTimer = () => {
  if (timer === null) return
  window.clearTimeout(timer)
  timer = null
}

const probe = async () => {
  const api = window.electronAPI
  if (!api?.probeNetwork) return true
  let timeout: number | undefined
  try {
    return await Promise.race([
      api.probeNetwork(),
      new Promise<boolean>((resolve) => { timeout = window.setTimeout(() => resolve(false), PROBE_TIMEOUT_MS) })
    ])
  } catch {
    return false
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

const startCountdown = () => {
  clearTimer()
  const failedChecks = (snapshot.phase === 'offline' ? snapshot.failedChecks : 0) + 1
  emit({ phase: 'offline', checking: false, nextCheckAt: Date.now() + NETWORK_RECHECK_SECONDS * 1000, failedChecks })
  timer = window.setTimeout(() => { timer = null; void check() }, NETWORK_RECHECK_SECONDS * 1000)
}

const showRestored = () => {
  clearTimer()
  lastConfirmedAt = Date.now()
  emit({ phase: 'restored', checking: false, nextCheckAt: null, failedChecks: 0 })
  timer = window.setTimeout(() => { timer = null; emit(ONLINE) }, NETWORK_RESTORED_NOTICE_MS)
}

/** Thử kết nối một lần rồi chuyển trạng thái. Lượt gọi tới trong lúc đang thử sẽ thử thêm một lần sau đó. */
const check = async () => {
  if (!users) return
  if (activeCheck) { probeAgain = true; return }
  const run = {}
  activeCheck = run
  if (snapshot.phase === 'offline') {
    clearTimer()
    emit({ ...snapshot, checking: true, nextCheckAt: null })
  }
  let reachable = false
  do {
    probeAgain = false
    const startedAt = Date.now()
    // Một request có phản hồi trong lúc thử cũng là bằng chứng đã có mạng.
    reachable = await probe() || lastRequestSuccessAt >= startedAt
  } while (probeAgain && activeCheck === run)
  if (activeCheck !== run) return
  activeCheck = null
  failureBeforeStart = false
  if (!reachable) { startCountdown(); return }
  lastConfirmedAt = Date.now()
  if (snapshot.phase === 'offline') showRestored()
}

/** Main báo một request tới máy chủ dữ liệu bị lỗi mạng. */
export const reportNetworkRequestFailure = () => {
  if (!users) { failureBeforeStart = true; return }
  if (activeCheck || snapshot.phase === 'offline') return
  if (Date.now() - lastConfirmedAt < REQUEST_FAILURE_PROBE_COOLDOWN_MS) return
  void check()
}

/** Main báo một request tới máy chủ dữ liệu có phản hồi sau lần lỗi. */
export const reportNetworkRequestSuccess = () => {
  failureBeforeStart = false
  if (!users) return
  lastRequestSuccessAt = Date.now()
  if (snapshot.phase === 'offline') showRestored()
}

/** Nút "Kiểm tra ngay" trên dòng báo. */
export const checkNetworkNow = () => { void check() }

// Sự kiện tới giữa lúc đang thử thì thử thêm một lần: lượt đang chạy có thể đã bắt đầu trước khi mạng đổi.
const handleBrowserOffline = () => { if (activeCheck || snapshot.phase !== 'offline') void check() }
const handleBrowserOnline = () => { if (activeCheck || snapshot.phase === 'offline') void check() }
const checkIfDue = () => {
  if (snapshot.phase === 'offline' && !snapshot.checking && (snapshot.nextCheckAt ?? 0) <= Date.now()) void check()
}
const handleVisibilityChange = () => {
  // Hẹn giờ có thể bị hoãn khi cửa sổ ẩn hoặc máy ngủ.
  if (document.visibilityState === 'visible') checkIfDue()
}

const subscribeMainSignals = () => {
  // Giữ lắng nghe suốt đời trang: tín hiệu tới lúc chưa có dòng báo nào được gắn vẫn được ghi nhận.
  if (unsubscribeMain || !window.electronAPI?.onNetworkRequestSignal) return
  unsubscribeMain = window.electronAPI.onNetworkRequestSignal((signal) => {
    if (signal === 'failed') reportNetworkRequestFailure()
    else reportNetworkRequestSuccess()
  })
}

const startNetworkMonitor = () => {
  users += 1
  if (users === 1) {
    subscribeMainSignals()
    window.addEventListener('offline', handleBrowserOffline)
    window.addEventListener('online', handleBrowserOnline)
    window.addEventListener('focus', checkIfDue)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    // Mở app khi đang mất mạng thì không có sự kiện offline nào.
    if (navigator.onLine === false || failureBeforeStart) void check()
  }
  return () => {
    users -= 1
    if (users > 0) return
    window.removeEventListener('offline', handleBrowserOffline)
    window.removeEventListener('online', handleBrowserOnline)
    window.removeEventListener('focus', checkIfDue)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    // Đang mất mạng mà dòng báo bị gỡ (đổi màn đăng nhập ↔ app): dòng báo kế tiếp thử lại ngay thay vì coi như có mạng.
    failureBeforeStart = snapshot.phase === 'offline'
    activeCheck = null
    probeAgain = false
    clearTimer()
    lastConfirmedAt = 0
    lastRequestSuccessAt = 0
    if (snapshot !== ONLINE) emit(ONLINE)
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSnapshot = () => snapshot

/** Bật theo dõi trong lúc component còn hiển thị và trả về trạng thái mạng hiện tại. */
export function useNetworkStatus() {
  useEffect(() => startNetworkMonitor(), [])
  return useSyncExternalStore(subscribe, getSnapshot)
}
