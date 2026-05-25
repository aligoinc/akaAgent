import { ipcMain } from 'electron'
import { IPC_EVENTS, type ContentTemplate } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerContentTemplateHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.DB_LIST_CONTENT_TEMPLATES, async () => {
    return supabase.listContentTemplates()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CONTENT_TEMPLATE, async (_, templateData: Partial<ContentTemplate>) => {
    return supabase.createContentTemplate(templateData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CONTENT_TEMPLATE, async (_, id: number, updates: Partial<ContentTemplate>) => {
    return supabase.updateContentTemplate(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CONTENT_TEMPLATE, async (_, id: number) => {
    return supabase.deleteContentTemplate(id)
  })
}
