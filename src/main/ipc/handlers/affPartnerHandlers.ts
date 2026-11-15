import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { AffPartnerResponse } from '../../../shared/affPartner'
import {
  AFF_PARTNER_IPC, AffPartnerDesktopError, affPartnerSafePortalUrl,
  type AffPartnerIpcResult, type AffPartnerOpenPortalResult
} from '../../../shared/affPartnerDesktop'
import { getAffPartnerPortalLink, getAffPartnerSummary } from '../../data/repositories/affPartnerRepository'

/**
 * Giới thiệu nhận hoa hồng (V546, docs/AFF_PARTNER_DESKTOP.md). Trả `AffPartnerIpcResult` thay vì ném lỗi.
 * Link có vé chỉ đi trong tiến trình chính: renderer chỉ nhận `{ signed }`.
 */
export function registerAffPartnerHandlers(mainWindow: BrowserWindow): void {
  const handle = <T>(channel: string, run: () => Promise<T>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent): Promise<AffPartnerIpcResult<T>> => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Yêu cầu không hợp lệ.')
      }
      try {
        return { ok: true, data: await run() }
      } catch (error) {
        const failure = error instanceof AffPartnerDesktopError ? error : new AffPartnerDesktopError('aff_partner_unavailable')
        if (!(error instanceof AffPartnerDesktopError)) {
          console.warn(`[AffPartner] unexpected failure on ${channel}: ${error instanceof Error ? error.name : typeof error}`)
        }
        return { ok: false, code: failure.code, message: failure.message }
      }
    })
  }

  handle<AffPartnerResponse>(AFF_PARTNER_IPC.summary, async () => ({ summary: await getAffPartnerSummary(true) }))

  handle<AffPartnerOpenPortalResult>(AFF_PARTNER_IPC.openPortal, async () => {
    const link = await getAffPartnerPortalLink()
    const url = affPartnerSafePortalUrl(link.url, link.portalUrl)
    if (!url) throw new AffPartnerDesktopError('aff_partner_invalid_link')
    try {
      await shell.openExternal(url)
    } catch {
      throw new AffPartnerDesktopError('aff_partner_open_failed')
    }
    return { signed: link.signed }
  })
}
