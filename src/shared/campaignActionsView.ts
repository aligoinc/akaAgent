/**
 * Câu chữ và phép tính hiển thị dùng chung cho cột "Giới hạn lượt" của danh sách chiến dịch và tab/mục "Hành động"
 * (Web, iOS; Desktop chép nguyên văn sang akaAgent `src/shared/campaignActionsView.ts`, sửa ở đây trước). Chỉ là hàm
 * thuần trên số liệu đã đọc: dòng ghi chú dưới mỗi hành động, giờ chạy lại của một hành động, dòng đầu "Chạy tiếp sớm
 * nhất …" của cả chiến dịch, ước tính số ngày gửi còn lại và các chiến dịch khác dùng chung lượt.
 *
 * Kiểu dữ liệu ở đây là kiểu tối thiểu (dòng của Web và của Desktop đều khớp), không phụ thuộc hợp đồng riêng của
 * từng nền tảng.
 */
import {
  campaignLimitResume, formatCampaignLimitTime,
  type CampaignLimitAction, type CampaignLimitActionView, type CampaignLimitProgressItem, type CampaignLimitState,
} from './campaignLimitProgress'

/** Một hành động của tab "Hành động" (các trường mà hàm hiển thị cần). */
export interface CampaignActionViewRow {
  code: string
  name: string
  limited: boolean
  disabled: boolean
  enableAt: string | null
  disabledReason: string | null
  dayUsed: number | null
  dayLimit: number | null
  windowUsed: number | null
  windowLimit: number | null
  windowMinutes: number | null
  windowTimes?: string[]
  windowAtLeast?: boolean
  sharedCampaigns?: number
  today?: { campaigns: ReadonlyArray<{ campaignId: number | null; name: string | null; current: boolean; counted: number }> } | null
}

/** Phần thông tin quản trị mà dòng đầu cần. */
export interface CampaignActionViewManagement {
  schedule: string | null
  resumeKnown: boolean
  skippableCodes: string[]
  blockingCodes: string[]
}

/** Số liệu sống của danh sách (cùng bộ tính): mới hơn lượt đọc của tab thì ghi đè số đếm của tab. */
export interface CampaignActionsLiveItem {
  item: CampaignLimitProgressItem
  checkedAtMs: number
}

export const CAMPAIGN_ACTIONS_SCHEDULE_TYPE_LABELS: Readonly<Record<string, string>> = {
  daily: 'hằng ngày', weekly: 'hằng tuần', monthly: 'hằng tháng', once: '1 lần',
}

/** Giờ chạy lại làm tròn lên phút: lượt rời khung lúc 10:41:30 thì chạy lại từ 10:42. */
export const campaignLimitMinuteCeil = (ms: number): number => Math.ceil(ms / 60_000) * 60_000

/** Dòng của tab dưới dạng số liệu của cột "Giới hạn lượt", để dùng chung các hàm tính theo đồng hồ. */
export function campaignActionViewLimit(row: CampaignActionViewRow): CampaignLimitAction {
  return {
    code: row.code, name: row.name, limited: row.limited,
    dayUsed: row.dayUsed, dayLimit: row.limited ? row.dayLimit : null,
    windowLimit: row.limited ? row.windowLimit : null, windowMinutes: row.windowMinutes,
    windowUsed: row.windowUsed ?? 0, windowTimes: row.windowTimes ?? [], windowAtLeast: row.windowAtLeast === true,
    locked: row.disabled, lockedUntil: row.enableAt, lockReason: row.disabledReason,
    sharedCampaigns: row.sharedCampaigns ?? 0,
  }
}

export type CampaignLimitNoteTone = 'lock' | 'wait' | 'done'

/** Dòng giải thích dưới một hành động của danh sách (null khi đang chạy bình thường). */
export function campaignLimitActionNote(view: CampaignLimitActionView, now: number): { tone: CampaignLimitNoteTone; text: string } | null {
  if (view.state === 'locked') {
    return { tone: 'lock', text: view.resumeAt !== null ? `Tạm khóa · mở lại ${formatCampaignLimitTime(campaignLimitMinuteCeil(view.resumeAt), now)}` : 'Tạm khóa · chưa có giờ mở lại' }
  }
  if (view.state === 'day') return { tone: 'done', text: view.resumeAt !== null ? `Đủ lượt hôm nay · lượt mới từ ${formatCampaignLimitTime(view.resumeAt, now)}` : 'Đủ lượt hôm nay' }
  if (view.state === 'window') {
    return { tone: 'wait', text: view.resumeAt !== null ? `Nghỉ theo giờ · chạy tiếp khoảng ${formatCampaignLimitTime(campaignLimitMinuteCeil(view.resumeAt), now)}` : 'Nghỉ theo giờ' }
  }
  return null
}

