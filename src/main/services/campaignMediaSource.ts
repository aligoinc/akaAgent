/**
 * Biến một mục media của chiến dịch (đường dẫn trên máy, URL, data:, hoặc ảnh chụp { name, localPath, cloudUrl }) thành tệp
 * gửi được, đúng như bộ chạy Desktop/VPS. Tách nguyên văn từ campaignScheduler.ts (resolveCampaignMediaSource,
 * downloadCampaignMediaUrl, getMediaDownloadExtension, getCampaignMediaName, cleanupCampaignMediaTempFiles) để bộ lập lịch cũ
 * và engine v2 (cổng Zalo Desktop) dùng chung một bản. Sửa ở đây là đổi cả hai.
 *
 * Tệp tải từ cloud nằm trong một thư mục tạm riêng (`campaign-media-XXXXXX`, mkdtemp) và mang tên gốc đã làm sạch, để tệp đính
 * kèm Email, tệp gửi Zalo và tệp tải lên Facebook giữ đúng tên người dùng đặt (chiến dịch soạn trên Web/iOS chỉ có `cloudUrl`).
 * Phần mở rộng của tệp giữ đúng thứ tự cũ (đuôi URL → đuôi tên → Content-Type) vì các bước kiểm loại tệp theo đường dẫn và
 * `runtimeMediaSourceMatchesSelectionMode` dựa vào nó. Dọn tệp là xoá cả thư mục, và chỉ xoá thư mục do chính tiến trình
 * này tạo, nên không bao giờ chạm tệp thật của người dùng.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { dirname, extname, join } from 'path'
import { tmpdir } from 'os'
import type { CampaignMediaInput } from '../../shared/types'
import { getRuntimeMediaDownloadExtensionForMimeType } from '../../shared/mediaTypes'

export const CAMPAIGN_MEDIA_TEMP_DIR_PREFIX = 'campaign-media-'
// Tên tệp tối đa 150 byte UTF-8 (ext4/APFS cho 255 byte, NTFS 255 ký tự): chừa chỗ cho thư mục tạm trong giới hạn
// đường dẫn 260 ký tự của Windows (`C:\Users\<tên>\AppData\Local\Temp\campaign-media-XXXXXX\`).
export const CAMPAIGN_MEDIA_FILE_NAME_MAX_BYTES = 150
const CAMPAIGN_MEDIA_FALLBACK_STEM = 'media'
const CAMPAIGN_MEDIA_EXTENSION_MAX_LENGTH = 24
// Ký tự điều khiển C0/C1 và ký tự định dạng vô hình/đảo chiều (giả đuôi kiểu "abc\u202Efdp.exe").
const UNSAFE_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g
// Ký tự Windows không cho trong tên tệp (dấu tách đường dẫn đã bỏ ở bước lấy phần cuối).
const WINDOWS_RESERVED_FILE_NAME_CHARACTERS = /[<>:"/\\|?*]/g
const WINDOWS_RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i

/** Thư mục tạm do tiến trình này tạo cho tệp tải về; dọn tệp chỉ xoá thư mục có trong đây. */
const ownedCampaignMediaTempDirs = new Set<string>()

export class CampaignMediaResolveError extends Error {
  constructor(
    public readonly mediaName: string,
    public readonly reason: string
  ) {
    super(`Không dùng được media "${mediaName}": ${reason}`)
    this.name = 'CampaignMediaResolveError'
  }
}

export function isCampaignMediaResolveError(err: unknown): err is CampaignMediaResolveError {
  return err instanceof CampaignMediaResolveError
}

export function hasDeclaredMediaSource(item: CampaignMediaInput): boolean {
  if (typeof item === 'string') {
    const value = item.trim()
    return Boolean(value)
  }
  if (!item || typeof item !== 'object') return false
  const localPath = String(item.localPath || '').trim()
  const cloudUrl = String(item.cloudUrl || '').trim()
  return Boolean(localPath || cloudUrl)
}

export function getCampaignMediaName(item: CampaignMediaInput): string {
  if (typeof item === 'string') return item.split(/[\\/]/).pop() || item || 'media'
  return item?.name ||
    item?.localPath?.split(/[\\/]/).pop() ||
    item?.cloudUrl?.split('/').pop()?.split('?')[0] ||
    'media'
}

