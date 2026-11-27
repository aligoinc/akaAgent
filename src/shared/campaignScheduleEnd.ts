/**
 * "Ngày kết thúc" của lịch Theo tuần / Theo tháng (anh chốt 27/11/2026): luôn bắt buộc có, vì chiến dịch không thể lặp lại mãi; tới
 * ngày đó chiến dịch dừng hẳn. Hợp đồng dùng chung Web, iOS và Desktop: câu chữ, giá trị ô lúc mở form và kiểm tra lúc lưu.
 * Bản gốc: akaAgentWebApp packages/control-api/src/campaignScheduleEnd.ts. Desktop chép nguyên văn sang src/shared/campaignScheduleEnd.ts
 * (sửa ở WebApp trước rồi chép lại; bài kiểm so md5 hai bản).
 *
 * Việc dừng do DB làm (akaAgent V674, docs/CAMPAIGN_END_DATE_STOP_V674.md): qua auto_campaigns.schedule_end_date (cuối ngày theo giờ
 * Việt Nam), lượt cập nhật lịch ngày mới đóng data còn chờ ("Chưa gửi vì chiến dịch đã hết ngày kết thúc") rồi hoàn thành chiến dịch
 * ("Chiến dịch đã hết ngày kết thúc"). Module này chỉ lo phần form.
 * Chiến dịch chạy bằng Nhóm data có hạn riêng. Lịch Hàng ngày chỉ có ngày kết thúc của "Lặp lại sau khi chạy xong".
 */

/** Chiến dịch mới: ngày kết thúc đặt sẵn = hôm nay + số ngày này (như form trước đây). */
export const SCHEDULE_END_DEFAULT_DAYS = 7
/** Dòng dưới ô ngày kết thúc. */
export const SCHEDULE_END_HINT = 'Hết ngày này chiến dịch dừng hẳn. Data chưa gửi sẽ không gửi nữa.'
export const SCHEDULE_END_REQUIRED_ERROR = 'Vui lòng chọn ngày kết thúc.'
export const SCHEDULE_END_BEFORE_RUN_ERROR = 'Ngày kết thúc phải từ ngày chạy trở đi.'
export const SCHEDULE_END_PAST_ERROR = 'Ngày kết thúc đã qua. Vui lòng chọn ngày kết thúc mới.'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** yyyy-mm-dd là một ngày có thật trên lịch (loại 2026-02-30, 2026-13-01; năm 0001–9999). */
export function isScheduleEndDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const date = new Date(Date.UTC(2000, month - 1, day))
  date.setUTCFullYear(year)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** yyyy-mm-dd (UTC) của một mốc ms; ngoài năm 0001–9999 hoặc không đọc được thì chuỗi rỗng. */
function utcDateKey(time: number): string {
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const year = date.getUTCFullYear()
  if (!Number.isFinite(year) || year < 1 || year > 9999) return ''
  return `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** Ngày (yyyy-mm-dd) theo giờ Việt Nam của một mốc thời gian; không đọc được, không phải ngày có thật hoặc ngoài năm 0001–9999 thì chuỗi rỗng. */
export function scheduleEndDateKey(value: string | Date | null | undefined): string {
  if (typeof value === 'string') {
    if (DATE_KEY.test(value)) return isScheduleEndDateKey(value) ? value : ''
    if (!value.trim()) return ''
    // Giờ Việt Nam cố định UTC+7, không đổi giờ theo mùa.
    return utcDateKey(Date.parse(value) + 7 * 3_600_000)
  }
  if (value instanceof Date) return utcDateKey(value.getTime() + 7 * 3_600_000)
  return ''
}

/** Ngày kết thúc đặt sẵn của chiến dịch mới: `today` (yyyy-mm-dd, giờ Việt Nam) + SCHEDULE_END_DEFAULT_DAYS; không đọc được thì rỗng. */
export function defaultScheduleEndDate(today: string): string {
  if (!isScheduleEndDateKey(today)) return ''
  const [year, month, day] = today.split('-').map(Number)
  const date = new Date(Date.UTC(2000, month - 1, day))
  date.setUTCFullYear(year)
  return utcDateKey(date.getTime() + SCHEDULE_END_DEFAULT_DAYS * 86_400_000)
}

export interface ScheduleEndInitialOptions {
  /** Chiến dịch mới (kể cả form chưa có lịch tuần / tháng để giữ): đặt sẵn hôm nay + 7 ngày. */
  isNew: boolean
  /** Hôm nay theo giờ Việt Nam, yyyy-mm-dd. */
  today: string
}

/**
 * Giá trị ô ngày kết thúc lúc mở form (yyyy-mm-dd). Chiến dịch mới: hôm nay + 7 ngày. Chiến dịch đang sửa / bản nhân bản: ngày đã lưu
 * (`saved` là auto_campaigns.schedule_end_date hoặc yyyy-mm-dd); chưa có ngày thì ô trống và lúc lưu phải chọn.
 */
export function initialScheduleEndDate(saved: string | null | undefined, options: ScheduleEndInitialOptions): string {
  if (options.isNew) return defaultScheduleEndDate(options.today)
  return scheduleEndDateKey(saved)
}

export interface ScheduleEndCheckInput {
  /** Ngày kết thúc trên form, yyyy-mm-dd; rỗng khi chưa chọn. */
  date: string
  /** Ngày chạy trên form, yyyy-mm-dd (theo giờ Việt Nam). */
  runDate: string
  /** Hôm nay theo giờ Việt Nam, yyyy-mm-dd. */
  today: string
}

/** Lỗi của ô ngày kết thúc lúc lưu (lịch Theo tuần / Theo tháng); null khi hợp lệ. */
export function scheduleEndError(input: ScheduleEndCheckInput): string | null {
  if (!isScheduleEndDateKey(input.date)) return SCHEDULE_END_REQUIRED_ERROR
  if (isScheduleEndDateKey(input.runDate) && input.date < input.runDate) return SCHEDULE_END_BEFORE_RUN_ERROR
  if (isScheduleEndDateKey(input.today) && input.date < input.today) return SCHEDULE_END_PAST_ERROR
  return null
}
