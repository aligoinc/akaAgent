import { useEffect } from 'react'
import { Check, X } from 'lucide-react'
import {
  formatVietnamDay,
  renewalCountdown,
  renewalReminderProductLabel,
  renewalReminderTexts,
  type RenewalReminder
} from '../../../../shared/renewalReminder'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { RENEWAL_LEVEL_ICONS, formatCountdownPart, renewalToneClass, useRenewalNow } from './renewalReminderUi'

/**
 * Hộp thoại nhắc gia hạn: một nút chính (Gia hạn/Gia hạn ngay/Nâng cấp), "Để sau" ("Đóng" ở ngày cuối), thẻ gói có thanh
 * thời gian đã dùng, vài lợi ích và (ngày cuối) đồng hồ tới 24:00. Không có giá: phần mềm không có dữ liệu giá.
 */
export default function RenewalReminderDialog({ reminder, today }: { reminder: RenewalReminder; today: string }) {
  const closeDialog = useRenewalReminderStore(store => store.closeDialog)
  const openWindow = useRenewalReminderStore(store => store.openWindow)
  // Số chiến dịch đang chạy đã có sẵn trong trang chiến dịch đang tải; không đọc thêm DB.
  const runningCount = useCampaignStore(store => store.campaignPage?.runningCampaigns?.length ?? 0)
  const lastDay = reminder.daysLeft <= 0
  const now = useRenewalNow(lastDay)
  const texts = renewalReminderTexts(reminder, today)
  const Icon = RENEWAL_LEVEL_ICONS[reminder.level]
  const paid = reminder.kind === 'paid'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDialog() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeDialog])

  const duration = reminder.product.durationDays
  const used = typeof duration === 'number' && duration > 0 ? Math.max(0, Math.min(duration, duration - reminder.daysLeft)) : null
  const countdown = renewalCountdown(reminder.expiresAtMs, now)
  const benefits = [
    ...(paid ? [`Hạn mới cộng tiếp từ ${formatVietnamDay(reminder.expiryDay)}.`] : []),
    'Tài khoản và chiến dịch giữ nguyên, không phải cài đặt lại.',
    ...(texts.offer ? [`${texts.offer}.`] : [])
  ]

  return (
    <div className="modal-overlay renewal-reminder-overlay" onClick={closeDialog}>
      <div className={`renewal-reminder-dialog ${renewalToneClass(reminder.level)}`}
        role={reminder.level === 'strong' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="renewal-reminder-title"
        onClick={event => event.stopPropagation()}>
        <div className="renewal-reminder-dialog-head">
          <span className="renewal-reminder-dialog-icon"><Icon size={20} aria-hidden="true" /></span>
          <div className="renewal-reminder-dialog-heading">
            {lastDay && <span className="renewal-reminder-dialog-badge">Ngày cuối cùng</span>}
            <h2 id="renewal-reminder-title">{texts.title}</h2>
            <p>{texts.dialogMessage}</p>
            {texts.others && <p className="renewal-reminder-muted">Bạn còn {texts.others.replace(/^và /, '')} sắp hết hạn.</p>}
          </div>
          <button type="button" className="btn-icon" onClick={closeDialog} aria-label="Đóng"><X size={16} /></button>
        </div>

        {lastDay && (
          <div className="renewal-reminder-countdown renewal-reminder-countdown-large" role="timer" aria-live="off">
            {[[countdown.hours, 'giờ'], [countdown.minutes, 'phút'], [countdown.seconds, 'giây']].map(([value, unit]) => (
              <div key={unit} className="renewal-reminder-countdown-cell">
                <strong>{formatCountdownPart(Number(value))}</strong><span>{unit}</span>
              </div>
            ))}
          </div>
        )}

        <div className="renewal-reminder-product">
          <div className="renewal-reminder-product-head">
            <strong>{renewalReminderProductLabel(reminder)}</strong>
            <span>{paid ? `Hết hạn ${formatVietnamDay(reminder.expiryDay)}` : `Hết hạn lúc 24:00 ngày ${formatVietnamDay(reminder.expiryDay)}`}</span>
          </div>
          {used !== null && duration && (
            <>
              <div className="renewal-reminder-progress" role="img" aria-label={`Đã dùng ${used} trên ${duration} ngày`}>
                <div style={{ width: `${Math.round((used / duration) * 100)}%` }} />
              </div>
              <div className="renewal-reminder-progress-caption">
                <span>Đã dùng {used}/{duration} ngày</span>
                <span>{lastDay ? 'Hết hạn hôm nay' : `Còn ${reminder.daysLeft} ngày`}</span>
              </div>
            </>
          )}
        </div>

        <ul className="renewal-reminder-benefits">
          {benefits.map(text => (
            <li key={text}><Check size={16} aria-hidden="true" /><span>{text}</span></li>
          ))}
        </ul>

        {lastDay && runningCount > 0 && (
          <p className="renewal-reminder-running">
            <strong>{runningCount} chiến dịch đang chạy</strong> sẽ dừng sau 24:00. {paid ? 'Gia hạn' : 'Nâng cấp'} xong, mọi thứ chạy tiếp như cũ.
          </p>
        )}

        <div className="renewal-reminder-dialog-actions">
          <button type="button" className="renewal-reminder-primary renewal-reminder-primary-large" onClick={openWindow} autoFocus>
            {texts.button}
          </button>
          <button type="button" className="renewal-reminder-secondary" onClick={closeDialog}>{lastDay ? 'Đóng' : 'Để sau'}</button>
        </div>
      </div>
    </div>
  )
}
