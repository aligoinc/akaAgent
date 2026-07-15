import { renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join } from 'path'
import {
  CampaignMediaSnapshot,
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  MEDIA_LIBRARY_DEFAULT_MAX_FILES_PER_STAFF,
  MEDIA_LIBRARY_MAX_FILES_SETTING_KEY,
  MediaClipboardImageInput,
  MediaFile,
  MediaGroup,
  MediaStorageSettings,
  MediaUploadFailure,
  MediaUploadResult
} from '../../../shared/types'
import { mapMediaFileFromDB, mapMediaGroupFromDB } from '../mappers'
import { requireCurrentUser } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import { getSettingValue as getSystemSettingValue, listActiveSystemSettingsByKeys } from './systemSettingsRepository'
import {
  buildMediaObjectKey,
  detectMediaMimeType,
  guessMediaMimeType,
  mediaStorageService,
  ResolvedMediaStorageSettings,
  sniffImageMimeType
} from '../../services/mediaStorageService'

const client = () => getSupabaseClient()
const SECRET_MASK = '********'
const MEDIA_QUERY_PAGE_SIZE = 1_000
const MEDIA_ID_QUERY_CHUNK_SIZE = 500

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

function normalizeName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeId(value: unknown): number {
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function normalizeIds(values: unknown): number[] {
  const raw = Array.isArray(values) ? values : []
  const seen = new Set<number>()
  const ids: number[] = []
  for (const value of raw) {
    const id = normalizeId(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function buildMediaGroupItemRows(
  groupId: number,
  mediaFileIds: number[],
  sortOrderStart = 0,
  baseTime = Date.now()
): Array<Record<string, unknown>> {
  return mediaFileIds.map((mediaFileId, index) => ({
    group_id: groupId,
    media_file_id: mediaFileId,
    sort_order: sortOrderStart + index + 1,
    created_at: new Date(baseTime + sortOrderStart + index).toISOString()
  }))
}

function formatMediaLimitSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}

function formatMediaGroupError(error: { message?: string; code?: string } | null | undefined, fallback: string): Error {
  const message = error?.message || ''
  if (error?.code === '23505' || /duplicate key/i.test(message)) {
    return new Error('Thư mục media này đã tồn tại.')
  }
  return new Error(message ? `${fallback}: ${message}` : fallback)
}

function getMediaQuotaError(activeCount: number, maxFilesPerStaff: number): string {
  return `Thư viện media đã có ${activeCount}/${maxFilesPerStaff} file. Vui lòng xoá bớt media trước khi upload thêm.`
}

function normalizeMediaLibraryMaxFiles(value: unknown): number {
  const parsed = Number(normalizeText(value))
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : MEDIA_LIBRARY_DEFAULT_MAX_FILES_PER_STAFF
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

function getImageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/apng':
      return '.apng'
    case 'image/avif':
      return '.avif'
    case 'image/bmp':
      return '.bmp'
    case 'image/gif':
      return '.gif'
    case 'image/heic':
      return '.heic'
    case 'image/heif':
      return '.heif'
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/svg+xml':
      return '.svg'
    case 'image/tiff':
      return '.tiff'
    case 'image/webp':
      return '.webp'
    default:
      return '.png'
  }
}

function sanitizeClipboardImageName(value: unknown, mimeType: string, index: number): string {
  const rawName = basename(normalizeText(value))
  const rawExtension = extname(rawName)
  const rawStem = rawExtension ? rawName.slice(0, -rawExtension.length) : rawName
  const safeStem = rawStem
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fallback = `pasted-image-${Date.now()}-${index + 1}`
  return `${safeStem || fallback}${getImageExtension(mimeType)}`
}

function estimateBase64DecodedSize(value: string): number {
  const normalized = value.replace(/\s/g, '')
  if (!normalized) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding)
}

interface PreparedMediaUpload {
  uploadPath: string
  originalName: string
  persistedLocalPath: string | null
  mimeType: string
}

function prepareClipboardImage(input: MediaClipboardImageInput, index: number): PreparedMediaUpload & { cleanupPath: string } {
  const dataUrl = normalizeText(input?.dataUrl)
  const failureName = normalizeText(input?.name) || `Ảnh dán #${index + 1}`
  const maxDataUrlLength = Math.ceil(MEDIA_IMAGE_MAX_SIZE_BYTES * 4 / 3) + 1024
  if (!dataUrl || dataUrl.length > maxDataUrlLength) {
    throw new Error(dataUrl ? `Ảnh "${failureName}" vượt quá dung lượng tối đa ${formatMediaLimitSize(MEDIA_IMAGE_MAX_SIZE_BYTES)}.` : 'Ảnh dán không có dữ liệu.')
  }

  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(dataUrl)
  if (!match || !match[1].toLowerCase().startsWith('image/')) {
    throw new Error(`Ảnh "${failureName}" không đúng định dạng data URL.`)
  }

  const base64Payload = match[2].replace(/\s/g, '')
  const validBase64 = base64Payload.length % 4 === 0
    && /^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(base64Payload)
  if (!validBase64) {
    throw new Error(`Ảnh "${failureName}" có dữ liệu base64 không hợp lệ.`)
  }
  const estimatedSize = estimateBase64DecodedSize(base64Payload)
  if (estimatedSize <= 0) throw new Error(`Ảnh "${failureName}" không có dữ liệu.`)
  if (estimatedSize > MEDIA_IMAGE_MAX_SIZE_BYTES) {
    throw new Error(`Ảnh "${failureName}" vượt quá dung lượng tối đa ${formatMediaLimitSize(MEDIA_IMAGE_MAX_SIZE_BYTES)}.`)
  }

  const body = Buffer.from(base64Payload, 'base64')
  if (body.length <= 0) throw new Error(`Ảnh "${failureName}" không có dữ liệu.`)
  if (body.length > MEDIA_IMAGE_MAX_SIZE_BYTES) {
    throw new Error(`Ảnh "${failureName}" vượt quá dung lượng tối đa ${formatMediaLimitSize(MEDIA_IMAGE_MAX_SIZE_BYTES)}.`)
  }

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const sniffPath = join(tmpdir(), `aka-agent-media-${unique}.tmp`)
  let cleanupPath = sniffPath
  try {
    writeFileSync(sniffPath, body)
    const mimeType = sniffImageMimeType(sniffPath)
    if (!mimeType) throw new Error(`Ảnh "${failureName}" không phải định dạng ảnh được hỗ trợ.`)

    const originalName = sanitizeClipboardImageName(input?.name, mimeType, index)
    const uploadPath = join(tmpdir(), `aka-agent-media-${unique}-${originalName}`)
    renameSync(sniffPath, uploadPath)
    cleanupPath = uploadPath
    return {
      uploadPath,
      originalName,
      persistedLocalPath: null,
      mimeType,
      cleanupPath
    }
  } catch (error) {
    try {
      unlinkSync(cleanupPath)
    } catch {
      // Best-effort cleanup for invalid clipboard images.
    }
    throw error
  }
}

async function uploadPreparedMedia(
  settings: ResolvedMediaStorageSettings,
  input: PreparedMediaUpload,
  staffId: number,
  organizationId?: number | null
): Promise<MediaFile> {
  assertMediaUploadSize(input.uploadPath, input.mimeType)
  const objectKey = buildMediaObjectKey(input.originalName, settings.keyPrefix)
  const result = await mediaStorageService.uploadFile(settings, {
    localPath: input.uploadPath,
    objectKey,
    contentType: input.mimeType
  })

  const { data, error } = await client()
    .from('auto_media_files')
    .insert({
      provider: settings.provider,
      original_name: input.originalName,
      local_path: input.persistedLocalPath,
      cloud_url: result.cloudUrl,
      object_key: result.objectKey,
      mime_type: result.mimeType,
      size_bytes: result.sizeBytes,
      staff_id: staffId,
      organization_id: organizationId
    })
    .select('*')
    .single()

  if (error) throw new Error(`Upload thành công nhưng không thể lưu media: ${error.message}`)
  return mapMediaFileFromDB(data)
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

function getStorageSettingValue(settings: Map<string, string>, name: MediaSettingName): string {
  return normalizeText(settings.get(MEDIA_SETTING_KEYS[name]) ?? DEFAULT_SETTINGS[name])
}

export async function resolveMediaStorageSettings(): Promise<ResolvedMediaStorageSettings> {
  const settings = await readSettingsMap()
  return {
    provider: getStorageSettingValue(settings, 'provider') || 'r2',
    endpointUrl: getStorageSettingValue(settings, 'endpointUrl'),
    accessKeyId: getStorageSettingValue(settings, 'accessKeyId'),
    secretAccessKey: getStorageSettingValue(settings, 'secretAccessKey'),
    bucket: getStorageSettingValue(settings, 'bucket'),
    publicBaseUrl: getStorageSettingValue(settings, 'publicBaseUrl'),
    keyPrefix: getStorageSettingValue(settings, 'keyPrefix')
  }
}

export async function resolveMediaLibraryMaxFiles(): Promise<number> {
  const settings = await listActiveSystemSettingsByKeys([MEDIA_LIBRARY_MAX_FILES_SETTING_KEY])
  return normalizeMediaLibraryMaxFiles(getSystemSettingValue(settings, MEDIA_LIBRARY_MAX_FILES_SETTING_KEY))
}

function toPublicSettings(
  settings: ResolvedMediaStorageSettings,
  includeConfig = true,
  maxFilesPerStaff = MEDIA_LIBRARY_DEFAULT_MAX_FILES_PER_STAFF
): MediaStorageSettings {
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
      maxFilesPerStaff,
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
    maxFilesPerStaff,
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
  const [settings, maxFilesPerStaff] = await Promise.all([
    resolveMediaStorageSettings(),
    resolveMediaLibraryMaxFiles()
  ])
  return toPublicSettings(settings, user.isAdminAkabiz === true, maxFilesPerStaff)
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

  return toPublicSettings(next, true, await resolveMediaLibraryMaxFiles())
}

export async function testMediaStorageSettings(settings: Partial<MediaStorageSettings> = {}): Promise<{ ok: boolean; cloudUrl?: string }> {
  requireAdmin()
  const current = await resolveMediaStorageSettings()
  return mediaStorageService.test(buildStorageSettingsInput(settings, current))
}

export async function listMediaFiles(): Promise<MediaFile[]> {
  const user = requireCurrentUser()
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += MEDIA_QUERY_PAGE_SIZE) {
    const { data, error } = await client()
      .from('auto_media_files')
      .select('*')
      .eq('staff_id', user.staffId)
      .eq('is_delete', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + MEDIA_QUERY_PAGE_SIZE - 1)

    if (error) throw new Error(`Không thể tải thư viện media: ${error.message}`)
    const page = (data || []) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < MEDIA_QUERY_PAGE_SIZE) break
  }
  return rows.map(row => mapMediaFileFromDB(row))
}

