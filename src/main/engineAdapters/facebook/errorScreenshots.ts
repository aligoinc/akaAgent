// Ảnh lỗi của engine v2 Facebook (phương án mục 12; anh chốt Q12–Q14, 16/11/2026).
// - Chụp khi block lỗi / mốc không rõ kết quả, chỉ khi chụp được (không bắt buộc). JPEG ~70, rộng tối đa 1.280 px, kèm tệp JSON mô tả.
// - Lưu trên máy: userData/local-data/engine-screenshots/<ngày>/<mã ảnh>.jpg + .json. Giữ 14 ngày hoặc 1 GB (cái nào tới trước, xoá cũ
//   nhất trước), dọn luôn thư mục block-screenshots của bộ cũ theo cùng giới hạn.
// - Trần: mỗi lượt data tối đa 3 ảnh; cùng mã lỗi trên cùng chiến dịch tối đa 5 ảnh mỗi giờ (còn lại chỉ đếm).
// - Không tự tải ảnh nào lên máy chủ; chỉ gửi khi có yêu cầu chẩn đoán (diagnosticsResponder).
// - DOM cả trang (anh chốt 20/11/2026, "đơn giản như phần chụp ảnh"): cùng lúc, cùng trần, cùng mã với ảnh, lưu <mã ảnh>.dom.html.gz cạnh
//   ảnh; bộ dọn ở trên tính chung. Khi có yêu cầu chẩn đoán thì gửi tệp gzip kèm ảnh (bảng auto_desktop_diagnostic_doms, V595).
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'

export interface ErrorScreenshotMeta {
  id: string
  at: string
  campaignId: number
  accountId: number
  inputDataId: number | null
  targetRunId: number
  stepKey: string
  blockName: string | null
  url: string
  code: string | null
  message: string | null
  appVersion: string
  /** Cỡ ảnh JPEG; 0 khi lần này chỉ lấy được DOM. */
  bytes: number
  /** Có tệp ảnh không (tệp mô tả trước 20/11 không có trường này: luôn có ảnh). */
  hasJpeg?: boolean
  /** DOM cả trang đi kèm: số ký tự trước khi nén và cỡ tệp gzip; null / thiếu = không có. */
  dom?: { chars: number; gzipBytes: number } | null
}

/** Đuôi tệp DOM cạnh ảnh: <mã ảnh>.dom.html.gz. */
export const DOM_FILE_SUFFIX = '.dom.html.gz'
/** Đọc DOM trong trang tối đa 2 giây, quá thì bỏ (như đọc chữ trên trang, errorSigns.ts). */
export const PAGE_DOM_TIMEOUT_MS = 2_000
/** DOM dài hơn thì không lưu (trang bất thường). Đo 20/11 trên Facebook thật: 0,4–0,7 triệu ký tự sau khi bỏ script / style. */
export const PAGE_DOM_MAX_CHARS = 10_000_000
/** Trần tệp DOM gzip tải lên máy chủ (V595, như ảnh JPEG): quá thì chỉ giữ trên máy. */
export const DOM_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/**
 * DOM cả trang lúc block lỗi (PageController.evaluate chạy như thân hàm). Chỉ bỏ:
 * - script: có mã phiên đăng nhập Facebook của khách (fb_dtsg, mã truy cập…), ai có tệp là vào được tài khoản;
 * - style: chỉ là CSS;
 * - giá trị ô ẩn: đo trên Facebook thật 20/11, sau khi bỏ script vẫn còn ô ẩn `h` (mã đăng xuất) trong form.
 * Dòng đầu là dấu để trang giả trong bài kiểm nhận ra.
 */
export const PAGE_DOM_SCRIPT = `/* aka:page-dom */
var root = document.documentElement.cloneNode(true);
var drop = root.querySelectorAll('script, style');
for (var i = 0; i < drop.length; i++) { if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]); }
var hidden = root.querySelectorAll('input[type="hidden"]');
for (var j = 0; j < hidden.length; j++) hidden[j].removeAttribute('value');
return (document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>\\n' : '') + root.outerHTML;`

const gzipAsync = promisify(gzip)

/** Nén DOM để lưu trên máy; lỗi thì null (DOM không bắt buộc). */
export async function gzipErrorDom(html: string): Promise<Buffer | null> {
  try { return await gzipAsync(Buffer.from(html, 'utf8')) } catch { return null }
}

export const SCREENSHOT_KEEP_DAYS = 14
export const SCREENSHOT_KEEP_BYTES = 1024 * 1024 * 1024
const PER_TARGET = 3
const PER_CODE_HOUR = 5
const CLEANUP_EVERY_MS = 60 * 60_000

