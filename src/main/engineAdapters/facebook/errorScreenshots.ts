// Ảnh lỗi của engine v2 Facebook (phương án mục 12; anh chốt Q12–Q14, 16/11/2026).
// - Chụp khi block lỗi / mốc không rõ kết quả, chỉ khi chụp được (không bắt buộc). JPEG ~70, rộng tối đa 1.280 px, kèm tệp JSON mô tả.
// - Lưu trên máy: userData/local-data/engine-screenshots/<ngày>/<mã ảnh>.jpg + .json. Giữ 14 ngày hoặc 1 GB (cái nào tới trước, xoá cũ
//   nhất trước), dọn luôn thư mục block-screenshots của bộ cũ theo cùng giới hạn.
// - Trần: mỗi lượt data tối đa 3 ảnh; cùng mã lỗi trên cùng chiến dịch tối đa 5 ảnh mỗi giờ (còn lại chỉ đếm).
// - Không tự tải ảnh nào lên máy chủ; chỉ gửi khi có yêu cầu chẩn đoán (diagnosticsResponder).
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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
  bytes: number
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

/** Lưu ảnh lỗi (JPEG) và mô tả; trả mã ảnh, lỗi ghi đĩa thì null (ảnh không bắt buộc). */
export function saveErrorScreenshot(jpeg: Buffer, meta: Omit<ErrorScreenshotMeta, 'id' | 'at' | 'appVersion' | 'bytes'>): string | null {
  try {
    const id = randomUUID()
    const at = new Date().toISOString()
    const dir = path.join(root('engine-screenshots'), at.slice(0, 10))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${id}.jpg`), jpeg)
    const full: ErrorScreenshotMeta = { ...meta, id, at, appVersion: app.getVersion(), bytes: jpeg.length }
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(full))
    if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) void cleanupScreenshots().catch(() => undefined)
    return id
  } catch (error) {
    console.warn('[CampaignEngine] Không lưu được ảnh lỗi:', error)
    return null
  }
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

/** Ảnh lỗi trên máy khớp bộ lọc của yêu cầu chẩn đoán (đọc tệp mô tả), mới nhất trước, tối đa `limit`. */
export function findErrorScreenshots(filter: ScreenshotFilter, limit = 50): Array<{ meta: ErrorScreenshotMeta; jpegPath: string }> {
  const files: FileEntry[] = []
  walk(root('engine-screenshots'), files)
  const ids = filter.imageIds ? new Set(filter.imageIds.map(String)) : null
  const from = filter.from ? Date.parse(filter.from) : Number.NaN
  const to = filter.to ? Date.parse(filter.to) : Number.NaN
  const found: Array<{ meta: ErrorScreenshotMeta; jpegPath: string }> = []
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
    if (!fs.existsSync(jpegPath)) continue
    found.push({ meta, jpegPath })
    if (found.length >= limit) break
  }
  return found
}
