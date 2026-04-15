import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerElementHandlers(supabase: SupabaseService): void {
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
