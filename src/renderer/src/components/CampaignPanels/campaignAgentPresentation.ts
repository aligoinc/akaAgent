import { agentEqual, isAgentRecord, isAgentEditableLimitAction, type AgentChange, type AgentSnapshot } from '../../../../shared/campaignAgent'

export const ACTION_CODE_LABELS: Record<string, string> = {
  fb_post_group: 'Đăng bài group',
  fb_post_my_profile: 'Đăng bài trang cá nhân',
  fb_post_page: 'Đăng bài fanpage',
  fb_comment: 'Comment',
  fb_message_stranger: 'Nhắn tin người lạ',
  fb_message_friend: 'Nhắn tin bạn bè',
  fb_message_page_inbox_customer: 'Nhắn tin khách inbox page',
  fb_add_friend: 'Kết bạn',
  fb_like_post: 'Like post',
  fb_join_group: 'Tham gia group',
  fb_group_invite: 'Mời vào group',
  zalo_find_phone_user: 'Tìm SĐT',
  zalo_message_friend: 'Nhắn tin bạn bè',
  zalo_message_group: 'Nhắn tin group',
  zalo_message_stranger: 'Nhắn tin người lạ',
  zalo_add_friend: 'Kết bạn',
  zalo_add_group_member: 'Thêm thành viên vào group',
  zalo_join_group_link: 'Tham gia group',
  zalo_cancel_sent_friend_request: 'Huỷ lời mời kết bạn',
  zalo_tag_contact: 'Gắn tag Zalo',
  zalo_change_alias: 'Đổi tên Zalo',
  email_send: 'Gửi email',
  sms_send: 'Gửi SMS',
  voice_call: 'Gọi tự động qua SIM'
}

export const getActionCodeLabel = (code: string) => ACTION_CODE_LABELS[code] || 'Hành động'

const ACTION_LIMIT_UNITS: Record<string, string> = {
  fb_post_group: 'bài đăng',
  fb_post_my_profile: 'bài đăng',
  fb_post_page: 'bài đăng',
  fb_comment: 'comment',
  fb_message_stranger: 'tin nhắn',
  fb_message_friend: 'tin nhắn',
  fb_message_page_inbox_customer: 'tin nhắn',
  fb_add_friend: 'lời mời',
  fb_like_post: 'like',
  fb_join_group: 'group',
  fb_group_invite: 'lời mời',
  zalo_find_phone_user: 'SĐT',
  zalo_message_friend: 'tin nhắn',
  zalo_message_group: 'tin nhắn',
  zalo_message_stranger: 'tin nhắn',
  zalo_add_friend: 'lời mời',
  zalo_add_group_member: 'thành viên',
  zalo_join_group_link: 'group',
  zalo_cancel_sent_friend_request: 'lời mời',
  email_send: 'email',
  sms_send: 'tin nhắn',
  voice_call: 'cuộc gọi'
}

export const getActionLimitUnit = (code: string) => ACTION_LIMIT_UNITS[code] || 'lượt'

export interface AgentChangeRow {
  key: string; label: string; beforeText: string; afterText: string; targetKey?: string
}
const choiceLabels: Record<string, Record<string, string>> = {
  scheduleType: { daily: 'Hằng ngày', weekly: 'Hằng tuần', monthly: 'Hằng tháng' },
  dataTargetSourceMode: { direct: 'Danh sách trực tiếp', data_group: 'Nhóm data' },
  contentSettingsTab: { content: 'Nội dung tự soạn', source: 'Nội dung từ bài nguồn' },
  advancedContentSourceMode: { manual: 'Tự soạn', group: 'Nhóm mẫu nội dung' },
  zaloFriendTargetMode: { selected: 'Danh sách đã chọn', all_friends: 'Tất cả bạn bè', tagged_friends: 'Bạn bè theo tag' },
  zaloMessageSendMode: { normal: 'Gửi tin nhắn', share: 'Chia sẻ tin nhắn' },
  pagePostMode: { api: 'Đăng qua API', ui: 'Đăng trên trình duyệt' },
  mediaOption: { none: 'Không đính kèm', image: 'Ảnh', video: 'Video', file: 'Tệp' },
  postBumpMode: { select: 'Chiến dịch đã chọn', create: 'Tạo chiến dịch mới' }
}
const shortText = (value: string) => {
  const chars = Array.from(value)
  return chars.length > 240 ? chars.slice(0, 240).join('') + '…' : value
}
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('vi-VN') : '—'
export const agentLimitWindows = (snapshot: AgentSnapshot): Record<string, number[]> => Object.fromEntries(
  (snapshot.limits?.limits.actions || []).map(action => [action.actionCode,
    action.rateLimitMinuteValues || (action.rateLimitMinutes === null ? [] : [action.rateLimitMinutes])]))
