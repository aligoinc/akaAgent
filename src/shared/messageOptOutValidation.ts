import { messageOptOutChannelForAction, validateChannelOptOutSettings, type MessageOptOutChannels } from './messageOptOutChannels'
import { validateStopMessagesSettings } from './zaloMessageOptOut'

type OptOutSettings = Parameters<typeof validateStopMessagesSettings>[1] & Parameters<typeof validateChannelOptOutSettings>[1]

/**
 * Kiểm link từ chối lúc lưu cho mọi loại chiến dịch: SMS / email / nhắn tin Facebook theo công tắc kênh (V649),
 * loại khác theo luật Zalo cũ. `channels` thiếu = kênh mới tắt. Như WebApp control-api `messageOptOutValidation.ts`.
 */
export function validateMessageOptOutSettings(
  content: string | null | undefined,
  settings: OptOutSettings,
  actionId: string,
  channels?: Partial<MessageOptOutChannels> | null,
  plainText: (value: string) => string = value => value,
): string | null {
  return messageOptOutChannelForAction(actionId)
    ? validateChannelOptOutSettings(content, settings, actionId, channels, plainText)
    : validateStopMessagesSettings(content, settings, actionId, plainText)
}