/**
 * Số trong giờ đáng hiện trên danh sách: ẩn khi đủ lượt ngày/bị khóa (không còn ý nghĩa), khi khung trống, khi chiến
 * dịch tạm dừng, hoặc khi giới hạn giờ không thấp hơn giới hạn ngày mà chưa đầy.
 */
export function campaignLimitWindowVisible(action: CampaignLimitAction, view: CampaignLimitActionView, muted = false): boolean {
  return action.limited && action.windowLimit !== null && view.state !== 'day' && view.state !== 'locked'
    && view.windowUsed > 0 && (view.windowFull || !view.windowMoot) && !muted
}

/** Số đã chạy hôm nay tại `now` (qua 00:00 coi như 0 cho tới lượt đọc kế tiếp). */
export const campaignLimitDayUsed = (action: Pick<CampaignLimitAction, 'dayUsed'>, view: CampaignLimitActionView, now: number, nextDayStartsAt: number): number | null =>
  view.state !== 'day' && now >= nextDayStartsAt ? 0 : action.dayUsed

/** Dòng "khi nào chạy lại" của một hành động trong tab "Hành động". */
export function campaignActionResumeLine(view: CampaignLimitActionView, now: number): string | null {
  if (view.state === 'locked') return view.resumeAt !== null ? `Mở lại ${formatCampaignLimitTime(campaignLimitMinuteCeil(view.resumeAt), now)}` : 'Chưa có giờ mở lại'
  if (view.state === 'day') return view.resumeAt !== null ? `Lượt mới từ ${formatCampaignLimitTime(view.resumeAt, now)}` : null
  if (view.state === 'window') return view.resumeAt !== null ? `Chạy tiếp khoảng ${formatCampaignLimitTime(campaignLimitMinuteCeil(view.resumeAt), now)}` : null
  return null
}

/** Nhãn trạng thái ngắn của một hành động. */
export const CAMPAIGN_LIMIT_STATE_LABELS: Readonly<Record<CampaignLimitState, string>> = {
  ok: 'Bình thường', window: 'Nghỉ theo giờ', day: 'Đủ lượt hôm nay', locked: 'Bị giới hạn',
}

/** Ghi đè số đếm của tab bằng số liệu sống của danh sách khi danh sách đọc sau tab. */
export function campaignActionRowWithLive<T extends CampaignActionViewRow>(row: T, live: CampaignActionsLiveItem | null | undefined, checkedAtMs: number): T {
  const action = live && live.checkedAtMs > checkedAtMs ? live.item.actions.find(item => item.code === row.code) : null
  if (!action) return row
  return {
    ...row, dayUsed: action.dayUsed, windowUsed: row.limited ? action.windowUsed : row.windowUsed, windowTimes: action.windowTimes,
    windowAtLeast: action.windowAtLeast, disabled: action.locked, enableAt: action.lockedUntil,
    disabledReason: action.locked ? action.lockReason ?? row.disabledReason : null,
  }
}

export type CampaignActionsBannerTone = 'ok' | 'wait' | 'lock' | 'idle'
export interface CampaignActionsBanner { tone: CampaignActionsBannerTone; title: string; detail: string }

/**
 * Dòng đầu tab "Hành động": chiến dịch đang chạy, hay sớm nhất khi nào chạy lại theo giới hạn lượt và lịch đã lưu.
 * null khi chưa có thông tin quản trị (DB chưa có hàm đọc mới).
 */
