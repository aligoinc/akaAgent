import { X } from 'lucide-react'
import { renewalReminderTexts, renewalReminderView } from '../../../../shared/renewalReminder'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { RENEWAL_LEVEL_ICONS, renewalToneClass } from './renewalReminderUi'

/**
 * Dải một dòng dưới thanh trên cùng, cạnh dải thông báo chung. Cách ẩn theo `reminder.banner`: `once` đóng tới giai đoạn
 * sau, `daily` ẩn trong ngày, `sticky` chỉ thu gọn trong ngày (nhãn trên thanh trên cùng vẫn còn), `locked` không ẩn.
 */
export default function RenewalReminderBanner() {
  const state = useRenewalReminderStore(store => store.state)
  const seen = useRenewalReminderStore(store => store.seen)
  const dialogShownThisSession = useRenewalReminderStore(store => store.dialogShownThisSession)
  const dismissBanner = useRenewalReminderStore(store => store.dismissBanner)
  const openWindow = useRenewalReminderStore(store => store.openWindow)
  const reminder = state?.enabled ? state.reminder : null
  if (!reminder || !state?.today) return null
  const view = renewalReminderView(reminder, seen, state.today, dialogShownThisSession)
  if (!view.showBanner) return null

  const texts = renewalReminderTexts(reminder, state.today)
  const Icon = RENEWAL_LEVEL_ICONS[reminder.level]
  const strong = reminder.level === 'strong'

  return (
    <div className={`renewal-reminder-banner ${renewalToneClass(reminder.level)}`} role={strong ? 'alert' : 'status'} aria-live="polite">
      <Icon className="renewal-reminder-banner-icon" size={17} aria-hidden="true" />
      <div className="renewal-reminder-banner-content">
        <strong>{texts.title}{texts.others ? ` ${texts.others}` : ''}</strong>
        <span>{texts.message}</span>
      </div>
      {texts.offer && <span className="renewal-reminder-offer">{texts.offer}</span>}
      <button type="button" className="renewal-reminder-primary" onClick={openWindow}>{texts.button}</button>
      {view.bannerDismissible && (reminder.banner === 'sticky' ? (
        <button type="button" className="renewal-reminder-banner-collapse" onClick={dismissBanner} title="Thu gọn thông báo trong hôm nay">
          Thu gọn
        </button>
      ) : (
        <button type="button" className="renewal-reminder-banner-close" onClick={dismissBanner}
          aria-label={reminder.banner === 'daily' ? 'Ẩn thông báo trong hôm nay' : 'Đóng thông báo'}
          title={reminder.banner === 'daily' ? 'Ẩn thông báo trong hôm nay' : 'Đóng thông báo'}>
          <X size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
