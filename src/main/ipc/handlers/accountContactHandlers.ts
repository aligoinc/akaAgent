import { ipcMain } from 'electron'
import { AccountContactListQuery, BindCampaignDataGroupSourceRequest, CreateCampaignBundleRequest, CreateDataGroupRequest, DataGroupCampaignTargetPreviewRequest, DataGroupIngestRequest, DataGroupListQuery, DataGroupMemberListQuery, DataGroupMemberMutationRequest, ContactDatasetListQuery, ContactType, IPC_EVENTS, MoveDataGroupMembersRequest, SaveUploadDatasetRequest, SnapshotDataGroupToCampaignRequest, UpdateDataGroupRequest, ZaloGroupMemberContactListQuery, ZaloGroupMemberScanRequest, ZaloRemarketingCustomerListQuery } from '../../../shared/types'
import { SupabaseService } from '../../services/supabase'
import { ContactLoader } from '../../services/contactLoader'
import { ZaloServerClient } from '../../services/zaloServerClient'
import * as localContactRepo from '../../data/repositories/localAccountContactRepository'
import {
  ensureCurrentUserCanUseAccountPlatform,
  ensureCurrentUserFeatureActive
} from '../../data/repositories/entitlementRepository'

async function ensureContactAccess(
  supabase: SupabaseService,
  accountId: number,
  contactType?: string | null
): Promise<void> {
  const account = await supabase.getAccount(accountId)
  if (!account) {
    throw new Error('Tài khoản không tồn tại hoặc không thuộc quyền quản lý của bạn')
  }
  if (contactType === 'page' || contactType === 'page_inbox_customer') {
    await ensureCurrentUserFeatureActive('facebookFanpage')
    return
  }
  if (contactType === 'zalo_tag') {
    await ensureCurrentUserFeatureActive('zalo')
    return
  }

  if (account?.flatformType === 'zalo') {
    await ensureCurrentUserFeatureActive('zalo')
    return
  }
  if (contactType === 'person' || contactType === 'group') {
    await ensureCurrentUserFeatureActive('facebookCore')
    return
  }
  await ensureCurrentUserCanUseAccountPlatform(account?.flatformType || 'facebook')
}

