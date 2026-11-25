import { ipcMain, type BrowserWindow } from 'electron'
import { SEND_EXCLUSION_IPC, type SaveSendExclusionGroup } from '../../../shared/campaignSendExclusion'
import { SEND_EXCLUSION_V2_IPC, type SaveSendExclusionGroupV2, type SendExclusionListsQuery } from '../../../shared/campaignSendExclusionMulti'
import {
  getSendExclusionV2Lists, getSendExclusionV2Options, getSendExclusionV2Page, listSendExclusionGroups, saveSendExclusionGroup, saveSendExclusionGroupV2
} from '../../data/repositories/campaignSendExclusionRepository'

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const ids = (value: unknown, max: number) => value === undefined || Array.isArray(value) && value.length <= max && value.every(positive)

export function registerSendExclusionHandlers(window: BrowserWindow): void {
  const sender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không hợp lệ.')
  }
  const check = (event: Electron.IpcMainInvokeEvent, id: number) => {
    sender(event)
    if (!positive(id)) throw new Error('Yêu cầu không hợp lệ.')
  }
  ipcMain.handle(SEND_EXCLUSION_IPC.page, (event, id: number) => { check(event, id); return listSendExclusionGroups(id) })
  ipcMain.handle(SEND_EXCLUSION_IPC.save, (event, group: SaveSendExclusionGroup) => { check(event, group?.accountId); return saveSendExclusionGroup(group) })
  // V653: form mới (nhiều Zalo, Nhóm data, chiến dịch đã gửi). Nhân viên lấy từ phiên ở tiến trình chính; DB kiểm lại quyền.
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.page, event => { sender(event); return getSendExclusionV2Page() })
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.options, (event, id: number) => { check(event, id); return getSendExclusionV2Options(id) })
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.lists, (event, query: SendExclusionListsQuery) => {
    sender(event)
    const q = query && typeof query === 'object' ? query : {}
    if (q.kind !== undefined && !['all', 'dataGroups', 'campaigns'].includes(q.kind) || q.query !== undefined && (typeof q.query !== 'string' || q.query.length > 100)
      || q.excludeCampaignId != null && !positive(q.excludeCampaignId) || !ids(q.dataGroupIds, 20) || !ids(q.sentCampaignIds, 20)) throw new Error('Yêu cầu không hợp lệ.')
    return getSendExclusionV2Lists({ kind: q.kind, query: q.query, excludeCampaignId: q.excludeCampaignId ?? undefined, dataGroupIds: q.dataGroupIds, sentCampaignIds: q.sentCampaignIds })
  })
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.save, (event, group: SaveSendExclusionGroupV2) => {
    sender(event)
    if (!group || typeof group !== 'object' || !Array.isArray(group.blocks) || !group.blocks.length || group.blocks.length > 20
      || group.blocks.some(block => !positive(block?.accountId))) throw new Error('Yêu cầu không hợp lệ.')
    return saveSendExclusionGroupV2(group)
  })
}
