import { BrowserWindow, ipcMain } from 'electron'
import type {
  AutomationExecutionListQuery,
  AutomationInput,
  AutomationListQuery,
  AutomationUpdatedEvent,
  CampaignAutomationExecutionListQuery
} from '../../../shared/types'
import { IPC_EVENTS } from '../../../shared/types'
import * as automationRepo from '../../data/repositories/automationRepository'

export function emitAutomationUpdated(
  window: BrowserWindow | null | undefined,
  event: AutomationUpdatedEvent
): void {
  try {
    if (window && !window.isDestroyed()) window.webContents.send(IPC_EVENTS.AUTOMATION_UPDATED, event)
  } catch {
    // Renderer or the server event bridge may already be closing.
  }
}

export function registerAutomationHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_EVENTS.AUTOMATION_LIST, async (_, query?: AutomationListQuery) => {
    return automationRepo.listAutomations(query)
  })

  ipcMain.handle(IPC_EVENTS.AUTOMATION_GET, async (_, id: number) => {
    return automationRepo.getAutomation(id)
  })

  ipcMain.handle(IPC_EVENTS.AUTOMATION_OPTIONS, async () => {
    return automationRepo.getAutomationOptions()
  })

  ipcMain.handle(IPC_EVENTS.AUTOMATION_CREATE, async (_, input: AutomationInput) => {
    const automation = await automationRepo.createAutomation(input)
    emitAutomationUpdated(mainWindow, { automationId: automation.id, reason: 'created' })
    return automation
  })

  ipcMain.handle(IPC_EVENTS.AUTOMATION_UPDATE, async (_, id: number, input: AutomationInput) => {
    const automation = await automationRepo.updateAutomation(id, input)
    emitAutomationUpdated(mainWindow, { automationId: automation.id, reason: 'updated' })
    return automation
  })

  ipcMain.handle(IPC_EVENTS.AUTOMATION_SET_ACTIVE, async (_, id: number, isActive: boolean) => {
    const automation = await automationRepo.setAutomationActive(id, isActive)
    emitAutomationUpdated(mainWindow, { automationId: automation.id, reason: 'active_changed' })
    return automation
  })

  ipcMain.handle(IPC_EVENTS.AUTOMATION_DELETE, async (_, id: number) => {
    await automationRepo.deleteAutomation(id)
    emitAutomationUpdated(mainWindow, { automationId: Number(id), reason: 'deleted' })
  })

  ipcMain.handle(
    IPC_EVENTS.AUTOMATION_DETAILS_LIST,
    async (_, automationId: number, query?: AutomationExecutionListQuery) => {
      return automationRepo.listAutomationDetails(automationId, query)
    }
  )

  ipcMain.handle(
    IPC_EVENTS.AUTOMATION_CAMPAIGN_DETAILS_LIST,
    async (_, query: CampaignAutomationExecutionListQuery) => {
      return automationRepo.listCampaignAutomationDetails(query)
    }
  )
}
