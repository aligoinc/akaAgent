/**
 * Dòng tiến trình cho khách, theo đúng câu của bộ chạy Desktop/VPS (campaignScheduler.ts), cộng mã ngắn ở cuối
 * câu lỗi. Câu kết quả do DB dựng (log của kết quả); ở đây chỉ ghép tên thao tác như formatZaloProgressLog và
 * chọn mức độ. Không lộ ID, stacktrace hay tên kỹ thuật.
 */
import type { GateDecision, OutcomeDecision, ProgressLevel, ProgressLine, RuntimeTarget } from './contracts.js'
import type { ConfigIssue } from './validation.js'

/** Mã của cổng từ chối nhận tin: Desktop in "🚫 Bỏ qua ..." thay cho dòng của thao tác. */
export const OPT_OUT_ERROR_CODE = 'err_engine_recipient_opted_out'
/**
 * Mã của cổng chặn người nhận (từ chối nhận tin, loại trừ gửi: thuộc điều kiện / chưa đủ dữ liệu): Desktop in "🚫 Bỏ qua ..."
 * (logZaloMessageOptOutBlocked) thay cho dòng của thao tác.
 */
const SKIP_GATE_ERROR_CODES = new Set([OPT_OUT_ERROR_CODE, 'err_engine_send_excluded', 'err_engine_send_exclusion_unknown',
  'err_engine_friend_blocklisted', 'err_engine_zalo_tag_not_friend'])
/** Dừng chủ động: không phải kết quả với khách, Desktop không in dòng nào. */
export const CANCELLED_ERROR_CODE = 'err_engine_cancelled'
/** Facebook (V559 FB45): bước chạy xong mà bộ dựng lịch sử của bộ cũ không ghi dòng nào; bộ cũ không in gì, engine cũng không in. */
export const NO_HISTORY_ERROR_CODE = 'err_engine_fb_no_history'

const withCode = (text: string, code: string | null): string =>
  code && !text.includes(`(${code})`) ? `${text} (${code})` : text

const line = (campaignId: number, inputDataId: number | null, text: string, level: ProgressLevel, code: string | null = null): ProgressLine =>
  ({ campaignId, inputDataId, text, code, level })

/** Như formatZaloProgressLog của Desktop: "<thao tác>: <câu>", trừ khi câu đã bắt đầu bằng tên thao tác. */
export function formatActionLog(actionName: string | null | undefined, log: string | null | undefined): string {
  const action = String(actionName || '').trim()
  const text = String(log || '').trim()
  if (!action) return text
  if (!text) return action
  return text.toLocaleLowerCase('vi-VN').startsWith(action.toLocaleLowerCase('vi-VN')) ? text : `${action}: ${text}`
}

/**
 * Dòng lỗi có tên data (anh chốt 18/11/2026, cả Facebook lẫn Zalo): `<thao tác> "<data>": <câu>`. Tiến trình hiện lẫn nhiều chiến dịch
 * nên dòng lỗi đọc riêng vẫn biết data nào. Câu đã chứa tên data (mẫu {message} của bộ dựng cũ) thì không lặp lại tên.
 */
export function formatTargetActionLog(actionName: string | null | undefined, label: string | null | undefined, log: string | null | undefined): string {
  const action = String(actionName || '').trim()
  const text = String(log || '').trim()
  const name = String(label || '').trim()
  const lower = (value: string) => value.toLocaleLowerCase('vi-VN')
  const named = name !== '' && name !== 'N/A' && !lower(text).includes(lower(name))
  if (!action) return named && text ? `"${name}": ${text}` : text
  if (!text) return named ? `${action} "${name}"` : action
  if (lower(text).startsWith(lower(action))) {
    // Câu đã mở đầu bằng tên thao tác ("<thao tác>: …", "<thao tác> thất bại: …"): chèn tên data ngay sau tên thao tác.
    const rest = text.slice(action.length)
    if (!named || !/^[\s:]/.test(rest)) return text
    return /^\s*:/.test(rest) ? `${action} "${name}"${rest.trimStart()}` : `${action} "${name}"${rest}`
  }
  return named ? `${action} "${name}": ${text}` : `${action}: ${text}`
}

