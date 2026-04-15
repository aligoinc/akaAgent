import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep } from '../../../shared/types'
import { PlaywrightController } from '../../playwright/controller'
import { FlowRunner } from '../../playwright/flowRunner'
import { SupabaseService } from '../../services/supabase'

let playwrightController: PlaywrightController | null = null
let flowRunner: FlowRunner | null = null

export function registerFlowHandlers(mainWindow: BrowserWindow, supabase: SupabaseService): void {
  ipcMain.handle(IPC_CHANNELS.FLOW_RUN, async (_, flowData: FlowData) => {
    if (!playwrightController || !playwrightController.isConnected()) {
      throw new Error('Browser not launched. Please launch browser first.')
    }

    flowRunner = new FlowRunner(playwrightController, supabase, (step: ExecutionStep) => {
      mainWindow.webContents.send(IPC_CHANNELS.FLOW_PROGRESS, step)
    })

    try {
      const result = await flowRunner.run(flowData)
      return result
    } catch (error) {
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.FLOW_STOP, async () => {
    if (flowRunner) {
      flowRunner.stop()
      flowRunner = null
    }
    return { success: true }
  })
}

export function getPlaywrightController(): PlaywrightController | null {
  return playwrightController
}

export function setPlaywrightController(ctrl: PlaywrightController | null): void {
  playwrightController = ctrl
}
