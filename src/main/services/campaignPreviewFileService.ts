import { existsSync, statSync, readFileSync } from 'fs'
import { extname, resolve } from 'path'

export interface CampaignPreviewFileReadResult {
  filePath: string
  dataUrl: string
  sizeBytes: number
  mimeType: string
}

const MAX_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024

const SUPPORTED_PREVIEW_IMAGE_EXTENSIONS = new Set(['.apng', '.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp'])

export function readCampaignPreviewFileDataUrl(filePath: string): CampaignPreviewFileReadResult {
  const rawPath = String(filePath || '').trim()
  if (!rawPath) throw new Error('Đường dẫn file xem trước không hợp lệ.')

  const targetPath = resolve(rawPath)
  if (!existsSync(targetPath)) throw new Error('File xem trước không còn tồn tại.')

  const stat = statSync(targetPath)
  if (!stat.isFile()) throw new Error('Đường dẫn xem trước không phải file.')
  if (stat.size > MAX_PREVIEW_IMAGE_BYTES) throw new Error('Ảnh xem trước quá lớn.')

  const ext = extname(targetPath).toLowerCase()
  if (!SUPPORTED_PREVIEW_IMAGE_EXTENSIONS.has(ext)) throw new Error('File xem trước không phải ảnh được hỗ trợ.')

  const buffer = readFileSync(targetPath)
  const detectedMimeType = detectImageMimeType(buffer)
  if (!detectedMimeType) throw new Error('File xem trước không phải ảnh hợp lệ.')

  const mimeType = detectedMimeType === 'image/png' && ext === '.apng'
    ? 'image/apng'
    : detectedMimeType

  return {
    filePath: targetPath,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    sizeBytes: stat.size,
    mimeType
  }
}

function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.toString('ascii', 0, 6)
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif'
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }

  if (isAvifBuffer(buffer)) {
    return 'image/avif'
  }

  return null
}

function isAvifBuffer(buffer: Buffer): boolean {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false

  const maxOffset = Math.min(buffer.length - 4, 64)
  for (let offset = 8; offset <= maxOffset; offset += 4) {
    const brand = buffer.toString('ascii', offset, offset + 4)
    if (brand === 'avif' || brand === 'avis') return true
  }

  return false
}
