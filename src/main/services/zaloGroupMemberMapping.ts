import type { ZaloGroupMemberInfo, ZaloGroupMemberRole } from './zaloRuntimeService'

/**
 * Hồ sơ thành viên nhóm Zalo (quét group đã tham gia `/api/social/group/members`, trang link group) → bản ghi thành viên.
 *
 * KHÔNG lấy `globalId` của hồ sơ thành viên: Zalo trả Global ID của chính nick đang xem, không phải của thành viên (đo 26/11/2026
 * trên production: mọi dòng `zalo_users` chỉ có dữ liệu quét thành viên nhóm đều mang Global ID của nick đang đăng nhập; một tài
 * khoản 25.582 người cùng một Global ID). Global ID thật của thành viên chỉ có khi đọc hồ sơ người đó (tra số, `getUserInfo`, danh
 * sách bạn bè). Vì cùng lý do, không dùng `globalId` làm Zalo ID dự phòng, và bỏ trường đó khỏi `rawPayload` để không ai đọc nhầm.
 */
export function mapZaloGroupMemberProfile(
  zaloGroupId: string,
  group: Record<string, unknown>,
  rawMember: Record<string, unknown>,
  source: 'profile' | 'link'
): ZaloGroupMemberInfo {
  const uid = normalizeMemberId(firstString(
    rawMember.id,
    rawMember.uid,
    rawMember.userId
  ))
  const creatorId = normalizeMemberId(group.creatorId)
  const adminIds = new Set(toStringArray(group.adminIds).map(normalizeMemberId).filter(Boolean))
  const isCreator = !!uid && uid === creatorId
  const isAdmin = !!uid && adminIds.has(uid)
  const role: ZaloGroupMemberRole = isCreator ? 'owner' : isAdmin ? 'admin' : 'member'
  const { globalId: _viewerGlobalId, ...memberPayload } = rawMember

  return {
    zaloGroupId,
    zaloUid: uid,
    displayName: firstString(rawMember.displayName, rawMember.dName, rawMember.name),
    zaloName: firstString(rawMember.zaloName, rawMember.zalo_name),
    avatar: firstString(rawMember.avatar),
    accountStatus: nullableNumber(rawMember.accountStatus),
    type: nullableNumber(rawMember.type),
    lastUpdateTime: nullableNumber(rawMember.lastUpdateTime),
    globalId: null,
    role,
    roleRank: role === 'owner' ? 1 : role === 'admin' ? 2 : 3,
    isCreator,
    isAdmin,
    rawPayload: {
      ...memberPayload,
      source,
      zaloGroupId
    }
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = String(value || '').trim()
    if (trimmed) return trimmed
  }
  return null
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeMemberId(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/_0$/i, '')
}