export function registerAccountContactHandlers(
  supabase: SupabaseService,
  contactLoader: ContactLoader,
  zaloServerClient?: ZaloServerClient
): void {
  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_FRIENDS, async (_, accountId: number) => {
    await ensureContactAccess(supabase, accountId, 'person')
    const account = await supabase.getAccount(accountId)
    if (account?.flatformType === 'zalo' && account.isZaloServer) {
      if (!zaloServerClient) throw new Error('Chưa kết nối akaAgent Zalo Server')
      return zaloServerClient.executeCommand('contacts.loadFriends', accountId)
    }
    return contactLoader.loadFriends(accountId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_GROUPS, async (_, accountId: number) => {
    await ensureContactAccess(supabase, accountId, 'group')
    const account = await supabase.getAccount(accountId)
    if (account?.flatformType === 'zalo' && account.isZaloServer) {
      if (!zaloServerClient) throw new Error('Chưa kết nối akaAgent Zalo Server')
      return zaloServerClient.executeCommand('contacts.loadGroups', accountId)
    }
    return contactLoader.loadGroups(accountId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_PAGES, async (_, accountId: number) => {
    await ensureContactAccess(supabase, accountId, 'page')
    return contactLoader.loadPages(accountId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_POST_COMMENTERS, async (_, accountId: number, postUrl: string, maxCommenters: number) => {
    await ensureContactAccess(supabase, accountId, 'person')
    return contactLoader.loadPostCommenters(accountId, postUrl, maxCommenters)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_POST_LIKES, async (_, accountId: number, postUrl: string, maxLikes: number) => {
    await ensureContactAccess(supabase, accountId, 'person')
    return contactLoader.loadPostLikes(accountId, postUrl, maxLikes)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_PROFILE_FRIENDS, async (_, accountId: number, profileUrl: string, maxFriends: number) => {
    await ensureContactAccess(supabase, accountId, 'person')
    return contactLoader.loadProfileFriends(accountId, profileUrl, maxFriends)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_GROUP_MEMBERS, async (_, accountId: number, groupUrl: string, maxGroupMembers: number) => {
    await ensureContactAccess(supabase, accountId, 'person')
    return contactLoader.loadGroupMembers(accountId, groupUrl, maxGroupMembers)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_PAGE_INBOX_CUSTOMERS, async (_, accountId: number, pageUid: string, pageName?: string) => {
    await ensureContactAccess(supabase, accountId, 'page_inbox_customer')
    return contactLoader.loadPageInboxCustomers(accountId, pageUid, pageName)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LOAD_ZALO_GROUP_MEMBERS, async (_, accountId: number, request: ZaloGroupMemberScanRequest) => {
    await ensureContactAccess(supabase, accountId, 'zalo_tag')
    const account = await supabase.getAccount(accountId)
    if (account?.flatformType === 'zalo' && account.isZaloServer) {
      if (!zaloServerClient) throw new Error('Chưa kết nối akaAgent Zalo Server')
      return zaloServerClient.executeCommand('contacts.loadZaloGroupMembers', accountId, request)
    }
    return contactLoader.loadZaloGroupMembers(accountId, request)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_CANCEL_LOAD, async (_, accountId: number) => {
    const account = await supabase.getAccountIgnoringCapability(accountId)
    if (!account) {
      throw new Error('Tài khoản không tồn tại hoặc không thuộc quyền quản lý của bạn')
    }
    if (account?.flatformType === 'zalo' && account.isZaloServer) {
      if (!zaloServerClient) throw new Error('Chưa kết nối akaAgent Zalo Server')
      return zaloServerClient.executeCommand('contacts.cancel', accountId)
    }
    contactLoader.cancelLoad(accountId)
    return { success: true }
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST, async (_, accountId: number, contactType?: string) => {
    await ensureContactAccess(supabase, accountId, contactType)
    return supabase.listContacts(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_DATASETS_LIST, async (_, query: ContactDatasetListQuery) => {
    if (!query || !Number.isSafeInteger(query.accountId) || query.accountId <= 0) {
      throw new Error('Tài khoản không hợp lệ')
    }
    await ensureContactAccess(supabase, query.accountId, query.contactType)
    return supabase.listContactDatasets(query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_DATASETS_SAVE_UPLOAD, async (_, request: SaveUploadDatasetRequest) => {
    const requestedAccountIds = Array.isArray(request?.accountIds) ? request.accountIds : []
    const accountIds = Array.from(new Set(requestedAccountIds))
      .filter(accountId => Number.isSafeInteger(accountId) && accountId > 0)
    if (accountIds.length === 0) {
      throw new Error('Vui lòng chọn ít nhất một tài khoản')
    }
    for (const accountId of accountIds) {
      await ensureContactAccess(supabase, accountId)
    }
    return supabase.saveUploadDataset({ ...request, accountIds })
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST_PAGED, async (_, accountId: number, query: AccountContactListQuery = {}) => {
    await ensureContactAccess(supabase, accountId, query.contactType)
    return supabase.listContactsPage(accountId, query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST_PAGE_INBOX, async (_, accountId: number, query = {}) => {
    await ensureContactAccess(supabase, accountId, 'page_inbox_customer')
    return localContactRepo.listPageInboxContacts(accountId, query as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST_ZALO_GROUP_MEMBERS, async (_, accountId: number, query: ZaloGroupMemberContactListQuery = {}) => {
    await ensureContactAccess(supabase, accountId, 'zalo_tag')
    return supabase.listZaloGroupMemberContacts(accountId, query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_LIST_ZALO_REMARKETING_CUSTOMERS, async (_, accountId: number, query: ZaloRemarketingCustomerListQuery = {}) => {
    await ensureContactAccess(supabase, accountId, 'zalo_tag')
    return supabase.listZaloRemarketingCustomers(accountId, query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_EXPORT_PAGE_INBOX, async (_, accountId: number, query = {}) => {
    await ensureContactAccess(supabase, accountId, 'page_inbox_customer')
    return localContactRepo.exportPageInboxContacts(accountId, query as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_EXPORT_PAGED, async (_, accountId: number, query: AccountContactListQuery = {}) => {
    await ensureContactAccess(supabase, accountId, query.contactType)
    return supabase.exportContactsPage(accountId, query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_EXPORT_ZALO_GROUP_MEMBERS, async (_, accountId: number, query: ZaloGroupMemberContactListQuery = {}) => {
    await ensureContactAccess(supabase, accountId, 'zalo_tag')
    return supabase.exportZaloGroupMemberContacts(accountId, query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_EXPORT_ZALO_REMARKETING_CUSTOMERS, async (_, accountId: number, query: ZaloRemarketingCustomerListQuery = {}) => {
    await ensureContactAccess(supabase, accountId, 'zalo_tag')
    return supabase.exportZaloRemarketingCustomers(accountId, query)
  })

  ipcMain.handle(IPC_EVENTS.CONTACTS_DELETE, async (_, accountId: number, contactType: string) => {
    await ensureContactAccess(supabase, accountId, contactType)
    if (contactType === 'page_inbox_customer') {
      return localContactRepo.deletePageInboxContacts(accountId)
    }
    return supabase.deleteContacts(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_LIST, async (_, accountId: number, contactType?: string) => {
    await ensureContactAccess(supabase, accountId, contactType)
    return supabase.listContactGroups(accountId, contactType as any)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_CREATE, async (_, accountId: number, contactType: string, name: string) => {
    await ensureContactAccess(supabase, accountId, contactType)
    return supabase.createContactGroup(accountId, contactType as any, name)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_UPDATE, async (_, groupId: number, name: string) => {
    return supabase.updateContactGroup(groupId, name)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_DELETE, async (_, groupId: number) => {
    return supabase.deleteContactGroup(groupId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_LIST_CONTACTS, async (_, groupId: number, accountId: number, contactType?: ContactType) => {
    await ensureContactAccess(supabase, accountId, contactType)
    return supabase.listContactGroupContacts(groupId, accountId, contactType)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_CONTACT_TAGS_LIST, async () => {
    return supabase.listAkaBizContactTags()
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_CONTACT_TAGS_CREATE, async (_, name: string) => {
    return supabase.createAkaBizContactTag(name)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_CONTACT_TAGS_UPDATE, async (_, tagId: number, name: string) => {
    return supabase.updateAkaBizContactTag(tagId, name)
  })

  ipcMain.handle(IPC_EVENTS.AKABIZ_CONTACT_TAGS_DELETE, async (_, tagId: number) => {
    return supabase.deleteAkaBizContactTag(tagId)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_ADD_CONTACTS, async (_, groupId: number, contactIds: number[]) => {
    return supabase.addContactsToGroup(groupId, contactIds)
  })

  ipcMain.handle(IPC_EVENTS.CONTACT_GROUPS_REMOVE_CONTACTS, async (_, groupId: number, contactIds: number[]) => {
    return supabase.removeContactsFromGroup(groupId, contactIds)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_LIST, async (_, query: DataGroupListQuery = {}) => {
    return supabase.listDataGroups(query)
  })

  ipcMain.handle(IPC_EVENTS.DATA_TYPE_CATEGORIES_LIST, async () => {
    return supabase.listDataTypeCategoryItems()
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_CREATE, async (_, request: CreateDataGroupRequest) => {
    return supabase.createDataGroup(request)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_UPDATE, async (_, request: UpdateDataGroupRequest) => {
    return supabase.updateDataGroup(request)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_DELETE, async (
    _,
    groupId: number,
    requestId: string,
    detachAutomations?: boolean
  ) => {
    return supabase.deleteDataGroup(groupId, requestId, detachAutomations !== false)
  })

  ipcMain.handle(
    IPC_EVENTS.DATA_GROUPS_DUPLICATE,
    async (_, groupId: number, name: string | null, requestId: string) => {
      return supabase.duplicateDataGroup(groupId, name, requestId)
    }
  )

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_LIST_MEMBERS, async (_, query: DataGroupMemberListQuery) => {
    return supabase.listDataGroupMembers(query)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_LIST_MEMBER_IDS, async (_, query: DataGroupMemberListQuery) => {
    return supabase.listDataGroupMemberIds(query)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_LIST_DATASETS, async (_, groupId: number) => {
    return supabase.listDataGroupDatasets(groupId)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_GET_LATEST_INGEST_STATS, async (_, groupId: number) => {
    return supabase.getDataGroupLatestIngestStats(groupId)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_EXPORT_MEMBERS, async (_, query: DataGroupMemberListQuery) => {
    return supabase.exportDataGroupMembers(query)
  })

  ipcMain.handle(IPC_EVENTS.DATA_GROUPS_INGEST, async (_, request: DataGroupIngestRequest) => {
    return supabase.ingestDataGroup(request)
  })

  ipcMain.handle(
    IPC_EVENTS.DATA_GROUPS_REMOVE_MEMBERS,
    async (_, request: DataGroupMemberMutationRequest) => supabase.removeDataGroupMembers(request)
  )

  ipcMain.handle(
    IPC_EVENTS.DATA_GROUPS_MOVE_MEMBERS,
    async (_, request: MoveDataGroupMembersRequest) => supabase.moveDataGroupMembers(request)
  )

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_DATA_GROUP_TARGETS_PREVIEW,
    async (_, request: DataGroupCampaignTargetPreviewRequest) => (
      supabase.previewDataGroupCampaignTargets(request)
    )
  )

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_DATA_GROUP_SOURCE_BIND,
    async (_, request: BindCampaignDataGroupSourceRequest) => supabase.bindCampaignDataGroupSource(request)
  )

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_DATA_GROUP_SNAPSHOT_ADD,
    async (_, request: SnapshotDataGroupToCampaignRequest) => supabase.snapshotDataGroupToCampaign(request)
  )

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_DATA_GROUP_SOURCE_PREFLIGHT_CHANGE,
    async (_, campaignId: number, groupId: number) => (
      supabase.preflightCampaignDataGroupChange(campaignId, groupId)
    )
  )

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_CREATION_BUNDLE_CREATE,
    async (_, request: CreateCampaignBundleRequest) => supabase.createCampaignCreationBundle(request)
  )

  ipcMain.handle(IPC_EVENTS.CAMPAIGN_DATA_GROUP_SOURCE_GET, async (_, campaignId: number) => {
    return supabase.getCampaignDataGroupSource(campaignId)
  })

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_DATA_GROUP_SOURCE_STOP,
    async (_, campaignId: number, requestId: string, reason?: string) => (
      supabase.stopCampaignDataGroupSource(campaignId, requestId, reason)
    )
  )

  ipcMain.handle(
    IPC_EVENTS.CAMPAIGN_DATA_GROUP_SOURCE_REACTIVATE,
    async (_, campaignId: number, requestId: string) => (
      supabase.reactivateCampaignDataGroupSource(campaignId, requestId)
    )
  )

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_LIST, async (_, accountId: number) => {
    await ensureContactAccess(supabase, accountId, 'person')
    return supabase.listZaloFriendBlocklists(accountId)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_CREATE, async (_, accountId: number, name: string) => {
    await ensureContactAccess(supabase, accountId, 'person')
    return supabase.createZaloFriendBlocklist(accountId, name)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_UPDATE, async (_, groupId: number, name: string) => {
    return supabase.updateZaloFriendBlocklist(groupId, name)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_DELETE, async (_, groupId: number) => {
    return supabase.deleteZaloFriendBlocklist(groupId)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_LIST_FRIENDS, async (_, groupId: number) => {
    return supabase.listZaloFriendBlocklistFriends(groupId)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_ADD_FRIENDS, async (_, groupId: number, contactIds: number[]) => {
    return supabase.addFriendsToZaloFriendBlocklist(groupId, contactIds)
  })

  ipcMain.handle(IPC_EVENTS.ZALO_FRIEND_BLOCKLISTS_REMOVE_FRIENDS, async (_, groupId: number, contactIds: number[]) => {
    return supabase.removeFriendsFromZaloFriendBlocklist(groupId, contactIds)
  })
}
