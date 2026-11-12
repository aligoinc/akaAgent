/**
 * Số ngày và tài khoản đã chọn của "Lọc trùng dữ liệu" nhớ trên máy, chung cho cửa sổ Upload và nút Kiểm tra trùng của
 * Thêm data (cùng khóa với Web: `aka.campaignImportDuplicates.v1:<tổ chức>:<nhân viên>`).
 */
export const inputDuplicateMemoryKey = (organizationId: number | string | undefined | null, staffId: number | string | undefined | null): string =>
  `aka.campaignImportDuplicates.v1:${organizationId ?? ''}:${staffId ?? ''}`

export const readDuplicateMemory = (key: string): { days?: number; pickedIds?: number[] } => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      days: typeof record.days === 'number' && Number.isInteger(record.days) ? record.days : undefined,
      pickedIds: Array.isArray(record.pickedIds)
        ? record.pickedIds.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0) : undefined
    }
  } catch { return {} }
}

export const writeDuplicateMemory = (key: string, patch: { days?: number; pickedIds?: number[] }): void => {
  try { window.localStorage.setItem(key, JSON.stringify({ ...readDuplicateMemory(key), ...patch })) }
  catch { /* Không lưu được: chỉ mất phần nhớ lựa chọn cho lần sau. */ }
}
