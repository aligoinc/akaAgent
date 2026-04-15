import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { ContactLoader } from '../../services/contactLoader'

export function registerContactHandlers(supabase: SupabaseService, contactLoader: ContactLoader): void {
  ipcMain.handle(IPC_CHANNELS.CONTACTS_LOAD_FRIENDS, async (_, flatformAccountId: number) => {
    return contactLoader.loadFriends(flatformAccountId)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_LOAD_GROUPS, async (_, flatformAccountId: number) => {
    return contactLoader.loadGroups(flatformAccountId)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_LIST, async (_, flatformAccountId: number, contactType?: string) => {
    return supabase.listContacts(flatformAccountId, contactType as any)
  })

  ipcMain.handle(IPC_CHANNELS.CONTACTS_DELETE, async (_, flatformAccountId: number, contactType: string) => {
    return supabase.deleteContacts(flatformAccountId, contactType as any)
  })
}
