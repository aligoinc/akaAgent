import { statSync } from 'fs'
import { basename } from 'path'
import {
  CampaignMediaSnapshot,
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  MEDIA_LIBRARY_MAX_FILES_PER_STAFF,
  MediaFile,
  MediaStorageSettings,
  MediaUploadFailure,
  MediaUploadResult
} from '../../../shared/types'
import { mapMediaFileFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import {
  buildMediaObjectKey,
  detectMediaMimeType,
  guessMediaMimeType,
  mediaStorageService,
  ResolvedMediaStorageSettings
} from '../../services/mediaStorageService'

const client = () => getSupabaseClient()
const SECRET_MASK = '********'

const MEDIA_SETTING_KEYS = {
  provider: 'media.storage.provider',
  endpointUrl: 'media.storage.endpoint_url',
  accessKeyId: 'media.storage.access_key_id',
  secretAccessKey: 'media.storage.secret_access_key',
  bucket: 'media.storage.bucket',
  publicBaseUrl: 'media.storage.public_base_url',
  keyPrefix: 'media.storage.key_prefix'
} as const

type MediaSettingName = keyof typeof MEDIA_SETTING_KEYS

const DEFAULT_SETTINGS: Record<MediaSettingName, string> = {
  provider: 'r2',
  endpointUrl: '',
  accessKeyId: '',
  secretAccessKey: '',
  bucket: '',
  publicBaseUrl: '',
  keyPrefix: ''
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function formatMediaLimitSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

function getMediaQuotaError(activeCount: number): string {
  return `Thư viện media đã có ${activeCount}/${MEDIA_LIBRARY_MAX_FILES_PER_STAFF} file. Vui lòng xoá bớt media trước khi upload thêm.`
}

function isMediaImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/')
}

function resolveUploadMimeType(localPath: string): string {
  try {
    return detectMediaMimeType(localPath)
  } catch {
    return guessMediaMimeType(localPath)
  }
}

function assertMediaUploadSize(localPath: string, mimeType: string): void {
  const stat = statSync(localPath)
  if (!stat.isFile()) throw new Error(`Đường dẫn không phải file: ${localPath}`)
  const limit = isMediaImageMime(mimeType) ? MEDIA_IMAGE_MAX_SIZE_BYTES : MEDIA_FILE_MAX_SIZE_BYTES
  if (stat.size > limit) {
    const label = isMediaImageMime(mimeType) ? 'Ảnh' : 'File'
    throw new Error(`${label} vượt quá dung lượng tối đa ${formatMediaLimitSize(limit)}.`)
  }
}

function requireAdmin(): void {
  const user = requireCurrentUser()
  if (!user.isAdminAkabiz) throw new Error('Chỉ admin akaBiz được cấu hình kho media.')
}

async function readSettingsMap(): Promise<Map<string, string>> {
  requireCurrentUser()
  const keys = Object.values(MEDIA_SETTING_KEYS)
  const { data, error } = await client()
    .from('auto_system_settings')
    .select('key, value')
    .in('key', keys)
    .eq('is_active', true)

  if (error) throw new Error(`Không thể tải cấu hình media: ${error.message}`)
  return new Map((data || []).map(row => [String(row.key), String(row.value || '')]))
}

function getSettingValue(settings: Map<string, string>, name: MediaSettingName): string {
  return normalizeText(settings.get(MEDIA_SETTING_KEYS[name]) ?? DEFAULT_SETTINGS[name])
}

export async function resolveMediaStorageSettings(): Promise<ResolvedMediaStorageSettings> {
  const settings = await readSettingsMap()
  return {
    provider: getSettingValue(settings, 'provider') || 'r2',
    endpointUrl: getSettingValue(settings, 'endpointUrl'),
    accessKeyId: getSettingValue(settings, 'accessKeyId'),
    secretAccessKey: getSettingValue(settings, 'secretAccessKey'),
    bucket: getSettingValue(settings, 'bucket'),
    publicBaseUrl: getSettingValue(settings, 'publicBaseUrl'),
    keyPrefix: getSettingValue(settings, 'keyPrefix')
  }
}

function toPublicSettings(settings: ResolvedMediaStorageSettings, includeConfig = true): MediaStorageSettings {
  const isConfigured = Boolean(
    settings.provider &&
    settings.endpointUrl &&
    settings.accessKeyId &&
    settings.secretAccessKey &&
    settings.bucket &&
    settings.publicBaseUrl
  )
  if (!includeConfig) {
    return {
      provider: settings.provider || 'r2',
      endpointUrl: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: '',
      publicBaseUrl: '',
      keyPrefix: '',
      isConfigured,
      secretAccessKeyMasked: false
    }
  }

  return {
    provider: settings.provider || 'r2',
    endpointUrl: settings.endpointUrl,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey ? SECRET_MASK : '',
    bucket: settings.bucket,
    publicBaseUrl: settings.publicBaseUrl,
    keyPrefix: settings.keyPrefix,
    isConfigured,
    secretAccessKeyMasked: Boolean(settings.secretAccessKey)
  }
}

async function upsertSetting(key: string, value: string, description: string, isSecret = false): Promise<void> {
  const { error } = await client()
    .from('auto_system_settings')
    .upsert({
      key,
      value,
      description,
      is_secret: isSecret,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'key' })

  if (error) throw new Error(`Không thể lưu cấu hình media: ${error.message}`)
}

export async function getMediaStorageSettings(): Promise<MediaStorageSettings> {
  const user = requireCurrentUser()
  return toPublicSettings(await resolveMediaStorageSettings(), user.isAdminAkabiz === true)
}

function buildStorageSettingsInput(
  settings: Partial<MediaStorageSettings>,
  current: ResolvedMediaStorageSettings
): ResolvedMediaStorageSettings {
  return {
    provider: settings.provider !== undefined ? (normalizeText(settings.provider) || 'r2') : (current.provider || 'r2'),
    endpointUrl: settings.endpointUrl !== undefined ? normalizeText(settings.endpointUrl) : current.endpointUrl,
    accessKeyId: settings.accessKeyId !== undefined ? normalizeText(settings.accessKeyId) : current.accessKeyId,
    secretAccessKey: settings.secretAccessKey === undefined || settings.secretAccessKey === SECRET_MASK
      ? current.secretAccessKey
      : normalizeText(settings.secretAccessKey),
    bucket: settings.bucket !== undefined ? normalizeText(settings.bucket) : current.bucket,
    publicBaseUrl: settings.publicBaseUrl !== undefined ? normalizeText(settings.publicBaseUrl) : current.publicBaseUrl,
    keyPrefix: settings.keyPrefix !== undefined
      ? normalizeText(settings.keyPrefix)
      : (current.keyPrefix || DEFAULT_SETTINGS.keyPrefix)
  }
}

export async function saveMediaStorageSettings(settings: Partial<MediaStorageSettings>): Promise<MediaStorageSettings> {
  requireAdmin()
  const current = await resolveMediaStorageSettings()
  const next = buildStorageSettingsInput(settings, current)

  await upsertSetting(MEDIA_SETTING_KEYS.provider, next.provider, 'Cloud media storage provider.')
  await upsertSetting(MEDIA_SETTING_KEYS.endpointUrl, next.endpointUrl, 'S3-compatible endpoint URL for media uploads.')
  await upsertSetting(MEDIA_SETTING_KEYS.accessKeyId, next.accessKeyId, 'Access key ID for media uploads.')
  await upsertSetting(MEDIA_SETTING_KEYS.secretAccessKey, next.secretAccessKey, 'Secret access key for media uploads.', true)
  await upsertSetting(MEDIA_SETTING_KEYS.bucket, next.bucket, 'Bucket name for media uploads.')
  await upsertSetting(MEDIA_SETTING_KEYS.publicBaseUrl, next.publicBaseUrl, 'Public base URL used to build uploaded media links.')
  await upsertSetting(MEDIA_SETTING_KEYS.keyPrefix, next.keyPrefix || '', 'Optional key prefix for uploaded media objects.')

  return toPublicSettings(next)
}

export async function testMediaStorageSettings(settings: Partial<MediaStorageSettings> = {}): Promise<{ ok: boolean; cloudUrl?: string }> {
  requireAdmin()
  const current = await resolveMediaStorageSettings()
  return mediaStorageService.test(buildStorageSettingsInput(settings, current))
}

export async function listMediaFiles(): Promise<MediaFile[]> {
  const user = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_media_files')
    .select('*')
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Không thể tải thư viện media: ${error.message}`)
  return (data || []).map(row => mapMediaFileFromDB(row))
}

async function countActiveMediaFiles(staffId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_media_files')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Không thể kiểm tra quota media: ${error.message}`)
  return count ?? 0
}

