/**
 * Ranh giới lỗi: mọi lời gọi ra ngoài có hạn giờ và huỷ được qua withDeadline; ngoại lệ còn sót
 * ở một bước được bọc thành tín hiệu, không bao giờ làm sập lượt chạy.
 */
import type { Phase, RawOutcome } from './contracts.js'

export class DeadlineError extends Error {
  constructor(readonly label: string, readonly ms: number) {
    super(`${label}: quá ${ms} ms`)
    this.name = 'DeadlineError'
  }
}

export class CancelledError extends Error {
  constructor(readonly label: string) {
    super(`${label}: đã huỷ`)
    this.name = 'CancelledError'
  }
}

/**
 * Chạy fn với hạn giờ ms. Hết giờ hoặc parent bị huỷ thì signal của fn bị abort và lời gọi trả lỗi ngay,
 * không chờ fn tự kết thúc. Bộ hẹn giờ và listener luôn được dọn.
 */
export async function withDeadline<T>(label: string, ms: number, parent: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (parent?.aborted) throw new CancelledError(label)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onParentAbort: (() => void) | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DeadlineError(label, ms)
      controller.abort(error)
      reject(error)
    }, Math.max(0, ms))
    onParentAbort = () => {
      const error = new CancelledError(label)
      controller.abort(error)
      reject(error)
    }
    parent?.addEventListener('abort', onParentAbort, { once: true })
  })
  try {
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), guard])
  } finally {
    if (timer) clearTimeout(timer)
    if (onParentAbort) parent?.removeEventListener('abort', onParentAbort)
    guard.catch(() => undefined)
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

const TRANSIENT_ERRNO = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
  'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])
/** Mã PostgreSQL / PostgREST mà gọi lại sau có thể thành công. */
const TRANSIENT_SQLSTATE = /^(08|53|57P0|57014|40001|40P01|55P03|PGRST00[0-3])/

/** Lỗi gọi DB có phải tạm thời (mạng, timeout, Supabase sập, pool đầy) không. */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof DeadlineError) return true
  if (err instanceof CancelledError) return false
  const anyErr = err as { code?: unknown; status?: unknown; cause?: unknown; message?: unknown } | null
  const code = typeof anyErr?.code === 'string' ? anyErr.code : ''
  if (TRANSIENT_ERRNO.has(code) || TRANSIENT_SQLSTATE.test(code)) return true
  const status = Number(anyErr?.status)
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true
  const message = errorMessage(err).toLowerCase()
  if (/fetch failed|network|socket hang up|timeout|timed out|connection terminated|econnreset|503|502|504/.test(message)) return true
  return anyErr?.cause ? isTransientDbError(anyErr.cause) : false
}

/**
 * Bọc ngoại lệ của một bước thành kết quả. Bước gửi (delivery) đã ghi dấu "sắp gửi" thì không biết
 * nền tảng đã nhận chưa: pha in_flight (không gửi lại). Bước khác: before_send.
 */
export function stepFailure(err: unknown, delivery: boolean): RawOutcome {
  const phase: Phase = delivery ? 'in_flight' : 'before_send'
  if (err instanceof DeadlineError) return { ok: false, phase, signal: { kind: 'timeout', code: err.label, message: err.message } }
  if (err instanceof CancelledError) return { ok: false, phase, signal: { kind: 'engine', code: 'cancelled', errorCode: 'err_engine_cancelled', message: err.message } }
  return { ok: false, phase, signal: { kind: 'exception', message: errorMessage(err).slice(0, 500) } }
}
