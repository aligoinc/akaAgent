import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
  CAMPAIGN_SUPPORT_IPC,
  type CampaignSupportControlRequest, type CampaignSupportImageRequest, type CampaignSupportSendRequest
} from '../../../shared/campaignSupport'
import { getCurrentUser } from '../../data/currentUser'
import { requireCampaignSupportAccess } from '../../data/repositories/campaignRepository'
import { CampaignSupportService } from '../../services/campaignSupportService'
import { validateCampaignSupportUploadImages } from '../../services/campaignSupportImageValidation'

export function registerCampaignSupportHandlers(mainWindow: BrowserWindow): CampaignSupportService {
  const service = new CampaignSupportService({
    directory: join(app.getPath('userData'), 'campaign-support'),
    getOwner: () => {
      const user = getCurrentUser()
      return user ? { organizationId: user.organizationId, staffId: user.staffId } : null
    },
    authorizeCampaign: (id, owner) => requireCampaignSupportAccess(id, owner.staffId, owner.organizationId),
    onUpdate: state => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CAMPAIGN_SUPPORT_IPC.updated, state)
    }
  })
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Không có quyền sử dụng trợ lý.')
      }
      return fn(...args)
    })
  }
  handle(CAMPAIGN_SUPPORT_IPC.open, (campaignId: number, startRequestId?: string) => service.open(campaignId, startRequestId))
  handle(CAMPAIGN_SUPPORT_IPC.send, (request: CampaignSupportSendRequest) => {
    const images = validateCampaignSupportUploadImages(request?.images)
    return service.send({ ...request, images })
  })
  handle(CAMPAIGN_SUPPORT_IPC.control, (request: CampaignSupportControlRequest) => service.control(request))
  handle(CAMPAIGN_SUPPORT_IPC.retry, (campaignId: number, key: string) => service.retry(campaignId, key))
  handle(CAMPAIGN_SUPPORT_IPC.reset, (campaignId: number, key: string) => service.reset(campaignId, key))
  handle(CAMPAIGN_SUPPORT_IPC.image, (request: CampaignSupportImageRequest) => service.image(request))
  mainWindow.webContents.once('destroyed', () => service.stop())
  return service
}
