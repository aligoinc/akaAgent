import type { NotificationListItem } from '../../../../shared/types'

/**
 * Đích "Mở nhanh" của một thông báo trong Desktop, cùng quy tắc `notificationTargetPath()` của
 * WebApp: chiến dịch, tài khoản và nhóm data mở đúng đối tượng; báo cáo và gửi thử chỉ xem chi tiết.
 */
export type NotificationTargetKind = 'campaign' | 'account' | 'dataGroup'

export interface NotificationTarget {
  kind: NotificationTargetKind
  id: number
}

export const NOTIFICATION_TARGET_LABELS: Record<NotificationTargetKind, string> = {
  campaign: 'Mở chiến dịch',
  account: 'Mở tài khoản',
  dataGroup: 'Mở nhóm data'
}

type TargetSource = Pick<NotificationListItem, 'eventType' | 'entityKey' | 'campaignId' | 'accountId' | 'dataGroupId'>

function positiveId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Ưu tiên cột id của thông báo, nếu trống thì đọc từ `entityKey` dạng "campaign:12". */
function entityId(item: TargetSource, kind: string, column: number | null): number | null {
  const fromColumn = positiveId(column)
  if (fromColumn) return fromColumn
  const [entityKind, rawId] = (item.entityKey || '').split(':')
  return entityKind === kind ? positiveId(rawId) : null
}

export function notificationTarget(item: TargetSource): NotificationTarget | null {
  if (item.eventType === 'campaign.status_changed') {
    const id = entityId(item, 'campaign', item.campaignId)
    return id ? { kind: 'campaign', id } : null
  }
  if (item.eventType === 'account.status_changed') {
    const id = entityId(item, 'account', item.accountId)
    return id ? { kind: 'account', id } : null
  }
  if (item.eventType === 'data_group.membership_changed') {
    const id = entityId(item, 'group', item.dataGroupId)
    return id ? { kind: 'dataGroup', id } : null
  }
  return null
}
