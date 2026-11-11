/**
 * "Chia đều data cho các tài khoản": một lần lưu chọn từ 2 tài khoản trở lên thì form tạo mỗi tài khoản một
 * chiến dịch. Chia đều = mỗi dòng data chỉ thuộc một chiến dịch (dòng i về tài khoản i % n); không chia =
 * mọi tài khoản nhận cả danh sách.
 *
 * Mặc định theo loại data (chốt 11/11/2026): chỉ chia sẵn khi data là thứ tài khoản nào cũng dùng được và
 * mỗi người chỉ nên nhận một lần (SĐT, email, UID/link profile Facebook). Các loại Facebook theo link nhóm,
 * link bài, từ khoá, Page giữ mặc định dùng chung vì khách cố ý cho nhiều tài khoản chạy cùng danh sách.
 * Data gắn với một tài khoản (bạn bè Facebook) không được chia.
 *
 * Lựa chọn chỉ có tác dụng lúc tạo, không lưu vào chiến dịch. Nháp giữ hai khoá trong `formData`:
 * `splitDataAcrossAccounts` và `splitDataChoiceMade` (người dùng đã tự chọn hay chưa).
 *
 * Hợp đồng dùng chung Web/iOS/Desktop: akaAgent chép nguyên văn sang `src/shared/campaignDataSplit.ts`
 * (sửa ở akaAgentWebApp trước rồi chép lại). Xem docs/CAMPAIGN_DATA_SPLIT_DEFAULT.md.
 */

/** split = chia đều sẵn; shared = dùng chung sẵn, tự tích nếu muốn chia; never = ẩn ô, không chia. */
export type CampaignDataSplitMode = 'split' | 'shared' | 'never'

export const CAMPAIGN_DATA_SPLIT_DEFAULT_ACTIONS: readonly string[] = [
  'zalo_message_phone', 'sms_send', 'voice_call', 'email_send', 'facebook_message_uid'
]
export const CAMPAIGN_DATA_SPLIT_NEVER_ACTIONS: readonly string[] = ['facebook_message_friend']

const PHONE_KEY_ACTIONS: readonly string[] = ['zalo_message_phone', 'sms_send', 'voice_call']
const PHONE_OR_UID_KEY_ACTIONS: readonly string[] = ['zalo_add_group_member']

export function campaignDataSplitMode(actionId: string | null | undefined): CampaignDataSplitMode {
  const action = String(actionId || '')
  if (CAMPAIGN_DATA_SPLIT_NEVER_ACTIONS.includes(action)) return 'never'
  return CAMPAIGN_DATA_SPLIT_DEFAULT_ACTIONS.includes(action) ? 'split' : 'shared'
}

/** Ô chia đều có được hiện cho loại này không (còn tuỳ số tài khoản và nguồn data ở form). */
export const campaignDataSplitAvailable = (actionId: string | null | undefined): boolean =>
  campaignDataSplitMode(actionId) !== 'never'

export const defaultSplitDataAcrossAccounts = (actionId: string | null | undefined): boolean =>
  campaignDataSplitMode(actionId) === 'split'

/**
 * Giá trị đang áp dụng của ô chia đều.
 * - Loại không được chia: luôn tắt.
 * - Người dùng đã tự chọn (`choiceMade`): theo đúng lựa chọn.
 * - Chưa chọn: theo mặc định của loại. Nháp cũ không có `splitDataChoiceMade`; `true` trong nháp cũ chỉ có
 *   thể do người dùng tự tích (mặc định cũ là tắt) nên vẫn được giữ, còn `false` thì không phân biệt được
 *   với mặc định cũ nên áp mặc định mới.
 */
export function resolveSplitDataAcrossAccounts(
  actionId: string | null | undefined,
  stored: unknown,
  choiceMade: unknown,
): boolean {
  const mode = campaignDataSplitMode(actionId)
  if (mode === 'never') return false
  if (choiceMade === true) return stored === true
  return stored === true || mode === 'split'
}

