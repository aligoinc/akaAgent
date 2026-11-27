/**
 * "Ngày kết thúc" của lịch Theo tuần / Theo tháng (anh chốt phương án A ngày 27/11/2026, bổ sung cùng ngày: lịch tuần / tháng luôn
 * phải có ngày kết thúc vì chiến dịch không thể lặp lại mãi). Hợp đồng dùng chung Web, iOS và Desktop: câu chữ, giá trị ô lúc mở form,
 * giá trị lưu và kiểm tra lúc lưu.
 * Bản gốc: akaAgentWebApp packages/control-api/src/campaignScheduleEnd.ts. Desktop chép nguyên văn sang src/shared/campaignScheduleEnd.ts
 * (sửa ở WebApp trước rồi chép lại; bài kiểm so md5 hai bản).
 *
 * Cột DB: auto_campaigns.schedule_end_date (cuối ngày theo giờ Việt Nam) và auto_campaigns.schedule_end_strict.
 * - schedule_end_strict = true: chiến dịch lưu từ form mới (form ghi rõ ngày này là ngày dừng). Hết ngày đó chiến dịch "hoàn thành" kèm ghi chú
 *   SCHEDULE_END_STOPPED_NOTE, kể cả khi còn data chờ (data chờ giữ nguyên). DB tự làm, mọi bản app.
 * - schedule_end_strict = false mà có ngày kết thúc: chiến dịch tạo trước đây (form cũ đặt sẵn ngày tạo + 7 ngày). Giữ cách chạy cũ:
 *   sau ngày đó không làm mới data, data còn chờ vẫn chạy nốt.
 * Chiến dịch chạy bằng Nhóm data có hạn riêng, không dùng module này. Lịch Hàng ngày chỉ có ngày kết thúc của "Lặp lại sau khi chạy xong".
 */

/** Chiến dịch mới: ngày kết thúc đặt sẵn = hôm nay + số ngày này (như form trước đây). */
export const SCHEDULE_END_DEFAULT_DAYS = 7
/** Dòng dưới ô ngày khi chiến dịch sẽ dừng đúng ngày. */
export const SCHEDULE_END_STRICT_HINT = 'Hết ngày này chiến dịch dừng, kể cả khi còn data chưa chạy.'
/** Dòng dưới ô ngày của chiến dịch tạo trước đây, khi khách chưa đổi ngày. */
export const SCHEDULE_END_LEGACY_HINT =
  'Chiến dịch tạo trước đây: sau ngày này chiến dịch không làm mới data, data còn chờ vẫn chạy nốt. Chọn lại ngày kết thúc để chiến dịch dừng đúng ngày.'
export const SCHEDULE_END_REQUIRED_ERROR = 'Vui lòng chọn ngày kết thúc.'
export const SCHEDULE_END_BEFORE_RUN_ERROR = 'Ngày kết thúc phải từ ngày chạy trở đi.'
export const SCHEDULE_END_PAST_ERROR = 'Ngày kết thúc đã qua. Vui lòng chọn ngày kết thúc mới.'
/** Ghi chú DB đặt cho chiến dịch khi dừng theo ngày kết thúc (đúng câu bước cập nhật lịch ngày mới đang dùng). */
export const SCHEDULE_END_STOPPED_NOTE = 'Chiến dịch đã hết ngày kết thúc'
/** Nhãn ở danh sách / chi tiết: chiến dịch tạo trước đây đã qua ngày kết thúc mà vẫn đang chạy nốt data. */
export const SCHEDULE_END_LEGACY_RUNNING_LABEL = 'Đã qua ngày kết thúc, đang chạy nốt data còn chờ'
/** Dòng ở chi tiết chiến dịch. */
export const SCHEDULE_END_DETAIL_STRICT = 'dừng đúng ngày'
export const SCHEDULE_END_DETAIL_LEGACY = 'sau ngày này chạy nốt data còn chờ'

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Ngày (yyyy-mm-dd) theo giờ Việt Nam của một mốc thời gian; không đọc được thì chuỗi rỗng. */
export function scheduleEndDateKey(value: string | Date | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string' && DATE_KEY.test(value)) return value
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(time)) return ''
  // Giờ Việt Nam cố định UTC+7, không đổi giờ theo mùa.
  return new Date(time + 7 * 3_600_000).toISOString().slice(0, 10)
}

/** Ngày kết thúc đặt sẵn của chiến dịch mới: `today` (yyyy-mm-dd, giờ Việt Nam) + SCHEDULE_END_DEFAULT_DAYS; không đọc được thì rỗng. */
export function defaultScheduleEndDate(today: string): string {
  if (!DATE_KEY.test(today)) return ''
  const time = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(time)) return ''
  return new Date(time + SCHEDULE_END_DEFAULT_DAYS * 86_400_000).toISOString().slice(0, 10)
}

export interface ScheduleEndSaved {
  /** auto_campaigns.schedule_end_date (ISO) hoặc ngày yyyy-mm-dd. */
  scheduleEndDate?: string | null
  /** auto_campaigns.schedule_end_strict. */
  scheduleEndStrict?: boolean | null
}

