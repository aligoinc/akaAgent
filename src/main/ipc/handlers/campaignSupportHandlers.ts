import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
  CAMPAIGN_SUPPORT_IPC,
  type CampaignSupportControlRequest, type CampaignSupportImageRequest, type CampaignSupportSendRequest, type CampaignSupportVariant
} from '../../../shared/campaignSupport'
import { getCurrentUser } from '../../data/currentUser'
import { requireCampaignSupportAccess } from '../../data/repositories/campaignRepository'
import { CampaignSupportService } from '../../services/campaignSupportService'
import { validateCampaignSupportUploadImages } from '../../services/campaignSupportImageValidation'

export function registerCampaignSupportHandlers(mainWindow: BrowserWindow): Pick<CampaignSupportService, 'startSession' | 'stop'> {
  const createService = (variant: CampaignSupportVariant) => new CampaignSupportService({
    variant,
    directory: join(app.getPath('userData'), variant === 'dsh' ? 'campaign-support-dsh' : 'campaign-support'),
    getOwner: () => {
      const user = getCurrentUser()
      return user ? { organizationId: user.organizationId, staffId: user.staffId } : null
    },
    authorizeCampaign: (id, owner) => requireCampaignSupportAccess(id, owner.staffId, owner.organizationId),
    onUpdate: state => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(CAMPAIGN_SUPPORT_IPC.updated, state)
    }
  })
  // Constructing a service does not open connections or schedule polling; work starts on user request.
  const services = { standard: createService('standard'), dsh: createService('dsh') }
  const serviceFor = (variant: unknown = 'standard'): CampaignSupportService => {
    if (variant !== 'standard' && variant !== 'dsh') throw new Error('Loại trợ lý không hợp lệ.')
    return services[variant]
  }
  const lifecycle = {
    startSession: () => { Object.values(services).forEach(service => service.startSession()) },
    stop: () => { Object.values(services).forEach(service => service.stop()) }
  }
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
        throw new Error('Không có quyền sử dụng trợ lý.')
      }
      return fn(...args)
    })
  }
  handle(CAMPAIGN_SUPPORT_IPC.open, (campaignId: number, startRequestId?: string, variant?: CampaignSupportVariant) =>
    serviceFor(variant).open(campaignId, startRequestId))
  handle(CAMPAIGN_SUPPORT_IPC.send, (request: CampaignSupportSendRequest) => {
    const images = validateCampaignSupportUploadImages(request?.images)
    return serviceFor(request.variant).send({ ...request, images })
  })
  handle(CAMPAIGN_SUPPORT_IPC.control, (request: CampaignSupportControlRequest) => serviceFor(request.variant).control(request))
  handle(CAMPAIGN_SUPPORT_IPC.retry, (campaignId: number, key: string, variant?: CampaignSupportVariant) => serviceFor(variant).retry(campaignId, key))
  handle(CAMPAIGN_SUPPORT_IPC.reset, (campaignId: number, key: string, variant?: CampaignSupportVariant) => serviceFor(variant).reset(campaignId, key))
  handle(CAMPAIGN_SUPPORT_IPC.image, (request: CampaignSupportImageRequest) => serviceFor(request.variant).image(request))
  mainWindow.webContents.once('destroyed', () => lifecycle.stop())
  return lifecycle
}
