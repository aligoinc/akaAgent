import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import {
  AkaBizCampaignListKind,
  AkaBizIntegrationKind,
  AkaBizStaffBasic,
  IPC_EVENTS
} from '../../../shared/types'
import { listAkaBizCampaigns, listAkaBizSmsShops, lookupAkaBizStaff } from '../../services/akaBizApiClient'
import {
  listAkaBizDesktopCampaigns,
  resolveAkaBizDesktopDbPath
} from '../../services/akaBizDesktopSqliteClient'
import {
  getAkaBizIntegrations,
  saveAkaBizIntegration
} from '../../data/repositories/staffIntegrationRepository'
import {
  AKABIZ_AUTO_SYNC_IPC,
  type AkaBizAutoSyncConnectResult,
  type AkaBizAutoSyncReport,
  type AkaBizAutoSyncResult,
  type AkaBizAutoSyncSettings
} from '../../../shared/akaBizAutoSync'
import {
  AKABIZ_AUTO_SYNC_API_BASE,
  AkaBizAutoSyncError,
  AkaBizAutoSyncService,
  messageFor
} from '../../services/akaBizAutoSyncService'
import { desktopSession } from '../../data/supabaseClient'
import { getCurrentUser } from '../../data/currentUser'

// Đồng bộ akaBiz Auto → akaAgent (phương án 2, docs/AKABIZ_AUTO_SYNC_DESKTOP.md): một phiên cho cả app, gắn với nhân viên
// đang đăng nhập lúc xác minh. Mật khẩu akaBiz chỉ nằm trong service; IPC chỉ trả `{ ok, data }` / `{ ok: false, code, message }`.
const autoSync = new AkaBizAutoSyncService({
  baseUrl: AKABIZ_AUTO_SYNC_API_BASE,
  token: signal => desktopSession.token(signal),
  fetch: (input, init) => fetch(input, init),
  sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new AkaBizAutoSyncError('akabiz_sync_cancelled', messageFor('akabiz_sync_cancelled'))) }, { once: true })
  }),
  now: () => Date.now()
})
let autoSyncStaffId: number | null = null

function autoSyncFailure(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof AkaBizAutoSyncError) return { ok: false, code: error.code, message: error.message }
  console.error('[akaBizAutoSync] unexpected error', error instanceof Error ? error.message : 'unknown')
  return { ok: false, code: 'akabiz_sync_failed', message: messageFor('akabiz_sync_failed') }
}

function currentStaffMatches(): boolean {
  const staffId = getCurrentUser()?.staffId ?? null
  if (staffId === null || staffId !== autoSyncStaffId) {
    autoSync.close()
    autoSyncStaffId = null
    return false
  }
  return true
}

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

  ipcMain.handle(IPC_EVENTS.AKABIZ_SMS_SHOPS_LIST, async () => {
    const integrations = await getAkaBizIntegrations()
    const integration = integrations.sms
    if (!integration?.staffId) {
      throw new Error('Chưa tích hợp akaBiz Sms.')
    }
    return listAkaBizSmsShops(integration.staffId)
  })

  ipcMain.handle(AKABIZ_AUTO_SYNC_IPC.connect, async (_event, password: unknown): Promise<AkaBizAutoSyncResult<AkaBizAutoSyncConnectResult>> => {
    try {
      const user = getCurrentUser()
      if (!user) return { ok: false, code: 'akabiz_sync_session_unavailable', message: messageFor('akabiz_sync_session_unavailable') }
      if (typeof password !== 'string' || !password || password.length > 200) {
        return { ok: false, code: 'akabiz_sync_invalid_input', message: 'Vui lòng nhập mật khẩu akaBiz.' }
      }
      const integration = (await getAkaBizIntegrations()).akaBizDesktop
      if (!integration?.username || !integration.dbPath) {
        return { ok: false, code: 'akabiz_sync_not_linked', message: 'Chưa tích hợp akaBiz Desktop.' }
      }
      if (autoSyncStaffId !== user.staffId) autoSync.close()
      autoSyncStaffId = user.staffId
      return { ok: true, data: await autoSync.connect({ dbPath: integration.dbPath, username: integration.username }, password) }
    } catch (error) {
      return autoSyncFailure(error)
    }
  })

  ipcMain.handle(AKABIZ_AUTO_SYNC_IPC.run, async (event: IpcMainInvokeEvent, settings: AkaBizAutoSyncSettings, dryRun: unknown): Promise<AkaBizAutoSyncResult<AkaBizAutoSyncReport>> => {
    try {
      if (!currentStaffMatches()) return { ok: false, code: 'akabiz_sync_no_session', message: messageFor('akabiz_sync_no_session') }
      const report = await autoSync.run(settings, dryRun === true, progress => {
        if (!event.sender.isDestroyed()) event.sender.send(AKABIZ_AUTO_SYNC_IPC.progress, progress)
      })
      return { ok: true, data: report }
    } catch (error) {
      return autoSyncFailure(error)
    }
  })

  ipcMain.handle(AKABIZ_AUTO_SYNC_IPC.cancel, async () => {
    autoSync.cancel()
    return { ok: true, data: null }
  })

  ipcMain.handle(AKABIZ_AUTO_SYNC_IPC.close, async () => {
    autoSync.close()
    autoSyncStaffId = null
    return { ok: true, data: null }
  })
}