async function listActiveMediaFileIds(staffId: number, mediaFileIds: number[]): Promise<number[]> {
  const ids = normalizeIds(mediaFileIds)
  if (ids.length === 0) return []

  const active = new Set<number>()
  for (let from = 0; from < ids.length; from += MEDIA_ID_QUERY_CHUNK_SIZE) {
    const chunk = ids.slice(from, from + MEDIA_ID_QUERY_CHUNK_SIZE)
    const { data, error } = await client()
      .from('auto_media_files')
      .select('id')
      .eq('staff_id', staffId)
      .eq('is_delete', false)
      .in('id', chunk)

    if (error) throw new Error(`Không thể kiểm tra media trong thư mục: ${error.message}`)
    for (const row of data || []) {
      const id = Number(row.id)
      if (Number.isFinite(id) && id > 0) active.add(id)
    }
  }
  return ids.filter(id => active.has(id))
}

async function assertMediaGroupForStaff(groupId: number, staffId: number): Promise<void> {
  const id = normalizeId(groupId)
  if (!id) throw new Error('Thư mục media không hợp lệ.')

  const { data, error } = await client()
    .from('auto_media_groups')
    .select('id')
    .eq('id', id)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw formatMediaGroupError(error, 'Không thể kiểm tra thư mục media')
  if (!data) throw new Error('Không tìm thấy thư mục media.')
}

