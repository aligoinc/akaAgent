// Trả lời yêu cầu ảnh lỗi (V556, phương án mục 12.4; anh chốt Q12: chỉ theo yêu cầu). Nhịp presence 30 giây sẵn có báo số yêu cầu đang mở
// (aka_agent_device_presence_v2); có yêu cầu thì Desktop nhận (diagnostic_next_v1), tìm ảnh trên máy theo bộ lọc, gửi từng ảnh
// (diagnostic_upload_v1, ≤ 2 MB, tối đa 50 ảnh), rồi báo xong (diagnostic_complete_v1). Không thêm lượt gọi định kỳ nào.
import fs from 'node:fs'
import { getSupabaseClient } from '../../data/supabaseClient'
import { findErrorScreenshots, type ScreenshotFilter } from './errorScreenshots'

const MAX_FILES = 50
const MAX_BYTES = 2 * 1024 * 1024
let running: Promise<void> | null = null

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().rpc(name, args).abortSignal(AbortSignal.timeout(30_000))
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as T
}

/** Một lần trả lời mọi yêu cầu đang mở (chạy một luồng; gọi lại khi đang chạy thì dùng chung). */
export function respondToDiagnostics(): Promise<void> {
  running ??= (async () => {
    try {
      const next = await rpc<{ ok?: boolean; requests?: Array<{ id: number; filter: ScreenshotFilter }> }>('aka_agent_desktop_diagnostic_next_v1', {})
      if (next?.ok !== true) return
      for (const request of next.requests ?? []) await respondOne(Number(request.id), request.filter ?? {})
    } catch (error) {
      console.warn('[Diagnostics] Không trả lời được yêu cầu ảnh lỗi:', error)
    } finally {
      running = null
    }
  })()
  return running
}

async function respondOne(requestId: number, filter: ScreenshotFilter): Promise<void> {
  const uploaded: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  try {
    for (const { meta, jpegPath } of findErrorScreenshots(filter, MAX_FILES)) {
      let jpeg: Buffer
      try { jpeg = fs.readFileSync(jpegPath) } catch { skipped.push({ id: meta.id, reason: 'read_failed' }); continue }
      if (jpeg.length > MAX_BYTES) { skipped.push({ id: meta.id, reason: 'too_large' }); continue }
      const res = await rpc<{ ok?: boolean; reason?: string }>('aka_agent_desktop_diagnostic_upload_v1', {
        p_request_id: requestId, p_image_id: meta.id, p_meta: meta, p_jpeg_base64: jpeg.toString('base64')
      })
      if (res?.ok === true) uploaded.push(meta.id)
      else if (res?.reason === 'closed' || res?.reason === 'too_many_files') break
      else skipped.push({ id: meta.id, reason: res?.reason || 'rejected' })
    }
    await rpc('aka_agent_desktop_diagnostic_complete_v1', { p_request_id: requestId,
      p_result: { status: uploaded.length > 0 ? 'done' : 'no_images', uploaded: uploaded.length, imageIds: uploaded, skipped } })
  } catch (error) {
    await rpc('aka_agent_desktop_diagnostic_complete_v1', { p_request_id: requestId,
      p_result: { status: 'failed', uploaded: uploaded.length, imageIds: uploaded, message: error instanceof Error ? error.message : String(error) } })
      .catch(() => undefined)
  }
}
