import type {
  ZaloLabelOption,
  ZaloSessionCheckResult
} from '../../shared/types'
import type { SupabaseService } from './supabase'
import type {
  ZaloGroupInfoBatch,
  ZaloGroupMembersResult
} from './zaloRuntimeService'
import type { ZaloContactScanSource } from './zaloContactScanSource'
import type { ZaloChatApiClient } from './zaloChatApiClient'

const GROUP_LINK_PROXY_SETTING_KEY = 'zalo.group_link.ginfo_proxy_url'

function normalizeProxyUrl(value: unknown): string | undefined {
  const raw = String(value || '').trim()
  if (!raw) return undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw

  const parts = raw.split(':')
  if (parts.length >= 4) {
    const [host, port, username, ...passwordParts] = parts
    const password = passwordParts.join(':')
    if (host && port && username) {
      return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`
    }
  }

  return `http://${raw}`
}

/** Chat-backed read source; ContactLoader remains the scan orchestrator/writer. */
export class ZaloChatContactScanSource implements ZaloContactScanSource {
  public constructor(
    private readonly chatApi: ZaloChatApiClient,
    private readonly supabase: Pick<SupabaseService, 'getSystemSettingValue'>
  ) {}

  public checkSession(accountId: number): Promise<ZaloSessionCheckResult> {
    return this.chatApi.checkSession(accountId)
  }

  public getAllFriendsPage(
    accountId: number,
    count = 500,
    page = 1
  ): Promise<Record<string, unknown>[]> {
    return this.chatApi.getAllFriendsPage(accountId, count, page)
  }

  public listLabels(accountId: number): Promise<ZaloLabelOption[]> {
    return this.chatApi.listLabels(accountId)
  }

  public getAllGroups(accountId: number): Promise<Record<string, string>> {
    return this.chatApi.getAllGroups(accountId)
  }

  public getGroupInfoBatch(
    accountId: number,
    groupIds: string[]
  ): Promise<ZaloGroupInfoBatch> {
    return this.chatApi.getGroupInfoBatch(accountId, groupIds)
  }

  public getJoinedGroupMembers(
    accountId: number,
    groupId: string
  ): Promise<ZaloGroupMembersResult> {
    return this.chatApi.getJoinedGroupMembers(accountId, groupId)
  }

  public async getGroupMembersByLink(
    accountId: number,
    link: string
  ): Promise<ZaloGroupMembersResult> {
    const proxyUrl = normalizeProxyUrl(await this.supabase
      .getSystemSettingValue(GROUP_LINK_PROXY_SETTING_KEY)
      .catch(() => ''))
    return this.chatApi.getGroupMembersByLink(accountId, link, proxyUrl)
  }

  public cancelActiveQuery(accountId: number): Promise<void> {
    return this.chatApi.cancelActiveQuery(accountId)
  }
}
