import {
  ContentTemplate,
  ContentTemplateChannelConfig,
  ContentTemplateChannelName,
  ContentTemplateChannels,
  ContentTemplateContentType,
  ContentTemplateGroup,
  CreateContentTemplateGroupInput,
  CreateContentTemplateInput,
  UpdateContentTemplateGroupInput,
  UpdateContentTemplateInput
} from '../../../shared/types'
import {
  formattedContentToPlainCampaignContent,
  isFormattedContentEmpty,
  sanitizeFormattedContent
} from '../../../shared/formattedContent'
import { requireCurrentUser } from '../currentUser'
import {
  mapContentTemplateContentTypeFromDB,
  mapContentTemplateGroupFromDB
} from '../mappers'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

const SUPPORTED_CHANNEL_NAMES = [
  'sms',
  'zalo_message',
  'facebook_post',
  'facebook_message',
  'facebook_comment',
  'email'
] as const satisfies readonly ContentTemplateChannelName[]

type ContentTypeMaps = {
  rows: Record<string, unknown>[]
  idByName: Map<ContentTemplateChannelName, string>
  nameById: Map<string, ContentTemplateChannelName>
}

function normalizeId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizeName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeDescription(description: unknown): string | null {
  const value = String(description ?? '').trim()
  return value || null
}

function normalizeOrder(value: unknown, fallback = 100): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) throw new Error('Thứ tự nhóm nội dung không hợp lệ.')
  return parsed
}

function maxImagesForChannel(channelName: ContentTemplateChannelName): number {
  if (channelName === 'sms') return 0
  if (channelName === 'facebook_comment') return 1
  return 10
}

function normalizeImageUrls(value: unknown, channelName: ContentTemplateChannelName): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error(`Danh sách ảnh của kênh ${channelName} không hợp lệ.`)
  }

  const urls: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const url = typeof item === 'string' ? item.trim() : ''
    if (!url || seen.has(url)) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Ảnh mẫu nội dung phải là URL hợp lệ.')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Ảnh mẫu nội dung phải dùng URL http(s).')
    }
    seen.add(url)
    urls.push(url)
  }

  const maximum = maxImagesForChannel(channelName)
  if (urls.length > maximum) {
    if (maximum === 0) throw new Error('Kênh SMS không hỗ trợ ảnh.')
    throw new Error(`Kênh ${channelName} chỉ được dùng tối đa ${maximum} ảnh.`)
  }
  return urls
}

function normalizeStoredImageUrls(value: unknown, channelName: ContentTemplateChannelName): string[] {
  if (!Array.isArray(value)) return []
  const maximum = maxImagesForChannel(channelName)
  if (maximum === 0) return []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const url = item.trim()
    if (!url || seen.has(url)) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
    } catch {
      continue
    }
    seen.add(url)
    urls.push(url)
    if (urls.length >= maximum) break
  }
  return urls
}

function normalizeVariants(
  value: unknown,
  channelName: ContentTemplateChannelName,
  strict: boolean,
  rich: boolean
): Array<{ text: string }> {
  if (!Array.isArray(value)) {
    if (strict) throw new Error(`Danh sách biến thể của kênh ${channelName} không hợp lệ.`)
    return []
  }

  return value.flatMap(item => {
    const rawText = typeof item === 'string'
      ? item
      : item && typeof item === 'object'
        ? (item as Record<string, unknown>).text
        : undefined
    if (typeof rawText !== 'string') return []
    if (!rich) return rawText.trim() ? [{ text: rawText }] : []
    const text = sanitizeFormattedContent(rawText)
    return isFormattedContentEmpty(text) ? [] : [{ text }]
  })
}