export function unitStartProgress(campaignId: number, campaignName: string, accountName: string): ProgressLine {
  return line(campaignId, null, `🚀 Bắt đầu chiến dịch "${campaignName}" trên tài khoản "${accountName}"`, 'info')
}

/** Như executeCampaignV2 của Desktop: đăng nhóm bật "Xáo trộn danh sách group" xáo các data chờ ở đầu lượt (V564, ngay sau 🚀). */
export function shuffleProgress(campaignId: number, count: number): ProgressLine {
  return line(campaignId, null, `🔀 Đã xáo trộn danh sách ${count} group`, 'info')
}

export function targetStartProgress(campaignId: number, inputDataId: number | null, label: string, campaignName: string): ProgressLine {
  return line(campaignId, inputDataId, `▶️ Xử lý "${label}" trong chiến dịch "${campaignName}"`, 'info')
}

export function targetDoneProgress(campaignId: number, inputDataId: number | null, label: string): ProgressLine {
  return line(campaignId, inputDataId, `✅ Hoàn thành "${label}"`, 'success')
}

/** Như executeCampaignV2 của bộ cũ: data chạy xong mà bị bỏ qua (đăng nhóm kèm chia sẻ) in "ℹ️ Bỏ qua" thay cho "✅ Hoàn thành". */
export function targetSkippedProgress(campaignId: number, inputDataId: number | null, label: string, note: string): ProgressLine {
  return line(campaignId, inputDataId, `ℹ️ Bỏ qua "${label}": ${note}`, 'info')
}

export function paceProgress(campaignId: number, seconds: number): ProgressLine {
  return line(campaignId, null, `⏳ Nghỉ ${seconds}s trước khi xử lý mục tiếp theo...`, 'info')
}

export function campaignDoneProgress(campaignId: number, campaignName: string): ProgressLine {
  return line(campaignId, null, `✅ Hoàn thành chiến dịch "${campaignName}"`, 'success')
}

/** Như formatVietnamDateTime của Desktop (campaignScheduler.ts): "HH:mm dd/MM/yyyy" theo vi-VN, giờ Việt Nam. */
export function formatVietnamDateTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return date.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

/**
 * Câu kết thúc lượt theo lý do của finish_campaign_v2, đúng câu của handleCampaignCompletion / rescheduleCompletedCampaignPass /
 * deferCampaignUntilFutureInput / transitionCampaignToCompleted. Lý do không có câu (còn data chờ trong khung giờ, không đổi gì) → null.
 */