export function getMediaDownloadExtension(url: string, contentType: string, mediaName: string): string {
  try {
    const ext = extname(new URL(url).pathname)
    if (ext) return ext
  } catch {}

  const nameExt = extname(mediaName)
  if (nameExt) return nameExt

  return getRuntimeMediaDownloadExtensionForMimeType(contentType) || '.bin'
}

/** Phần cuối của đường dẫn URL (đã giải mã %XX), không gồm query/hash. Rỗng khi URL hỏng. */
function getUrlPathBaseName(url: string): string {
  let segment = ''
  try {
    segment = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
  } catch {
    return ''
  }
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Tên nên dùng cho tệp tải về: `name` của mục media, không có thì tên tệp của `localPath` (máy đã chọn tệp); URL dạng chuỗi
 * thì để trống, bước tải lấy tên từ đường dẫn URL. Khác `getCampaignMediaName` (dùng cho câu báo lỗi, giữ nguyên).
 */
export function getCampaignMediaFileNameCandidate(item: CampaignMediaInput): string {
  if (!item || typeof item !== 'object') return ''
  const name = String(item.name || '').trim()
  if (name) return name
  return String(item.localPath || '').trim().split(/[\\/]/).pop() || ''
}

function sanitizeFileNamePart(value: string): string {
  return value
    .replace(UNSAFE_FILE_NAME_CHARACTERS, '')
    .replace(WINDOWS_RESERVED_FILE_NAME_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    // Windows không cho tên kết thúc bằng dấu cách/dấu chấm; bỏ cả dấu chấm đầu (tệp ẩn, "." và "..").
    .replace(/^[\s.]+|[\s.]+$/g, '')
}

/** Tên gốc → tên tệp an toàn: chỉ lấy phần cuối sau dấu tách đường dẫn, NFC, bỏ ký tự điều khiển và ký tự Windows cấm. */
export function sanitizeCampaignMediaFileName(value: unknown): string {
  const lastSegment = String(value ?? '')
    .normalize('NFC')
    .split(/[\\/]+/)
    .filter(segment => segment.trim() && segment.trim() !== '.' && segment.trim() !== '..')
    .pop() || ''
  return sanitizeFileNamePart(lastSegment)
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
  let output = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    output += character
    bytes += size
  }
  return output
}

function normalizeDownloadExtension(extension: string, contentType: string): string {
  const safe = sanitizeFileNamePart(String(extension || '').replace(/^\.+/, ''))
  if (safe && safe.length <= CAMPAIGN_MEDIA_EXTENSION_MAX_LENGTH) return `.${safe}`
  return getRuntimeMediaDownloadExtensionForMimeType(contentType) || '.bin'
}

/**
 * Tên tệp trên đĩa cho một media tải từ cloud: tên gốc đã làm sạch (`nameCandidate`, không có thì phần cuối của URL),
 * đuôi tệp theo đúng thứ tự cũ của `getMediaDownloadExtension`. Tên đã có đúng đuôi đó thì giữ nguyên, không thì thêm đuôi.
 * Tối đa `CAMPAIGN_MEDIA_FILE_NAME_MAX_BYTES` byte, tránh tên thiết bị của Windows (CON, NUL, COM1...).
 */
export function buildCampaignMediaDownloadFileName(
  nameCandidate: string,
  url: string,
  contentType: string,
  extensionName: string = nameCandidate
): string {
  const extension = normalizeDownloadExtension(getMediaDownloadExtension(url, contentType, extensionName), contentType)
  const name = sanitizeCampaignMediaFileName(nameCandidate) || sanitizeCampaignMediaFileName(getUrlPathBaseName(url))
  const hasExtension = name.length > extension.length && name.slice(-extension.length).toLowerCase() === extension.toLowerCase()
  let stem = hasExtension ? name.slice(0, -extension.length) : name
  stem = sanitizeFileNamePart(truncateUtf8(stem, CAMPAIGN_MEDIA_FILE_NAME_MAX_BYTES - Buffer.byteLength(extension, 'utf8')))
  if (!stem) stem = CAMPAIGN_MEDIA_FALLBACK_STEM
  if (WINDOWS_RESERVED_DEVICE_NAMES.test(stem.split('.')[0].trimEnd())) {
    stem = truncateUtf8(`_${stem}`, CAMPAIGN_MEDIA_FILE_NAME_MAX_BYTES - Buffer.byteLength(extension, 'utf8'))
  }
  return `${stem}${extension}`
}

function removeOwnedCampaignMediaTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
  ownedCampaignMediaTempDirs.delete(dir)
}

