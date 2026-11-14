/**
 * Chèn dòng auto_campaign_input_data có chọn trước chỉ số nội dung (content_rotation_indexes).
 *
 * aka_agent_desktop chỉ có quyền INSERT cột này từ V531. Desktop chạy trước khi V531 được apply thì PostgREST từ chối
 * cả lệnh chèn (42501 "permission denied"); khi đó chèn lại không có cột (hành vi cũ: RPC dùng con trỏ của chiến dịch)
 * và không thử cột này trong 10 phút, để thứ tự apply migration / phát hành app không làm hỏng việc thêm data.
 */

export interface ContentRotationInsertRow {
  content_rotation_indexes?: Record<string, number>
}

export interface ContentRotationInsertResponse<T> {
  data: T | null
  error: { code?: string; message: string } | null
}

export const CONTENT_ROTATION_INSERT_RETRY_MS = 10 * 60 * 1000
let contentRotationInsertDeniedAt: number | null = null

/** Chỉ giữ khoá action code hợp lệ với chỉ số nguyên không âm; không còn khoá nào thì trả null. */
export function normalizeContentRotationIndexes(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key, index]) => key.trim().length > 0 && key.length <= 128 &&
      typeof index === 'number' && Number.isSafeInteger(index) && index >= 0)
  return entries.length > 0 ? Object.fromEntries(entries) as Record<string, number> : null
}

function hasContentRotation(rows: ContentRotationInsertRow[]): boolean {
  return rows.some(row => row.content_rotation_indexes !== undefined)
}

function withoutContentRotation<R extends ContentRotationInsertRow>(rows: R[]): R[] {
  return rows.map(row => {
    if (row.content_rotation_indexes === undefined) return row
    const { content_rotation_indexes: _omitted, ...rest } = row
    return rest as R
  })
}

function prepareContentRotation<R extends ContentRotationInsertRow>(rows: R[], now: number): R[] {
  if (!hasContentRotation(rows)) return rows
  if (contentRotationInsertDeniedAt !== null && now - contentRotationInsertDeniedAt < CONTENT_ROTATION_INSERT_RETRY_MS) {
    return withoutContentRotation(rows)
  }
  // Một lệnh chèn nhiều dòng phải cùng tập cột; dòng không chọn trước nhận đúng giá trị mặc định của cột.
  return rows.map(row => row.content_rotation_indexes === undefined ? { ...row, content_rotation_indexes: {} } : row)
}

export async function insertWithContentRotationFallback<R extends ContentRotationInsertRow, T>(
  rows: R[],
  run: (rows: R[]) => PromiseLike<ContentRotationInsertResponse<T>>,
  now: () => number = Date.now
): Promise<ContentRotationInsertResponse<T>> {
  const prepared = prepareContentRotation(rows, now())
  const first = await run(prepared)
  // Chỉ lỗi thiếu quyền cột ("permission denied"); lỗi RLS cũng mang 42501 nhưng là "row-level security".
  if (first.error?.code === '42501' && /permission denied/i.test(first.error.message) && hasContentRotation(prepared)) {
    contentRotationInsertDeniedAt = now()
    console.warn('[campaignInputData] content_rotation_indexes chưa được cấp quyền INSERT (V531); chèn lại không có cột này.')
    return run(withoutContentRotation(prepared))
  }
  return first
}

/** Chỉ dùng trong bài kiểm. */
export function resetContentRotationInsertStateForTests(): void {
  contentRotationInsertDeniedAt = null
}
