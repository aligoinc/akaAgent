import { ipcMain, type BrowserWindow } from 'electron'
import { SEND_EXCLUSION_IPC, type SaveSendExclusionGroup } from '../../../shared/campaignSendExclusion'
import { SEND_EXCLUSION_PREVIEW_MAX_TARGETS, SEND_EXCLUSION_V2_IPC, type SaveSendExclusionGroupV2, type SendExclusionListsQuery, type SendExclusionPreviewQuery } from '../../../shared/campaignSendExclusionMulti'
import {
  getSendExclusionV2Lists, getSendExclusionV2Options, getSendExclusionV2Page, getSendExclusionV2Preview, listSendExclusionGroups, saveSendExclusionGroup, saveSendExclusionGroupV2
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
  // V654: form mới (nhiều Zalo, Nhóm data, chiến dịch đã gửi). Nhân viên lấy từ phiên ở tiến trình chính; DB kiểm lại quyền.
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.page, event => { sender(event); return getSendExclusionV2Page() })
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.options, (event, id: number) => { check(event, id); return getSendExclusionV2Options(id) })
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.lists, (event, query: SendExclusionListsQuery) => {
    sender(event)
    const q = query && typeof query === 'object' ? query : {}
    if (q.kind !== undefined && !['all', 'dataGroups', 'campaigns'].includes(q.kind) || q.query !== undefined && (typeof q.query !== 'string' || q.query.length > 100)
      || q.excludeCampaignId != null && !positive(q.excludeCampaignId) || !ids(q.dataGroupIds, 20) || !ids(q.sentCampaignIds, 20)) throw new Error('Yêu cầu không hợp lệ.')
    return getSendExclusionV2Lists({ kind: q.kind, query: q.query, excludeCampaignId: q.excludeCampaignId ?? undefined, dataGroupIds: q.dataGroupIds, sentCampaignIds: q.sentCampaignIds })
  })
  // V657: xem trước ở bước lưu (chỉ đọc). DB kiểm lại quyền với danh sách / Nhóm data / chiến dịch đã chọn.
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.preview, (event, query: SendExclusionPreviewQuery) => {
    sender(event)
    const q = query && typeof query === 'object' ? query : ({} as SendExclusionPreviewQuery)
    const sel = q.selection
    const text = (v: unknown) => v === undefined || v === null || typeof v === 'string' && v.length <= 64
    if (!positive(q.accountId) || !sel || typeof sel !== 'object' || !(sel.groupId === null || positive(sel.groupId)) || !ids(sel.blocklistIds, 20) || sel.blocklistIds === undefined
      || !ids(sel.dataGroupIds, 20) || !ids(sel.sentCampaignIds, 20) || q.campaignId != null && !positive(q.campaignId) || q.afterId != null && !positive(q.afterId)
      || q.limit !== undefined && !(positive(q.limit) && q.limit <= SEND_EXCLUSION_PREVIEW_MAX_TARGETS)
      || q.targets !== undefined && !(Array.isArray(q.targets) && q.targets.length <= SEND_EXCLUSION_PREVIEW_MAX_TARGETS && q.targets.every(t => t && typeof t === 'object' && text(t.phone) && text(t.uid))))
      throw new Error('Yêu cầu không hợp lệ.')
    return getSendExclusionV2Preview({ accountId: q.accountId, selection: sel, campaignId: q.campaignId ?? null, targets: q.targets, afterId: q.afterId ?? null, limit: q.limit })
  })
  ipcMain.handle(SEND_EXCLUSION_V2_IPC.save, (event, group: SaveSendExclusionGroupV2) => {
    sender(event)
    if (!group || typeof group !== 'object' || !Array.isArray(group.blocks) || !group.blocks.length || group.blocks.length > 20
      || group.blocks.some(block => !positive(block?.accountId))) throw new Error('Yêu cầu không hợp lệ.')
    return saveSendExclusionGroupV2(group)
  })
}
