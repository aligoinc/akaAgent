import { parseCampaignRepeatAudience } from '../../../shared/campaignRepeat'
import { create } from 'zustand'
import {
  DEFAULT_DESKTOP_POLLING, DESKTOP_UI_TUNING_RANGES, parseDesktopPollSeconds, parseDesktopUiSeconds,
  type DesktopPollingSettings
} from '../../../shared/desktopUiReads'
import { parseAffPartnerAudience } from '../../../shared/affPartner'
import { parseContentSyntaxGuardMode } from '../../../shared/contentSyntax'
import { parseMessageOptOutChannels } from '../../../shared/messageOptOutChannels'

let generation = 0
export const useDesktopPollingStore = create<{
  scope: string | null
  settings: DesktopPollingSettings
  enter(scope: string | null): void
}>((set, get) => ({
  scope: null, settings: { ...DEFAULT_DESKTOP_POLLING },
  enter(scope) {
    if (scope === get().scope) return
    const request = ++generation
    set({ scope, settings: { ...DEFAULT_DESKTOP_POLLING } })
    if (!scope) return
    void window.electronAPI.getDesktopPollingSettings().then(settings => {
      if (request !== generation) return
      set({ settings: {
        accounts: parseDesktopPollSeconds(settings.accounts),
        campaigns: parseDesktopPollSeconds(settings.campaigns),
        zaloShareRepeatEnabled: settings.zaloShareRepeatEnabled === true,
        // "Lặp lại sau khi chạy xong": giá trị lạ = ẩn.
        campaignRepeatAudience: parseCampaignRepeatAudience({ audience: settings.campaignRepeatAudience }),
        // Kiểm lại ở giao diện: thiếu/sai = tắt = đọc như trước (docs/DESKTOP_UI_IDLE_READS.md).
        hiddenPauseEnabled: settings.hiddenPauseEnabled === true,
        idleAfterSeconds: parseDesktopUiSeconds(settings.idleAfterSeconds, DESKTOP_UI_TUNING_RANGES.idleAfterSeconds),
        idlePollSeconds: parseDesktopUiSeconds(settings.idlePollSeconds, DESKTOP_UI_TUNING_RANGES.idlePollSeconds),
        progressRecountSeconds: parseDesktopUiSeconds(settings.progressRecountSeconds, DESKTOP_UI_TUNING_RANGES.progressRecountSeconds),
        // Ẩn/hiện mục "Giới thiệu nhận hoa hồng"; giá trị lạ = ẩn.
        affPartnerAudience: parseAffPartnerAudience({ audience: settings.affPartnerAudience }),
        // Chặn lưu nội dung sai cú pháp: thiếu / lạ = chặn.
        contentSyntaxGuard: parseContentSyntaxGuardMode(settings.contentSyntaxGuard),
        // Link từ chối cho SMS / email / nhắn tin Facebook (V649): thiếu / lạ = tắt.
        messageOptOutChannels: parseMessageOptOutChannels(settings.messageOptOutChannels)
      } })
    }).catch(() => { /* Defaults must not block the UI or trigger retries. */ })
  }
}))