/** Hỏi lại trước khi lưu: loại nên chia mà người dùng chọn cho mọi tài khoản gửi cả danh sách. */
export function shouldConfirmSharedCampaignData(input: {
  actionId: string | null | undefined
  splitDataAcrossAccounts: boolean
  accountCount: number
  dataCount: number
}): boolean {
  return campaignDataSplitMode(input.actionId) === 'split' && !input.splitDataAcrossAccounts
    && input.accountCount > 1 && input.dataCount > 0
}

export const sharedCampaignDataConfirmTitle = 'Mỗi tài khoản gửi cả danh sách?'

export function sharedCampaignDataConfirmMessage(accountCount: number, dataCount: number): string {
  return `Bạn đang tắt chia đều: cả ${accountCount} tài khoản sẽ cùng gửi tới ${dataCount.toLocaleString('vi-VN')} data, `
    + `nên một khách có thể nhận tới ${accountCount} lần. Bật "Chia đều data cho các tài khoản" để mỗi khách chỉ nhận 1 lần.`
}

export function campaignDataSplitTooFewMessage(dataCount: number, accountCount: number): string {
  return `Có ${dataCount} data hợp lệ nhưng đang chia đều cho ${accountCount} tài khoản. `
    + 'Vui lòng thêm data, giảm số tài khoản, hoặc tắt "Chia đều data cho các tài khoản" để mỗi tài khoản gửi cả danh sách.'
}

export function campaignDataSplitDedupeNotice(removed: number): string {
  return `Đã bỏ ${removed.toLocaleString('vi-VN')} dòng trùng trước khi chia đều cho các tài khoản.`
}

export interface CampaignDataSplitRow {
  phone?: unknown
  uid?: unknown
  email?: unknown
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim())

function phoneKey(value: unknown): string {
  const digits = text(value).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('0084')) return `p:0${digits.slice(4)}`
  if (digits.startsWith('84') && digits.length >= 11) return `p:0${digits.slice(2)}`
  return `p:${digits}`
}

function uidKey(value: unknown): string {
  const uid = text(value).replace(/\s+/g, '').replace(/\/+$/g, '').toLowerCase()
  return uid ? `u:${uid}` : ''
}

function emailKey(value: unknown): string {
  const email = text(value).toLowerCase()
  return email ? `e:${email}` : ''
}

/** Khoá nhận diện một dòng data theo loại chiến dịch; rỗng = không nhận diện được, không coi là trùng. */
export function campaignDataSplitKey(actionId: string | null | undefined, row: CampaignDataSplitRow): string {
  const action = String(actionId || '')
  if (PHONE_KEY_ACTIONS.includes(action)) return phoneKey(row.phone)
  if (action === 'email_send') return emailKey(row.email)
  if (PHONE_OR_UID_KEY_ACTIONS.includes(action)) return phoneKey(row.phone) || uidKey(row.uid)
  return uidKey(row.uid) || phoneKey(row.phone) || emailKey(row.email)
}

/** Bỏ dòng trùng (giữ dòng đầu, giữ thứ tự) để hai dòng của cùng một người không rơi vào hai tài khoản. */
export function dedupeCampaignDataForSplit<T extends CampaignDataSplitRow>(
  actionId: string | null | undefined,
  rows: readonly T[],
): { rows: T[]; removed: number } {
  const seen = new Set<string>()
  const kept: T[] = []
  for (const row of rows) {
    const key = campaignDataSplitKey(actionId, row)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    kept.push(row)
  }
  return { rows: kept, removed: rows.length - kept.length }
}

/** Dòng i về tài khoản i % n; tài khoản đứng đầu nhận phần dư. */
export function splitCampaignDataAcrossAccounts<T>(rows: readonly T[], accountCount: number): T[][] {
  const count = Math.max(0, Math.floor(accountCount))
  const chunks: T[][] = Array.from({ length: count }, () => [])
  if (count === 0) return chunks
  rows.forEach((row, index) => { chunks[index % count].push(row) })
  return chunks
}
