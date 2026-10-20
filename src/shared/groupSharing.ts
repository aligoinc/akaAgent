export type GroupKind = 'data' | 'content'
export type GroupSharingScope = 'private' | 'organization' | 'selected'
export interface GroupAccess {
  ownerStaffId: number
  ownerName?: string
  role: 'owner' | 'shared'
  canManage: boolean
  canUse: boolean
  canCopy: boolean
}
export interface GroupSharing {
  scope: GroupSharingScope
  revision: string
  recipientIds: number[]
  access: GroupAccess
}
export interface GroupSharingStaff { id: number; name: string }
export interface GroupSharingSave {
  kind: GroupKind
  groupId: number
  scope: GroupSharingScope
  recipientIds: number[]
  expectedRevision: string
}
export interface GroupCopy {
  kind: GroupKind
  groupId: number
  requestId: string
  name?: string
  targetGroupId?: number
  membershipIds?: number[]
  templateId?: number
}
export interface GroupSharingApi {
  staff(): Promise<GroupSharingStaff[]>
  get(kind: GroupKind, groupId: number): Promise<GroupSharing>
  save(input: GroupSharingSave): Promise<GroupSharing>
  copy(input: GroupCopy): Promise<{ groupId: number; count: number }>
}
export const GROUP_SHARING_IPC = 'group-sharing:invoke'
export const canManageGroup = (group: { access?: GroupAccess } | null | undefined): boolean =>
  !!group && group.access?.role !== 'shared'
export function groupSharingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const messages: Record<string, string> = {
    group_sharing_access_denied: 'Nhóm đã bị thu hồi chia sẻ hoặc bạn không còn quyền sử dụng.',
    group_sharing_owner_required: 'Chỉ chủ nhóm được thay đổi nhóm này.',
    group_sharing_conflict: 'Cấu hình chia sẻ đã thay đổi. Vui lòng tải lại trước khi lưu.',
    group_sharing_recipients_required: 'Vui lòng chọn ít nhất một nhân viên.',
    invalid_group_sharing_recipients: 'Danh sách nhân viên đã thay đổi hoặc không thuộc tổ chức.',
    invalid_group_copy_target: 'Vui lòng chọn một nhóm riêng khác đang hoạt động.',
    invalid_group_copy_members: 'Data được chọn đã thay đổi. Vui lòng tải lại.',
    data_group_bound_source_unknown: 'Bản sao chưa gắn tài khoản. Vui lòng chọn nhóm đích không gắn tài khoản.'
  }
  return Object.entries(messages).find(([code]) => message.includes(code))?.[1]
    || message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}
