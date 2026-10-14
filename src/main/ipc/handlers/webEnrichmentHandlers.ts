import { ipcMain, type BrowserWindow } from 'electron'
import { WEB_ENRICHMENT_IPC, WEB_ENRICHMENT_STATE } from '../../../shared/facebookWebEnrichment'
import { webEnrichmentRpc } from '../../data/repositories/webEnrichmentRepository'
import { requireCurrentUser } from '../../data/currentUser'
import { onWebEnrichmentState, webEnrichmentSnapshot } from '../../services/webEnrichmentControl'
import type { WebEnrichmentService } from '../../services/webEnrichmentService'

export function registerWebEnrichmentHandlers(window: BrowserWindow, runtime?: WebEnrichmentService): void {
  ipcMain.handle(WEB_ENRICHMENT_IPC, async (event, operation: string, accountId: number, input: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
    requireCurrentUser()
    if (operation === 'state') return webEnrichmentSnapshot()
    if (operation !== 'get' && operation !== 'save') throw new Error('Thao tác không hợp lệ.')
    const settings = await webEnrichmentRpc(accountId, operation, input)
    if (operation === 'save') runtime?.invalidate(accountId)
    return settings
  })
  const unsubscribe = onWebEnrichmentState(() => {
    if (!window.isDestroyed()) window.webContents.send(WEB_ENRICHMENT_STATE, webEnrichmentSnapshot())
  })
  window.once('closed', unsubscribe)
}