/**
 * Ghi tệp tải về vào thư mục tạm riêng. Tên gốc không ghi được trên hệ điều hành này (ký tự lạ, tên quá dài với hệ tệp)
 * thì ghi bằng tên dự phòng `media<đuôi>`, để không tạm dừng chiến dịch chỉ vì tên tệp.
 */
function writeCampaignMediaTempFile(fileName: string, extension: string, data: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), CAMPAIGN_MEDIA_TEMP_DIR_PREFIX))
  ownedCampaignMediaTempDirs.add(dir)
  try {
    const tempPath = join(dir, fileName)
    try {
      writeFileSync(tempPath, data)
      return tempPath
    } catch (err) {
      const fallbackPath = join(dir, `${CAMPAIGN_MEDIA_FALLBACK_STEM}${extension}`)
      if (fallbackPath === tempPath) throw err
      writeFileSync(fallbackPath, data)
      return fallbackPath
    }
  } catch (err) {
    removeOwnedCampaignMediaTempDir(dir)
    throw err
  }
}

export async function downloadCampaignMediaUrl(
  url: string,
  mediaName: string,
  mediaTempPaths: string[] = [],
  fileNameCandidate: string = mediaName
): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await response.arrayBuffer())
    const fileName = buildCampaignMediaDownloadFileName(fileNameCandidate, url, contentType, mediaName)
    const extension = extname(fileName)
    const tempPath = writeCampaignMediaTempFile(fileName, extension, buf)
    mediaTempPaths.push(tempPath)
    return tempPath
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new CampaignMediaResolveError(mediaName, `cloud URL không tải được (${message})`)
  }
}

export async function resolveCampaignMediaSource(item: CampaignMediaInput, mediaTempPaths: string[] = []): Promise<string> {
  const mediaName = getCampaignMediaName(item)

  if (typeof item === 'string') {
    const value = item.trim()
    if (!value) throw new CampaignMediaResolveError(mediaName, 'không có local path hoặc cloud URL hợp lệ')
    if (value.startsWith('data:')) return value
    if (/^https?:\/\//i.test(value)) {
      return downloadCampaignMediaUrl(value, mediaName, mediaTempPaths, getCampaignMediaFileNameCandidate(item))
    }
    if (existsSync(value)) return value
    throw new CampaignMediaResolveError(mediaName, 'local path không tồn tại và không có cloud URL fallback')
  }

  const localPath = String(item?.localPath || '').trim()
  const localMissingReason = localPath ? 'local path không tồn tại' : 'không có local path'
  if (localPath) {
    if (localPath.startsWith('data:') || existsSync(localPath)) return localPath
  }

  const cloudUrl = String(item?.cloudUrl || '').trim()
  if (cloudUrl) {
    try {
      return await downloadCampaignMediaUrl(cloudUrl, mediaName, mediaTempPaths, getCampaignMediaFileNameCandidate(item))
    } catch (err) {
      if (isCampaignMediaResolveError(err)) {
        throw new CampaignMediaResolveError(mediaName, `${localMissingReason} và ${err.reason}`)
      }
      throw err
    }
  }

  if (localPath) {
    throw new CampaignMediaResolveError(mediaName, `${localMissingReason} và không có cloud URL fallback`)
  }
  throw new CampaignMediaResolveError(mediaName, 'không có local path hoặc cloud URL hợp lệ')
}

/**
 * Dọn tệp do `downloadCampaignMediaUrl` tải về: xoá cả thư mục tạm riêng của từng tệp. Chỉ xoá thư mục do tiến trình này
 * tạo (`ownedCampaignMediaTempDirs`); đường dẫn khác (kể cả tệp thật của người dùng lỡ lọt vào danh sách) không bị đụng.
 */
export function cleanupCampaignMediaTempFiles(paths: string[]): void {
  const uniquePaths = Array.from(new Set(paths.map(path => String(path || '').trim()).filter(Boolean)))
  paths.length = 0
  for (const path of uniquePaths) {
    const dir = dirname(path)
    if (ownedCampaignMediaTempDirs.has(dir)) removeOwnedCampaignMediaTempDir(dir)
  }
}
