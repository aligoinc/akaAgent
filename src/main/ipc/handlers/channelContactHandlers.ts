import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { ContactLoader } from '../../services/contactLoader'

export function registerChannelContactHandlers(supabase: SupabaseService, contactLoader: ContactLoader): void {
  ipcMain.handle(IPC_CHANNELS.CONTACTS_LOAD_FRIENDS, async (_, channelId: number) => {
    return contactLoader.loadFriends(channelId)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_LOAD_GROUPS, async (_, channelId: number) => {
    return contactLoader.loadGroups(channelId)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_LIST, async (_, channelId: number, contactType?: string) => {
    return supabase.listContacts(channelId, contactType as any)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_DELETE, async (_, channelId: number, contactType: string) => {
    return supabase.deleteContacts(channelId, contactType as any)
  })
}