const perTarget = new Map<number, number>()
const perCodeHour = new Map<string, number[]>()
let lastCleanup = 0

function root(name: 'engine-screenshots' | 'block-screenshots'): string {
  return path.join(app.getPath('userData'), 'local-data', name)
}

/** Còn được chụp cho lượt data / mã lỗi này không (trần mục 12.2); gọi là trừ một lượt. */
export function screenshotAllowed(targetRunId: number, campaignId: number, code: string | null, now = Date.now()): boolean {
  const used = perTarget.get(targetRunId) ?? 0
  if (used >= PER_TARGET) return false
  const key = `${campaignId}:${code ?? 'unknown'}`
  const recent = (perCodeHour.get(key) ?? []).filter(at => now - at < 60 * 60_000)
  if (recent.length >= PER_CODE_HOUR) { perCodeHour.set(key, recent); return false }
  recent.push(now)
  perCodeHour.set(key, recent)
  perTarget.set(targetRunId, used + 1)
  if (perTarget.size > 5000) perTarget.clear()
  return true
}

type EvidenceMetaInput = Omit<ErrorScreenshotMeta, 'id' | 'at' | 'appVersion' | 'bytes' | 'hasJpeg' | 'dom'>

/**
 * Lưu ảnh lỗi (JPEG) và / hoặc DOM cả trang (đã nén gzip) cùng một mã, kèm tệp mô tả; trả mã ảnh. Không có gì để lưu hoặc lỗi ghi đĩa thì
 * null (ảnh và DOM đều không bắt buộc).
 */
export function saveErrorEvidence(parts: { jpeg?: Buffer | null; domGzip?: Buffer | null; domChars?: number | null },
  meta: EvidenceMetaInput): string | null {
  const jpeg = parts.jpeg && parts.jpeg.length > 0 ? parts.jpeg : null
  const domGzip = parts.domGzip && parts.domGzip.length > 0 ? parts.domGzip : null
  if (!jpeg && !domGzip) return null
  try {
    const id = randomUUID()
    const at = new Date().toISOString()
    const dir = path.join(root('engine-screenshots'), at.slice(0, 10))
    fs.mkdirSync(dir, { recursive: true })
    if (jpeg) fs.writeFileSync(path.join(dir, `${id}.jpg`), jpeg)
    if (domGzip) fs.writeFileSync(path.join(dir, `${id}${DOM_FILE_SUFFIX}`), domGzip)
    const full: ErrorScreenshotMeta = { ...meta, id, at, appVersion: app.getVersion(), bytes: jpeg?.length ?? 0, hasJpeg: !!jpeg,
      dom: domGzip ? { chars: Math.max(0, Math.trunc(Number(parts.domChars) || 0)), gzipBytes: domGzip.length } : null }
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(full))
    if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) void cleanupScreenshots().catch(() => undefined)
    return id
  } catch (error) {
    console.warn('[CampaignEngine] Không lưu được ảnh lỗi:', error)
    return null
  }
}

/** Lưu ảnh lỗi (JPEG) và mô tả; trả mã ảnh, lỗi ghi đĩa thì null (ảnh không bắt buộc). */
export function saveErrorScreenshot(jpeg: Buffer, meta: EvidenceMetaInput): string | null {
  return saveErrorEvidence({ jpeg }, meta)
}

interface FileEntry { file: string; mtimeMs: number; size: number }

function walk(dir: string, out: FileEntry[]): void {
  let names: fs.Dirent[]
  try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of names) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(file, out); continue }
    try { const st = fs.statSync(file); out.push({ file, mtimeMs: st.mtimeMs, size: st.size }) } catch { /* đã xoá */ }
  }
}

/**
 * Dọn ảnh: quá 14 ngày thì xoá; tổng (ảnh engine + ảnh block-screenshots của bộ cũ) quá 1 GB thì xoá cũ nhất trước. Chạy lúc mở app và
 * tối đa một lần mỗi giờ khi có ảnh mới. Trả số tệp đã xoá.
 */
export async function cleanupScreenshots(now = Date.now(), limits = { days: SCREENSHOT_KEEP_DAYS, bytes: SCREENSHOT_KEEP_BYTES }): Promise<number> {
  lastCleanup = now
  const files: FileEntry[] = []
  walk(root('engine-screenshots'), files)
  walk(root('block-screenshots'), files)
  let removed = 0
  const cutoff = now - limits.days * 24 * 60 * 60_000
  const keep: FileEntry[] = []
  for (const entry of files) {
    if (entry.mtimeMs < cutoff) { try { fs.rmSync(entry.file, { force: true }); removed++ } catch { /* bỏ qua */ } } else keep.push(entry)
  }
  let total = keep.reduce((sum, entry) => sum + entry.size, 0)
  keep.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const entry of keep) {
    if (total <= limits.bytes) break
    try { fs.rmSync(entry.file, { force: true }); removed++; total -= entry.size } catch { /* bỏ qua */ }
  }
  // Thư mục ngày rỗng.
  for (const base of [root('engine-screenshots'), root('block-screenshots')]) removeEmptyDirs(base)
  return removed
}

