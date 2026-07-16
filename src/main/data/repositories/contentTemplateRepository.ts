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
  mapContentTemplateFromDB,
  mapContentTemplateGroupFromDB
} from '../mappers'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()
const SUPPORTED_CHANNEL_NAMES: readonly ContentTemplateChannelName[] = ['sms', 'zalo', 'facebook', 'email']
const MAX_TEMPLATE_IMAGES = 10

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
  return String(name ?? '').trim()
}

function normalizeContent(content: unknown): string {
  return String(content ?? '').trim()
}

function normalizeDescription(description: unknown): string | null {
  const value = String(description ?? '').trim()
  return value || null
}

function normalizeBaseContentHtml(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const sanitized = sanitizeFormattedContent(value)
  if (isFormattedContentEmpty(sanitized)) {
    throw new Error('Nội dung cơ bản có định dạng không được để trống.')
  }
  return sanitized
}

function normalizeOrder(value: unknown, fallback = 100): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) throw new Error('Thứ tự nhóm nội dung không hợp lệ.')
  return parsed
}

function normalizeImageUrls(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Danh sách ảnh mẫu nội dung không hợp lệ.')
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
  if (urls.length > MAX_TEMPLATE_IMAGES) {
    throw new Error(`Mỗi mẫu nội dung chỉ được dùng tối đa ${MAX_TEMPLATE_IMAGES} ảnh.`)
  }
  return urls
}

function normalizeVariants(value: unknown): Array<{ text: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return [{ text: item }]
    if (!item || typeof item !== 'object') return []
    const text = (item as Record<string, unknown>).text
    return typeof text === 'string' ? [{ text }] : []
  })
}

function normalizeChannelConfig(
  value: unknown,
  channelName: ContentTemplateChannelName
): ContentTemplateChannelConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const formattedContentEnabled = source.formattedContentEnabled === true
  const isHtml = source.isHtml === true
  const isRich = (channelName === 'zalo' || channelName === 'facebook')
    ? formattedContentEnabled
    : channelName === 'email' && isHtml
  const variants = normalizeVariants(source.variants).flatMap(variant => {
    if (!isRich) return variant.text.trim() ? [variant] : []
    const sanitized = sanitizeFormattedContent(variant.text)
    return isFormattedContentEmpty(sanitized) ? [] : [{ text: sanitized }]
  })
  const config: ContentTemplateChannelConfig = {
    enabled: source.enabled === true,
    variants
  }
  if (typeof source.formattedContentEnabled === 'boolean') {
    config.formattedContentEnabled = formattedContentEnabled
  }
  if (typeof source.subject === 'string') config.subject = source.subject
  if (typeof source.isHtml === 'boolean') config.isHtml = isHtml
  if (config.enabled && variants.length === 0) {
    throw new Error(`Kênh ${channelName} phải có ít nhất một biến thể nội dung.`)
  }
  if (config.enabled && channelName === 'email' && !String(config.subject || '').trim()) {
    throw new Error('Kênh email phải có tiêu đề.')
  }
  return config
}

function normalizeChannels(value: unknown): ContentTemplateChannels {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cấu hình kênh mẫu nội dung không hợp lệ.')
  }
  const source = value as Record<string, unknown>
  const result: ContentTemplateChannels = {}
  for (const name of SUPPORTED_CHANNEL_NAMES) {
    if (!(name in source)) continue
    const config = normalizeChannelConfig(source[name], name)
    if (!config) throw new Error(`Cấu hình kênh ${name} không hợp lệ.`)
    result[name] = config
  }
  return result
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

function rawChannelObject(value: unknown): Record<string, unknown> {
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
    Object.entries(rawChannelObject(existingRawChannels)).filter(([id]) => !knownIds.has(id))
  )

  for (const name of SUPPORTED_CHANNEL_NAMES) {
    const config = channels[name]
    if (!config) continue
    const id = maps.idByName.get(name)
    if (!id) throw new Error(`Chưa cấu hình loại nội dung ${name} trong hệ thống.`)
    result[id] = config
  }
  return result
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
      .select('*, content_group:auto_content_groups(name)')
      .eq('staff_id', user.staffId)
      .eq('is_delete', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    loadContentTypeMaps()
  ])

  if (error) throw formatContentTemplateError(error, 'Không thể tải mẫu nội dung')
  return (data || []).map(row => mapContentTemplateFromDB(row, maps.nameById))
}

