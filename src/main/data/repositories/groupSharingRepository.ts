import { groupSharingError } from '../../../shared/groupSharing'
import { requireCurrentUser, requireCurrentUserCredentials, getCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'

export async function invokeGroupSharing<T = unknown>(action: string, input: object = {}): Promise<T> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_group_sharing', {
    p_staff_id: user.staffId,
    p_organization_id: user.organizationId,
    p_auth_username: credentials.username,
    p_auth_password: credentials.password,
    p_action: action,
    p_data: input
  })
  if (getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại.')
  if (error) throw new Error(groupSharingError(error.message))
  return data as T
}

export async function listSharedContentRows(action: 'content_groups' | 'content_templates'): Promise<Record<string, unknown>[]> {
  const session = requireCurrentUserCredentials()
  const rows: Record<string, unknown>[] = []
  let afterId = 0
  for (;;) {
    const page = await invokeGroupSharing<Record<string, unknown>[]>(action, { afterId })
    if (getCurrentUserCredentials() !== session) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng tải lại.')
    if (!Array.isArray(page)) throw new Error('Không thể đọc danh sách nhóm được chia sẻ.')
    if (page.length === 0) return rows
    const nextId = Number(page[page.length - 1].id)
    if (!Number.isSafeInteger(nextId) || nextId <= afterId) throw new Error('Phân trang nhóm không hợp lệ.')
    rows.push(...page)
    afterId = nextId
  }
}

export async function validateContentGroupSelection(next: Record<string, unknown> | null | undefined, previous?: Record<string, unknown> | null): Promise<void> {
  if (next?.advancedContentSource !== 'group_snapshot') return
  const snapshot = next.advancedContentGroupSnapshot as { groupId?: number } | undefined
  if (!snapshot?.groupId) return
  if (previous?.advancedContentSource === 'group_snapshot' && JSON.stringify(snapshot) === JSON.stringify(previous.advancedContentGroupSnapshot)) return
  await invokeGroupSharing('validate_content_selection', { kind: 'content', groupId: snapshot.groupId })
}
