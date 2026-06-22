import { ipcMain } from 'electron'
import { IPC_EVENTS, ZaloGroupMemberScanRequest } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { ContactLoader } from '../../services/contactLoader'
import * as localContactRepo from '../../data/repositories/localAccountContactRepository'

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

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_POST_COMMENTERS, async (_, accountId: number, postUrl: string, maxCommenters: number) => {
    return contactLoader.loadPostCommenters(accountId, postUrl, maxCommenters)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_PAGE_INBOX_CUSTOMERS, async (_, accountId: number, pageUid: string, pageName?: string) => {
    return contactLoader.loadPageInboxCustomers(accountId, pageUid, pageName)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_ZALO_GROUP_MEMBERS, async (_, accountId: number, request: ZaloGroupMemberScanRequest) => {
    return contactLoader.loadZaloGroupMembers(accountId, request)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_CANCEL_LOAD, async (_, accountId: number) => {
    contactLoader.cancelLoad(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST, async (_, accountId: number, contactType?: string) => {
    return supabase.listContacts(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST_PAGE_INBOX, async (_, accountId: number, query = {}) => {
    return localContactRepo.listPageInboxContacts(accountId, query as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST_ZALO_GROUP_MEMBERS, async (_, accountId: number, zaloGroupId: string) => {
    return supabase.listZaloGroupMemberContacts(accountId, zaloGroupId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_EXPORT_PAGE_INBOX, async (_, accountId: number, query = {}) => {
    return localContactRepo.exportPageInboxContacts(accountId, query as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_DELETE, async (_, accountId: number, contactType: string) => {
    if (contactType === 'page_inbox_customer') {
      return localContactRepo.deletePageInboxContacts(accountId)
    }
    return supabase.deleteContacts(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_LIST, async (_, accountId: number, contactType?: string) => {
    return supabase.listContactGroups(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_CREATE, async (_, accountId: number, contactType: string, name: string) => {
    return supabase.createContactGroup(accountId, contactType as any, name)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_UPDATE, async (_, groupId: number, name: string) => {
    return supabase.updateContactGroup(groupId, name)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_DELETE, async (_, groupId: number) => {
    return supabase.deleteContactGroup(groupId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_LIST_CONTACTS, async (_, groupId: number) => {
    return supabase.listContactGroupContacts(groupId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_ADD_CONTACTS, async (_, groupId: number, contactIds: number[]) => {
    return supabase.addContactsToGroup(groupId, contactIds)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_REMOVE_CONTACTS, async (_, groupId: number, contactIds: number[]) => {
    return supabase.removeContactsFromGroup(groupId, contactIds)
  })
}