export function finishProgress(campaignId: number, campaignName: string, finished: { reason?: unknown; schedule?: unknown; slot?: unknown;
  suffix?: unknown; pendingCount?: unknown; ranTargets?: unknown; repeat?: unknown; hours?: unknown }, runtime: RuntimeTarget,
  formatDateTime: (iso: string) => string = formatVietnamDateTime): ProgressLine | null {
  const name = `"${campaignName}"`
  const done = (suffix = ''): ProgressLine => line(campaignId, null, `✅ Hoàn thành chiến dịch ${name}${suffix}`, 'success')
  const at = typeof finished.schedule === 'string' ? formatDateTime(finished.schedule) : ''
  // "Lặp lại sau khi chạy xong" (V561): finish_campaign_v2 trả kèm { run, maxRuns, reason } của lượt vừa xong.
  const repeat = finished.repeat && typeof finished.repeat === 'object' ? finished.repeat as { run?: unknown; maxRuns?: unknown; reason?: unknown } : null
  const repeatRun = repeat && Number.isInteger(repeat.run) && Number.isInteger(repeat.maxRuns) ? `${Number(repeat.run)}/${Number(repeat.maxRuns)}` : ''
  switch (finished.reason) {
    case 'completed':
      if (repeat?.reason === 'max_runs' && repeatRun) return done(` (đã chạy đủ ${Number(repeat.maxRuns)} lượt)`)
      if (repeat?.reason === 'end_date') return done(' (lượt lặp kế tiếp đã qua ngày kết thúc)')
      return done()
    case 'completed_end_date': return done(' (hết ngày kết thúc)')
    case 'completed_no_slot': return done(' (không còn khung giờ chạy trong hôm nay)')
    case 'completed_slot_after_cutoff': return done(` (khung giờ ${String(finished.slot ?? '')} vượt quá giờ dừng trong ngày)`)
    case 'completed_repeat_next_day': return done(' (lượt gửi lặp kế tiếp đã sang ngày mới)')
    case 'completed_repeat_after_cutoff': return done(' (lượt gửi lặp kế tiếp vượt quá giờ dừng trong ngày)')
    case 'completed_no_rerun_data': return done(` (không có data cần chạy lại ${String(finished.suffix ?? '')})`)
    // Chạy lại sau N giờ (tìm data, comment seeding, newsfeed; V561 finish_campaign_v2): câu của handleCampaignCompletion bước hẹn chạy lại.
    case 'completed_no_rerun_page': return done(` (không có page cần chạy lại ${String(finished.suffix ?? '')})`)
    case 'completed_rerun_next_day': return done(' (không hẹn chạy lại theo giờ qua ngày mới)')
    case 'completed_rerun_after_cutoff': return done(` (lượt chạy lại sau ${String(finished.hours ?? '')} giờ vượt quá giờ dừng trong ngày)`)
    case 'completed_rerun_no_data': return done(' (không có data cần chạy lại)')
    case 'rerun_scheduled':
      return line(campaignId, null, `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch ${name} lúc ${at}`, 'info')
    case 'slot_advanced':
      return line(campaignId, null, `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch ${name} ở khung giờ ${String(finished.slot ?? '')} (${at})`, 'info')
    case 'repeat_scheduled':
      if (repeatRun) return line(campaignId, null, `⏳ Đã chạy xong lượt ${repeatRun}, hẹn chạy lại chiến dịch ${name} lúc ${at}`, 'info')
      return line(campaignId, null, `⏳ Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch ${name} lúc ${at}`, 'info')
    case 'rescheduled_future_input':
      return line(campaignId, null, `⏳ Hẹn chạy tiếp chiến dịch lúc ${at}`, 'info')
    case 'pending_input_remaining':
      return line(campaignId, null, `⏳ Phát hiện ${Number(finished.pendingCount ?? 0)} data mới đang chờ xử lý; chiến dịch chưa hoàn thành.`, 'info')
    // Như handleCampaignCompletion bước 1 (Nhóm data): hàm kết thúc hoàn thành chiến dịch, hoặc chiến dịch còn chờ data mới.
    case 'data_group_completed': return done()
    case 'data_group_waiting':
      return line(campaignId, null, `⏳ Chiến dịch ${name} đang chờ data mới từ Nhóm data`, 'info')
    // Group thời gian thực (V506): như prepareZaloRealtimeGroupCampaignRun (lượt chưa chạy data) / handleZaloRealtimeGroupCompletion.
    case 'realtime_waiting':
      return line(campaignId, null, `⏳ Chiến dịch ${name} ${finished.ranTargets === true ? 'tiếp tục chờ' : 'đang chờ'} data theo thời gian thực từ group Zalo`, 'info')
    case 'completed_realtime_end': return done(' (hết ngày nhận data theo thời gian thực)')
    case 'friend_auto_no_data':
      // Như executeCampaignV2: nhắn bạn bè "toàn bộ / theo tag" đã lấy data một lần mà không có dòng nào.
      return line(campaignId, null, '⚠️ Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy', 'warning')
    case 'account_control_won':
      // Chỉ Fly / VPS (finalizer của VPS); Desktop không có nhánh này.
      return runtime !== 'desktop' ? line(campaignId, null, '⏸ Đã hoàn thành lượt hiện tại và tạm dừng tài khoản.', 'info') : null
    default: return null
  }
}

/**
 * Như logRecentDeliveryCooldownPauses: `⏸️ Bỏ qua "<nhãn>": <câu>`. Nhãn (getRecentDeliveryCooldownTargetName): chiến dịch theo
 * SĐT lấy 2 giá trị khác nhau đầu tiên của [SĐT, tên, UID] nối " - ", loại khác [tên, UID, SĐT, email]; câu bỏ "Tạm dừng: " /
 * "Tạm dừng vì " ở đầu và " Gửi lại từ DD/MM/YYYY." / " Đăng lại từ DD/MM/YYYY." ở cuối.
 */
