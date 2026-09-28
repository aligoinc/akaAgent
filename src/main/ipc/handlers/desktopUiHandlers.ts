import { ipcMain } from 'electron'
import { DESKTOP_UI_IPC } from '../../../shared/desktopUiReads'
import * as reads from '../../data/repositories/desktopUiRepository'
import { listDesktopCampaignCatalog } from '../../data/repositories/campaignRepository'

export function registerDesktopUiHandlers(): void {
  // Scope and credentials are resolved in main, never accepted from renderer.
  ipcMain.handle(DESKTOP_UI_IPC.settings, () => reads.getDesktopPollingSettings())
  ipcMain.handle(DESKTOP_UI_IPC.campaignPage, (_, query) => reads.getDesktopCampaignPage(query))
  ipcMain.handle(DESKTOP_UI_IPC.campaignSelection, (_, query) => reads.getDesktopCampaignSelection(query))
  ipcMain.handle(DESKTOP_UI_IPC.accountSnapshot, (_, version) => reads.getDesktopAccountSnapshot(version))
  ipcMain.handle(DESKTOP_UI_IPC.campaignSources, (_, id) => reads.getDesktopCampaignSources(id))
  ipcMain.handle(DESKTOP_UI_IPC.campaignConfig, (_, id) => reads.getDesktopCampaignConfig(id))
  ipcMain.handle(DESKTOP_UI_IPC.campaignLog, (_, id) => reads.getDesktopCampaignLog(id))
  ipcMain.handle(DESKTOP_UI_IPC.campaignCatalog, () => listDesktopCampaignCatalog())
}
