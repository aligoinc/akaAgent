import type {
  ZaloLabelOption,
  ZaloSessionCheckResult
} from '../../shared/types'
import type {
  ZaloGroupInfoBatch,
  ZaloGroupMembersResult
} from './zaloRuntimeService'

/**
 * Read-only Zalo surface used by ContactLoader.
 *
 * The desktop runtime and Chat server runtime both implement this contract so
 * scan pacing, progress, cancellation and persistence stay in one place.
 */
export interface ZaloContactScanSource {
  checkSession(accountId: number): Promise<ZaloSessionCheckResult>
  getAllFriendsPage(
    accountId: number,
    count?: number,
    page?: number,
    onProgress?: (message: string) => void
  ): Promise<Record<string, unknown>[]>
  listLabels(accountId: number): Promise<ZaloLabelOption[]>
  getAllGroups(accountId: number, onProgress?: (message: string) => void): Promise<Record<string, string>>
  getGroupInfoBatch(
    accountId: number,
    groupIds: string[],
    onProgress?: (message: string) => void
  ): Promise<ZaloGroupInfoBatch>
  getJoinedGroupMembers(
    accountId: number,
    groupId: string
  ): Promise<ZaloGroupMembersResult>
  getGroupMembersByLink(
    accountId: number,
    link: string
  ): Promise<ZaloGroupMembersResult>
  cancelActiveQuery?(accountId: number): Promise<void> | void
}
