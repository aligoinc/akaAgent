/**
 * Desktop "Thêm data" vào chiến dịch đã tạo: luật so trùng và hợp đồng xem trước "đã có trong chiến dịch này".
 *
 * Một luật cho hai nơi: main lúc ghi thật (`addCampaignInputDataRows`, ghi thẳng DB bằng phiên Desktop) và lúc xem trước
 * (`campaign:add-data-preview`, chỉ đọc), renderer dùng cùng hàm để khử trùng danh sách "Data chờ thêm".
 * Luật này rộng hơn WebApp `campaignAppendPreview.ts` (Desktop nhận thêm Facebook, email, link group…), nên KHÔNG chép từ WebApp.
 */
import { getCampaignInputDataRequirement, isCampaignInputDataValidForAction, type CampaignInputData } from './types'
import { normalizeVietnamMobilePhone } from './phone'

export type AppendInputIdentity = Pick<CampaignInputData, 'phone' | 'uid' | 'email'>

const text = (value: unknown): string => String(value ?? '').trim()

/** Chuẩn hóa ba trường định danh đúng như dòng được ghi (SĐT chuẩn hóa khi loại chiến dịch nhận SĐT hoặc SMS/gọi). */
export function normalizeAppendInputIdentity(row: Partial<AppendInputIdentity>, actionId: string): AppendInputIdentity {
  const requirement = getCampaignInputDataRequirement(actionId)
  const normalizePhone = requirement?.field === 'phone' || requirement?.field === 'phone_or_uid'
    || actionId === 'sms_send' || actionId === 'voice_call'
  return {
    phone: normalizePhone ? normalizeVietnamMobilePhone(row.phone) : text(row.phone),
    uid: text(row.uid),
    email: actionId === 'email_send' ? text(row.email).toLowerCase() : text(row.email)
  }
}

/** Khóa so trùng của một dòng; mảng rỗng = dòng không có định danh. */
export function appendInputDataDedupeKeys(row: Partial<AppendInputIdentity>, actionId?: string | null): string[] {
  const requirement = getCampaignInputDataRequirement(actionId)
  if (!requirement) return []
  if (requirement.field === 'phone_or_uid') {
    const keys: string[] = []
    const phone = normalizeVietnamMobilePhone(row.phone)
    const uid = text(row.uid).replace(/\/+$/g, '').toLowerCase()
    if (phone) keys.push(`phone:${phone}`)
    if (uid) keys.push(`uid:${uid}`)
    return keys
  }
  const value = text((row as Record<string, unknown>)[requirement.field])
  if (actionId === 'email_send') return value ? [value.toLowerCase()] : []
  if (requirement.field === 'phone') {
    const phone = normalizeVietnamMobilePhone(value)
    return phone ? [phone] : []
  }
  const key = value.replace(/\/+$/g, '').toLowerCase()
  return key ? [key] : []
}

/** Khóa so trùng của một dòng chờ thêm sau khi chuẩn hóa như lúc ghi (renderer dùng để khử trùng và đối chiếu kết quả xem trước). */
export function appendInputRowKeys(row: Partial<AppendInputIdentity>, actionId: string): string[] {
  return appendInputDataDedupeKeys(normalizeAppendInputIdentity(row, actionId), actionId)
}

/** Dòng có định danh hợp lệ cho loại chiến dịch (cùng điều kiện "không hợp lệ" của đường ghi). */
export function isAppendInputRowValid(row: Partial<AppendInputIdentity>, actionId: string): boolean {
  const identity = normalizeAppendInputIdentity(row, actionId)
  return appendInputDataDedupeKeys(identity, actionId).length > 0 && isCampaignInputDataValidForAction(identity, actionId)
}

/** Cột cần đọc của data đã có để dựng khóa so trùng. */
export function appendInputDataKeyColumns(actionId: string): string | null {
  const requirement = getCampaignInputDataRequirement(actionId)
  if (!requirement) return null
  return requirement.field === 'phone_or_uid' ? 'phone, uid' : requirement.field
}

export interface AppendClassification {
  /** Chỉ số (theo thứ tự đầu vào) của dòng sẽ được thêm. */
  acceptedIndexes: number[]
  /** Dòng không có định danh hợp lệ. */
  invalidIndexes: number[]
  /** Dòng lặp lại một dòng đứng trước trong cùng lượt. */
  batchDuplicateIndexes: number[]
  /** Dòng đã có trong chiến dịch. */
  existingIndexes: number[]
}

