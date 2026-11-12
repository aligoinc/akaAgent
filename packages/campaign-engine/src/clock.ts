/** Đồng hồ thật cho nơi chạy: nghỉ huỷ được bằng AbortSignal (không dùng setInterval). */
import type { EngineClock } from './contracts.js'

export const systemClock: EngineClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<boolean>(resolve => {
    if (signal?.aborted) return resolve(false)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, Math.max(0, ms))
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
