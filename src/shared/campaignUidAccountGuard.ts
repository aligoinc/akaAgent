/**
 * Chặn chiến dịch Zalo dùng danh sách người nhận quét bằng tài khoản khác (DAT04). Phương án: akaAgent
 * docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md; luật kiểm nằm ở DB (akaAgent V679: aka_agent_control_campaign_uid_account_check /
 * aka_agent_campaign_uid_account_check_v1). Module này chỉ lo: chọn chiến dịch cần kiểm, chuẩn hoá + chia lượt UID, đọc kết quả
 * của DB và câu cho khách (một câu chung, UID_GUARD_MESSAGE).
 * Bản gốc: akaAgentWebApp packages/control-api/src/campaignUidAccountGuard.ts. Desktop chép nguyên văn sang
 * src/shared/campaignUidAccountGuard.ts (sửa ở WebApp trước rồi chép lại; bài kiểm so md5 hai bản).
 *
 * Không chặn khi không kiểm được (DB chưa có hàm, lỗi, hết giờ, công tắc `campaign.uid_account_guard` = off): lúc chạy, người nhận
 * gặp DAT04 vẫn được giữ lại (V679), không mất data.
 */

export const UID_ACCOUNT_GUARD_CONTROL_RPC = 'aka_agent_control_campaign_uid_account_check'
export const UID_ACCOUNT_GUARD_DESKTOP_RPC = 'aka_agent_campaign_uid_account_check_v1'
/** Mã lỗi API trả khi chặn lưu (HTTP 400), câu của lỗi = UID_GUARD_MESSAGE, kèm `details` kiểu UidAccountGuardDetails. */
export const UID_ACCOUNT_GUARD_ERROR_CODE = 'campaign_uid_account_mismatch'
/** Giới hạn của hàm DB. */
export const UID_ACCOUNT_GUARD_MAX_UIDS_PER_CALL = 2000
export const UID_ACCOUNT_GUARD_MAX_ACCOUNTS = 50
/** Hạn chờ cả lượt kiểm ở bên gọi (hàm DB tự dừng ở 15 giây). */
export const UID_ACCOUNT_GUARD_DEADLINE_MS = 20_000

/** Loại chiến dịch gửi theo UID mà UID gắn theo tài khoản gửi (cùng danh sách với private.aka_agent_uid_guard_action). */
export const UID_ACCOUNT_GUARD_ACTIONS: readonly string[] = [
  'zalo_message_group_member',
  'zalo_message_friend',
  'zalo_message_remarketing_customer',
  'zalo_cancel_sent_friend_request',
]

/** Chiến dịch chạy bằng Nhóm data không kiểm (nhóm đã gắn tài khoản). */
export function uidAccountGuardApplies(actionId: unknown, dataTargetSourceMode?: unknown): boolean {
  if (typeof actionId !== 'string' || !UID_ACCOUNT_GUARD_ACTIONS.includes(actionId)) return false
  const mode = typeof dataTargetSourceMode === 'string' && dataTargetSourceMode.trim() ? dataTargetSourceMode.trim() : 'direct'
  return mode === 'direct'
}

const GUARD_SPACE = new RegExp('[\\s\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+', 'g')

/** Như private.aka_agent_uid_guard_norm: bỏ mọi khoảng trắng (cả khoảng trắng Unicode, zero-width space) và một đuôi "_0". */
export function normalizeGuardUid(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const cleaned = String(value).replace(GUARD_SPACE, '').replace(/_0$/, '')
  return cleaned ? cleaned : null
}

/** UID khác nhau (đã chuẩn hoá) của các dòng data, theo thứ tự gặp. */
export function collectGuardUids(rows: readonly { uid?: unknown }[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    const uid = normalizeGuardUid(row?.uid)
    if (uid) seen.add(uid)
  }
  return Array.from(seen)
}

export function chunkGuardUids(uids: readonly string[], size = UID_ACCOUNT_GUARD_MAX_UIDS_PER_CALL): string[][] {
  const chunks: string[][] = []
  for (let offset = 0; offset < uids.length; offset += size) chunks.push(uids.slice(offset, offset + size))
  return chunks
}

export interface UidGuardOwner {
  accountId: number
  accountName: string
  count: number
  /** Tài khoản của chính nhân viên, Zalo, chưa xoá: đổi sang được. */
  usable: boolean
}

export interface UidGuardAccountResult {
  accountId: number
  accountName: string
  total: number
  own: number
  blocked: number
  unknown: number
  blockedUids: string[]
  owners: UidGuardOwner[]
}

export interface UidGuardCampaignResult {
  applies: boolean
  enabled: boolean
  campaignId: number
  checkedRows: number
  truncated: boolean
  /** Người nhận (dòng data) đang chờ mà tài khoản không gửi được. */
  blockedRows: number
  account: UidGuardAccountResult | null
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function parseAccount(value: unknown): UidGuardAccountResult | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const accountId = num(row.accountId)
  if (accountId <= 0) return null
  const owners = Array.isArray(row.owners) ? row.owners : []
  return {
    accountId,
    accountName: str(row.accountName),
    total: num(row.total),
    own: num(row.own),
    blocked: num(row.blocked),
    unknown: num(row.unknown),
    blockedUids: Array.isArray(row.blockedUids) ? row.blockedUids.filter((uid): uid is string => typeof uid === 'string') : [],
    owners: owners.flatMap(owner => {
      if (!owner || typeof owner !== 'object') return []
      const item = owner as Record<string, unknown>
      const id = num(item.accountId)
      return id > 0 ? [{ accountId: id, accountName: str(item.accountName), count: num(item.count), usable: item.usable === true }] : []
    }),
  }
}