export function cooldownPauseProgress(campaignId: number, actionId: string | null | undefined,
  entry: { inputDataId: number; name: string | null; phone: string | null; uid: string | null; email: string | null; note: string }): ProgressLine {
  const values = (actionId === 'zalo_message_phone' ? [entry.phone, entry.name, entry.uid] : [entry.name, entry.uid, entry.phone, entry.email])
    .map(value => String(value ?? '').trim()).filter(Boolean)
  const distinct = [...new Set(values)]
  const label = (actionId === 'zalo_message_phone' ? distinct.slice(0, 2).join(' - ') : distinct[0]) || 'N/A'
  const detail = String(entry.note ?? '').trim()
    .replace(/^Tạm dừng:\s*/, '').replace(/^Tạm dừng vì\s*/, '')
    .replace(/\s*(?:Gửi|Đăng) lại từ \d{2}\/\d{2}\/\d{4}\.?$/, '').trim() || 'do giới hạn gửi/đăng lặp.'
  return line(campaignId, Number(entry.inputDataId) || null, `⏸️ Bỏ qua "${label}": ${detail}`, 'info')
}

/** Như yieldCampaignAtRunBoundary: giờ dừng riêng (nhãn HH:MM, có giây thì HH:MM:SS) hoặc mốc 23:59. */
export function dailyBoundaryProgress(campaignId: number, stopTime: string | null | undefined): ProgressLine {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(stopTime ?? '').trim())
  if (m) {
    let [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
    if (h * 3600 + mi * 60 + s > 23 * 3600 + 59 * 60) [h, mi, s] = [23, 59, 0]
    const pad = (v: number) => String(v).padStart(2, '0')
    const label = `${pad(h)}:${pad(mi)}${s > 0 ? `:${pad(s)}` : ''}`
    return line(campaignId, null, `⏹ Đã đến giờ dừng ${label}; đã hoàn tất lượt hiện tại và không mở lượt mới.`, 'info')
  }
  return line(campaignId, null, '⏹ Đã đến mốc dừng cuối ngày 23:59; đã hoàn tất lượt hiện tại và không mở lượt mới.', 'info')
}

/** Tạm dừng chiến dịch sau data đang xử lý: Desktop completeCampaignPause, VPS completePauseAtBoundary. */
export function campaignPausedProgress(campaignId: number, campaignName: string, runtime: RuntimeTarget): ProgressLine {
  return line(campaignId, null, runtime !== 'desktop' ? '⏸ Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.'
    : `⏸ Chiến dịch "${campaignName}" đã được tạm dừng.`, 'info')
}

/**
 * Chính sách lỗi vừa tạm dừng chiến dịch (DB trả campaign.effect = 'pause'): dòng riêng kèm tên, in sau dòng lý do "⚠️ …", trên cả
 * Desktop lẫn Fly. Trước đây lịch sử chạy chỉ có dòng lý do, không nói chiến dịch đã dừng; tiến trình hiện lẫn nhiều chiến dịch nên
 * phải có tên (anh chốt 18/11/2026). Cùng câu Desktop in khi khách bấm tạm dừng (campaignPausedProgress).
 */
export function policyPausedProgress(campaignId: number, campaignName: string): ProgressLine {
  return line(campaignId, null, `⏸ Chiến dịch "${campaignName}" đã được tạm dừng.`, 'warning')
}

/** Tài khoản bị đăng xuất / tạm dừng trong lượt: Desktop stopCampaignForAccountCondition, VPS completePauseAtBoundary. */
export function accountStopProgress(campaignId: number, campaignName: string, runtime: RuntimeTarget, reason: 'logged_out' | 'paused',
  accountStatus?: string | null): ProgressLine {
  if (reason === 'paused' && runtime !== 'desktop') return line(campaignId, null, '⏸ Đã hoàn thành lượt hiện tại và tạm dừng tài khoản.', 'info')
  const why = reason === 'logged_out' ? 'Tài khoản bị đăng xuất' : `Tài khoản đang ở trạng thái ${accountStatus || 'tạm dừng'}`
  return line(campaignId, null, `⚠️ Dừng chiến dịch "${campaignName}": ${why}`, 'warning')
}

/** Như updateUnclaimedCampaignPreflightNote: chiến dịch chưa chạy được vì thao tác bắt buộc đang chờ. */
export function campaignWaitProgress(campaignId: number, note: string): ProgressLine {
  return line(campaignId, null, `⚠️ Chưa thể chạy chiến dịch: ${note}`, 'warning', /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(note)?.[1] ?? null)
}

