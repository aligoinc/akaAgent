import { isPackageExpiringNotification } from '../../../../shared/notificationCenter'
import { renewalReminderTexts, type RenewalReminderState } from '../../../../shared/renewalReminder'
import type { NotificationListItem } from '../../../../shared/types'

/**
 * Đích "Mở nhanh" của một thông báo trong Desktop, cùng quy tắc `notificationTargetPath()` của
 * WebApp: chiến dịch, tài khoản và nhóm data mở đúng đối tượng; "Gói sắp hết hạn" mở cửa sổ Gia hạn gói
 * khi đang có lời nhắc gia hạn; báo cáo và gửi thử chỉ xem chi tiết.
 */
export type NotificationEntityTargetKind = 'campaign' | 'account' | 'dataGroup'
export type NotificationTargetKind = NotificationEntityTargetKind | 'renewal'

export type NotificationTarget =
  | { kind: NotificationEntityTargetKind; id: number }
  /** Mở cửa sổ "Gia hạn gói"; `label` là chữ trên nút Gia hạn của lời nhắc hiện tại. */
  | { kind: 'renewal'; label: string }

export const NOTIFICATION_TARGET_LABELS: Record<NotificationEntityTargetKind, string> = {
  campaign: 'Mở chiến dịch',
  account: 'Mở tài khoản',
  dataGroup: 'Mở nhóm data'
}

export function notificationTargetLabel(target: NotificationTarget): string {
  return target.kind === 'renewal' ? target.label : NOTIFICATION_TARGET_LABELS[target.kind]
}

/**
 * Nút gia hạn cho thông báo "Gói sắp hết hạn": chỉ khi tiến trình chính đang có lời nhắc (chưa gia hạn, tính năng bật).
 * Đã gia hạn hoặc tính năng tắt thì không có nút, thông báo chỉ mở chi tiết.
 */
export function renewalNotificationTarget(state: RenewalReminderState | null | undefined): NotificationTarget | null {
  if (!state?.enabled || !state.reminder || !state.today) return null
  const label = renewalReminderTexts(state.reminder, state.today).button
  return label ? { kind: 'renewal', label } : null
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

export function notificationTarget(item: TargetSource, renewalState?: RenewalReminderState | null): NotificationTarget | null {
  if (isPackageExpiringNotification(item)) return renewalNotificationTarget(renewalState)
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