async function countMediaFilesByGroup(groupIds: number[], staffId: number): Promise<Map<number, number>> {
  const ids = normalizeIds(groupIds)
  const counts = new Map<number, number>()
  for (const id of ids) counts.set(id, 0)
  if (ids.length === 0) return counts

  const memberships: Record<string, unknown>[] = []
  for (let from = 0; ; from += MEDIA_QUERY_PAGE_SIZE) {
    const { data, error } = await client()
      .from('auto_media_group_items')
      .select('group_id, media_file_id')
      .in('group_id', ids)
      .order('group_id', { ascending: true })
      .order('media_file_id', { ascending: true })
      .range(from, from + MEDIA_QUERY_PAGE_SIZE - 1)

    if (error) throw formatMediaGroupError(error, 'Không thể tải số lượng media trong thư mục')
    const page = (data || []) as Record<string, unknown>[]
    memberships.push(...page)
    if (page.length < MEDIA_QUERY_PAGE_SIZE) break
  }
  const mediaIds = normalizeIds(memberships.map(row => row.media_file_id))
  const activeMediaIds = new Set(await listActiveMediaFileIds(staffId, mediaIds))
  for (const row of memberships) {
    const groupId = normalizeId(row.group_id)
    const mediaFileId = normalizeId(row.media_file_id)
    if (!groupId || !activeMediaIds.has(mediaFileId)) continue
    counts.set(groupId, (counts.get(groupId) || 0) + 1)
  }

  return counts
}