/**
 * Một kết quả do DB chốt. Như logHelperMilestoneProgress: có dòng lịch sử thì in câu của dòng đó. Từ chối nhận tin in như
 * logZaloMessageOptOutBlocked. Trả null khi Desktop không in gì (dừng chủ động).
 * Dòng lỗi (anh chốt 18/11/2026, cả Facebook lẫn Zalo): `<emoji> <thao tác> "<data>": <câu> (mã)`; ❌ = data đã đóng mà không thành
 * công, ⚠️ = data sẽ chạy lại (không có dòng lịch sử) hoặc không rõ đã gửi chưa.
 */
export function outcomeProgress(campaignId: number, inputDataId: number | null, decision: OutcomeDecision,
  context: { actionName: string; targetLabel: string }): ProgressLine | null {
  const code = decision.publicCode
  if (decision.errorCode === CANCELLED_ERROR_CODE || decision.errorCode === NO_HISTORY_ERROR_CODE) return null
  if (decision.errorCode && SKIP_GATE_ERROR_CODES.has(decision.errorCode)) {
    return line(campaignId, inputDataId, `🚫 Bỏ qua "${context.targetLabel}": ${withCode(decision.log, code)}`, 'info', code)
  }
  const actionName = decision.actionName || context.actionName
  if (decision.ok) {
    return line(campaignId, inputDataId, formatActionLog(actionName, decision.log), decision.reportGroup === 'skipped' ? 'info' : 'success', code)
  }
  const named = formatTargetActionLog(actionName, context.targetLabel, withCode(decision.log, code))
  if (decision.detailId === null) return line(campaignId, inputDataId, `⚠️ ${named}`, 'warning', code)
  // Lỗi mà kết quả là "đã làm từ trước" (đã là bạn bè…) hoặc "thành công": không phải lỗi với khách. Bỏ qua vì lỗi của data
  // (FB40 không thấy ô đăng bài, lớp target_permanent) vẫn là lỗi như bộ cũ Facebook ("❌ Lỗi …").
  if (decision.reportGroup === 'success' || (decision.reportGroup === 'skipped' && decision.errorClass !== 'target_permanent')) {
    return line(campaignId, inputDataId, formatActionLog(actionName, withCode(decision.log, code)), 'info', code)
  }
  const uncertain = decision.deliveryState === 'unknown' || decision.deliveryState === 'partial'
  return line(campaignId, inputDataId, `${uncertain ? '⚠️' : '❌'} ${named}`, decision.deliveryState === 'unknown' ? 'warning' : 'error', code)
}

/**
 * Thao tác không bắt buộc đang phải chờ nên bị bỏ qua cho data này. Như logSkippedLimitActionsOnce
 * (mỗi thao tác in một lần trong lượt).
 */
export function gateSkipProgress(campaignId: number, inputDataId: number | null, actionName: string, gate: GateDecision,
  formatTime: (iso: string) => string): ProgressLine {
  const note = gate.note?.trim() || (gate.until ? `chạy tiếp lúc ${formatTime(gate.until)}` : 'đang tạm khoá')
  const text = gate.gate === 'quota' ? `⚠️ Bỏ qua ${actionName} vì đã đạt giới hạn: ${note}` : `⚠️ Bỏ qua ${actionName}: ${note}`
  return line(campaignId, inputDataId, text, 'warning', /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(note)?.[1] ?? null)
}

export function outageProgress(campaignId: number): ProgressLine {
  return line(campaignId, null, '⚠️ Mất kết nối máy chủ, đang chờ để chạy tiếp (DB01)', 'warning', 'DB01')
}

export function recoveredProgress(campaignId: number): ProgressLine {
  return line(campaignId, null, 'ℹ️ Đã kết nối lại máy chủ, chạy tiếp', 'info')
}

export function configIssueProgress(campaignId: number, issue: ConfigIssue): ProgressLine {
  return line(campaignId, null, `❌ ${withCode(issue.message, issue.publicCode)}`, 'error', issue.publicCode)
}

export function campaignNoteProgress(campaignId: number, note: string): ProgressLine {
  return line(campaignId, null, `⚠️ ${note}`, 'warning', /\(([A-Z]{1,4}[0-9]{2,4})\)\s*$/.exec(note)?.[1] ?? null)
}