function normalizeChannelConfig(
  value: unknown,
  channelName: ContentTemplateChannelName,
  strict: boolean
): ContentTemplateChannelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new Error(`Cấu hình kênh ${channelName} không hợp lệ.`)
    return null
  }
  const source = value as Record<string, unknown>
  const formattedContentEnabled = (channelName === 'zalo_message' || channelName === 'facebook_post')
    && source.formattedContentEnabled === true
  const isHtml = channelName === 'email' && source.isHtml === true
  const variants = normalizeVariants(
    source.variants,
    channelName,
    strict,
    formattedContentEnabled || isHtml
  )
  const enabled = source.enabled === true
  const config: ContentTemplateChannelConfig = {
    enabled,
    variants,
    imageUrls: normalizeImageUrls(source.imageUrls, channelName)
  }
  if (channelName === 'zalo_message' || channelName === 'facebook_post') {
    config.formattedContentEnabled = formattedContentEnabled
  }
  if (channelName === 'email') config.subject = String(source.subject ?? '').trim()
  if (channelName === 'email') config.isHtml = isHtml

  if (enabled && variants.length === 0) {
    throw new Error(`Kênh ${channelName} phải có ít nhất một biến thể nội dung.`)
  }
  if (enabled && channelName === 'email' && !config.subject) {
    throw new Error('Kênh email phải có tiêu đề.')
  }
  return config
}

function normalizeChannels(value: unknown): ContentTemplateChannels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cấu hình kênh mẫu nội dung không hợp lệ.')
  }

  const source = value as Record<string, unknown>
  const result: ContentTemplateChannels = {}
  for (const channelName of SUPPORTED_CHANNEL_NAMES) {
    if (!(channelName in source)) continue
    const config = normalizeChannelConfig(source[channelName], channelName, true)
    if (config) result[channelName] = config
  }
  if (!SUPPORTED_CHANNEL_NAMES.some(channelName => result[channelName]?.enabled)) {
    throw new Error('Vui lòng bật và nhập nội dung cho ít nhất một kênh.')
  }
  return result
}

function projectLegacyContent(channels: ContentTemplateChannels): {
  content: string
  baseContentHtml: string | null
} {
  for (const channelName of SUPPORTED_CHANNEL_NAMES) {
    const channel = channels[channelName]
    if (!channel?.enabled) continue
    const variant = channel.variants[0]
    if (!variant) continue
    const rich = channelName === 'email'
      ? channel.isHtml === true
      : (channelName === 'zalo_message' || channelName === 'facebook_post')
        && channel.formattedContentEnabled === true
    if (rich) {
      const baseContentHtml = sanitizeFormattedContent(variant.text)
      return {
        content: formattedContentToPlainCampaignContent(baseContentHtml).trim(),
        baseContentHtml
      }
    }
    return { content: variant.text.trim(), baseContentHtml: null }
  }
  return { content: '', baseContentHtml: null }
}

function normalizeStoredChannel(
  value: unknown,
  imageUrls: unknown,
  channelName: ContentTemplateChannelName
): ContentTemplateChannelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const formattedContentEnabled = (channelName === 'zalo_message' || channelName === 'facebook_post')
    && source.formattedContentEnabled === true
  const isHtml = channelName === 'email' && source.isHtml === true
  const config: ContentTemplateChannelConfig = {
    enabled: source.enabled === true,
    variants: normalizeVariants(
      source.variants,
      channelName,
      false,
      formattedContentEnabled || isHtml
    ),
    imageUrls: normalizeStoredImageUrls(imageUrls, channelName)
  }
  if (channelName === 'zalo_message' || channelName === 'facebook_post') {
    config.formattedContentEnabled = formattedContentEnabled
  }
  if (channelName === 'email') config.subject = String(source.subject ?? '').trim()
  if (channelName === 'email') config.isHtml = isHtml
  return config
}

function rawObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

function serializeChannels(
  channels: ContentTemplateChannels,
  maps: ContentTypeMaps,
  existingRawChannels?: unknown
): Record<string, unknown> {
  const knownIds = new Set(maps.idByName.values())
  const result = Object.fromEntries(
    Object.entries(rawObject(existingRawChannels)).filter(([id]) => !knownIds.has(id))
  )

  for (const channelName of SUPPORTED_CHANNEL_NAMES) {
    const config = channels[channelName]
    if (!config) continue
    const id = maps.idByName.get(channelName)
    if (!id) throw new Error(`Chưa cấu hình loại nội dung ${channelName} trong hệ thống.`)
    result[id] = {
      enabled: config.enabled,
      variants: config.variants,
      ...((channelName === 'zalo_message' || channelName === 'facebook_post')
        ? { formattedContentEnabled: config.formattedContentEnabled === true }
        : {}),
      ...(channelName === 'email'
        ? { subject: config.subject || '', isHtml: config.isHtml === true }
        : {})
    }
  }
  return result
}

