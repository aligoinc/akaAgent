// Trả lời yêu cầu ảnh lỗi (V556, phương án mục 12.4; anh chốt Q12: chỉ theo yêu cầu). Nhịp presence 30 giây sẵn có báo số yêu cầu đang mở
// (aka_agent_device_presence_v2); có yêu cầu thì Desktop nhận (diagnostic_next_v1), tìm ảnh trên máy theo bộ lọc, gửi từng ảnh
// (diagnostic_upload_v1, ≤ 2 MB, tối đa 50 ảnh), rồi báo xong (diagnostic_complete_v1). Không thêm lượt gọi định kỳ nào.
// DOM cả trang lưu kèm ảnh (anh chốt 20/11/2026) gửi cùng lượt qua diagnostic_dom_upload_v1 (V595, bảng riêng auto_desktop_diagnostic_doms),
// nén gzip như tệp trên máy: đo 20/11, gửi request lớn lên Supabase rất chậm (0,5 MB mất 7–16 giây), DOM đã nén 50–80 KB gửi 1–2,5 giây.
// DB chưa có V595 thì chỉ gửi ảnh như cũ.
import fs from 'node:fs'
import { getSupabaseClient } from '../../data/supabaseClient'
import { DOM_UPLOAD_MAX_BYTES, findErrorEvidence, type ErrorScreenshotMeta, type ScreenshotFilter } from './errorScreenshots'

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

/** Kết quả gửi một DOM: 'ok', 'missing' (DB chưa có V595), 'closed' (yêu cầu đã đóng), hoặc lý do bỏ qua. */
async function uploadDom(requestId: number, meta: ErrorScreenshotMeta, domPath: string): Promise<string> {
  let gzip: Buffer
  try { gzip = fs.readFileSync(domPath) } catch { return 'dom_read_failed' }
  if (gzip.length > DOM_UPLOAD_MAX_BYTES) return 'dom_too_large'
  const { data, error } = await getSupabaseClient().rpc('aka_agent_desktop_diagnostic_dom_upload_v1', {
    p_request_id: requestId, p_image_id: meta.id, p_meta: meta, p_gzip_base64: gzip.toString('base64')
  }).abortSignal(AbortSignal.timeout(60_000))
  if (error) {
    const code = String((error as { code?: unknown }).code ?? '')
    return code === 'PGRST202' || code === '42883' ? 'missing' : 'dom_failed'
  }
  const res = data as { ok?: boolean; reason?: string } | null
  if (res?.ok === true) return 'ok'
  if (res?.reason === 'closed') return 'closed'
  return `dom_${res?.reason || 'rejected'}`
}

async function respondOne(requestId: number, filter: ScreenshotFilter): Promise<void> {
  const uploaded: string[] = []
  const doms: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  let domReady = true
  try {
    for (const { meta, jpegPath, domPath } of findErrorEvidence(filter, MAX_FILES)) {
      if (jpegPath) {
        let jpeg: Buffer | null = null
        try { jpeg = fs.readFileSync(jpegPath) } catch { skipped.push({ id: meta.id, reason: 'read_failed' }) }
        if (jpeg && jpeg.length > MAX_BYTES) { skipped.push({ id: meta.id, reason: 'too_large' }); jpeg = null }
        if (jpeg) {
          const res = await rpc<{ ok?: boolean; reason?: string }>('aka_agent_desktop_diagnostic_upload_v1', {
            p_request_id: requestId, p_image_id: meta.id, p_meta: meta, p_jpeg_base64: jpeg.toString('base64')
          })
          if (res?.ok === true) uploaded.push(meta.id)
          else if (res?.reason === 'closed' || res?.reason === 'too_many_files') break
          else skipped.push({ id: meta.id, reason: res?.reason || 'rejected' })
        }
      }
      if (domPath && domReady) {
        const res = await uploadDom(requestId, meta, domPath)
        if (res === 'ok') doms.push(meta.id)
        else if (res === 'closed') break
        else {
          // DB chưa có V595 hoặc yêu cầu đã đủ DOM: thôi gửi DOM, ảnh vẫn gửi tiếp.
          if (res === 'missing' || res === 'dom_too_many_files') domReady = false
          skipped.push({ id: meta.id, reason: res === 'missing' ? 'dom_rpc_missing' : res })
        }
      }
    }
    await rpc('aka_agent_desktop_diagnostic_complete_v1', { p_request_id: requestId,
      p_result: { status: uploaded.length + doms.length > 0 ? 'done' : 'no_images', uploaded: uploaded.length, imageIds: uploaded,
        doms: doms.length, domIds: doms, skipped } })
  } catch (error) {
    await rpc('aka_agent_desktop_diagnostic_complete_v1', { p_request_id: requestId,
      p_result: { status: 'failed', uploaded: uploaded.length, imageIds: uploaded, doms: doms.length, domIds: doms,
        message: error instanceof Error ? error.message : String(error) } })
      .catch(() => undefined)
  }
}
