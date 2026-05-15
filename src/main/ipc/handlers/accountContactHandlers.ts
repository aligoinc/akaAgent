import { ipcMain } from 'electron'
import { IPC_EVENTS } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { ContactLoader } from '../../services/contactLoader'

export function registerAccountContactHandlers(supabase: SupabaseService, contactLoader: ContactLoader): void {
  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_FRIENDS, async (_, accountId: number) => {
    return contactLoader.loadFriends(accountId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_GROUPS, async (_, accountId: number) => {
    return contactLoader.loadGroups(accountId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_PAGES, async (_, accountId: number) => {
    return contactLoader.loadPages(accountId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_CANCEL_LOAD, async (_, accountId: number) => {
    contactLoader.cancelLoad(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST, async (_, accountId: number, contactType?: string) => {
    return supabase.listContacts(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_DELETE, async (_, accountId: number, contactType: string) => {
    return supabase.deleteContacts(accountId, contactType as any)
  })
}
