/**
 * Tệp đính kèm của tin nhắn Zalo, tách từ bộ chạy Desktop/VPS (campaignScheduler.ts): chọn media của chiến dịch
 * (resolveCampaignMediaForIndex + resolveMediaSelection, phần không có I/O), thứ tự gửi chữ/tệp (dispatchZaloMessage) và
 * đổi lỗi "hàng rào media" (CampaignMediaExecution, chung Desktop và runtime Fly) thành tín hiệu. Tải/đọc tệp là việc của
 * cổng (prepareMedia). Đặc tả: docs/engine-v2-specs/zalo-media.md.
 */
import type { Signal } from '../contracts.js'
import { ZaloPortError } from './common.js'

type JsonObject = Record<string, unknown>

/** Một mục media đã lưu (CampaignMediaInput): chuỗi cũ (đường dẫn, URL, data:) hoặc ảnh chụp tệp. */
export type CampaignMediaItem = string | {
  name?: string | null
  localPath?: string | null
  cloudUrl?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  provider?: string | null
}

/** Tệp đã sẵn sàng gửi: tên để ghi lịch sử, ref do cổng giữ (đường dẫn trên máy, hay { sourceUrl, fileName } cho Fly). */
export interface ZaloMediaFile { name: string; ref: unknown }

/** Như hasDeclaredMediaSource (CS:17774): chuỗi không rỗng, hoặc ảnh chụp có localPath / cloudUrl. */
export function hasDeclaredMediaSource(item: unknown): item is CampaignMediaItem {
  if (typeof item === 'string') return item.trim() !== ''
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const value = item as { localPath?: unknown; cloudUrl?: unknown }
  return String(value.localPath ?? '').trim() !== '' || String(value.cloudUrl ?? '').trim() !== ''
}

/** Như getCampaignMediaName (CS:17859): tên ảnh chụp, không thì tên tệp của đường dẫn / URL, không thì "media". */
export function campaignMediaName(item: CampaignMediaItem): string {
  if (typeof item === 'string') return item.split(/[\\/]/).pop() || item || 'media'
  return item?.name ||
    item?.localPath?.split(/[\\/]/).pop() ||
    item?.cloudUrl?.split('/').pop()?.split('?')[0] ||
    'media'
}

/**
 * Media gửi kèm một tin, nội dung cơ bản (không phải nội dung nâng cao): imageOption mặc định 'all' (extra.imageOption || 'all'),
 * randomImageCount mặc định 3; 'none' → không gửi tệp; 'random' → bốc lại mỗi lần gửi như Desktop
 * ([...declared].sort(() => 0.5 - random()).slice(0, max(1, count))). Media không phụ thuộc biến thể chữ.
 */
export function selectZaloCampaignMedia(campaign: { images?: readonly unknown[] | null; extraSettings: JsonObject },
  random: () => number = Math.random): CampaignMediaItem[] {
  const extra = campaign.extraSettings
  const option = String(extra.imageOption || 'all')
  if (option === 'none') return []
  const declared = (Array.isArray(campaign.images) ? campaign.images : []).filter(hasDeclaredMediaSource)
  if (option !== 'random') return declared
  const count = Math.max(1, Number(extra.randomImageCount || 3) || 1)
  return [...declared].sort(() => 0.5 - random()).slice(0, count)
}

/**
 * Đường dẫn/tên có đuôi tệp của một mục media, gần với tệp Desktop sẽ gửi (đường dẫn trên máy; tệp tải từ cloud lấy đuôi theo
 * URL, rồi tên, rồi MIME). Không xác định được đuôi thì '' (luật kiểm cấu hình bỏ qua, lỗi lúc gửi vẫn được bắt).
 */
