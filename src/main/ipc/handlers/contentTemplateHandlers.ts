import { ipcMain } from 'electron'
import {
  IPC_EVENTS,
  type CreateContentTemplateGroupInput,
  type CreateContentTemplateInput,
  type UpdateContentTemplateGroupInput,
  type UpdateContentTemplateInput
} from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerContentTemplateHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.DB_LIST_CONTENT_TEMPLATES, async () => {
    return supabase.listContentTemplates()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CONTENT_TEMPLATE, async (_, templateData: CreateContentTemplateInput) => {
    return supabase.createContentTemplate(templateData)
  })

  ipcMain.handle(IPC_EVENTS.DB_UPDATE_CONTENT_TEMPLATE, async (_, id: number, updates: UpdateContentTemplateInput) => {
    return supabase.updateContentTemplate(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CONTENT_TEMPLATE, async (_, id: number) => {
    return supabase.deleteContentTemplate(id)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CONTENT_TEMPLATE_GROUPS, async () => {
    return supabase.listContentTemplateGroups()
  })

  ipcMain.handle(IPC_EVENTS.DB_CREATE_CONTENT_TEMPLATE_GROUP, async (_, input: CreateContentTemplateGroupInput) => {
    return supabase.createContentTemplateGroup(input)
  })

  ipcMain.handle(
    IPC_EVENTS.DB_UPDATE_CONTENT_TEMPLATE_GROUP,
    async (_, id: number, updates: UpdateContentTemplateGroupInput) => {
      return supabase.updateContentTemplateGroup(id, updates)
    }
  )

  ipcMain.handle(IPC_EVENTS.DB_DELETE_CONTENT_TEMPLATE_GROUP, async (_, id: number) => {
    return supabase.deleteContentTemplateGroup(id)
  })

  ipcMain.handle(IPC_EVENTS.DB_LIST_CONTENT_TEMPLATE_CONTENT_TYPES, async () => {
    return supabase.listContentTemplateContentTypes()
  })
}