export function campaignActionsBanner(input: {
  campaignId: number
  accountId: number
  management: CampaignActionViewManagement | null | undefined
  rows: readonly CampaignActionViewRow[]
  status: string
  note?: string | null
  now: number
  nextDayStartsAt: number
}): CampaignActionsBanner | null {
  const { management, rows, status, now } = input
  if (!management) return null
  if (status === 'hoàn thành') return { tone: 'idle', title: 'Chiến dịch đã hoàn thành', detail: 'Số bên dưới là lượt của tài khoản trong hôm nay.' }
  const blocking = new Set(management.blockingCodes)
  const resume = campaignLimitResume({
    campaignId: input.campaignId, accountId: input.accountId, resumeKnown: management.resumeKnown, skippableCodes: management.skippableCodes,
    actions: rows.filter(row => blocking.has(row.code)).map(campaignActionViewLimit),
  }, now, input.nextDayStartsAt)
  const blocker = resume.blocked ? rows.find(row => row.code === resume.actionCode) : null
  const limitDetail = blocker
    ? resume.state === 'locked' ? `${blocker.name} đang bị khóa${blocker.disabledReason ? `: ${blocker.disabledReason.replace(/[\s.]+$/, '')}.` : '.'}`
      : resume.state === 'day' ? `Đã đủ lượt ${blocker.name} hôm nay. Chiến dịch chạy lại theo lịch gửi sau khi có lượt mới.`
        : `Đang chờ lượt ${blocker.name} trong giờ.`
    : ''
  const resumeText = resume.resumeAt !== null
    ? `${resume.state === 'day' ? 'từ' : 'khoảng'} ${formatCampaignLimitTime(resume.state === 'day' ? resume.resumeAt : campaignLimitMinuteCeil(resume.resumeAt), now)}` : ''
  if (status === 'tạm dừng') return {
    tone: 'idle', title: 'Chiến dịch đang tạm dừng',
    detail: resume.blocked ? `${limitDetail} Bấm Tiếp tục thì sớm nhất ${resumeText || 'chưa có giờ'} mới chạy lại.` : 'Giới hạn lượt còn chỗ: bấm Tiếp tục để chạy.',
  }
  if (status === 'đang chạy' && !resume.blocked) return { tone: 'ok', title: 'Chiến dịch đang chạy', detail: 'Giới hạn lượt chưa chặn hành động nào.' }
  if (resume.blocked) return {
    tone: resume.state === 'locked' ? 'lock' : 'wait',
    title: resumeText ? `Chạy tiếp sớm nhất ${resumeText}` : 'Chưa có giờ chạy lại',
    detail: `${limitDetail}${management.skippableCodes.length ? ' Chiến dịch cài tiếp tục hành động khác, nhưng các hành động đó cũng đang bị chặn.' : ''}`,
  }
  if (!management.resumeKnown) {
    return { tone: 'idle', title: 'Xem trạng thái từng hành động bên dưới', detail: 'Chiến dịch Facebook chạy trên app Desktop: chưa xác định được hành động nào làm chiến dịch đứng.' }
  }
  const scheduleMs = management.schedule ? Date.parse(management.schedule) : Number.NaN
  if (Number.isFinite(scheduleMs) && scheduleMs > now) {
    return { tone: 'idle', title: `Theo lịch, chạy lúc ${formatCampaignLimitTime(scheduleMs, now)}`, detail: 'Giới hạn lượt không chặn chiến dịch.' }
  }
  return {
    tone: 'ok', title: 'Giới hạn lượt không chặn chiến dịch',
    detail: input.note?.trim() || 'Nếu chiến dịch chưa chạy, nguyên nhân nằm ở chỗ khác: xem ghi chú trên danh sách hoặc bấm "Tại sao CD không chạy?".',
  }
}

export interface CampaignActionsEstimate<T extends CampaignActionViewRow> {
  /** Hành động quyết định số ngày gửi (giới hạn ngày thấp nhất trong các hành động làm chiến dịch đứng khi hết lượt). */
  bottleneck: T
  dayLimit: number
  /** Số lượt tối đa còn chạy được hôm nay, theo `todayLimitedBy`. */
  remainingToday: number
  /** Hành động quyết định `remainingToday` (có thể khác `bottleneck` khi nó đã chạy nhiều hơn hôm nay). */
  todayLimitedBy: T
  sendDays: number
  /** 00:00 ngày gửi cuối (chỉ lịch hằng ngày); null khi không ước được. */
  finishAt: number | null
}

/**
 * Ước tính ngày xong theo giới hạn ngày. Hành động trong `skippableCodes` (chiến dịch cài "tiếp tục hành động khác")
 * hết lượt thì chiến dịch vẫn chạy nên không giới hạn số data mỗi ngày; nếu mọi hành động đều được bỏ qua thì
 * chiến dịch còn chạy tới khi hành động nhiều lượt nhất hết lượt.
 */
