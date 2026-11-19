import { randomUUID } from 'crypto'
import {
  AI_CHAT_IMAGE_MAX_BYTES, AI_CHAT_IMAGE_TYPES, AI_CHAT_UNAVAILABLE, aiChatImageObjectKey, isOwnAiChatImageUrl, parseAiChatSnapshot,
  type AiChatImage
} from '../../shared/aiChat'
import { AI_CHAT_IMAGE_BASE64_MAX, AiChatDesktopError, type AiChatDesktopAction } from '../../shared/aiChatDesktop'

/**
 * Ảnh đính kèm câu hỏi của Hỏi đáp AI trên Desktop (cùng hợp đồng với API Web: akaAgentWebApp docs/AI_CHAT_IMAGES.md).
 * Ảnh chỉ được cất vào kho media của hệ thống (Cloudflare R2, cấu hình `media.storage.*` của thư viện media) ở thư mục riêng
 * `<tiền tố kho>/ai-chat/<tổ chức>/<nhân viên>/<uuid>.<đuôi>`; không ghi vào thư viện media của khách, không ghi đĩa.
 * Tiến trình chính không đọc, không sửa nội dung ảnh: chỉ kiểm định dạng thật và dung lượng rồi chuyển lên kho.
 * Tệp này không nhập Electron hay Supabase: nơi gọi truyền vào cách lấy phiên, cấu hình kho và cách ghi kho (xem aiChatHandlers).
 */

const IMAGE_EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
/** Mỗi nhân viên tối đa 30 ảnh trong 10 phút, tối đa 4 lượt tải lên cùng lúc (mỗi lượt giữ tới ~12 MB bộ nhớ). */
const UPLOAD_WINDOW_MS = 10 * 60_000
const UPLOADS_PER_WINDOW = 30
const MAX_CONCURRENT_UPLOADS = 4
/** Cấu hình kho đọc từ DB được giữ 60 giây: một câu hỏi kèm ảnh không phải đọc lại cho từng ảnh. */
const STORE_TTL_MS = 60_000
/** Trần của cột `ai_message.images`; số ảnh mỗi câu do DB quyết định (`ai_chat.max_images_per_question`). */
const MAX_IMAGES_PER_MESSAGE = 10

export interface AiChatImageIdentity { staffId: number; organizationId: number }

/** Phần cấu hình kho mà dịch vụ cần biết; `T` là cấu hình đầy đủ nơi gọi dùng để ghi. */
export interface AiChatImageStoreSettings { provider: string; endpointUrl: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicBaseUrl: string; keyPrefix?: string }

export interface AiChatImageDeps<T extends AiChatImageStoreSettings = AiChatImageStoreSettings> {
  /** Nhân viên đang đăng nhập; null = chưa đăng nhập. */
  identity(): AiChatImageIdentity | null
  /** Đọc cấu hình kho media (`media.storage.*`). */
  settings(): Promise<T>
  /** Ghi một tệp vào kho với đúng khoá đã dựng; trả URL công khai của tệp. */
  put(settings: T, input: { objectKey: string; body: Buffer; contentType: string }): Promise<{ cloudUrl: string }>
  now?(): number
}

/** Định dạng thật của tệp theo các byte đầu; không tin `mimeType` do giao diện khai. */
export function sniffAiChatImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

const fail = (code: string) => new AiChatDesktopError(code)

function storeConfigured(settings: AiChatImageStoreSettings): boolean {
  return settings.provider === 'r2' && !!settings.endpointUrl && !!settings.accessKeyId && !!settings.secretAccessKey
    && !!settings.bucket && /^https?:\/\//i.test(settings.publicBaseUrl)
}

export class AiChatImageService<T extends AiChatImageStoreSettings = AiChatImageStoreSettings> {
  private readonly recent = new Map<number, number[]>()
  private active = 0
  private cached: { key: string; at: number; settings: T } | null = null

  constructor(private readonly deps: AiChatImageDeps<T>) {}

  private now(): number { return this.deps.now ? this.deps.now() : Date.now() }

  private identity(): AiChatImageIdentity {
    const current = this.deps.identity()
    if (!current) throw fail('ai_chat_access_denied')
    return current
  }

  private same(identity: AiChatImageIdentity): boolean {
    const current = this.deps.identity()
    return !!current && current.staffId === identity.staffId && current.organizationId === identity.organizationId
  }

  /** Cấu hình kho của phiên đang đăng nhập. Chưa cấu hình đủ thì báo `ai_chat_images_not_ready`. */
  private async store(identity: AiChatImageIdentity): Promise<T> {
    const key = `${identity.organizationId}:${identity.staffId}`
    if (this.cached && this.cached.key === key && this.now() - this.cached.at < STORE_TTL_MS) return this.cached.settings
    let settings: T
    try {
      settings = await this.deps.settings()
    } catch {
      throw fail(AI_CHAT_UNAVAILABLE)
    }
    if (!this.same(identity)) throw fail(AI_CHAT_UNAVAILABLE)
    if (!storeConfigured(settings)) throw fail('ai_chat_images_not_ready')
    this.cached = { key, at: this.now(), settings }
    return settings
  }

  private takeSlot(staffId: number): void {
    const now = this.now()
    const kept = (this.recent.get(staffId) ?? []).filter(at => now - at < UPLOAD_WINDOW_MS)
    if (kept.length >= UPLOADS_PER_WINDOW || this.active >= MAX_CONCURRENT_UPLOADS) {
      this.recent.set(staffId, kept)
      throw fail('ai_chat_image_rate_limited')
    }
    kept.push(now)
    this.recent.set(staffId, kept)
    if (this.recent.size > 200) {
      for (const [id, times] of this.recent) if (!times.some(at => now - at < UPLOAD_WINDOW_MS)) this.recent.delete(id)
    }
  }

