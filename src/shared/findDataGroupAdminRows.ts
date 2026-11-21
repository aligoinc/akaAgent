/**
 * Dòng Nhóm data cho quản trị viên group Facebook tìm bằng search (21/11/2026, docs/FIND_DATA_GROUP_ADMIN_DATA_GROUPS.md).
 *
 * Chiến dịch "Tìm kiếm data bằng search" bật "Lấy thông tin quản trị viên của group" có thể đẩy quản trị viên sang hai Nhóm data riêng:
 *   - `facebook_group_admin_uid`: nhóm loại User Facebook, mỗi quản trị viên một dòng (gộp theo UID, người quản trị nhiều group chỉ
 *     một dòng, cột thêm ghi đủ các group);
 *   - `facebook_group_admin_phone`: nhóm loại Số điện thoại, mỗi số một dòng (một số có thể của nhiều quản trị viên, ví dụ hotline của
 *     group: một dòng, ghi đủ các quản trị viên; người có hai số ra hai dòng).
 * Chính tài khoản Facebook chạy chiến dịch không vào nhóm nào. Data đã có trong nhóm thì DB báo "đã có" (hàm nạp nhóm data).
 * TypeScript thuần (main + bài kiểm); không đọc DB.
 */
import { normalizeVietnamMobile, type FacebookGroupAdmin } from './facebookGroupAdmins'
import type { DataGroupIngestRow } from './types'

export const FIND_DATA_GROUP_ADMIN_UID_KIND = 'facebook_group_admin_uid'
export const FIND_DATA_GROUP_ADMIN_PHONE_KIND = 'facebook_group_admin_phone'
export const FIND_DATA_GROUP_ADMIN_KINDS = [FIND_DATA_GROUP_ADMIN_UID_KIND, FIND_DATA_GROUP_ADMIN_PHONE_KIND] as const
export type FindDataGroupAdminKind = typeof FIND_DATA_GROUP_ADMIN_KINDS[number]

/** Giới hạn danh sách trong phần thêm của một dòng (một hotline có thể gắn với rất nhiều quản trị viên / group). */
const LIST_MAX = 20

export interface FindDataAdminSourceGroup {
  url: string
  name?: string
  keyword?: string
  admins?: ReadonlyArray<FacebookGroupAdmin>
}

export interface FindDataGroupAdminRows {
  uidRows: DataGroupIngestRow[]
  phoneRows: DataGroupIngestRow[]
  /** Số quản trị viên khác nhau (đã bỏ tài khoản chạy chiến dịch). */
  adminCount: number
  /** Có quản trị viên bị bỏ vì là chính tài khoản chạy chiến dịch. */
  skippedOwnAccount: boolean
}

interface GroupRef { name: string; url: string }

interface AdminEntry {
  admin: FacebookGroupAdmin
  groups: GroupRef[]
  keywords: string[]
}

function uidOf(admin: FacebookGroupAdmin): string {
  const uid = String(admin.uid ?? '').trim()
  if (/^\d{5,30}$/.test(uid)) return uid
  const fromUrl = /[?&]id=(\d{5,30})(?:&|$)/.exec(String(admin.url ?? ''))
  return fromUrl ? fromUrl[1] : ''
}

function adminKey(admin: FacebookGroupAdmin): string {
  return uidOf(admin) || String(admin.url ?? '').trim().toLowerCase()
}

function pushUnique<T>(list: T[], item: T, same: (a: T, b: T) => boolean): void {
  if (list.length >= LIST_MAX) return
  if (!list.some(existing => same(existing, item))) list.push(item)
}

/**
 * Dựng dòng của hai Nhóm data từ các group của một lượt.
 * `ownFacebookUid`: UID Facebook của tài khoản chạy chiến dịch (không có thì không bỏ ai).
 * `sourceMetadata`: ghi vào phần thêm mọi dòng (chiến dịch nguồn, lượt chạy…), giống các loại đẩy Nhóm data khác.
 */
