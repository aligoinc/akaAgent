import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS, FlowData, ExecutionStep } from '../../shared/types'
import { builtinActions } from '../../shared/actions'
import { PlaywrightController } from '../playwright/controller'
import { FlowRunner } from '../playwright/flowRunner'
import { SupabaseService } from '../services/supabase'

let playwrightController: PlaywrightController | null = null
let flowRunner: FlowRunner | null = null

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const supabase = new SupabaseService()

  // =========== ACTIONS ===========
  ipcMain.handle(IPC_CHANNELS.ACTIONS_LIST, () => {
    return builtinActions
  })

  // =========== BROWSER CONTROL ===========
  ipcMain.handle(IPC_CHANNELS.BROWSER_LAUNCH, async (_, options?: { headless?: boolean; profileName?: string }) => {
    if (!playwrightController) {
      playwrightController = new PlaywrightController()
    }
    await playwrightController.launch(options?.headless ?? false, options?.profileName ?? 'default')
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE, async () => {
    if (playwrightController) {
      await playwrightController.close()
      playwrightController = null
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.BROWSER_STATUS, () => {
    return { connected: playwrightController?.isConnected() ?? false }
  })

  // =========== FLOW EXECUTION ===========
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

  // =========== DATABASE ===========
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_FLOW, async (_, flowData: FlowData) => {
    return supabase.saveFlow(flowData)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LOAD_FLOW, async (_, flowId: string) => {
    return supabase.loadFlow(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_FLOWS, async () => {
    return supabase.listFlows()
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_FLOW, async (_, flowId: string) => {
    return supabase.deleteFlow(flowId)
  })

  // Removed DB_SAVE_RUN as FlowRunner saves directly to the DB

  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUNS, async (_, flowId?: string) => {
    return supabase.listRuns(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUN_STEPS, async (_, runId: string) => {
    return supabase.listRunSteps(runId)
  })

  // =========== ELEMENTS ===========
  ipcMain.handle(IPC_CHANNELS.DB_SAVE_ELEMENT, async (_, element) => {
    return supabase.saveElement(element)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_ELEMENTS, async () => {
    return supabase.listElements()
  })

  ipcMain.handle(IPC_CHANNELS.DB_DELETE_ELEMENT, async (_, elementId: string) => {
    return supabase.deleteElement(elementId)
  })
}
