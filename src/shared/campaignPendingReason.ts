import type { CampaignListItem } from './types'

export const CAMPAIGN_PENDING_REASON_IPC = 'campaign:pending-reason'
export const CAMPAIGN_PENDING_REASON_TTL_MS = 5 * 60 * 1000
export const CAMPAIGN_PENDING_REASON_UNAVAILABLE = 'Chưa thể kiểm tra đầy đủ do lỗi kết nối hoặc tải dữ liệu. Vui lòng thử lại.'

export interface CampaignPendingReasonResult {
  campaignId: number
  /** Null means a real note/status/configuration change won the race. */
  message: string | null
  version: string
}

type PendingReasonCampaign = Pick<CampaignListItem, 'id' | 'accountId' | 'actionId' | 'status' | 'note' | 'isDelete' | 'schedule' | 'dailyStopTime' | 'updatedAt'>

export function canCheckCampaignPendingReason(campaign: PendingReasonCampaign): boolean {
  return campaign.status === 'chờ xử lý' && !campaign.isDelete && !campaign.note?.trim()
}

/** Compare observations, not object identity: ordinary list refreshes keep the result. */
export function campaignPendingReasonVersion(campaign: PendingReasonCampaign): string {
  const time = (value: string | null | undefined) => {
    if (!value) return ''
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? `${ms}:${(value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3, 6)}` : value
  }
  const stopParts = campaign.dailyStopTime?.split(':').map(Number)
  const stopTime = stopParts ? [stopParts[0], stopParts[1], stopParts[2] || 0].join(':') : ''
  return JSON.stringify([campaign.id, campaign.accountId, campaign.actionId, campaign.status,
    campaign.note || '', campaign.isDelete, time(campaign.schedule), stopTime, time(campaign.updatedAt)])
}
