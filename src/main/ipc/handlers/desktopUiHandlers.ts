import { ipcMain, type BrowserWindow } from 'electron'
import { DESKTOP_UI_IPC } from '../../../shared/desktopUiReads'
import * as reads from '../../data/repositories/desktopUiRepository'
import { listDesktopCampaignCatalog } from '../../data/repositories/campaignRepository'
import { readDesktopUiAttention, watchDesktopUiAttention } from '../../services/desktopUiAttention'
import { renewalReminderService } from '../../services/renewalReminderService'
import { RENEWAL_REMINDER_SETTINGS_OFF } from '../../../shared/renewalReminder'

export function registerDesktopUiHandlers(mainWindow: BrowserWindow): void {
  // Scope and credentials are resolved in main, never accepted from renderer.
  ipcMain.handle(DESKTOP_UI_IPC.settings, async () => {
    // Nhắc gia hạn đọc cài đặt `renewal.reminder` trong cùng câu này (một lần mỗi phiên đăng nhập, không thêm request).
    const scope = renewalReminderService.currentScope()
    const settings = await reads.getDesktopPollingSettings()
    renewalReminderService.applySettings(scope, settings.renewalReminder ?? { ...RENEWAL_REMINDER_SETTINGS_OFF })
    return settings
  })
  // `options` chỉ chọn cách đếm tiến độ (đã chuẩn hóa trong repository), không mang phạm vi hay quyền.
  ipcMain.handle(DESKTOP_UI_IPC.campaignPage, (_, query, options) => reads.getDesktopCampaignPage(query, options))
  // Trạng thái cửa sổ/máy cho bộ điều phối đọc: lệnh nội bộ, không đọc DB.
  ipcMain.handle(DESKTOP_UI_IPC.attention, () => readDesktopUiAttention(mainWindow))
  watchDesktopUiAttention(mainWindow)
  ipcMain.handle(DESKTOP_UI_IPC.campaignSelection, (_, query) => reads.getDesktopCampaignSelection(query))
  ipcMain.handle(DESKTOP_UI_IPC.accountSnapshot, (_, version) => reads.getDesktopAccountSnapshot(version))
  ipcMain.handle(DESKTOP_UI_IPC.campaignSources, (_, id) => reads.getDesktopCampaignSources(id))
  ipcMain.handle(DESKTOP_UI_IPC.campaignConfig, (_, id) => reads.getDesktopCampaignConfig(id))
  ipcMain.handle(DESKTOP_UI_IPC.campaignLogs, (_, id, query) => reads.getDesktopCampaignLogs(id, query))
  ipcMain.handle(DESKTOP_UI_IPC.campaignLog, (_, id) => reads.getDesktopCampaignLog(id))
  ipcMain.handle(DESKTOP_UI_IPC.campaignCatalog, () => listDesktopCampaignCatalog())
}