export async function listMediaGroups(): Promise<MediaGroup[]> {
  const user = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_media_groups')
    .select('*')
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw formatMediaGroupError(error, 'Không thể tải thư mục media')
  const groups = (data || []).map(row => mapMediaGroupFromDB(row))
  const counts = await countMediaFilesByGroup(groups.map(group => group.id), user.staffId)
  return groups.map(group => ({ ...group, fileCount: counts.get(group.id) || 0 }))
}

export async function createMediaGroup(input: Partial<MediaGroup>): Promise<MediaGroup> {
  const user = requireCurrentUser()
  const name = normalizeName(input.name)
  if (!name) throw new Error('Vui lòng nhập tên thư mục media.')

  const { data, error } = await client()
    .from('auto_media_groups')
    .insert({
      name,
      staff_id: user.staffId,
      organization_id: user.organizationId,
      is_delete: false
    })
    .select('*')
    .single()

  if (error) throw formatMediaGroupError(error, 'Không thể tạo thư mục media')
  return { ...mapMediaGroupFromDB(data), fileCount: 0 }
}

export async function updateMediaGroup(id: number, updates: Partial<MediaGroup>): Promise<MediaGroup> {
  const user = requireCurrentUser()
  const groupId = normalizeId(id)
  if (!groupId) throw new Error('Thư mục media không hợp lệ.')

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) {
    const name = normalizeName(updates.name)
    if (!name) throw new Error('Vui lòng nhập tên thư mục media.')
    payload.name = name
  }

  const { data, error } = await client()
    .from('auto_media_groups')
    .update(payload)
    .eq('id', groupId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('*')
    .maybeSingle()

  if (error) throw formatMediaGroupError(error, 'Không thể cập nhật thư mục media')
  if (!data) throw new Error('Không tìm thấy thư mục media.')
  const counts = await countMediaFilesByGroup([groupId], user.staffId)
  return { ...mapMediaGroupFromDB(data), fileCount: counts.get(groupId) || 0 }
}

export async function deleteMediaGroup(id: number): Promise<void> {
  const user = requireCurrentUser()
  const groupId = normalizeId(id)
  if (!groupId) throw new Error('Thư mục media không hợp lệ.')

  const { data, error } = await client()
    .from('auto_media_groups')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('id')
    .maybeSingle()

  if (error) throw formatMediaGroupError(error, 'Không thể xoá thư mục media')
  if (!data) throw new Error('Không tìm thấy thư mục media.')

  const { error: deleteItemsError } = await client()
    .from('auto_media_group_items')
    .delete()
    .eq('group_id', groupId)

  if (deleteItemsError) throw formatMediaGroupError(deleteItemsError, 'Không thể xoá media khỏi thư mục')
}

export async function listMediaGroupFileIds(groupId: number): Promise<number[]> {
  const user = requireCurrentUser()
  const id = normalizeId(groupId)
  if (!id) throw new Error('Thư mục media không hợp lệ.')
  await assertMediaGroupForStaff(id, user.staffId)

  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += MEDIA_QUERY_PAGE_SIZE) {
    const { data, error } = await client()
      .from('auto_media_group_items')
      .select('media_file_id, created_at')
      .eq('group_id', id)
      .order('created_at', { ascending: true })
      .order('media_file_id', { ascending: true })
      .range(from, from + MEDIA_QUERY_PAGE_SIZE - 1)

    if (error) throw formatMediaGroupError(error, 'Không thể tải media trong thư mục')
    const page = (data || []) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < MEDIA_QUERY_PAGE_SIZE) break
  }
  return listActiveMediaFileIds(user.staffId, normalizeIds(rows.map(row => row.media_file_id)))
}

export async function addMediaGroupFiles(groupId: number, mediaFileIds: number[]): Promise<number[]> {
  const user = requireCurrentUser()
  const id = normalizeId(groupId)
  if (!id) throw new Error('Thư mục media không hợp lệ.')
  await assertMediaGroupForStaff(id, user.staffId)

  const activeIds = await listActiveMediaFileIds(user.staffId, mediaFileIds)
  const membershipBaseTime = Date.now()
  for (let from = 0; from < activeIds.length; from += MEDIA_ID_QUERY_CHUNK_SIZE) {
    const chunk = activeIds.slice(from, from + MEDIA_ID_QUERY_CHUNK_SIZE)
    const { error: insertError } = await client()
      .from('auto_media_group_items')
      .upsert(buildMediaGroupItemRows(id, chunk, from, membershipBaseTime), {
        onConflict: 'group_id,media_file_id',
        ignoreDuplicates: true
      })

    if (insertError) throw formatMediaGroupError(insertError, 'Không thể thêm media vào thư mục')
  }

  const { error: updateError } = await client()
    .from('auto_media_groups')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', user.staffId)

  if (updateError) throw formatMediaGroupError(updateError, 'Không thể cập nhật thư mục media')
  return listMediaGroupFileIds(id)
}

