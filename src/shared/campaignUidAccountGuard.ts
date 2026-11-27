/**
 * Chặn chiến dịch Zalo dùng danh sách người nhận quét bằng tài khoản khác (DAT04). Phương án: akaAgent
 * docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md; luật kiểm nằm ở DB (akaAgent V679: aka_agent_control_campaign_uid_account_check /
 * aka_agent_campaign_uid_account_check_v1). Module này chỉ lo: chọn chiến dịch cần kiểm, chuẩn hoá + chia lượt UID, đọc kết quả
 * của DB và dựng câu cho khách.
 * Bản gốc: akaAgentWebApp packages/control-api/src/campaignUidAccountGuard.ts. Desktop chép nguyên văn sang
 * src/shared/campaignUidAccountGuard.ts (sửa ở WebApp trước rồi chép lại; bài kiểm so md5 hai bản).
 *
 * Không chặn khi không kiểm được (DB chưa có hàm, lỗi, hết giờ, công tắc `campaign.uid_account_guard` = off): lúc chạy, người nhận
 * gặp DAT04 vẫn được giữ lại (V679), không mất data.
 */

export const UID_ACCOUNT_GUARD_CONTROL_RPC = 'aka_agent_control_campaign_uid_account_check'
export const UID_ACCOUNT_GUARD_DESKTOP_RPC = 'aka_agent_campaign_uid_account_check_v1'
/** Mã lỗi API trả khi chặn lưu (HTTP 400), kèm `details` kiểu UidAccountGuardDetails. */
export const UID_ACCOUNT_GUARD_ERROR_CODE = 'campaign_uid_account_mismatch'
/** Khoá trong body lưu / thêm data / tiếp tục: khách chọn "Bỏ N người này". */
export const UID_ACCOUNT_GUARD_SKIP_FIELD = 'uidAccountGuard'
export const UID_ACCOUNT_GUARD_SKIP_VALUE = 'skip_blocked'
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

export function uidAccountGuardSkipRequested(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>)[UID_ACCOUNT_GUARD_SKIP_FIELD] === UID_ACCOUNT_GUARD_SKIP_VALUE
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

export type UidGuardVerdictKind = 'all' | 'partial' | 'shared' | 'resume'

export interface UidGuardVerdict {
  kind: UidGuardVerdictKind
  title: string
  message: string
  /** Tài khoản bị chặn đầu tiên (câu chính nói về tài khoản này). */
  accountId: number
  accountName: string
  blocked: number
  total: number
  owners: UidGuardOwner[]
  /** Nút "Dùng tài khoản X": chỉ khi một tài khoản của chính nhân viên đã quét cả phần bị chặn. */
  suggestedAccount: { accountId: number; accountName: string } | null
  /** Có nút "Bỏ N người này". */
  canSkip: boolean
}

export const UID_GUARD_CLOSE_LABEL = 'Đóng'
export const uidGuardUseAccountLabel = (name: string) => `Dùng tài khoản ${quoteName(name)}`
export const uidGuardRescanLabel = (name: string) => `Quét lại danh sách bằng ${quoteName(name)}`
export const uidGuardSkipLabel = (count: number) => `Bỏ ${formatCount(count)} người này`

function quoteName(name: string): string {
  const trimmed = (name || '').trim()
  return `"${trimmed || 'không tên'}"`
}

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('vi-VN')
}

/** "A", "A", "B" hoặc "A", "B" và 3 tài khoản khác. */
function namesText(names: readonly string[], limit = 3): string {
  const unique = Array.from(new Set(names.map(name => quoteName(name))))
  if (unique.length <= limit) return unique.join(', ')
  return `${unique.slice(0, limit).join(', ')} và ${unique.length - limit} tài khoản khác`
}

function ownerNames(owners: readonly UidGuardOwner[]): string {
  return owners.length > 0 ? namesText(owners.map(owner => owner.accountName)) : 'khác'
}

function suggestion(result: UidGuardAccountResult, blocked: number): UidGuardVerdict['suggestedAccount'] {
  const top = result.owners[0]
  if (!top || !top.usable || top.count < blocked) return null
  return { accountId: top.accountId, accountName: top.accountName }
}

