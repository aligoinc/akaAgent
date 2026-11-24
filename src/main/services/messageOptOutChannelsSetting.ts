import { MESSAGE_OPT_OUT_CHANNELS_OFF, parseMessageOptOutChannels, type MessageOptOutChannels } from '../../shared/messageOptOutChannels'

/**
 * Công tắc link từ chối cho SMS / email / nhắn tin Facebook (`message_opt_out.channels`, V649): đọc chung câu đọc cài đặt lúc
 * đăng nhập (desktopUiRepository). Đường lưu dùng để cho phép biến trong nội dung; bộ lập lịch dùng để gắn link / bỏ qua người
 * đã từ chối. Chưa đọc / thiếu dòng = tắt cả ba.
 */
let channels: MessageOptOutChannels = { ...MESSAGE_OPT_OUT_CHANNELS_OFF }

export function setMessageOptOutChannels(value: unknown): MessageOptOutChannels {
  channels = parseMessageOptOutChannels(value)
  return { ...channels }
}

export function getMessageOptOutChannels(): MessageOptOutChannels {
  return channels
}
