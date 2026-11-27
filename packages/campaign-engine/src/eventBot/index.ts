/**
 * Bot sự kiện (docs/EVENT_BOT_TECH.md mục 8): phần gửi dùng chung cho Desktop, App Server và (đợt 2) Fly.
 *
 * Việc đã được DB nhận và đánh dấu "đang gửi" (aka_agent_event_bot_claim_v1) trước khi tới đây, nên lời gọi gửi là bước giao tin duy
 * nhất của việc. Ở đây chỉ: dựng nội dung từ mẫu (biến #{FULL_NAME}, #{SEX{…}}, ngày, spin {a|b} và nhiều mẫu ngăn bằng `|` như chiến
 * dịch), gửi một tin văn bản tới UID qua cổng nhỏ của nơi chạy, rồi xếp kết quả thành `p_result` của aka_agent_event_bot_report_v1.
 *
 * Không đụng gì của hệ chiến dịch: không ghi auto_campaign_details, không đọc / cộng hạn mức, không lấy lease, không ghi khoá thao tác.
 *
 * Xếp kết quả:
 * - Zalo trả msgId → sent; Zalo trả thành công không msgId → sent với msgId null (DB ghi failed `no_msg_id` và tự tạm dừng 30 phút);
 * - lỗi chắc chắn trước khi gọi Zalo (cổng báo `notSent`, nội dung rỗng, lỗi mở kết nối, HTTP 429) → failed;
 * - Zalo từ chối (mã Zalo hoặc câu trả lời của Zalo) → failed kèm zaloCode khi có mã;
 * - còn lại (đứt mạng sau khi yêu cầu đi, hết giờ chờ, HTTP 5xx, phản hồi không đọc được) → unknown: không gửi lại.
 */
import { DeadlineError, errorMessage, withDeadline } from '../boundary.js'
import { renderCampaignTemplateText } from '../content/campaignContentTemplate.js'
import { renderContentSpin, renderContentSpinNonEmpty, splitContentVariants } from '../content/contentSpin.js'
import { classifyZaloError, firstNormalizedVietnamMobilePhone, templateUsesDatabaseDate, type ZaloResolvedTarget } from '../zalo/common.js'
import { friendProfile } from '../zalo/materialize.js'

/** Kết quả báo về DB (giống EventBotSendResult của src/shared/eventBot.ts). */
export type EventBotSendOutcome =
  | { status: 'sent'; msgId: string | null }
  | { status: 'failed'; zaloCode: string | null; errorMessage: string }
  | { status: 'unknown'; errorMessage: string }

/** Phần việc lõi cần (giống EventBotClaimedJob của src/shared/eventBot.ts). */
export interface EventBotSendJob {
  jobId: number
  accountId: number
  recipientUid: string
  recipientName: string | null
  message: string
}

export interface EventBotRecipientProfile {
  displayName?: string | null
  originalName?: string | null
  gender?: number | string | null
}

/** Cổng của nơi chạy. Mọi lỗi ném ra nguyên vẹn; lõi tự xếp loại. */
export interface EventBotSendPort {
  /** Gửi một tin văn bản 1-1. msgId null khi Zalo trả thành công mà không có mã tin. */
  sendText(accountId: number, uid: string, text: string): Promise<{ msgId: string | null }>
  /** Đọc hồ sơ người nhận (chỉ khi mẫu cần giới tính / tên gốc, hoặc thiếu tên). Lỗi bị bỏ qua. */
  getProfile?(accountId: number, uid: string): Promise<EventBotRecipientProfile | null>
  /**
   * Nơi chạy biết thêm về lỗi: `answered` = lỗi do Zalo trả về (ZaloApiError của zca-js), `notSent` = lỗi ở bước chuẩn bị trước khi gọi
   * Zalo (đọc tài khoản / phiên, đăng nhập lại bằng phiên). Thiếu thì coi như không biết.
   */
  errorHints?(error: unknown): { answered?: boolean; notSent?: boolean }
  /** Giờ nghiệp vụ (giờ DB) cho biến #{TODAY(…)}; thiếu thì dùng giờ máy. */
  businessNow?(): Promise<Date>
}