function removeEmptyDirs(dir: string): boolean {
  let names: fs.Dirent[]
  try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return false }
  let empty = true
  for (const entry of names) {
    if (entry.isDirectory()) { if (!removeEmptyDirs(path.join(dir, entry.name))) empty = false } else empty = false
  }
  if (empty && path.basename(path.dirname(dir)) !== 'local-data') { try { fs.rmdirSync(dir) } catch { return false } }
  return empty
}

/** Ảnh lỗi engine dạng data URL để gửi AI đọc (Q11). Chỉ đọc tệp .jpg nằm trong thư mục ảnh engine. */
export function readErrorScreenshotDataUrl(jpegPath: string): string {
  const base = path.resolve(root('engine-screenshots'))
  const target = path.resolve(String(jpegPath || ''))
  const rel = path.relative(base, target)
  if (!target.endsWith('.jpg') || rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Đường dẫn ảnh lỗi không hợp lệ')
  return `data:image/jpeg;base64,${fs.readFileSync(target).toString('base64')}`
}

export interface ScreenshotFilter {
  campaignId?: number
  inputDataId?: number
  targetRunId?: number
  from?: string
  to?: string
  imageIds?: string[]
}

export interface ErrorEvidence {
  meta: ErrorScreenshotMeta
  /** Tệp ảnh; null khi lần đó chỉ lấy được DOM (hoặc ảnh đã bị bộ dọn xoá). */
  jpegPath: string | null
  /** Tệp DOM gzip; null khi không có. */
  domPath: string | null
}

/**
 * Ảnh lỗi và DOM trên máy khớp bộ lọc của yêu cầu chẩn đoán (đọc tệp mô tả), mới nhất trước, tối đa `limit` mã. Mã nào còn ít nhất một
 * trong hai tệp thì có mặt.
 */
export function findErrorEvidence(filter: ScreenshotFilter, limit = 50, opts: { jpegOnly?: boolean } = {}): ErrorEvidence[] {
  const files: FileEntry[] = []
  walk(root('engine-screenshots'), files)
  const ids = filter.imageIds ? new Set(filter.imageIds.map(String)) : null
  const from = filter.from ? Date.parse(filter.from) : Number.NaN
  const to = filter.to ? Date.parse(filter.to) : Number.NaN
  const found: ErrorEvidence[] = []
  for (const entry of files.filter(item => item.file.endsWith('.json')).sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    let meta: ErrorScreenshotMeta
    try { meta = JSON.parse(fs.readFileSync(entry.file, 'utf8')) as ErrorScreenshotMeta } catch { continue }
    if (ids && !ids.has(meta.id)) continue
    if (filter.campaignId != null && meta.campaignId !== Number(filter.campaignId)) continue
    if (filter.inputDataId != null && meta.inputDataId !== Number(filter.inputDataId)) continue
    if (filter.targetRunId != null && meta.targetRunId !== Number(filter.targetRunId)) continue
    const at = Date.parse(meta.at)
    if (Number.isFinite(from) && at < from) continue
    if (Number.isFinite(to) && at > to) continue
    const jpegPath = entry.file.replace(/\.json$/, '.jpg')
    const domPath = entry.file.replace(/\.json$/, DOM_FILE_SUFFIX)
    const hasJpeg = fs.existsSync(jpegPath)
    const hasDom = fs.existsSync(domPath)
    if (!hasJpeg && (opts.jpegOnly || !hasDom)) continue
    found.push({ meta, jpegPath: hasJpeg ? jpegPath : null, domPath: hasDom ? domPath : null })
    if (found.length >= limit) break
  }
  return found
}

/** Ảnh lỗi trên máy khớp bộ lọc (chỉ mã có tệp ảnh), mới nhất trước, tối đa `limit`. */
export function findErrorScreenshots(filter: ScreenshotFilter, limit = 50): Array<{ meta: ErrorScreenshotMeta; jpegPath: string }> {
  return findErrorEvidence(filter, limit, { jpegOnly: true })
    .flatMap(item => (item.jpegPath ? [{ meta: item.meta, jpegPath: item.jpegPath }] : []))
}
