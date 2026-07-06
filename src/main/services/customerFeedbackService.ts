import { existsSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import {
  CUSTOMER_FEEDBACK_MAX_IMAGES,
  CustomerFeedbackImageInput,
  CustomerFeedbackProduct,
  CustomerFeedbackReportType,
  CustomerFeedbackSubmitRequest,
  CustomerFeedbackSubmitResult,
  MEDIA_IMAGE_MAX_SIZE_BYTES
} from '../../shared/types'
import { requireCurrentUser } from '../data/currentUser'
import { resolveMediaStorageSettings } from '../data/repositories/mediaFileRepository'
import {
  buildMediaObjectKey,
  detectMediaMimeType,
  guessMediaMimeType,
  mediaStorageService,
  ResolvedMediaStorageSettings
} from './mediaStorageService'

const CUSTOMER_REPORT_PREFIX = 'aka-agent-customer-feedback'
const SUPPORT_RATING_WEBHOOK_URL = 'https://akagroup.sg.larksuite.com/base/workflow/webhook/event/P83damSOcwJC4khA4QzlzrLkgnh'
const REPORT_FEATURE_WEBHOOK_URL = 'https://akagroup.sg.larksuite.com/base/workflow/webhook/event/EyGoahCc2wBDBPh4wnulvSoMglg'

const REPORT_TYPES = new Set<CustomerFeedbackReportType>(['báo lỗi', 'đề xuất tính năng'])
const REPORT_PRODUCTS = new Set<CustomerFeedbackProduct>(['sms', 'zalo', 'facebook', 'email', 'khác'])

interface PreparedFeedbackImage {
  uploadPath: string
  contentType: string
  cleanupPath?: string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function formatImageSizeLimit(): string {
  return `${Math.round(MEDIA_IMAGE_MAX_SIZE_BYTES / 1024 / 1024)}MB`
}

function formatMaxImageCount(): string {
  return `${CUSTOMER_FEEDBACK_MAX_IMAGES} ảnh`
}

function isAsciiWhitespace(value: string): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t'
}

function estimateBase64DecodedSize(base64Payload: string): number {
  let meaningfulLength = 0
  for (let i = 0; i < base64Payload.length; i += 1) {
    if (!isAsciiWhitespace(base64Payload[i])) meaningfulLength += 1
  }

  let padding = 0
  for (let i = base64Payload.length - 1; i >= 0 && padding < 2; i -= 1) {
    const char = base64Payload[i]
    if (isAsciiWhitespace(char)) continue
    if (char === '=') {
      padding += 1
      continue
    }
    break
  }

  return Math.max(0, Math.floor((meaningfulLength * 3) / 4) - padding)
}

function assertImageUpload(path: string, mimeType: string): void {
  if (!existsSync(path)) throw new Error(`File không tồn tại: ${path}`)
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`Đường dẫn không phải file: ${path}`)
  if (!mimeType.toLowerCase().startsWith('image/')) throw new Error(`File không phải ảnh: ${basename(path)}`)
  if (stat.size > MEDIA_IMAGE_MAX_SIZE_BYTES) {
    throw new Error(`Ảnh "${basename(path)}" vượt quá dung lượng tối đa ${formatImageSizeLimit()}.`)
  }
}

function detectImageMimeType(path: string, fallback?: string | null): string {
  const fallbackMime = normalizeText(fallback)
  try {
    return detectMediaMimeType(path)
  } catch {
    return fallbackMime || guessMediaMimeType(path)
  }
}

function getExtensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/apng':
      return '.apng'
    case 'image/avif':
      return '.avif'
    case 'image/gif':
      return '.gif'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/bmp':
      return '.bmp'
    case 'image/heic':
      return '.heic'
    case 'image/heif':
      return '.heif'
    case 'image/svg+xml':
      return '.svg'
    case 'image/tiff':
      return '.tiff'
    default:
      return '.png'
  }
}