export async function removeMediaGroupFiles(groupId: number, mediaFileIds: number[]): Promise<number[]> {
  const user = requireCurrentUser()
  const id = normalizeId(groupId)
  if (!id) throw new Error('Thư mục media không hợp lệ.')
  await assertMediaGroupForStaff(id, user.staffId)

  const ids = normalizeIds(mediaFileIds)
  for (let from = 0; from < ids.length; from += MEDIA_ID_QUERY_CHUNK_SIZE) {
    const chunk = ids.slice(from, from + MEDIA_ID_QUERY_CHUNK_SIZE)
    const { error: deleteError } = await client()
      .from('auto_media_group_items')
      .delete()
      .eq('group_id', id)
      .in('media_file_id', chunk)

    if (deleteError) throw formatMediaGroupError(deleteError, 'Không thể gỡ media khỏi thư mục')
  }

  const { error: updateError } = await client()
    .from('auto_media_groups')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', user.staffId)

  if (updateError) throw formatMediaGroupError(updateError, 'Không thể cập nhật thư mục media')
  return listMediaGroupFileIds(id)
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
  const [settings, maxFilesPerStaff] = await Promise.all([
    resolveMediaStorageSettings(),
    resolveMediaLibraryMaxFiles()
  ])
  const paths = Array.from(new Set(
    (Array.isArray(localPaths) ? localPaths : [])
      .map(path => normalizeText(path))
      .filter(Boolean)
  ))
  if (paths.length === 0) return { files: [], failures: [] }

  const activeCount = await countActiveMediaFiles(user.staffId)
  if (activeCount + paths.length > maxFilesPerStaff) {
    const error = getMediaQuotaError(activeCount, maxFilesPerStaff)
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
      uploaded.push(await uploadPreparedMedia(settings, {
        uploadPath: localPath,
        originalName: basename(localPath) || 'file',
        persistedLocalPath: localPath,
        mimeType
      }, user.staffId, user.organizationId))
    } catch (err) {
      failures.push({
        localPath,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return { files: uploaded, failures }
}

export async function uploadMediaClipboardImages(inputs: MediaClipboardImageInput[]): Promise<MediaUploadResult> {
  const user = requireCurrentUser()
  const [settings, maxFilesPerStaff] = await Promise.all([
    resolveMediaStorageSettings(),
    resolveMediaLibraryMaxFiles()
  ])
  const images = Array.isArray(inputs) ? inputs : []
  if (images.length === 0) return { files: [], failures: [] }

  const activeCount = await countActiveMediaFiles(user.staffId)
  if (activeCount + images.length > maxFilesPerStaff) {
    const error = getMediaQuotaError(activeCount, maxFilesPerStaff)
    return {
      files: [],
      failures: images.map((image, index) => ({
        localPath: normalizeText(image?.name) || `Ảnh dán #${index + 1}`,
        error
      }))
    }
  }

  const uploaded: MediaFile[] = []
  const failures: MediaUploadFailure[] = []
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    const failureName = normalizeText(image?.name) || `Ảnh dán #${index + 1}`
    let cleanupPath = ''
    try {
      const prepared = prepareClipboardImage(image, index)
      cleanupPath = prepared.cleanupPath
      uploaded.push(await uploadPreparedMedia(settings, prepared, user.staffId, user.organizationId))
    } catch (err) {
      failures.push({
        localPath: failureName,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      if (cleanupPath) {
        try {
          unlinkSync(cleanupPath)
        } catch {
          // Best-effort cleanup for pasted-image temp files.
        }
      }
    }
  }

  return { files: uploaded, failures }
}

export async function deleteMediaFile(id: number): Promise<void> {
  const user = requireCurrentUser()
  const mediaFileId = normalizeId(id)
  if (!mediaFileId) throw new Error('Media không hợp lệ.')

  const { data, error } = await client()
    .from('auto_media_files')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', mediaFileId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Không thể xoá media: ${error.message}`)
  if (!data) throw new Error('Không tìm thấy media.')

  const { error: membershipError } = await client()
    .from('auto_media_group_items')
    .delete()
    .eq('media_file_id', mediaFileId)

  if (membershipError) throw new Error(`Không thể xoá media khỏi thư mục: ${membershipError.message}`)
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