export interface EventBotSendOptions {
  /** Hạn chờ cả lời gọi gửi (mặc định 120 giây). Hết hạn là unknown. */
  sendTimeoutMs?: number
  /** Hạn chờ đọc hồ sơ (mặc định 15 giây). */
  profileTimeoutMs?: number
  random?: () => number
}

const ERROR_MESSAGE_MAX = 300

function clip(text: string): string {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return (value || 'Gửi không thành công').slice(0, ERROR_MESSAGE_MAX)
}

/** Mẫu cần hồ sơ: giới tính, tên gốc, hoặc #{FULL_NAME} mà DB không có tên. */
export function eventBotTemplateNeedsProfile(template: string, recipientName: string | null | undefined): boolean {
  const text = String(template ?? '')
  if (/#\{SEX\{/.test(text) || /#\{ORIGINAL_NAME\}/.test(text)) return true
  return /#\{FULL_NAME\}/.test(text) && !String(recipientName ?? '').trim()
}

/**
 * Dựng câu gửi từ mẫu: nhiều mẫu ngăn bằng `|` ở mức ngoài cùng thì chọn ngẫu nhiên một mẫu (như chiến dịch), rồi spin và thay biến.
 * Biến cột file (#{INPUT_…}, #{UID}, #{PHONE}…) không có nguồn nên ra rỗng; trang Web đã chặn #{INPUT_…} lúc lưu.
 */
export function renderEventBotMessage(template: string, recipient: { name: string | null; profile?: EventBotRecipientProfile | null },
  businessNow: Date | undefined, random: () => number = Math.random): string {
  const variants = splitContentVariants(String(template ?? ''), { trim: false }).filter(item => item.trim())
  const picked = variants.length === 0 ? '' : variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))] ?? ''
  const profile = recipient.profile ?? null
  const displayName = String(recipient.name ?? '').trim() || String(profile?.displayName ?? '').trim() || String(profile?.originalName ?? '').trim()
  const target: ZaloResolvedTarget = {
    uid: '',
    phone: '',
    displayName,
    originalName: String(profile?.originalName ?? '').trim() || displayName,
    gender: profile?.gender ?? null
  }
  // Như renderZaloTemplateText (nội dung không định dạng), nhận nguồn ngẫu nhiên để bài kiểm lặp lại được.
  const render = (raw: string, spin: (text: string) => string): string => renderCampaignTemplateText(raw, {}, target, businessNow, {
    spin, phone: (...values) => firstNormalizedVietnamMobilePhone(...values)
  })
  let text = render(picked, raw => renderContentSpin(raw, { rng: random }))
  // Spin chọn trúng nhánh rỗng mà mẫu vẫn có chữ: chọn nhánh có chữ như chiến dịch không kèm tệp.
  if (!text.trim() && picked.trim()) text = render(picked, raw => renderContentSpinNonEmpty(raw))
  return text.trim()
}

/** Lỗi gửi → kết quả báo DB. */
export function classifyEventBotSendError(error: unknown, hints: { answered?: boolean; notSent?: boolean } = {}): EventBotSendOutcome {
  if (error instanceof DeadlineError) return { status: 'unknown', errorMessage: clip('Gửi tin Zalo quá thời gian chờ, không rõ người nhận đã nhận chưa') }
  if (hints.notSent) return { status: 'failed', zaloCode: null, errorMessage: clip(errorMessage(error)) }
  const classified = classifyZaloError(error, 'send', hints.answered === true, false)
  const signal = classified.signal
  const message = clip(String(signal.message ?? errorMessage(error)))
  if (classified.phase === 'in_flight' || classified.deliveryUnknown) return { status: 'unknown', errorMessage: message }
  const zaloCode = signal.kind === 'zalo_code' && signal.code != null ? String(signal.code) : null
  return { status: 'failed', zaloCode, errorMessage: message }
}

/**
 * Gửi một việc đã nhận. Không bao giờ ném lỗi: mọi lỗi thành kết quả. Không huỷ được giữa chừng (lệnh Zalo đã đi thì phải chờ kết quả
 * để báo DB); nơi chạy dừng thì chờ việc đang gửi xong rồi mới thôi.
 */