export function campaignActionsEstimate<T extends CampaignActionViewRow>(
  rows: readonly T[], pending: number | null, now: number, nextDayStartsAt: number, daily: boolean,
  skippableCodes: readonly string[] = [],
): CampaignActionsEstimate<T> | null {
  const limited = rows.filter(row => row.limited && row.dayLimit !== null && row.code !== 'zalo_find_phone_user')
  if (!limited.length || pending === null) return null
  const left = (row: T) => Math.max(0, (row.dayLimit as number) - (now >= nextDayStartsAt ? 0 : row.dayUsed ?? 0))
  const skippable = new Set(skippableCodes)
  const required = limited.filter(row => !skippable.has(row.code))
  const pool = required.length ? required : limited
  // Bắt buộc: hành động giới hạn ngày thấp nhất quyết định (bằng nhau thì lấy hành động còn ít lượt hơn);
  // tất cả được bỏ qua: hành động giới hạn cao nhất quyết định.
  const sign = required.length ? 1 : -1
  const bottleneck = pool.reduce((best, row) => sign * ((row.dayLimit as number) - (best.dayLimit as number)) < 0
    || (row.dayLimit === best.dayLimit && sign * (left(row) - left(best)) < 0) ? row : best)
  const todayLimitedBy = pool.reduce((best, row) => sign * (left(row) - left(best)) < 0 ? row : best, bottleneck)
  const dayLimit = bottleneck.dayLimit as number
  const remainingToday = left(todayLimitedBy)
  const after = Math.max(0, pending - remainingToday)
  const moreDays = Math.ceil(after / Math.max(1, dayLimit))
  const finishAt = daily && pending > 0 ? (after > 0 ? nextDayStartsAt + (moreDays - 1) * 86_400_000 : now) : null
  return { bottleneck, dayLimit, remainingToday, todayLimitedBy, sendDays: moreDays + (pending > 0 && remainingToday > 0 ? 1 : 0), finishAt }
}

/** Ngày dd/MM theo giờ Việt Nam; cùng ngày với `now` thì ghi "hôm nay". */
export function campaignActionsDayLabel(ms: number, now: number): string {
  const day = (value: number) => {
    const date = new Date(value + 7 * 3600_000)
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  }
  return day(ms) === day(now) ? 'hôm nay' : day(ms)
}

/** Chiến dịch khác của tài khoản đã dùng lượt tính giới hạn hôm nay (cộng qua mọi hành động). */
export function campaignActionsOtherCampaigns(rows: readonly CampaignActionViewRow[]): Array<{ name: string | null; counted: number }> {
  const others = new Map<string, { name: string | null; counted: number }>()
  for (const row of rows) for (const item of row.today?.campaigns ?? []) if (!item.current && item.counted > 0) {
    const entry = others.get(String(item.campaignId)) ?? { name: item.name, counted: 0 }
    entry.counted += item.counted
    others.set(String(item.campaignId), entry)
  }
  return Array.from(others.values())
}

/** Câu "Chiến dịch khác" của khối Tài khoản. */
export function campaignActionsOtherCampaignsText(rows: readonly CampaignActionViewRow[]): string {
  const others = campaignActionsOtherCampaigns(rows)
  if (others.length) return `Hôm nay dùng chung lượt với ${others.map(item => `${item.name ? `“${item.name}”` : 'chiến dịch khác'} (${item.counted})`).join(', ')}`
  return rows.some(row => (row.sharedCampaigns ?? 0) > 0)
    ? 'Có chiến dịch khác cùng hành động chạy hôm nay, chưa dùng lượt nào'
    : 'Không có chiến dịch khác dùng chung lượt hôm nay'
}

/** Mốc (ms) cần cho đồng hồ của màn hình: có số phụ thuộc thời gian thì mới cần đếm. */
export function campaignLimitClockNeeded(items: Iterable<CampaignLimitProgressItem>): boolean {
  for (const item of Array.from(items)) for (const action of item.actions) {
    if (action.windowTimes.length > 0 || action.windowUsed > 0 || (action.locked && action.lockedUntil !== null) || (action.dayUsed ?? 0) > 0) return true
  }
  return false
}

