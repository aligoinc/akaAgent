/**
 * Biến một mục media của chiến dịch (đường dẫn trên máy, URL, data:, hoặc ảnh chụp { name, localPath, cloudUrl }) thành tệp
 * gửi được, đúng như bộ chạy Desktop/VPS. Tách nguyên văn từ campaignScheduler.ts (resolveCampaignMediaSource,
 * downloadCampaignMediaUrl, getMediaDownloadExtension, getCampaignMediaName, cleanupCampaignMediaTempFiles) để bộ lập lịch cũ
 * và engine v2 (cổng Zalo Desktop) dùng chung một bản. Sửa ở đây là đổi cả hai.
 */
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { tmpdir } from 'os'
import type { CampaignMediaInput } from '../../shared/types'
import { getRuntimeMediaDownloadExtensionForMimeType } from '../../shared/mediaTypes'

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

export async function downloadCampaignMediaUrl(url: string, mediaName: string, mediaTempPaths: string[] = []): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(60000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await response.arrayBuffer())
    const ext = getMediaDownloadExtension(url, contentType, mediaName)
    const tempPath = join(tmpdir(), `campaign-media-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`)
    writeFileSync(tempPath, buf)
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
    if (/^https?:\/\//i.test(value)) return downloadCampaignMediaUrl(value, mediaName, mediaTempPaths)
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
      return await downloadCampaignMediaUrl(cloudUrl, mediaName, mediaTempPaths)
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

export function cleanupCampaignMediaTempFiles(paths: string[]): void {
  const uniquePaths = Array.from(new Set(paths.map(path => String(path || '').trim()).filter(Boolean)))
  paths.length = 0
  for (const path of uniquePaths) {
    try {
      unlinkSync(path)
    } catch {}
  }
}
