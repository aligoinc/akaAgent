import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerRunHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUNS, async (_, flowId?: string) => {
    return supabase.listRuns(flowId)
  })

  ipcMain.handle(IPC_CHANNELS.DB_LIST_RUN_STEPS, async (_, runId: string) => {
    return supabase.listRunSteps(runId)
  })
}