export function buildFindDataGroupAdminRows(
  groups: ReadonlyArray<FindDataAdminSourceGroup>,
  ownFacebookUid: string | null | undefined,
  sourceMetadata: Record<string, unknown> = {}
): FindDataGroupAdminRows {
  const ownUid = /^\d{5,30}$/.test(String(ownFacebookUid ?? '').trim()) ? String(ownFacebookUid).trim() : ''
  const entries = new Map<string, AdminEntry>()
  let skippedOwnAccount = false

  for (const group of groups) {
    const groupRef: GroupRef = { name: String(group.name ?? '').trim() || String(group.url ?? ''), url: String(group.url ?? '') }
    const keyword = String(group.keyword ?? '').trim()
    for (const admin of group.admins ?? []) {
      const key = adminKey(admin)
      if (!key) continue
      if (ownUid && uidOf(admin) === ownUid) {
        skippedOwnAccount = true
        continue
      }
      let entry = entries.get(key)
      if (!entry) {
        entry = { admin: { ...admin, phones: [...(admin.phones ?? [])], emails: [...(admin.emails ?? [])] }, groups: [], keywords: [] }
        entries.set(key, entry)
      } else {
        // Cùng người ở group khác: gộp liên hệ, giữ tên / link đã có.
        for (const phone of admin.phones ?? []) if (!entry.admin.phones.includes(phone)) entry.admin.phones.push(phone)
        for (const email of admin.emails ?? []) if (!entry.admin.emails.includes(email)) entry.admin.emails.push(email)
        if (!entry.admin.name && admin.name) entry.admin.name = admin.name
        if (admin.profileRead === true) entry.admin.profileRead = true
      }
      if (groupRef.url) pushUnique(entry.groups, groupRef, (a, b) => a.url === b.url)
      if (keyword) pushUnique(entry.keywords, keyword, (a, b) => a === b)
    }
  }

  const uidRows: DataGroupIngestRow[] = []
  const phoneMap = new Map<string, { admins: AdminEntry[] }>()
  for (const entry of Array.from(entries.values())) {
    const { admin } = entry
    const uid = uidOf(admin)
    const phones: string[] = Array.from(new Set(admin.phones.map(value => normalizeVietnamMobile(value)).filter(Boolean)))
    uidRows.push({
      contactType: 'person',
      flatformType: 'facebook',
      name: admin.name || uid || admin.url,
      uid: uid || admin.url,
      url: admin.url || (uid ? `https://www.facebook.com/profile.php?id=${uid}` : null),
      extraData: {
        ...sourceMetadata,
        sourceProfileKind: 'group_admin',
        adminGroups: entry.groups,
        keywords: entry.keywords,
        phones,
        emails: admin.emails.slice(0, LIST_MAX),
        profileRead: admin.profileRead ?? null
      }
    })
    for (const phone of phones) {
      const current = phoneMap.get(phone)
      if (current) current.admins.push(entry)
      else phoneMap.set(phone, { admins: [entry] })
    }
  }

  const phoneRows: DataGroupIngestRow[] = []
  for (const [phone, { admins }] of Array.from(phoneMap.entries())) {
    const groupsOfPhone: GroupRef[] = []
    const keywords: string[] = []
    for (const entry of admins) {
      for (const group of entry.groups) pushUnique(groupsOfPhone, group, (a, b) => a.url === b.url)
      for (const keyword of entry.keywords) pushUnique(keywords, keyword, (a, b) => a === b)
    }
    const first = admins[0].admin
    phoneRows.push({
      contactType: 'phone',
      flatformType: null,
      name: first.name || phone,
      phone,
      extraData: {
        ...sourceMetadata,
        sourceProfileKind: 'group_admin',
        admins: admins.slice(0, LIST_MAX).map(entry => ({
          name: entry.admin.name || null,
          uid: uidOf(entry.admin) || null,
          url: entry.admin.url || null,
          profileRead: entry.admin.profileRead ?? null
        })),
        adminCount: admins.length,
        adminGroups: groupsOfPhone,
        keywords
      }
    })
  }

  return { uidRows, phoneRows, adminCount: entries.size, skippedOwnAccount }
}