export function campaignMediaSourceHint(item: CampaignMediaItem): string {
  const hasExt = (value: string): boolean => /\.[a-z0-9]{1,8}$/i.test(value.split(/[?#]/, 1)[0] ?? '')
  if (typeof item === 'string') return item.trim()
  const local = String(item?.localPath ?? '').trim()
  if (local && (local.startsWith('data:') || hasExt(local))) return local
  const cloud = String(item?.cloudUrl ?? '').trim()
  let cloudPath = ''
  try { cloudPath = cloud ? new URL(cloud).pathname : '' } catch { cloudPath = '' }
  if (cloudPath && hasExt(cloudPath)) return cloudPath
  const name = String(item?.name ?? '').trim()
  if (name && hasExt(name)) return name
  const mime = String(item?.mimeType ?? '').trim().toLowerCase()
  const fromMime: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'application/pdf': 'pdf' }
  return fromMime[mime] ? `${name || 'media'}.${fromMime[mime]}` : ''
}

/** Có media sẽ gửi (dùng để chọn hạn giờ bước gửi và luật kiểm cấu hình), không bốc ngẫu nhiên. */
export function campaignDeclaresMedia(campaign: { images?: readonly unknown[] | null; extraSettings: JsonObject }): boolean {
  return String(campaign.extraSettings.imageOption || 'all') !== 'none'
    && (Array.isArray(campaign.images) ? campaign.images : []).some(hasDeclaredMediaSource)
}

export type ZaloSendSequence = 'content_only' | 'combined' | 'media_only' | 'media_then_content' | 'content_then_media'
export interface ZaloSendCall { kind: 'media' | 'text' | 'combined'; stepKey: 'send_media' | 'send_content' | 'send_combined' }

/**
 * Thứ tự gửi như dispatchZaloMessage (CS:15555): ≥ 2 tệp → album rồi chữ; 1 tệp + chữ định dạng → chữ rồi tệp; 1 tệp còn lại →
 * một lần (chữ làm chú thích); không tệp → chỉ chữ. stepKey như bộ chạy cũ của Fly (khoá chống gửi trùng của lệnh giữ nguyên).
 */
export function planZaloSend(input: { fileCount: number; hasText: boolean; formatted: boolean }): { sequence: ZaloSendSequence; calls: ZaloSendCall[] } {
  const media: ZaloSendCall = { kind: 'media', stepKey: 'send_media' }
  const text: ZaloSendCall = { kind: 'text', stepKey: 'send_content' }
  if (input.fileCount >= 2) return input.hasText ? { sequence: 'media_then_content', calls: [media, text] } : { sequence: 'media_only', calls: [media] }
  if (input.fileCount === 1) {
    if (input.formatted) return input.hasText ? { sequence: 'content_then_media', calls: [text, media] } : { sequence: 'media_only', calls: [media] }
    return { sequence: input.hasText ? 'combined' : 'media_only', calls: [{ kind: 'combined', stepKey: 'send_combined' }] }
  }
  return { sequence: 'content_only', calls: [text] }
}

/** Mã lỗi của hàng rào media (CampaignMediaExecution, CME:14-28, 120-128), giống nhau trên Desktop và runtime Fly. */
const FENCE_NOT_SENT = new Set(['campaign_runtime_unavailable'])
const FENCE_UNKNOWN = new Set(['campaign_media_timeout', 'command_result_unknown'])

/**
 * Lỗi hàng rào media → tín hiệu chung cho hai nơi chạy (luật V495 của nhóm fly_command): tác vụ đã đóng thì chưa gửi gì
 * (before_send); quá giờ / phiên dừng giữa chừng thì không rõ đã tới (in_flight, không gửi lại). Không phải lỗi hàng rào → null.
 */
export function mediaFenceError(error: unknown): ZaloPortError | null {
  const code = String((error as { code?: unknown } | null)?.code ?? '').trim()
  if (!FENCE_NOT_SENT.has(code) && !FENCE_UNKNOWN.has(code)) return null
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim() || code
  const signal: Signal = { kind: 'fly_command', code, message }
  return FENCE_UNKNOWN.has(code)
    ? new ZaloPortError(message, { code, signal, phase: 'in_flight', evidence: { deliveryState: 'unknown' } })
    : new ZaloPortError(message, { code, signal, phase: 'before_send' })
}

/**
 * Không dùng được tệp media (không tải được, đường dẫn mất, Zalo Server chỉ có tệp trên máy…): chưa gửi gì. Luật DB đổi ra
 * CFG01 (tạm dừng chiến dịch một lần, data về hàng đợi) trên cả hai nơi chạy, câu giữ nguyên câu của Desktop/Fly.
 */
export function mediaUnavailableError(message: string): ZaloPortError {
  return new ZaloPortError(message, {
    code: 'media_unavailable',
    signal: { kind: 'engine', code: 'media_unavailable', errorCode: 'err_media_file_missing', message },
    phase: 'before_send'
  })
}