export interface ScheduleEndFormState {
  /** Ngày kết thúc yyyy-mm-dd, rỗng khi chưa chọn (lúc lưu báo lỗi: lịch tuần / tháng bắt buộc có ngày kết thúc). */
  date: string
  /**
   * Ngày kết thúc kiểu cũ (không dừng cứng) của chiến dịch đang sửa, yyyy-mm-dd. Rỗng với chiến dịch mới, bản nhân bản, chiến dịch đã dừng
   * đúng ngày và chiến dịch chưa có ngày kết thúc. Chừng nào khách chưa đổi ngày khỏi giá trị này thì chiến dịch giữ cách chạy cũ.
   */
  legacyDate: string
}

/**
 * Giá trị ô lúc mở form. `saved` là chiến dịch đang sửa; chiến dịch mới truyền null và `today` (yyyy-mm-dd, giờ Việt Nam) để đặt sẵn
 * hôm nay + 7 ngày. Chiến dịch đang sửa mà chưa có ngày kết thúc thì ô trống, lúc lưu phải chọn. Bản nhân bản truyền `clone: true`:
 * giữ ngày của chiến dịch nguồn nhưng là chiến dịch mới, nên lưu là dừng đúng ngày.
 */
export function initialScheduleEnd(
  saved?: ScheduleEndSaved | null,
  options: { clone?: boolean; today?: string } = {}
): ScheduleEndFormState {
  if (!saved) return { date: defaultScheduleEndDate(options.today ?? ''), legacyDate: '' }
  const date = scheduleEndDateKey(saved.scheduleEndDate)
  if (!date) return { date: '', legacyDate: '' }
  const legacy = options.clone !== true && saved.scheduleEndStrict !== true
  return { date, legacyDate: legacy ? date : '' }
}

/** Chiến dịch tạo trước đây và khách chưa đổi ngày kết thúc: giữ cách chạy cũ. */
export function isLegacyScheduleEnd(state: ScheduleEndFormState): boolean {
  return state.legacyDate !== '' && state.date === state.legacyDate
}

/** Dòng giải thích dưới ô theo giá trị hiện tại. */
export function scheduleEndHint(state: ScheduleEndFormState): string {
  return isLegacyScheduleEnd(state) ? SCHEDULE_END_LEGACY_HINT : SCHEDULE_END_STRICT_HINT
}

export interface ScheduleEndCheckInput {
  state: ScheduleEndFormState
  /** Ngày chạy trên form, yyyy-mm-dd (theo giờ Việt Nam). */
  runDate: string
  /** Hôm nay theo giờ Việt Nam, yyyy-mm-dd. */
  today: string
}

/** Lỗi của ô ngày kết thúc lúc lưu (lịch Theo tuần / Theo tháng); null khi hợp lệ. */
export function scheduleEndError(input: ScheduleEndCheckInput): string | null {
  const { state } = input
  if (!DATE_KEY.test(state.date)) return SCHEDULE_END_REQUIRED_ERROR
  if (DATE_KEY.test(input.runDate) && state.date < input.runDate) return SCHEDULE_END_BEFORE_RUN_ERROR
  if (DATE_KEY.test(input.today) && state.date < input.today) return SCHEDULE_END_PAST_ERROR
  return null
}

export interface ScheduleEndForSave {
  /** Ngày kết thúc yyyy-mm-dd; null chỉ khi ô chưa hợp lệ (scheduleEndError chưa trả null). Nơi lưu đổi thành cuối ngày theo giờ Việt Nam (T23:59:59+07:00). */
  date: string | null
  /** Giá trị cột schedule_end_strict. */
  strict: boolean
}

/** Giá trị lưu của lịch Theo tuần / Theo tháng. Gọi sau khi scheduleEndError trả null. */
export function scheduleEndForSave(state: ScheduleEndFormState): ScheduleEndForSave {
  if (!DATE_KEY.test(state.date)) return { date: null, strict: false }
  return { date: state.date, strict: !isLegacyScheduleEnd(state) }
}

export interface ScheduleEndCampaign extends ScheduleEndSaved {
  status?: string | null
  scheduleType?: string | null
  dataTargetSourceMode?: string | null
}

/**
 * Chiến dịch tạo trước đây đã qua ngày kết thúc mà vẫn chạy nốt data (nhãn SCHEDULE_END_LEGACY_RUNNING_LABEL). Chiến dịch dừng đúng
 * ngày thì DB đã đóng nên không cần nhãn; chiến dịch Nhóm data có hạn riêng.
 */
export function isRunningPastLegacyScheduleEnd(campaign: ScheduleEndCampaign, now: Date | number = Date.now()): boolean {
  if (!campaign.scheduleEndDate || campaign.scheduleEndStrict === true) return false
  if (campaign.dataTargetSourceMode === 'data_group') return false
  if (campaign.scheduleType !== 'weekly' && campaign.scheduleType !== 'monthly') return false
  if (campaign.status !== 'chờ xử lý' && campaign.status !== 'đang chạy') return false
  const end = Date.parse(campaign.scheduleEndDate)
  const current = typeof now === 'number' ? now : now.getTime()
  return Number.isFinite(end) && end <= current
}

/** Phần ghi thêm sau ngày kết thúc ở chi tiết chiến dịch: "dừng đúng ngày" hoặc "sau ngày này chạy nốt data còn chờ". */
export function scheduleEndDetailSuffix(campaign: ScheduleEndSaved): string {
  if (!campaign.scheduleEndDate) return ''
  return campaign.scheduleEndStrict === true ? SCHEDULE_END_DETAIL_STRICT : SCHEDULE_END_DETAIL_LEGACY
}
