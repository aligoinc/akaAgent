import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs'
import { basename, extname } from 'path'

export interface ResolvedMediaStorageSettings {
  provider: string
  endpointUrl: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
  keyPrefix?: string
}

export interface MediaUploadInput {
  localPath: string
  objectKey: string
  contentType: string
}

export interface MediaUploadOutput {
  objectKey: string
  cloudUrl: string
  sizeBytes: number
  mimeType: string
}

export function guessMediaMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.apng':
      return 'image/apng'
    case '.avif':
      return 'image/avif'
    case '.gif':
      return 'image/gif'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.heic':
      return 'image/heic'
    case '.heif':
      return 'image/heif'
    case '.svg':
      return 'image/svg+xml'
    case '.tif':
    case '.tiff':
      return 'image/tiff'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.pdf':
      return 'application/pdf'
    case '.txt':
      return 'text/plain'
    case '.csv':
      return 'text/csv'
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.xls':
      return 'application/vnd.ms-excel'
    default:
      return 'application/octet-stream'
  }
}

function readMediaHeader(filePath: string, length = 512): Buffer {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const bytesRead = readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    closeSync(fd)
  }
}

export function sniffImageMimeType(filePath: string): string | null {
  const header = readMediaHeader(filePath)
  if (header.length < 4) return null

  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg'
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (header.length >= 6 && (header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif'
  if (header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (header.length >= 2 && header.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
  if (header.length >= 4 && (header.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || header.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))) return 'image/tiff'

  if (header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brands = header.subarray(8, Math.min(header.length, 64)).toString('ascii')
    if (/(avif|avis)/.test(brands)) return 'image/avif'
    if (/(heic|heix|hevc|hevx|mif1|msf1)/.test(brands)) return 'image/heif'
  }

  const textHeader = header.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase()
  if (textHeader.startsWith('<svg') || (textHeader.startsWith('<?xml') && textHeader.includes('<svg'))) return 'image/svg+xml'

  return null
}

export function detectMediaMimeType(filePath: string): string {
  return sniffImageMimeType(filePath) || guessMediaMimeType(filePath)
}

export function buildMediaObjectKey(filePath: string, keyPrefix?: string): string {
  const normalizedPrefix = String(keyPrefix || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  const safeName = basename(filePath)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'file'
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const parts = [normalizedPrefix, `${unique}-${safeName}`].filter(Boolean)
  return parts.join('/')
}

export function buildMediaCloudUrl(publicBaseUrl: string, objectKey: string): string {
  const base = String(publicBaseUrl || '').trim().replace(/\/+$/g, '')
  if (!base) throw new Error('Thiếu public base URL cho media.')
  return `${base}/${objectKey.split('/').map(encodeURIComponent).join('/')}`
}

export class MediaStorageService {
  private buildR2Client(settings: ResolvedMediaStorageSettings): S3Client {
    return new S3Client({
      region: 'auto',
      endpoint: settings.endpointUrl,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey
      }
    })
  }

  private assertConfigured(settings: ResolvedMediaStorageSettings): void {
    if (settings.provider !== 'r2') throw new Error(`Provider media chưa được hỗ trợ: ${settings.provider}`)
    if (!settings.endpointUrl) throw new Error('Thiếu endpoint URL.')
    if (!settings.accessKeyId) throw new Error('Thiếu access key ID.')
    if (!settings.secretAccessKey) throw new Error('Thiếu secret access key.')
    if (!settings.bucket) throw new Error('Thiếu bucket.')
    if (!settings.publicBaseUrl) throw new Error('Thiếu public base URL.')
  }

  private async assertPublicUrlReadable(cloudUrl: string, expectedBody: Buffer): Promise<void> {
    try {
      const response = await fetch(cloudUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(30000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const actualBody = Buffer.from(await response.arrayBuffer())
      if (!actualBody.equals(expectedBody)) {
        throw new Error('Nội dung public URL không khớp object vừa upload.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Upload test thành công nhưng public base URL không đọc được: ${message}`)
    }
  }

  async uploadFile(settings: ResolvedMediaStorageSettings, input: MediaUploadInput): Promise<MediaUploadOutput> {
    this.assertConfigured(settings)
    if (!existsSync(input.localPath)) throw new Error(`File không tồn tại: ${input.localPath}`)
    const stat = statSync(input.localPath)
    if (!stat.isFile()) throw new Error(`Đường dẫn không phải file: ${input.localPath}`)

    const body = readFileSync(input.localPath)
    const client = this.buildR2Client(settings)
    await client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: input.objectKey,
      Body: body,
      ContentType: input.contentType
    }))

    return {
      objectKey: input.objectKey,
      cloudUrl: buildMediaCloudUrl(settings.publicBaseUrl, input.objectKey),
      sizeBytes: stat.size,
      mimeType: input.contentType
    }
  }

  async test(settings: ResolvedMediaStorageSettings): Promise<{ ok: boolean; cloudUrl?: string }> {
    this.assertConfigured(settings)
    const objectKey = buildMediaObjectKey('media-storage-test.txt', settings.keyPrefix)
    const client = this.buildR2Client(settings)
    const body = Buffer.from('media storage connectivity test', 'utf8')
    let uploaded = false
    await client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: objectKey,
      Body: body,
      ContentType: 'text/plain'
    }))
    uploaded = true

    const cloudUrl = buildMediaCloudUrl(settings.publicBaseUrl, objectKey)
    try {
      await this.assertPublicUrlReadable(cloudUrl, body)
    } finally {
      if (uploaded) {
        try {
          await client.send(new DeleteObjectCommand({
            Bucket: settings.bucket,
            Key: objectKey
          }))
        } catch {
          // Best-effort cleanup only. A failed cleanup should not make a valid config fail.
        }
      }
    }

    return { ok: true, cloudUrl }
  }
}

export const mediaStorageService = new MediaStorageService()
