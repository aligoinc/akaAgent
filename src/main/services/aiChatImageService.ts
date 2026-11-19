import {
  AI_CHAT_IMAGE_MAX_BYTES, AI_CHAT_IMAGE_TYPES, AI_CHAT_UNAVAILABLE, parseAiChatSnapshot, type AiChatImage, type AiChatImageUpload
} from '../../shared/aiChat'
import { AI_CHAT_IMAGE_BASE64_MAX, AiChatDesktopError, type AiChatDesktopAction } from '../../shared/aiChatDesktop'

/**
 * Ảnh đính kèm câu hỏi của Hỏi đáp AI trên Desktop (hợp đồng chung với Web: akaAgentWebApp docs/AI_CHAT_IMAGES.md).
 * Tiến trình chính không tự ghi kho: nó kiểm sơ bộ ảnh (định dạng thật, dung lượng) rồi gửi lên API Web, API xác minh phiên
 * Desktop và cất ảnh vào kho media của hệ thống ở thư mục `<tiền tố kho>/ai-chat/<tổ chức>/<nhân viên>/`. Giới hạn chính thức
 * (5 MB, PNG/JPG/WEBP, 30 ảnh / 10 phút mỗi nhân viên) do API quyết định; phần kiểm ở đây chỉ để khỏi gửi thứ chắc chắn bị từ chối.
 * Tệp này không nhập Electron hay Supabase: nơi gọi truyền vào cách lấy phiên và cách gửi ảnh (xem aiChatHandlers).
 */

/** Số lượt tải cùng lúc của một app (mỗi lượt giữ tới ~12 MB bộ nhớ). */
const MAX_CONCURRENT_UPLOADS = 4
/** Trần của cột `ai_message.images`; số ảnh mỗi câu do DB quyết định (`ai_chat.max_images_per_question`). */
const MAX_IMAGES_PER_MESSAGE = 10
/** Số URL ảnh đã tải mà app còn nhớ cho phiên đang đăng nhập; quá thì quên URL cũ nhất. */
const MAX_REMEMBERED_URLS = 200

export interface AiChatImageIdentity { staffId: number; organizationId: number }

export interface AiChatImageDeps {
  /** Nhân viên đang đăng nhập; null = chưa đăng nhập. */
  identity(): AiChatImageIdentity | null
  /** Gửi một ảnh lên API Web; trả ảnh đã cất trong kho media. Lỗi là `AiChatDesktopError` mang mã `ai_chat_*`. */
  upload(image: AiChatImageUpload): Promise<AiChatImage>
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
const ownerKey = (identity: AiChatImageIdentity) => `${identity.organizationId}:${identity.staffId}`

export class AiChatImageService {
  private active = 0
  /** URL ảnh do chính phiên đang đăng nhập tải lên trong lần mở app này. Đổi tài khoản thì bỏ hết. */
  private uploaded: { owner: string; urls: Set<string> } | null = null

  constructor(private readonly deps: AiChatImageDeps) {}

  private identity(): AiChatImageIdentity {
    const current = this.deps.identity()
    if (!current) throw fail('ai_chat_access_denied')
    return current
  }

  private same(identity: AiChatImageIdentity): boolean {
    const current = this.deps.identity()
    return !!current && current.staffId === identity.staffId && current.organizationId === identity.organizationId
  }

  private remember(identity: AiChatImageIdentity, url: string): void {
    const owner = ownerKey(identity)
    if (!this.uploaded || this.uploaded.owner !== owner) this.uploaded = { owner, urls: new Set() }
    const { urls } = this.uploaded
    urls.add(url)
    while (urls.size > MAX_REMEMBERED_URLS) urls.delete(urls.values().next().value as string)
  }

  /** Nhận một ảnh (base64), kiểm sơ bộ, gửi lên API Web; trả URL để gửi kèm câu hỏi. */
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

    if (this.active >= MAX_CONCURRENT_UPLOADS) throw fail('ai_chat_image_rate_limited')
    this.active++
    try {
      let image: AiChatImage
      try {
        image = await this.deps.upload({ mimeType, dataBase64: data })
      } catch (error) {
        throw error instanceof AiChatDesktopError ? error : fail('ai_chat_image_upload_failed')
      }
      // Đổi tài khoản trong lúc tải: không trả ảnh của phiên cũ cho phiên mới.
      if (!this.same(identity)) throw fail(AI_CHAT_UNAVAILABLE)
      if (!/^https?:\/\/\S+$/i.test(image.url) || image.url.length > 2048) throw fail('ai_chat_image_upload_failed')
      this.remember(identity, image.url)
      return image
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

  /** App chỉ gửi kèm ảnh do chính phiên đang đăng nhập vừa tải lên qua API (không nhận URL lạ từ giao diện). */
  assertOwn(images: readonly string[]): void {
    if (!images.length) return
    const identity = this.identity()
    const known = this.uploaded && this.uploaded.owner === ownerKey(identity) ? this.uploaded.urls : null
    for (const url of images) if (!known?.has(url)) throw fail('ai_chat_images_invalid')
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
    this.assertOwn(images)
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
