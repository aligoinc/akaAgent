import type { AutoAccount, CampaignAction } from './types'
import { getCampaignSupportedActionDescriptors, isCommentSeedingCampaign, type CampaignActionDescriptor } from './campaignActionDescriptors'

export interface CampaignAccountActionScope {
  accountIds: number[]
  actionCodes: string[]
}

export interface CampaignAccountActionDailyState {
  actionCode: string
  dailyActionCount: number
  isDisable: boolean
  remainingMinutes: number | null
}

export interface CampaignAccountActionSnapshot {
  capturedAt: string | null
  accounts: { accountId: number; actions: CampaignAccountActionDailyState[] }[]
}

/** Keep the picker and its opening statistics scope on the same account rules. */
export function canSelectAccountForCampaignAction(
  account: Pick<AutoAccount, 'flatformType' | 'isZaloShowWeb'>,
  action: Pick<CampaignAction, 'id' | 'flatformType'>
): boolean {
  return account.flatformType.trim().toLowerCase() === action.flatformType.trim().toLowerCase()
    && (action.id !== 'zalo_message_group_realtime' || account.isZaloShowWeb !== true)
}

/** Main actions stay visible; companion actions follow the form's actual toggles. */
export function getCampaignAccountPickerActionDescriptors(
  actionId: string,
  options: { enableComment?: boolean; enablePostLike?: boolean } = {}
): CampaignActionDescriptor[] {
  return getCampaignSupportedActionDescriptors(actionId).filter(action => {
    if (actionId === 'facebook_timeline_post') return action.code === 'fb_post_my_profile'
    if (actionId === 'facebook_group_post') {
      return action.code === 'fb_post_group' || (action.code === 'fb_comment' && options.enableComment === true)
    }
    if (isCommentSeedingCampaign(actionId) && action.code === 'fb_like_post') return options.enablePostLike === true
    return true
  })
}

/** All picker columns and daily-limit counters available in this form, fetched once. */
export function buildCampaignAccountActionScopes(
  accounts: Pick<AutoAccount, 'id' | 'flatformType' | 'isZaloShowWeb'>[],
  campaignActions: Pick<CampaignAction, 'id' | 'flatformType' | 'limitCheckActionCodes'>[]
): CampaignAccountActionScope[] {
  const candidates = campaignActions.map(action => {
    const codes = new Set<string>()
    // Include companions that can be enabled later without another request.
    for (const descriptor of getCampaignAccountPickerActionDescriptors(action.id, { enableComment: true, enablePostLike: true })) codes.add(descriptor.code)
    // The daily limit editor shares this snapshot, including optional limits.
    for (const code of action.limitCheckActionCodes || []) codes.add(code)
    return { action, codes }
  })
  const groups = new Map<string, CampaignAccountActionScope>()
  for (const account of accounts) {
    const codes = new Set<string>()
    for (const candidate of candidates) {
      if (!canSelectAccountForCampaignAction(account, candidate.action)) continue
      candidate.codes.forEach(code => codes.add(code))
    }
    if (codes.size === 0) continue
    const actionCodes = Array.from(codes)
    const key = JSON.stringify([...actionCodes].sort())
    const group = groups.get(key) ?? { accountIds: [], actionCodes }
    group.accountIds.push(account.id)
    groups.set(key, group)
  }
  return Array.from(groups.values())
}

export function formatCampaignAccountActionState(row: CampaignAccountActionDailyState): string {
  return `${row.dailyActionCount} - ${row.isDisable ? 'Bị giới hạn' : 'Bình thường'}${
    row.isDisable && row.remainingMinutes !== null ? ` - Còn ${row.remainingMinutes} phút` : ''
  }`
}
