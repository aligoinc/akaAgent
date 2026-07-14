import { statSync } from 'fs'
import { basename } from 'path'
import {
  CampaignMediaSnapshot,
  MEDIA_FILE_MAX_SIZE_BYTES,
  MEDIA_IMAGE_MAX_SIZE_BYTES,
  MEDIA_LIBRARY_MAX_FILES_PER_STAFF,
  MediaFile,
  MediaGroup,
  MediaStorageSettings,
  MediaUploadFailure,
  MediaUploadResult
} from '../../../shared/types'
import { mapMediaFileFromDB, mapMediaGroupFromDB } from '../mappers'
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
const MEDIA_QUERY_PAGE_SIZE = 1000
const MEDIA_ID_FILTER_CHUNK_SIZE = 500

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

function chunkIds(ids: number[]): number[][] {
  const chunks: number[][] = []
  for (let index = 0; index < ids.length; index += MEDIA_ID_FILTER_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + MEDIA_ID_FILTER_CHUNK_SIZE))
  }
  return chunks
}

function buildMediaGroupItemRows(groupId: number, mediaFileIds: number[]): Array<Record<string, unknown>> {
  const baseTime = Date.now()
  return mediaFileIds.map((mediaFileId, index) => ({
    group_id: groupId,
    media_file_id: mediaFileId,
    sort_order: index + 1,
    created_at: new Date(baseTime + index).toISOString()
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

function getMediaQuotaError(): string {
  return 'Thư viện media đã đầy. Vui lòng xoá bớt media trước khi upload thêm.'
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
  const rows: Array<Record<string, unknown>> = []
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
    const page = (data || []) as Array<Record<string, unknown>>
    rows.push(...page)
    if (page.length < MEDIA_QUERY_PAGE_SIZE) break
  }
  return rows.map(row => mapMediaFileFromDB(row))
}

async function listActiveMediaFileIds(staffId: number, mediaFileIds: number[]): Promise<number[]> {
  const ids = normalizeIds(mediaFileIds)
  if (ids.length === 0) return []

  const pages = await Promise.all(chunkIds(ids).map(async idChunk => {
    const { data, error } = await client()
      .from('auto_media_files')
      .select('id')
      .eq('staff_id', staffId)
      .eq('is_delete', false)
      .in('id', idChunk)

    if (error) throw new Error(`Không thể kiểm tra media trong thư mục: ${error.message}`)
    return data || []
  }))
  const active = new Set(pages.flat().map(row => Number(row.id)).filter(id => Number.isFinite(id) && id > 0))
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

  const memberships: Array<{ group_id: unknown; media_file_id: unknown }> = []
  for (const groupIdChunk of chunkIds(ids)) {
    for (let from = 0; ; from += MEDIA_QUERY_PAGE_SIZE) {
      const { data, error } = await client()
        .from('auto_media_group_items')
        .select('group_id, media_file_id')
        .in('group_id', groupIdChunk)
        .order('group_id', { ascending: true })
        .order('media_file_id', { ascending: true })
        .range(from, from + MEDIA_QUERY_PAGE_SIZE - 1)

      if (error) throw formatMediaGroupError(error, 'Không thể tải số lượng media trong thư mục')
      const page = (data || []) as Array<{ group_id: unknown; media_file_id: unknown }>
      memberships.push(...page)
      if (page.length < MEDIA_QUERY_PAGE_SIZE) break
    }
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

  const rows: Array<{ media_file_id: unknown }> = []
  for (let from = 0; ; from += MEDIA_QUERY_PAGE_SIZE) {
    const { data, error } = await client()
      .from('auto_media_group_items')
      .select('media_file_id, created_at')
      .eq('group_id', id)
      .order('created_at', { ascending: true })
      .order('media_file_id', { ascending: true })
      .range(from, from + MEDIA_QUERY_PAGE_SIZE - 1)

    if (error) throw formatMediaGroupError(error, 'Không thể tải media trong thư mục')
    const page = (data || []) as Array<{ media_file_id: unknown }>
    rows.push(...page)
    if (page.length < MEDIA_QUERY_PAGE_SIZE) break
  }
  const ids = normalizeIds(rows.map(row => row.media_file_id))
  return listActiveMediaFileIds(user.staffId, ids)
}

export async function addMediaGroupFiles(groupId: number, mediaFileIds: number[]): Promise<number[]> {
  const user = requireCurrentUser()
  const id = normalizeId(groupId)
  if (!id) throw new Error('Thư mục media không hợp lệ.')
  await assertMediaGroupForStaff(id, user.staffId)

  const activeIds = await listActiveMediaFileIds(user.staffId, mediaFileIds)
  if (activeIds.length > 0) {
    const { error: insertError } = await client()
      .from('auto_media_group_items')
      .upsert(buildMediaGroupItemRows(id, activeIds), {
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
  if (ids.length > 0) {
    const { error: deleteError } = await client()
      .from('auto_media_group_items')
      .delete()
      .eq('group_id', id)
      .in('media_file_id', ids)

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
  const settings = await resolveMediaStorageSettings()
  const paths = Array.from(new Set(
    (Array.isArray(localPaths) ? localPaths : [])
      .map(path => normalizeText(path))
      .filter(Boolean)
  ))
  if (paths.length === 0) return { files: [], failures: [] }

  const activeCount = await countActiveMediaFiles(user.staffId)
  if (activeCount + paths.length > MEDIA_LIBRARY_MAX_FILES_PER_STAFF) {
    const error = getMediaQuotaError()
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

export async function deleteMediaFiles(ids: number[]): Promise<number[]> {
  const user = requireCurrentUser()
  const mediaFileIds = normalizeIds(ids)
  if (mediaFileIds.length === 0) throw new Error('Media không hợp lệ.')

  const deletedIds: number[] = []
  const updatedAt = new Date().toISOString()
  for (const idChunk of chunkIds(mediaFileIds)) {
    const { data, error } = await client()
      .from('auto_media_files')
      .update({ is_delete: true, updated_at: updatedAt })
      .in('id', idChunk)
      .eq('staff_id', user.staffId)
      .eq('is_delete', false)
      .select('id')

    if (error) throw new Error(`Không thể xoá media: ${error.message}`)
    deletedIds.push(...(data || []).map(row => normalizeId(row.id)).filter(Boolean))
  }
  if (deletedIds.length === 0) throw new Error('Không tìm thấy media.')

  for (const idChunk of chunkIds(deletedIds)) {
    const { error: membershipError } = await client()
      .from('auto_media_group_items')
      .delete()
      .in('media_file_id', idChunk)

    if (membershipError) throw new Error(`Không thể xoá media khỏi thư mục: ${membershipError.message}`)
  }
  return deletedIds
}

export async function deleteMediaFile(id: number): Promise<void> {
  await deleteMediaFiles([id])
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
