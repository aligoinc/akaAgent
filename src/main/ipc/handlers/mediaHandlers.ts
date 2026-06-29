import { ipcMain } from 'electron'
import { IPC_EVENTS, type MediaStorageSettings } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'

export function registerMediaHandlers(supabase: SupabaseService): void {
  ipcMain.handle(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_GET, async () => {
    return supabase.getMediaStorageSettings()
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_SAVE, async (_, settings: Partial<MediaStorageSettings>) => {
    return supabase.saveMediaStorageSettings(settings)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_STORAGE_SETTINGS_TEST, async (_, settings?: Partial<MediaStorageSettings>) => {
    return supabase.testMediaStorageSettings(settings)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_LIST, async () => {
    return supabase.listMediaFiles()
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_UPLOAD, async (_, localPaths: string[]) => {
    return supabase.uploadMediaFiles(localPaths)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_DELETE, async (_, id: number) => {
    return supabase.deleteMediaFile(id)
  })
}
