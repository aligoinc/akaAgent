import { ipcMain, type BrowserWindow } from 'electron'
import { SHEET_SYNC_IPC, type GoogleSheetConfig, type SaveDataGroupExternalSyncSource } from '../../../shared/googleSheetSync'
import * as repository from '../../data/repositories/dataGroupExternalSyncRepository'

export function registerDataGroupExternalSyncHandlers(window: BrowserWindow): void {
  ipcMain.handle(SHEET_SYNC_IPC, async (event, action: unknown, input: Record<string, unknown>) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
    if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.groupId) || Number(input.groupId) <= 0) throw new Error('Nhóm không hợp lệ.')
    const groupId = input.groupId as number
    switch (action) {
      case 'list': return repository.listDataGroupExternalSync(groupId)
      case 'inspect':
        if (typeof input.url !== 'string' || typeof input.hasHeader !== 'boolean') throw new Error('Link Sheet không hợp lệ.')
        return repository.inspectDataGroupSheet(groupId, input.url, input.hasHeader)
      case 'preview': return repository.previewDataGroupSheet(groupId, input.config as GoogleSheetConfig, input.sourceId as number | undefined)
      case 'save': return repository.saveDataGroupExternalSync(input as unknown as SaveDataGroupExternalSyncSource)
      case 'toggle':
      case 'delete':
        if (!Number.isSafeInteger(input.id) || !Number.isSafeInteger(input.expectedRevision)) throw new Error('Nguồn không hợp lệ.')
        if (action === 'delete') return repository.removeDataGroupExternalSync(groupId, input.id as number, input.expectedRevision as number)
        if (typeof input.enabled !== 'boolean') throw new Error('Trạng thái không hợp lệ.')
        return repository.toggleDataGroupExternalSync(groupId, input.id as number, input.expectedRevision as number, input.enabled)
      default: throw new Error('Thao tác không hợp lệ.')
    }
  })
}