export async function sendEventBotJob(job: EventBotSendJob, port: EventBotSendPort, options: EventBotSendOptions = {}):
  Promise<{ outcome: EventBotSendOutcome; text: string | null }> {
  const random = options.random ?? Math.random
  const uid = String(job.recipientUid ?? '').trim()
  if (!uid || /^g/i.test(uid)) {
    return { outcome: { status: 'failed', zaloCode: null, errorMessage: 'Bot chỉ gửi cho cá nhân có Zalo ID' }, text: null }
  }
  let text: string
  try {
    let profile: EventBotRecipientProfile | null = null
    if (port.getProfile && eventBotTemplateNeedsProfile(job.message, job.recipientName)) {
      const getProfile = port.getProfile.bind(port)
      try {
        profile = await withDeadline('event_bot_profile', options.profileTimeoutMs ?? 15_000, undefined, () => getProfile(job.accountId, uid))
      } catch {
        // Hồ sơ chỉ để điền biến: đọc lỗi thì dùng tên DB đưa, không dừng việc gửi.
        profile = null
      }
    }
    let businessNow: Date | undefined
    if (templateUsesDatabaseDate(job.message)) businessNow = port.businessNow ? await port.businessNow() : new Date()
    text = renderEventBotMessage(job.message, { name: job.recipientName, profile }, businessNow, random)
  } catch (error) {
    return { outcome: { status: 'failed', zaloCode: null, errorMessage: clip(`Không dựng được nội dung tin: ${errorMessage(error)}`) }, text: null }
  }
  if (!text) return { outcome: { status: 'failed', zaloCode: null, errorMessage: 'Nội dung tin rỗng sau khi dựng mẫu' }, text: null }

  // DB đã đánh dấu việc "đang gửi" lúc giao (claim), nên đây là bước giao tin của việc.
  const step = {
    key: 'event_bot_send',
    delivery: true,
    run: (): Promise<{ msgId: string | null }> => port.sendText(job.accountId, uid, text)
  }
  try {
    const sent = await withDeadline('event_bot_send', options.sendTimeoutMs ?? 120_000, undefined, () => step.run())
    const msgId = sent && typeof sent.msgId === 'string' && sent.msgId.trim() ? sent.msgId.trim() : null
    return { outcome: { status: 'sent', msgId }, text }
  } catch (error) {
    let hints: { answered?: boolean; notSent?: boolean } = {}
    try { hints = port.errorHints?.(error) ?? {} } catch { hints = {} }
    return { outcome: classifyEventBotSendError(error, hints), text }
  }
}

/** Ngày VN dạng YYYY-MM-DD → "DD/MM" để so với sdob của Zalo (như chiến dịch sinh nhật). */
export function eventBotBirthdayKey(vnDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(vnDate ?? '').trim())
  return match ? `${match[3]}/${match[2]}` : null
}

/**
 * Lọc bạn bè có sinh nhật hôm nay từ một trang danh sách bạn bè Zalo (getAllFriends), dùng đúng cách đọc hồ sơ và so sdob của chiến dịch
 * sinh nhật (materialize.ts). `seen` giữ UID đã lấy qua các trang.
 */
export function eventBotBirthdayPeople(rows: unknown, vnDate: string, seen: Set<string> = new Set()): Array<{ uid: string; name: string }> {
  const ddmm = eventBotBirthdayKey(vnDate)
  if (!ddmm || !Array.isArray(rows)) return []
  const out: Array<{ uid: string; name: string }> = []
  for (const row of rows) {
    const profile = friendProfile(row && typeof row === 'object' ? row as Record<string, unknown> : {})
    if (!profile) continue
    const key = String(profile.uid).trim().replace(/\/+$/g, '').toLowerCase()
    if (!key || seen.has(key)) continue
    if (!(profile.sdob.length >= 5 && profile.sdob.slice(0, 5) === ddmm)) continue
    seen.add(key)
    out.push({ uid: profile.uid, name: profile.name })
  }
  return out
}