const windowText = (count: unknown, unit: string, windows: number[] | undefined, rawMinutes: unknown) => {
  const minutes = windows?.length ? windows : typeof rawMinutes === 'number' ? [rawMinutes] : []
  return `${amount(count)} ${unit} trong ${minutes.map(amount).join('/')} phút${minutes.length > 1 ? ' (tùy tài khoản)' : ''}`
}
function displayValue(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return 'Chưa có'
  if (typeof value === 'boolean') return value ? 'Bật' : 'Tắt'
  if (typeof value === 'number') return amount(value)
  if (typeof value === 'string') return choiceLabels[field]?.[value] || shortText(value)
  if (Array.isArray(value)) return value.length ? shortText(value.map(item => {
    if (isAgentRecord(item)) return [item.name, item.content, item.phone, item.email, item.uid].find(v => typeof v === 'string' && v) || 'Một mục'
    return displayValue(item, field)
  }).join(', ')) : 'Chưa chọn'
  if (isAgentRecord(value) && field === 'zaloTagSettingsByAccountId') {
    const names = Object.values(value).flatMap(item => isAgentRecord(item) && typeof item.zaloTagName === 'string' && item.zaloTagName ? [item.zaloTagName] : [])
    return names.length ? names.join(', ') : 'Chưa chọn tag'
  }
  // Internal object keys are not user-facing labels. Known structured fields have dedicated summaries.
  return isAgentRecord(value) && Object.keys(value).length ? 'Đã có thiết lập' : 'Chưa có thiết lập'
}

/** Presentation only: keep raw change records and revisions intact for undo and saved drafts. */
export function agentChangeRows(change: AgentChange): AgentChangeRow[] {
  if (change.hidden) return []
  const field = change.key.replace(/^formData\./, '')
  if (field !== 'actionLimitsByCode') return [{ key: change.key, label: change.label,
    beforeText: change.beforeText ?? displayValue(change.before, field), afterText: change.afterText ?? displayValue(change.after, field) }]
  const before = isAgentRecord(change.before) ? change.before : {}, after = isAgentRecord(change.after) ? change.after : {}
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(isAgentEditableLimitAction).flatMap(code => {
    const a = isAgentRecord(before[code]) ? before[code] : undefined, b = isAgentRecord(after[code]) ? after[code] : undefined
    const label = getActionCodeLabel(code), unit = getActionLimitUnit(code), rows: AgentChangeRow[] = []
    const targetKey = `formData.actionLimitsByCode.${code}`
    if (!agentEqual(a?.dailyLimit, b?.dailyLimit)) rows.push({ key: `${targetKey}.daily`, targetKey,
      label: `${label} · Giới hạn trong ngày`,
      beforeText: a ? `${amount(a.dailyLimit)} ${unit}/ngày` : 'Chưa thiết lập',
      afterText: b ? `${amount(b.dailyLimit)} ${unit}/ngày` : 'Không áp dụng' })
    if (!agentEqual([a?.rateLimitCount, a?.rateLimitMinutes], [b?.rateLimitCount, b?.rateLimitMinutes])) rows.push({ key: `${targetKey}.window`, targetKey,
      label: `${label} · Giới hạn theo thời gian`,
      beforeText: a ? windowText(a.rateLimitCount, unit, change.limitWindows?.before[code], a.rateLimitMinutes) : 'Chưa thiết lập',
      afterText: b ? windowText(b.rateLimitCount, unit, change.limitWindows?.after[code], b.rateLimitMinutes) : 'Không áp dụng' })
    return rows
  })
}
