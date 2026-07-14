import { ipcMain } from 'electron'
import { IPC_EVENTS, type MediaGroup, type MediaStorageSettings } from '../../../shared/types'
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

  ipcMain.handle(IPC_EVENTS.MEDIA_FILES_DELETE_MANY, async (_, ids: number[]) => {
    return supabase.deleteMediaFiles(ids)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_LIST, async () => {
    return supabase.listMediaGroups()
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_CREATE, async (_, group: Partial<MediaGroup>) => {
    return supabase.createMediaGroup(group)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_UPDATE, async (_, id: number, updates: Partial<MediaGroup>) => {
    return supabase.updateMediaGroup(id, updates)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUPS_DELETE, async (_, id: number) => {
    return supabase.deleteMediaGroup(id)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUP_FILE_IDS_LIST, async (_, groupId: number) => {
    return supabase.listMediaGroupFileIds(groupId)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUP_FILES_ADD, async (_, groupId: number, mediaFileIds: number[]) => {
    return supabase.addMediaGroupFiles(groupId, mediaFileIds)
  })

  ipcMain.handle(IPC_EVENTS.MEDIA_GROUP_FILES_REMOVE, async (_, groupId: number, mediaFileIds: number[]) => {
    return supabase.removeMediaGroupFiles(groupId, mediaFileIds)
  })
}
