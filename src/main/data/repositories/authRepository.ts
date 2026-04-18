import { AuthUser } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

export async function login(username: string, password: string): Promise<AuthUser> {
  const u = (username || '').trim()
  const p = password || ''
  if (!u || !p) throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.')

  const { data: staff, error } = await client()
    .from('org_staff')
    .select('id, organization_id, name, username, password, is_active')
    .eq('username', u)
    .maybeSingle()

  if (error) throw new Error(`Đăng nhập thất bại: ${error.message}`)
  if (!staff) throw new Error('Tên đăng nhập không tồn tại.')
  if (staff.password !== p) throw new Error('Mật khẩu không đúng.')
  if (!staff.is_active) throw new Error('Tài khoản đã bị khoá.')

  // Lookup org separately — embed gặp ambiguous FK (org_staff.organization_id vs org_organization.staff_admin_id).
  const { data: org, error: orgErr } = await client()
    .from('org_organization')
    .select('id, name, is_admin_akabiz')
    .eq('id', staff.organization_id)
    .maybeSingle()

  if (orgErr) throw new Error(`Đăng nhập thất bại: ${orgErr.message}`)

  return {
    staffId: staff.id as number,
    organizationId: staff.organization_id as number,
    name: staff.name as string,
    username: staff.username as string,
    organizationName: (org?.name as string) || '',
    isAdminAkabiz: !!org?.is_admin_akabiz
  }
}