/**
 * Câu khi lưu (tạo chiến dịch, đổi tài khoản, thêm data). `results` = một dòng cho mỗi tài khoản định dùng.
 * `blockedOverride` / `totalOverride`: đếm theo người nhận (dòng data) thay vì theo UID khác nhau (chế độ `campaign`).
 * Không ai bị chặn thì trả null.
 */
export function uidGuardSaveVerdict(
  results: readonly UidGuardAccountResult[],
  counts?: { blocked?: number; total?: number },
): UidGuardVerdict | null {
  const blockedAccounts = results.filter(result => result.blocked > 0)
  if (blockedAccounts.length === 0) return null
  const first = blockedAccounts[0]
  const blocked = counts?.blocked ?? first.blocked
  if (blocked <= 0) return null
  const total = Math.max(counts?.total ?? first.total, blocked)
  const owners = ownerNames(first.owners)
  if (results.length > 1) {
    const ownerList = mergeOwners(blockedAccounts.flatMap(result => result.owners))
    const ownersText = ownerNames(ownerList)
    return {
      kind: 'shared',
      title: `Danh sách này chỉ gửi được bằng tài khoản ${ownersText}.`,
      message: `Các tài khoản ${namesText(blockedAccounts.map(result => result.accountName))} không gửi được vì danh sách được quét bằng ${ownersText}. Mỗi tài khoản cần danh sách do chính nó quét.`,
      accountId: first.accountId,
      accountName: first.accountName,
      blocked,
      total,
      owners: ownerList,
      suggestedAccount: null,
      canSkip: false,
    }
  }
  if (first.own === 0) {
    const who = blocked >= total ? `Danh sách ${formatCount(total)} người nhận` : `${formatCount(blocked)} trong ${formatCount(total)} người nhận`
    return {
      kind: 'all',
      title: `Tài khoản ${quoteName(first.accountName)} không gửi được cho danh sách này.`,
      message: `${who} được quét bằng tài khoản Zalo ${owners}. Zalo cấp cho mỗi tài khoản một mã riêng của từng người, nên chỉ tài khoản đã quét danh sách mới gửi được.`,
      accountId: first.accountId,
      accountName: first.accountName,
      blocked,
      total,
      owners: first.owners,
      suggestedAccount: suggestion(first, first.blocked),
      canSkip: false,
    }
  }
  return {
    kind: 'partial',
    title: `Có ${formatCount(blocked)} người tài khoản ${quoteName(first.accountName)} không gửi được.`,
    message: `${formatCount(blocked)} trong ${formatCount(total)} người nhận được quét bằng tài khoản Zalo ${owners}. Bỏ ${formatCount(blocked)} người này ra thì lưu được.`,
    accountId: first.accountId,
    accountName: first.accountName,
    blocked,
    total,
    owners: first.owners,
    suggestedAccount: null,
    canSkip: true,
  }
}

function mergeOwners(owners: readonly UidGuardOwner[]): UidGuardOwner[] {
  const map = new Map<number, UidGuardOwner>()
  for (const owner of owners) {
    const existing = map.get(owner.accountId)
    if (existing) existing.count += owner.count
    else map.set(owner.accountId, { ...owner })
  }
  return Array.from(map.values()).sort((left, right) => right.count - left.count || left.accountId - right.accountId)
}