function sanitizeTempName(name?: string | null, mimeType = 'image/png'): string {
  const raw = normalizeText(name) || `pasted-image${getExtensionForMime(mimeType)}`
  const ext = extname(raw) || getExtensionForMime(mimeType)
  const stem = (ext ? raw.slice(0, -ext.length) : raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'image'
  return `${stem}${ext}`
}

function prepareDataUrlImage(input: CustomerFeedbackImageInput, index: number): PreparedFeedbackImage {
  const dataUrl = normalizeText(input.dataUrl)
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) throw new Error(`Ảnh #${index + 1} không đúng định dạng data URL.`)

  const contentType = match[1].toLowerCase()
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`Ảnh #${index + 1} không phải định dạng ảnh.`)

  const base64Payload = match[2]
  const estimatedSize = estimateBase64DecodedSize(base64Payload)
  if (estimatedSize === 0) throw new Error(`Ảnh #${index + 1} không có dữ liệu.`)
  if (estimatedSize > MEDIA_IMAGE_MAX_SIZE_BYTES) {
    throw new Error(`Ảnh "${input.name || `#${index + 1}`}" vượt quá dung lượng tối đa ${formatImageSizeLimit()}.`)
  }

  const buffer = Buffer.from(base64Payload.replace(/\s/g, ''), 'base64')
  if (buffer.length === 0) throw new Error(`Ảnh #${index + 1} không có dữ liệu.`)
  if (buffer.length > MEDIA_IMAGE_MAX_SIZE_BYTES) {
    throw new Error(`Ảnh "${input.name || `#${index + 1}`}" vượt quá dung lượng tối đa ${formatImageSizeLimit()}.`)
  }

  const safeName = sanitizeTempName(input.name, contentType)
  const tempPath = join(tmpdir(), `customer-feedback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`)
  writeFileSync(tempPath, buffer)
  return {
    uploadPath: tempPath,
    contentType,
    cleanupPath: tempPath
  }
}

function prepareLocalImage(input: CustomerFeedbackImageInput): PreparedFeedbackImage {
  const localPath = normalizeText(input.localPath)
  if (!localPath) throw new Error('Ảnh thiếu đường dẫn local.')
  const contentType = detectImageMimeType(localPath, input.mimeType)
  assertImageUpload(localPath, contentType)
  return {
    uploadPath: localPath,
    contentType
  }
}

function prepareImage(input: CustomerFeedbackImageInput, index: number): PreparedFeedbackImage {
  if (normalizeText(input.localPath)) return prepareLocalImage(input)
  if (normalizeText(input.dataUrl)) return prepareDataUrlImage(input, index)
  throw new Error(`Ảnh #${index + 1} thiếu dữ liệu.`)
}

async function uploadFeedbackImages(
  settings: ResolvedMediaStorageSettings,
  images: CustomerFeedbackImageInput[] = []
): Promise<string[]> {
  const urls: string[] = []

  for (let i = 0; i < images.length; i += 1) {
    const prepared = prepareImage(images[i], i)
    try {
      const result = await mediaStorageService.uploadFile(settings, {
        localPath: prepared.uploadPath,
        objectKey: buildMediaObjectKey(prepared.uploadPath, CUSTOMER_REPORT_PREFIX),
        contentType: prepared.contentType
      })
      urls.push(result.cloudUrl)
    } finally {
      if (prepared.cleanupPath) {
        try {
          unlinkSync(prepared.cleanupPath)
        } catch {
          // Best-effort cleanup for pasted-image temp files.
        }
      }
    }
  }

  return urls
}

function normalizeImages(images?: CustomerFeedbackImageInput[]): CustomerFeedbackImageInput[] {
  if (!Array.isArray(images)) return []
  return images.filter(image => normalizeText(image?.localPath) || normalizeText(image?.dataUrl))
}

function assertImageCount(images: CustomerFeedbackImageInput[]): void {
  if (images.length > CUSTOMER_FEEDBACK_MAX_IMAGES) {
    throw new Error(`Chỉ được gửi tối đa ${formatMaxImageCount()} mỗi lần.`)
  }
}

function buildPayload(request: CustomerFeedbackSubmitRequest, imageUrls: string[]) {
  const user = requireCurrentUser()
  const username = user.username || user.name || ''
  const phone = user.phone || ''
  const content = normalizeText(request.content)
  const createdAt = new Date().toISOString()

  if (!content) throw new Error('Vui lòng nhập nội dung.')

  if (request.kind === 'support_rating') {
    const rating = Number(request.rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating phải nằm trong khoảng 1-5.')
    }
    return {
      webhookUrl: SUPPORT_RATING_WEBHOOK_URL,
      payload: {
        username,
        phone,
        content,
        rating: Math.round(rating),
        image_url: imageUrls,
        createdAt
      }
    }
  }

  if (!REPORT_TYPES.has(request.type)) throw new Error('Loại báo cáo không hợp lệ.')
  if (!REPORT_PRODUCTS.has(request.product)) throw new Error('Sản phẩm không hợp lệ.')

  return {
    webhookUrl: REPORT_FEATURE_WEBHOOK_URL,
    payload: {
      type: request.type,
      content,
      username,
      phone,
      product: request.product,
      image_url: imageUrls,
      description: normalizeText(request.description),
      createdAt
    }
  }
}

function validateRequest(request: CustomerFeedbackSubmitRequest): void {
  const content = normalizeText(request.content)
  if (!content) throw new Error('Vui lòng nhập nội dung.')

  if (request.kind === 'support_rating') {
    const rating = Number(request.rating)
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new Error('Rating phải nằm trong khoảng 1-5.')
    }
    return
  }

  if (!REPORT_TYPES.has(request.type)) throw new Error('Loại báo cáo không hợp lệ.')
  if (!REPORT_PRODUCTS.has(request.product)) throw new Error('Sản phẩm không hợp lệ.')
}

function parseWebhookResponseBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

async function postWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  })

  const responseText = await response.text()
  if (!response.ok) {
    const message = responseText.slice(0, 300)
    throw new Error(`Webhook Lark lỗi HTTP ${response.status}${message ? `: ${message}` : ''}`)
  }

  const body = parseWebhookResponseBody(responseText)
  if (body && body.code !== 0) {
    const message = normalizeText(body.msg) || normalizeText(body.message) || responseText.slice(0, 300)
    throw new Error(`Webhook Lark trả lỗi${message ? `: ${message}` : ''}`)
  }
}

export async function submitCustomerFeedback(request: CustomerFeedbackSubmitRequest): Promise<CustomerFeedbackSubmitResult> {
  requireCurrentUser()
  validateRequest(request)
  const images = normalizeImages(request.images)
  assertImageCount(images)
  const settings = await resolveMediaStorageSettings()
  const imageUrls = await uploadFeedbackImages(settings, images)
  const { webhookUrl, payload } = buildPayload(request, imageUrls)
  await postWebhook(webhookUrl, payload)
  return {
    success: true,
    imageUrls
  }
}
