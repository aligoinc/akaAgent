import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import {
  AkaBizCampaignListKind,
  AkaBizIntegrationKind,
  AkaBizStaffBasic,
  IPC_EVENTS
} from '../../../shared/types'
import { listAkaBizCampaigns, lookupAkaBizStaff } from '../../services/akaBizApiClient'
import {
  listAkaBizDesktopCampaigns,
  resolveAkaBizDesktopDbPath
} from '../../services/akaBizDesktopSqliteClient'
import {
  getAkaBizIntegrations,
  saveAkaBizIntegration
} from '../../data/repositories/staffIntegrationRepository'

function isDesktopCampaignKind(kind: AkaBizCampaignListKind): boolean {
  return kind === 'desktopZaloPhone' || kind === 'desktopZaloGroupLink'
}

export function registerAkaBizIntegrationHandlers(): void {
  ipcMain.handle(IPC_EVENTS.AKABIZ_INTEGRATIONS_GET, async () => {
    return getAkaBizIntegrations()
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_INTEGRATION_LOOKUP, async (_, kind: AkaBizIntegrationKind, username: string) => {
    return lookupAkaBizStaff(kind, username)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_INTEGRATION_SAVE, async (_, kind: AkaBizIntegrationKind, staff: AkaBizStaffBasic) => {
    const desktopPath = kind === 'akaBizDesktop'
      ? resolveAkaBizDesktopDbPath(staff.installPath || '')
      : null

    return saveAkaBizIntegration(kind, {
      staffId: staff.staffId || staff.id,
      username: staff.username,
      name: staff.name,
      installPath: desktopPath?.installPath ?? staff.installPath ?? null,
      dbPath: desktopPath?.dbPath ?? staff.dbPath ?? null
    })
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_DESKTOP_INSTALL_PATH_SELECT, async event => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'Chọn thư mục cài đặt akaBiz Desktop',
      properties: ['openDirectory']
    }
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] || null)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_DESKTOP_INSTALL_PATH_VALIDATE, async (_, installPath: string) => {
    return resolveAkaBizDesktopDbPath(installPath)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_EXTERNAL_CAMPAIGNS_LIST, async (_, kind: AkaBizCampaignListKind) => {
    const integrations = await getAkaBizIntegrations()
    if (isDesktopCampaignKind(kind)) {
      const integration = integrations.akaBizDesktop
      if (!integration?.staffId) {
        throw new Error('Chưa tích hợp akaBiz Desktop.')
      }
      return listAkaBizDesktopCampaigns(kind, integration)
    }

    const integration = kind === 'sms' ? integrations.sms : integrations.zaloWeb
    if (!integration?.staffId) {
      throw new Error(kind === 'sms' ? 'Chưa tích hợp akaBiz Sms.' : 'Chưa tích hợp akaBiz Zalo Web.')
    }
    return listAkaBizCampaigns(kind, integration.staffId)
  })
}