/** Kết quả chế độ `uids`. Công tắc tắt (`enabled: false`) thì trả null: không chặn. */
export function parseUidGuardUidsResult(data: unknown): UidGuardAccountResult[] | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (row.ok !== true || row.enabled === false) return null
  const accounts = Array.isArray(row.accounts) ? row.accounts : []
  return accounts.flatMap(item => {
    const parsed = parseAccount(item)
    return parsed ? [parsed] : []
  })
}

/** Kết quả chế độ `campaign`. Không áp dụng hoặc công tắc tắt thì trả null: không chặn. */
export function parseUidGuardCampaignResult(data: unknown): UidGuardCampaignResult | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (row.ok !== true || row.applies !== true || row.enabled === false) return null
  return {
    applies: true,
    enabled: true,
    campaignId: num(row.campaignId),
    checkedRows: num(row.checkedRows),
    truncated: row.truncated === true,
    blockedRows: num(row.blockedRows),
    account: parseAccount(row.account),
  }
}

/** Gộp kết quả các lượt (mỗi lượt ≤ 2.000 UID, không trùng nhau) theo tài khoản. */
export function mergeUidGuardChunks(chunks: readonly (readonly UidGuardAccountResult[])[]): UidGuardAccountResult[] {
  const byAccount = new Map<number, UidGuardAccountResult>()
  for (const chunk of chunks) {
    for (const item of chunk) {
      const merged = byAccount.get(item.accountId)
      if (!merged) {
        byAccount.set(item.accountId, { ...item, blockedUids: [...item.blockedUids], owners: item.owners.map(owner => ({ ...owner })) })
        continue
      }
      merged.total += item.total
      merged.own += item.own
      merged.blocked += item.blocked
      merged.unknown += item.unknown
      merged.blockedUids.push(...item.blockedUids)
      for (const owner of item.owners) {
        const existing = merged.owners.find(candidate => candidate.accountId === owner.accountId)
        if (existing) existing.count += owner.count
        else merged.owners.push({ ...owner })
      }
    }
  }
  const merged = Array.from(byAccount.values())
  for (const item of merged) {
    item.owners.sort((left, right) => right.count - left.count || left.accountId - right.accountId)
  }
  return merged
}

/**
 * Câu cho khách (anh chốt 27/11/2026): chỉ chặn, không cho lưu, một câu chung cho mọi trường hợp (lưu, thêm data, Tiếp tục,
 * cả danh sách hay chỉ vài người sai, một hay nhiều tài khoản). Không nêu tên tài khoản đã quét, không nêu số người, không nút
 * "Bỏ N người" / "Dùng tài khoản", chỉ nút Đóng.
 */
export const UID_GUARD_MESSAGE = 'Danh sách người nhận được quét bằng tài khoản Zalo khác nên tài khoản đang chọn không gửi được. '
  + 'Hãy chọn đúng tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này.'

export interface UidGuardVerdict {
  message: string
  /** Tài khoản bị chặn đầu tiên (chỉ để ghi log / chẩn đoán, không hiện cho khách). */
  accountId: number
  blocked: number
  total: number
}

/**
 * Lưu (tạo chiến dịch, đổi tài khoản, thêm data). `results` = một dòng cho mỗi tài khoản định dùng.
 * `counts`: đếm theo người nhận (dòng data) thay vì theo UID khác nhau (chế độ `campaign`). Không ai bị chặn thì trả null.
 */
export function uidGuardSaveVerdict(
  results: readonly UidGuardAccountResult[],
  counts?: { blocked?: number; total?: number },
): UidGuardVerdict | null {
  const first = results.find(result => result.blocked > 0)
  if (!first) return null
  const blocked = counts?.blocked ?? results.reduce((sum, result) => sum + Math.max(0, result.blocked), 0)
  if (blocked <= 0) return null
  const total = Math.max(counts?.total ?? results.reduce((sum, result) => sum + Math.max(0, result.total), 0), blocked)
  return { message: UID_GUARD_MESSAGE, accountId: first.accountId, blocked, total }
}

/** Bấm Tiếp tục (chế độ `campaign`, tài khoản hiện tại). Không còn người nào đang chờ bị chặn thì trả null. */
export function uidGuardResumeVerdict(result: UidGuardCampaignResult | null): UidGuardVerdict | null {
  if (!result || !result.account || result.blockedRows <= 0) return null
  return {
    message: UID_GUARD_MESSAGE,
    accountId: result.account.accountId,
    blocked: result.blockedRows,
    total: Math.max(result.checkedRows, result.blockedRows),
  }
}

/** `details` của lỗi API `campaign_uid_account_mismatch` (không hiện cho khách). */
export interface UidAccountGuardDetails {
  accountId: number
  blocked: number
  total: number
  campaignId?: number
}

export function uidGuardDetails(verdict: UidGuardVerdict, campaignId?: number): UidAccountGuardDetails {
  return {
    accountId: verdict.accountId,
    blocked: verdict.blocked,
    total: verdict.total,
    ...(campaignId ? { campaignId } : {}),
  }
}

/** Phản hồi của API kiểm trước khi lưu (POST /campaigns/uid-account-check): `blocked` = có chặn hay không, `message` = câu cho khách. */
export interface UidAccountGuardCheckResponse {
  blocked: boolean
  message: string | null
}

export function uidGuardCheckResponse(verdict: UidGuardVerdict | null): UidAccountGuardCheckResponse {
  return verdict ? { blocked: true, message: verdict.message } : { blocked: false, message: null }
}
