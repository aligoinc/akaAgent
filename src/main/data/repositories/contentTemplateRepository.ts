import { ContentTemplate } from '../../../shared/types'
import { requireCurrentUser } from '../currentUser'
import { mapContentTemplateFromDB } from '../mappers'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

function normalizeName(name: unknown): string {
  return String(name ?? '').trim()
}

function normalizeContent(content: unknown): string {
  return String(content ?? '').trim()
}

function formatContentTemplateError(error: { message?: string; code?: string } | null | undefined, fallback: string): Error {
  const message = error?.message || ''
  if (error?.code === '23505' || /duplicate key/i.test(message)) {
    return new Error('Mẫu nội dung này đã tồn tại.')
  }
  return new Error(message ? `${fallback}: ${message}` : fallback)
}

async function ensureUniqueContentForStaff(staffId: number, content: string, excludeId?: number): Promise<void> {
  let query = client()
    .from('auto_content_templates')
    .select('id')
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .eq('content', content)
    .limit(1)

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw formatContentTemplateError(error, 'Không thể kiểm tra nội dung mẫu')
  if (data) throw new Error('Mẫu nội dung này đã tồn tại.')
}

export async function listContentTemplates(): Promise<ContentTemplate[]> {
  const user = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_content_templates')
    .select('*')
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw formatContentTemplateError(error, 'Không thể tải mẫu nội dung')
  return (data || []).map(row => mapContentTemplateFromDB(row))
}

export async function createContentTemplate(template: Partial<ContentTemplate>): Promise<ContentTemplate> {
  const user = requireCurrentUser()
  const name = normalizeName(template.name)
  const content = normalizeContent(template.content)
  if (!name) throw new Error('Vui lòng nhập tên mẫu nội dung.')
  if (!content) throw new Error('Vui lòng nhập nội dung mẫu.')
  await ensureUniqueContentForStaff(user.staffId, content)

  const { data, error } = await client()
    .from('auto_content_templates')
    .insert({
      name,
      content,
      staff_id: user.staffId,
      organization_id: user.organizationId
    })
    .select('*')
    .single()

  if (error) throw formatContentTemplateError(error, 'Không thể tạo mẫu nội dung')
  return mapContentTemplateFromDB(data)
}

export async function updateContentTemplate(id: number, updates: Partial<ContentTemplate>): Promise<ContentTemplate> {
  const user = requireCurrentUser()
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (updates.name !== undefined) {
    const name = normalizeName(updates.name)
    if (!name) throw new Error('Vui lòng nhập tên mẫu nội dung.')
    payload.name = name
  }

  if (updates.content !== undefined) {
    const content = normalizeContent(updates.content)
    if (!content) throw new Error('Vui lòng nhập nội dung mẫu.')
    payload.content = content
    await ensureUniqueContentForStaff(user.staffId, content, id)
  }

  const { data, error } = await client()
    .from('auto_content_templates')
    .update(payload)
    .eq('id', id)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)
    .select('*')
    .maybeSingle()

  if (error) throw formatContentTemplateError(error, 'Không thể cập nhật mẫu nội dung')
  if (!data) throw new Error('Không tìm thấy mẫu nội dung.')
  return mapContentTemplateFromDB(data)
}

export async function deleteContentTemplate(id: number): Promise<void> {
  const user = requireCurrentUser()
  const { error } = await client()
    .from('auto_content_templates')
    .update({ is_delete: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('staff_id', user.staffId)
    .eq('is_delete', false)

  if (error) throw formatContentTemplateError(error, 'Không thể xoá mẫu nội dung')
}