/**
 * Phân loại từng dòng theo đúng thứ tự xét của đường ghi: không hợp lệ → trùng trong lượt → đã có trong chiến dịch → nhận.
 * `skipExisting=false` thì không dòng nào rơi vào nhóm "đã có". Dòng bị bỏ vì "đã có" không chặn dòng sau cùng khóa.
 */
export function classifyAppendInputData(
  actionId: string,
  rows: readonly Partial<AppendInputIdentity>[],
  existingKeys: ReadonlySet<string>,
  options: { skipExisting: boolean }
): AppendClassification {
  const result: AppendClassification = { acceptedIndexes: [], invalidIndexes: [], batchDuplicateIndexes: [], existingIndexes: [] }
  const batchKeys = new Set<string>()
  rows.forEach((raw, index) => {
    const keys = appendInputRowKeys(raw, actionId)
    if (!isAppendInputRowValid(raw, actionId)) { result.invalidIndexes.push(index); return }
    if (keys.some(key => batchKeys.has(key))) { result.batchDuplicateIndexes.push(index); return }
    if (options.skipExisting && keys.some(key => existingKeys.has(key))) { result.existingIndexes.push(index); return }
    keys.forEach(key => batchKeys.add(key))
    result.acceptedIndexes.push(index)
  })
  return result
}

// ── Xem trước (IPC chỉ đọc) ───────────────────────────────────────────────────────────────────────────────

export const CAMPAIGN_ADD_DATA_PREVIEW_IPC = 'campaign:add-data-preview'

/** Số dòng tối đa mỗi lượt xem trước (bằng giới hạn một lần nhập). Renderer gửi tuần tự khi danh sách dài hơn. */
export const APPEND_PREVIEW_MAX_ITEMS = 10_000

export interface CampaignAddDataPreviewRequest {
  campaignId: number
  items: Partial<AppendInputIdentity>[]
}

export interface CampaignAddDataPreviewResult {
  checkedAt: string
  /** Số dòng data chiến dịch đang có lúc xem trước. */
  campaignInputCount: number
  itemCount: number
  existingIndexes: number[]
  batchDuplicateIndexes: number[]
  invalidIndexes: number[]
}

export type CampaignAddDataPreviewErrorCode =
  | 'session_invalid'
  | 'append_preview_disabled'
  | 'campaign_append_unsupported'
  | 'campaign_not_found'
  | 'invalid_append_preview_request'
  | 'append_preview_busy'
  | 'append_preview_timeout'
  | 'append_preview_failed'

export type CampaignAddDataPreviewResponse =
  | { ok: true; data: CampaignAddDataPreviewResult }
  | { ok: false; code: CampaignAddDataPreviewErrorCode; message: string }

/** Lỗi khiến renderer thôi gọi trong phiên form (công tắc tắt, loại chiến dịch không hỗ trợ). Lỗi khác chờ khách bấm Thử lại. */
export const isAppendPreviewGone = (code: CampaignAddDataPreviewErrorCode): boolean =>
  code === 'append_preview_disabled' || code === 'campaign_append_unsupported'

/** Công tắc chung với Web: `web.campaign_input_duplicates.appendPreview`; thiếu = bật, chỉ `false` mới tắt. Như WebApp. */
export function parseAppendPreviewEnabled(value: unknown): boolean {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    return (parsed as Record<string, unknown>).appendPreview !== false
  } catch { return true }
}

const previewText = (value: unknown, max: number): value is string | null | undefined =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= max)

/** Kiểm tra yêu cầu xem trước. Ném Error tiếng Việt. */
export function validateAppendPreviewRequest(value: unknown): CampaignAddDataPreviewRequest {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  const campaignId = Number(body?.campaignId)
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) throw new Error('Chiến dịch không hợp lệ.')
  const items = body?.items
  if (!Array.isArray(items) || items.length === 0 || items.length > APPEND_PREVIEW_MAX_ITEMS) {
    throw new Error(`Mỗi lượt xem trước từ 1 đến ${APPEND_PREVIEW_MAX_ITEMS.toLocaleString('vi-VN')} dòng.`)
  }
  return {
    campaignId,
    items: items.map(raw => {
      const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
      if (!item || !previewText(item.phone, 64) || !previewText(item.uid, 10_000) || !previewText(item.email, 320)) {
        throw new Error('Dữ liệu xem trước không hợp lệ.')
      }
      return { phone: item.phone ?? '', uid: item.uid ?? '', email: item.email ?? '' }
    })
  }
}