/** Câu khi bấm Tiếp tục (chế độ `campaign`, tài khoản hiện tại). Không còn người nào đang chờ bị chặn thì trả null. */
export function uidGuardResumeVerdict(result: UidGuardCampaignResult | null): UidGuardVerdict | null {
  if (!result || !result.account || result.blockedRows <= 0) return null
  const account = result.account
  const owners = ownerNames(account.owners)
  const name = quoteName(account.accountName)
  const partial = account.own > 0
  const total = Math.max(result.checkedRows, result.blockedRows)
  const who = partial ? `${formatCount(result.blockedRows)} người nhận` : 'danh sách người nhận'
  return {
    kind: 'resume',
    title: 'Chưa chạy tiếp được',
    message: `Chưa chạy tiếp được: ${who} được quét bằng tài khoản Zalo ${owners} nên ${name} không gửi được. `
      + (partial
        ? `Bỏ ${formatCount(result.blockedRows)} người này ra thì chạy tiếp được, hoặc mở Sửa chiến dịch để chọn lại tài khoản ${owners}.`
        : `Mở Sửa chiến dịch để chọn lại tài khoản ${owners}, hoặc quét lại danh sách bằng ${name}.`),
    accountId: account.accountId,
    accountName: account.accountName,
    blocked: result.blockedRows,
    total,
    owners: account.owners,
    suggestedAccount: partial ? null : suggestion(account, account.blocked),
    canSkip: partial,
  }
}

/** `details` của lỗi API `campaign_uid_account_mismatch`. */
export interface UidAccountGuardDetails {
  kind: UidGuardVerdictKind
  title: string
  accountId: number
  accountName: string
  blocked: number
  total: number
  owners: UidGuardOwner[]
  suggestedAccountId: number | null
  suggestedAccountName: string | null
  canSkip: boolean
  campaignId?: number
}

export function uidGuardDetails(verdict: UidGuardVerdict, campaignId?: number): UidAccountGuardDetails {
  return {
    kind: verdict.kind,
    title: verdict.title,
    accountId: verdict.accountId,
    accountName: verdict.accountName,
    blocked: verdict.blocked,
    total: verdict.total,
    owners: verdict.owners.slice(0, 10),
    suggestedAccountId: verdict.suggestedAccount?.accountId ?? null,
    suggestedAccountName: verdict.suggestedAccount?.accountName ?? null,
    canSkip: verdict.canSkip,
    ...(campaignId ? { campaignId } : {}),
  }
}

/** Phản hồi của API kiểm trước khi lưu (POST /campaigns/uid-account-check). */
export interface UidAccountGuardCheckResponse {
  verdict: (UidAccountGuardDetails & { message: string }) | null
  /** UID (đã chuẩn hoá) bị chặn, để bỏ khỏi danh sách khi khách chọn "Bỏ N người này". */
  blockedUids: string[]
}

/** Đọc lại `details` của lỗi API (Web / iOS). Sai khuôn thì trả null (bên gọi hiện câu của lỗi). */
export function parseUidAccountGuardDetails(value: unknown): UidAccountGuardDetails | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const kind = row.kind
  if (kind !== 'all' && kind !== 'partial' && kind !== 'shared' && kind !== 'resume') return null
  const accountId = num(row.accountId)
  if (accountId <= 0) return null
  const suggestedAccountId = num(row.suggestedAccountId)
  return {
    kind,
    title: str(row.title),
    accountId,
    accountName: str(row.accountName),
    blocked: num(row.blocked),
    total: num(row.total),
    owners: Array.isArray(row.owners)
      ? row.owners.flatMap(owner => {
        if (!owner || typeof owner !== 'object') return []
        const item = owner as Record<string, unknown>
        const id = num(item.accountId)
        return id > 0 ? [{ accountId: id, accountName: str(item.accountName), count: num(item.count), usable: item.usable === true }] : []
      })
      : [],
    suggestedAccountId: suggestedAccountId > 0 ? suggestedAccountId : null,
    suggestedAccountName: typeof row.suggestedAccountName === 'string' ? row.suggestedAccountName : null,
    canSkip: row.canSkip === true,
    ...(num(row.campaignId) > 0 ? { campaignId: num(row.campaignId) } : {}),
  }
}

/** Bỏ khỏi danh sách các dòng có UID nằm trong `blockedUids` (đã chuẩn hoá). */
export function dropGuardBlockedRows<T extends { uid?: unknown }>(rows: readonly T[], blockedUids: Iterable<string>): T[] {
  const blocked = new Set(blockedUids)
  if (blocked.size === 0) return [...rows]
  return rows.filter(row => {
    const uid = normalizeGuardUid(row?.uid)
    return !uid || !blocked.has(uid)
  })
}