function serializeChannelImageUrls(
  channels: ContentTemplateChannels,
  maps: ContentTypeMaps,
  existingRawImages?: unknown
): Record<string, unknown> {
  const knownIds = new Set(maps.idByName.values())
  const result = Object.fromEntries(
    Object.entries(rawObject(existingRawImages)).filter(([id]) => !knownIds.has(id))
  )

  for (const channelName of SUPPORTED_CHANNEL_NAMES) {
    const config = channels[channelName]
    if (!config) continue
    const id = maps.idByName.get(channelName)
    if (!id) throw new Error(`Chưa cấu hình loại nội dung ${channelName} trong hệ thống.`)
    result[id] = config.imageUrls
  }
  return result
}

function joinedContentGroupName(row: Record<string, unknown>): string | null {
  const relation = row.content_group ?? row.auto_content_groups
  const group = Array.isArray(relation) ? relation[0] : relation
  if (!group || typeof group !== 'object') return null
  const name = (group as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

function mapContentTemplateFromV2DB(
  row: Record<string, unknown>,
  maps: ContentTypeMaps
): ContentTemplate {
  const channels: ContentTemplateChannels = {}
  const rawChannels = rawObject(row.channels)
  const rawImages = rawObject(row.channel_image_urls)
  for (const [id, rawConfig] of Object.entries(rawChannels)) {
    const channelName = maps.nameById.get(id)
    if (!channelName) continue
    const config = normalizeStoredChannel(rawConfig, rawImages[id], channelName)
    if (config) channels[channelName] = config
  }

  return {
    id: Number(row.id),
    name: String(row.name || ''),
    groupId: normalizeId(row.group_id),
    groupName: joinedContentGroupName(row),
    channels,
    isDelete: row.is_delete === true,
    staffId: normalizeId(row.staff_id) ?? undefined,
    organizationId: normalizeId(row.organization_id),
    createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined
  }
}

function formatContentTemplateError(
  error: { message?: string; code?: string } | null | undefined,
  fallback: string,
  duplicateMessage = 'Tên mẫu nội dung này đã tồn tại.'
): Error {
  const message = error?.message || ''
  if (error?.code === '23505' || /duplicate key/i.test(message)) {
    return new Error(duplicateMessage)
  }
  return new Error(message ? `${fallback}: ${message}` : fallback)
}

function isSupportedChannelName(value: unknown): value is ContentTemplateChannelName {
  return typeof value === 'string' && SUPPORTED_CHANNEL_NAMES.includes(value as ContentTemplateChannelName)
}

async function loadContentTypeMaps(): Promise<ContentTypeMaps> {
  const { data, error } = await client()
    .from('aka_crm_status')
    .select('id, name, description, stt_by_type, is_active')
    .eq('type', 'content_type')
    .in('name', [...SUPPORTED_CHANNEL_NAMES])
    .order('stt_by_type', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw formatContentTemplateError(error, 'Không thể tải loại nội dung')
  const rows = (data || []) as Record<string, unknown>[]
  const idByName = new Map<ContentTemplateChannelName, string>()
  const nameById = new Map<string, ContentTemplateChannelName>()
  for (const row of rows) {
    const name = row.name
    const id = normalizeId(row.id)
    if (!id || !isSupportedChannelName(name)) continue
    idByName.set(name, String(id))
    nameById.set(String(id), name)
  }
  return { rows, idByName, nameById }
}

async function assertOwnedActiveGroup(groupId: number, staffId: number): Promise<void> {
  const { data, error } = await client()
    .from('auto_content_groups')
    .select('id')
    .eq('id', groupId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw formatContentTemplateError(error, 'Không thể kiểm tra nhóm nội dung')
  if (!data) throw new Error('Không tìm thấy nhóm nội dung đang hoạt động.')
}

export async function listContentTemplateContentTypes(): Promise<ContentTemplateContentType[]> {
  const maps = await loadContentTypeMaps()
  return maps.rows
    .filter(row => row.is_active !== false && isSupportedChannelName(row.name))
    .map(row => mapContentTemplateContentTypeFromDB(row))
}

export async function listContentTemplates(): Promise<ContentTemplate[]> {
  const user = requireCurrentUser()
  const [{ data, error }, maps] = await Promise.all([
    client()
      .from('auto_content_templates')
      .select('id, name, group_id, channels, channel_image_urls, is_delete, staff_id, organization_id, created_at, updated_at, content_group:auto_content_groups(name)')
      .eq('staff_id', user.staffId)
      .eq('is_delete', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    loadContentTypeMaps()
  ])

  if (error) throw formatContentTemplateError(error, 'Không thể tải mẫu nội dung')
  return (data || []).map(row => mapContentTemplateFromV2DB(row, maps))
}

export async function createContentTemplate(template: CreateContentTemplateInput): Promise<ContentTemplate> {
  const user = requireCurrentUser()
  const name = normalizeName(template.name)
  if (!name) throw new Error('Vui lòng nhập tên mẫu nội dung.')

  const groupId = template.groupId === null || template.groupId === undefined
    ? null
    : normalizeId(template.groupId)
  if (template.groupId !== null && template.groupId !== undefined && !groupId) {
    throw new Error('Nhóm nội dung không hợp lệ.')
  }
  if (groupId) await assertOwnedActiveGroup(groupId, user.staffId)

  const maps = await loadContentTypeMaps()
  const channels = normalizeChannels(template.channels)
  const legacyProjection = projectLegacyContent(channels)
  const { data, error } = await client()
    .from('auto_content_templates')
    .insert({
      name,
      content: legacyProjection.content,
      base_content_html: legacyProjection.baseContentHtml,
      group_id: groupId,
      channels: serializeChannels(channels, maps),
      channel_image_urls: serializeChannelImageUrls(channels, maps),
      staff_id: user.staffId,
      organization_id: user.organizationId,
      is_delete: false
    })
    .select('id, name, group_id, channels, channel_image_urls, is_delete, staff_id, organization_id, created_at, updated_at, content_group:auto_content_groups(name)')
    .single()

  if (error) throw formatContentTemplateError(error, 'Không thể tạo mẫu nội dung')
  return mapContentTemplateFromV2DB(data, maps)
}

export async function updateContentTemplate(id: number, updates: UpdateContentTemplateInput): Promise<ContentTemplate> {
  const user = requireCurrentUser()
  const templateId = normalizeId(id)
  if (!templateId) throw new Error('Mẫu nội dung không hợp lệ.')

  const { data: existing, error: existingError } = await client()
    .from('auto_content_templates')
    .select('group_id, channels, channel_image_urls')
    .eq('id', templateId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .maybeSingle()
  if (existingError) throw formatContentTemplateError(existingError, 'Không thể tải mẫu nội dung')
  if (!existing) throw new Error('Không tìm thấy mẫu nội dung.')

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) {
    const name = normalizeName(updates.name)
    if (!name) throw new Error('Vui lòng nhập tên mẫu nội dung.')
    payload.name = name
  }
  if (updates.groupId !== undefined) {
    const groupId = updates.groupId === null ? null : normalizeId(updates.groupId)
    if (updates.groupId !== null && !groupId) throw new Error('Nhóm nội dung không hợp lệ.')
    const currentGroupId = normalizeId(existing.group_id)
    if (groupId && groupId !== currentGroupId) await assertOwnedActiveGroup(groupId, user.staffId)
    payload.group_id = groupId
  }

  const maps = await loadContentTypeMaps()
  if (updates.channels !== undefined) {
    const channels = normalizeChannels(updates.channels)
    const legacyProjection = projectLegacyContent(channels)
    payload.channels = serializeChannels(channels, maps, existing.channels)
    payload.channel_image_urls = serializeChannelImageUrls(channels, maps, existing.channel_image_urls)
    payload.content = legacyProjection.content
    payload.base_content_html = legacyProjection.baseContentHtml
  }

  const { data, error } = await client()
    .from('auto_content_templates')
    .update(payload)
    .eq('id', templateId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('id, name, group_id, channels, channel_image_urls, is_delete, staff_id, organization_id, created_at, updated_at, content_group:auto_content_groups(name)')
    .maybeSingle()

  if (error) throw formatContentTemplateError(error, 'Không thể cập nhật mẫu nội dung')
  if (!data) throw new Error('Không tìm thấy mẫu nội dung.')
  return mapContentTemplateFromV2DB(data, maps)
}

export async function deleteContentTemplate(id: number): Promise<void> {
  const user = requireCurrentUser()
  const templateId = normalizeId(id)
  if (!templateId) throw new Error('Mẫu nội dung không hợp lệ.')

  const { data, error } = await client()
    .from('auto_content_templates')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', templateId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('id')
    .maybeSingle()

  if (error) throw formatContentTemplateError(error, 'Không thể xoá mẫu nội dung')
  if (!data) throw new Error('Không tìm thấy mẫu nội dung.')
}

async function countActiveTemplatesInGroup(groupId: number, staffId: number): Promise<number> {
  const { count, error } = await client()
    .from('auto_content_templates')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('staff_id', staffId)
    .eq('is_delete', false)

  if (error) throw formatContentTemplateError(error, 'Không thể đếm mẫu nội dung trong nhóm')
  return count || 0
}

export async function listContentTemplateGroups(): Promise<ContentTemplateGroup[]> {
  const user = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_content_groups')
    .select('*')
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .order('stt', { ascending: true })
    .order('name', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw formatContentTemplateError(error, 'Không thể tải nhóm nội dung')
  const groups = (data || []).map(row => mapContentTemplateGroupFromDB(row))
  const counts = await Promise.all(groups.map(group => countActiveTemplatesInGroup(group.id, user.staffId)))
  return groups.map((group, index) => ({ ...group, templateCount: counts[index] }))
}

export async function createContentTemplateGroup(input: CreateContentTemplateGroupInput): Promise<ContentTemplateGroup> {
  const user = requireCurrentUser()
  const name = normalizeName(input.name)
  if (!name) throw new Error('Vui lòng nhập tên nhóm nội dung.')

  const { data, error } = await client()
    .from('auto_content_groups')
    .insert({
      name,
      description: normalizeDescription(input.description),
      stt: normalizeOrder(input.order),
      is_active: input.isActive ?? true,
      staff_id: user.staffId,
      organization_id: user.organizationId,
      is_delete: false
    })
    .select('*')
    .single()

  if (error) {
    throw formatContentTemplateError(error, 'Không thể tạo nhóm nội dung', 'Tên nhóm nội dung này đã tồn tại.')
  }
  return mapContentTemplateGroupFromDB(data)
}

export async function updateContentTemplateGroup(
  id: number,
  updates: UpdateContentTemplateGroupInput
): Promise<ContentTemplateGroup> {
  const user = requireCurrentUser()
  const groupId = normalizeId(id)
  if (!groupId) throw new Error('Nhóm nội dung không hợp lệ.')

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.name !== undefined) {
    const name = normalizeName(updates.name)
    if (!name) throw new Error('Vui lòng nhập tên nhóm nội dung.')
    payload.name = name
  }
  if (updates.description !== undefined) payload.description = normalizeDescription(updates.description)
  if (updates.order !== undefined) payload.stt = normalizeOrder(updates.order)
  if (updates.isActive !== undefined) payload.is_active = updates.isActive

  const { data, error } = await client()
    .from('auto_content_groups')
    .update(payload)
    .eq('id', groupId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('*')
    .maybeSingle()

  if (error) {
    throw formatContentTemplateError(error, 'Không thể cập nhật nhóm nội dung', 'Tên nhóm nội dung này đã tồn tại.')
  }
  if (!data) throw new Error('Không tìm thấy nhóm nội dung.')
  return {
    ...mapContentTemplateGroupFromDB(data),
    templateCount: await countActiveTemplatesInGroup(groupId, user.staffId)
  }
}

export async function deleteContentTemplateGroup(id: number): Promise<void> {
  const user = requireCurrentUser()
  const groupId = normalizeId(id)
  if (!groupId) throw new Error('Nhóm nội dung không hợp lệ.')

  const templateCount = await countActiveTemplatesInGroup(groupId, user.staffId)
  if (templateCount > 0) {
    throw new Error('Không thể xoá nhóm khi vẫn còn mẫu nội dung trong nhóm.')
  }

  const { data, error } = await client()
    .from('auto_content_groups')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('id')
    .maybeSingle()

  if (error) throw formatContentTemplateError(error, 'Không thể xoá nhóm nội dung')
  if (!data) throw new Error('Không tìm thấy nhóm nội dung.')
}
