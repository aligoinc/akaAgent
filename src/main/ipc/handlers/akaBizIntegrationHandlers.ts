import { ipcMain } from 'electron'
import {
  AkaBizCampaignListKind,
  AkaBizIntegrationKind,
  AkaBizStaffBasic,
  IPC_EVENTS
} from '../../../shared/types'
import { listAkaBizCampaigns, lookupAkaBizStaff } from '../../services/akaBizApiClient'
import {
  getAkaBizIntegrations,
  saveAkaBizIntegration
} from '../../data/repositories/staffIntegrationRepository'

export function registerAkaBizIntegrationHandlers(): void {
  ipcMain.handle(IPC_EVENTS.AKABIZ_INTEGRATIONS_GET, async () => {
    return getAkaBizIntegrations()
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_INTEGRATION_LOOKUP, async (_, kind: AkaBizIntegrationKind, username: string) => {
    return lookupAkaBizStaff(kind, username)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_INTEGRATION_SAVE, async (_, kind: AkaBizIntegrationKind, staff: AkaBizStaffBasic) => {
    return saveAkaBizIntegration(kind, {
      staffId: staff.staffId || staff.id,
      username: staff.username,
      name: staff.name
    })
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_EXTERNAL_CAMPAIGNS_LIST, async (_, kind: AkaBizCampaignListKind) => {
    const integrations = await getAkaBizIntegrations()
    const integration = kind === 'sms' ? integrations.sms : integrations.zaloWeb
    if (!integration?.staffId) {
      throw new Error(kind === 'sms' ? 'Chưa tích hợp akaBiz Sms.' : 'Chưa tích hợp akaBiz Zalo Web.')
    }
    return listAkaBizCampaigns(kind, integration.staffId)
  })
}