export async function uploadMediaFiles(localPaths: string[]): Promise<MediaUploadResult> {
  const user = requireCurrentUser()
  const settings = await resolveMediaStorageSettings()
  const paths = Array.from(new Set(
    (Array.isArray(localPaths) ? localPaths : [])
      .map(path => normalizeText(path))
      .filter(Boolean)
  ))
  if (paths.length === 0) return { files: [], failures: [] }

  const activeCount = await countActiveMediaFiles(user.staffId)
  if (activeCount + paths.length > MEDIA_LIBRARY_MAX_FILES_PER_STAFF) {
    const error = getMediaQuotaError(activeCount)
    return {
      files: [],
      failures: paths.map(localPath => ({ localPath, error }))
    }
  }

  const mediaInputs = paths.map(localPath => ({
    localPath,
    mimeType: resolveUploadMimeType(localPath)
  }))
  const uploaded: MediaFile[] = []
  const failures: MediaUploadFailure[] = []
  for (const { localPath, mimeType } of mediaInputs) {
    try {
      assertMediaUploadSize(localPath, mimeType)
      const objectKey = buildMediaObjectKey(localPath, settings.keyPrefix)
      const result = await mediaStorageService.uploadFile(settings, {
        localPath,
        objectKey,
        contentType: mimeType
      })

      const { data, error } = await client()
        .from('auto_media_files')
        .insert({
          provider: settings.provider,
          original_name: basename(localPath) || 'file',
          local_path: localPath,
          cloud_url: result.cloudUrl,
          object_key: result.objectKey,
          mime_type: result.mimeType,
          size_bytes: result.sizeBytes,
          staff_id: user.staffId,
          organization_id: user.organizationId
        })
        .select('*')
        .single()

      if (error) throw new Error(`Upload thành công nhưng không thể lưu media: ${error.message}`)
      uploaded.push(mapMediaFileFromDB(data))
    } catch (err) {
      failures.push({
        localPath,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return { files: uploaded, failures }
}

export async function deleteMediaFile(id: number): Promise<void> {
  const user = requireCurrentUser()
  const { error } = await client()
    .from('auto_media_files')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)

  if (error) throw new Error(`Không thể xoá media: ${error.message}`)
}

export function mediaFileToCampaignSnapshot(file: MediaFile): CampaignMediaSnapshot {
  return {
    name: file.originalName,
    localPath: file.localPath || '',
    cloudUrl: file.cloudUrl,
    mimeType: file.mimeType || '',
    sizeBytes: file.sizeBytes ?? null,
    provider: file.provider || 'r2'
  }
}