  /** Nhận một ảnh (base64), kiểm định dạng thật và dung lượng, cất vào kho media; trả URL để gửi kèm câu hỏi. */
  async upload(body: unknown): Promise<AiChatImage> {
    const identity = this.identity()
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    const declared = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : ''
    const data = typeof input.dataBase64 === 'string' ? input.dataBase64 : ''
    if (!AI_CHAT_IMAGE_TYPES.includes(declared)) throw fail('ai_chat_image_type_invalid')
    if (!data) throw fail('ai_chat_images_invalid')
    if (data.length > AI_CHAT_IMAGE_BASE64_MAX) throw fail('ai_chat_image_too_large')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) throw fail('ai_chat_images_invalid')
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length) throw fail('ai_chat_images_invalid')
    if (bytes.length > AI_CHAT_IMAGE_MAX_BYTES) throw fail('ai_chat_image_too_large')
    const mimeType = sniffAiChatImageType(bytes)
    if (!mimeType) throw fail('ai_chat_image_type_invalid')

    this.takeSlot(identity.staffId)
    this.active++
    try {
      const settings = await this.store(identity)
      const location = { publicBaseUrl: settings.publicBaseUrl, keyPrefix: settings.keyPrefix ?? '' }
      const objectKey = aiChatImageObjectKey(location.keyPrefix, identity.organizationId, identity.staffId, `${randomUUID()}.${IMAGE_EXTENSION[mimeType]}`)
      let url: string
      try {
        url = (await this.deps.put(settings, { objectKey, body: bytes, contentType: mimeType })).cloudUrl
      } catch {
        throw fail('ai_chat_image_upload_failed')
      }
      // Đổi tài khoản trong lúc tải: không trả ảnh của phiên cũ cho phiên mới.
      if (!this.same(identity)) throw fail(AI_CHAT_UNAVAILABLE)
      // Cấu hình kho lệch (URL trả về không nằm đúng thư mục của nhân viên) thì ảnh không dùng được ở bước hỏi: báo ngay.
      if (!isOwnAiChatImageUrl(url, location, identity.organizationId, identity.staffId)) throw fail('ai_chat_image_upload_failed')
      return { url, mimeType, sizeBytes: bytes.length }
    } finally {
      this.active--
    }
  }

  /** Danh sách URL ảnh của một lệnh hỏi: kiểm kiểu, gộp URL trùng. */
  imageList(value: unknown): string[] {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw fail('ai_chat_images_invalid')
    if (value.length > MAX_IMAGES_PER_MESSAGE) throw fail('ai_chat_too_many_images')
    const images: string[] = []
    for (const item of value) {
      if (typeof item !== 'string' || !/^https?:\/\/\S+$/i.test(item) || item.length > 2048) throw fail('ai_chat_images_invalid')
      if (!images.includes(item)) images.push(item)
    }
    return images
  }

  /** App chỉ được gửi kèm ảnh do chính nhân viên của phiên tải lên kho media (đúng thư mục tổ chức / nhân viên của phiên). */
  async assertOwn(images: readonly string[]): Promise<void> {
    if (!images.length) return
    const identity = this.identity()
    const settings = await this.store(identity)
    const location = { publicBaseUrl: settings.publicBaseUrl, keyPrefix: settings.keyPrefix ?? '' }
    for (const url of images) {
      if (!isOwnAiChatImageUrl(url, location, identity.organizationId, identity.staffId)) throw fail('ai_chat_images_invalid')
    }
  }

  /**
   * Gọi RPC Hỏi đáp AI. Riêng `open` / `ask` có ảnh: kiểm ảnh là của phiên trước khi gửi, và nếu DB chưa có phần nhận ảnh
   * (lõi cũ bỏ qua `images`) thì dừng câu vừa ghi rồi báo rõ, để bộ trả lời không trả lời một câu hỏi thiếu ảnh mà người hỏi
   * không biết. Giao diện vốn đã ẩn nút đính ảnh khi DB chưa nhận ảnh.
   */
  async call(
    action: AiChatDesktopAction,
    payload: Record<string, unknown>,
    rpc: (action: AiChatDesktopAction, payload: Record<string, unknown>) => Promise<unknown>
  ): Promise<unknown> {
    if (action !== 'open' && action !== 'ask') return rpc(action, payload)
    const images = this.imageList(payload.images)
    const { images: _ignored, ...rest } = payload
    void _ignored
    if (!images.length) return rpc(action, rest)
    await this.assertOwn(images)
    const data = await rpc(action, { ...rest, images })
    let snapshot: ReturnType<typeof parseAiChatSnapshot>
    try {
      snapshot = parseAiChatSnapshot(data)
    } catch {
      return data
    }
    if (!snapshot.changed || snapshot.reused === true) return data
    const requestId = typeof payload.requestId === 'string' ? payload.requestId.toLowerCase() : ''
    const stored = snapshot.messages.find(item => item.requestId.toLowerCase() === requestId)
    if (!stored || stored.images.length >= images.length) return data
    await rpc('cancel', { threadId: snapshot.thread.id, messageId: stored.id, afterRevision: 0 }).catch(() => undefined)
    throw fail('ai_chat_images_not_ready')
  }
}