export async function createContentTemplate(template: CreateContentTemplateInput): Promise<ContentTemplate> {
  const user = requireCurrentUser()
  const name = normalizeName(template.name)
  const baseContentHtml = normalizeBaseContentHtml(template.baseContentHtml)
  const content = baseContentHtml
    ? normalizeContent(formattedContentToPlainCampaignContent(baseContentHtml))
    : normalizeContent(template.content)
  if (!name) throw new Error('Vui lòng nhập tên mẫu nội dung.')
  if (!content) throw new Error('Vui lòng nhập nội dung cơ bản.')

  const groupId = template.groupId === null || template.groupId === undefined
    ? null
    : normalizeId(template.groupId)
  if (template.groupId !== null && template.groupId !== undefined && !groupId) {
    throw new Error('Nhóm nội dung không hợp lệ.')
  }
  if (groupId) await assertOwnedActiveGroup(groupId, user.staffId)

  const maps = await loadContentTypeMaps()
  const channels = normalizeChannels(template.channels)
  const { data, error } = await client()
    .from('auto_content_templates')
    .insert({
      name,
      content,
      base_content_html: baseContentHtml,
      group_id: groupId,
      content_type_id: null,
      image_urls: normalizeImageUrls(template.imageUrls),
      channels: serializeChannels(channels, maps),
      staff_id: user.staffId,
      organization_id: user.organizationId,
      is_delete: false
    })
    .select('*, content_group:auto_content_groups(name)')
    .single()

  if (error) throw formatContentTemplateError(error, 'Không thể tạo mẫu nội dung')
  return mapContentTemplateFromDB(data, maps.nameById)
}

export async function updateContentTemplate(id: number, updates: UpdateContentTemplateInput): Promise<ContentTemplate> {
  const user = requireCurrentUser()
  const templateId = normalizeId(id)
  if (!templateId) throw new Error('Mẫu nội dung không hợp lệ.')

  const { data: existing, error: existingError } = await client()
    .from('auto_content_templates')
    .select('*')
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
  if (updates.content !== undefined) {
    const content = normalizeContent(updates.content)
    if (!content) throw new Error('Vui lòng nhập nội dung cơ bản.')
    payload.content = content
  }
  if (updates.baseContentHtml !== undefined) {
    const baseContentHtml = normalizeBaseContentHtml(updates.baseContentHtml)
    payload.base_content_html = baseContentHtml
    if (baseContentHtml) {
      const plainFallback = normalizeContent(formattedContentToPlainCampaignContent(baseContentHtml))
      if (!plainFallback) throw new Error('Nội dung cơ bản không được để trống.')
      payload.content = plainFallback
    }
  }
  if (updates.groupId !== undefined) {
    const groupId = updates.groupId === null ? null : normalizeId(updates.groupId)
    if (updates.groupId !== null && !groupId) throw new Error('Nhóm nội dung không hợp lệ.')
    const currentGroupId = normalizeId(existing.group_id)
    if (groupId && groupId !== currentGroupId) await assertOwnedActiveGroup(groupId, user.staffId)
    payload.group_id = groupId
  }
  if (updates.imageUrls !== undefined) payload.image_urls = normalizeImageUrls(updates.imageUrls)

  const maps = await loadContentTypeMaps()
  if (updates.channels !== undefined) {
    payload.channels = serializeChannels(normalizeChannels(updates.channels), maps, existing.channels)
    payload.content_type_id = null
  }

  const { data, error } = await client()
    .from('auto_content_templates')
    .update(payload)
    .eq('id', templateId)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('*, content_group:auto_content_groups(name)')
    .maybeSingle()

  if (error) throw formatContentTemplateError(error, 'Không thể cập nhật mẫu nội dung')
  if (!data) throw new Error('Không tìm thấy mẫu nội dung.')
  return mapContentTemplateFromDB(data, maps.nameById)
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
