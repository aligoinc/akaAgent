import { useEffect, useRef } from 'react'
import { renewalReminderView } from '../../../../shared/renewalReminder'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import RenewalReminderDialog from './RenewalReminderDialog'
import RenewalReminderWindow from './RenewalReminderWindow'

/**
 * Nhận trạng thái nhắc gia hạn từ main (một lần khi vào phiên + sự kiện đổi), tự mở hộp thoại theo `reminder.dialog`,
 * và giữ cửa sổ "Gia hạn gói". Không đọc DB, không hẹn giờ.
 */
export default function RenewalReminderHost({ scope }: { scope: string | null }) {
  const state = useRenewalReminderStore(store => store.state)
  const seen = useRenewalReminderStore(store => store.seen)
  const dialogShownThisSession = useRenewalReminderStore(store => store.dialogShownThisSession)
  const dialogOpen = useRenewalReminderStore(store => store.dialogOpen)
  const windowOpen = useRenewalReminderStore(store => store.windowOpen)
  const windowKey = useRef<string | null>(null)

  useEffect(() => {
    useRenewalReminderStore.getState().enter(scope)
    return () => useRenewalReminderStore.getState().enter(null)
  }, [scope])

  useEffect(() => {
    if (!window.electronAPI?.onRenewalReminderChanged) return
    return window.electronAPI.onRenewalReminderChanged(next => useRenewalReminderStore.getState().receive(next))
  }, [])

  // Sau khi mở trình duyệt ngoài: lần quay lại cửa sổ kế tiếp thì đọc lại gói một lần (main giới hạn 1 lượt/20 giây).
  useEffect(() => {
    const onFocus = () => {
      if (!useRenewalReminderStore.getState().consumeRefreshOnFocus()) return
      void window.electronAPI.refreshRenewalReminder()
        .then(next => useRenewalReminderStore.getState().receive(next))
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const reminder = state?.enabled ? state.reminder : null
  useEffect(() => {
    if (!reminder || !state?.today || dialogOpen || windowOpen) return
    if (renewalReminderView(reminder, seen, state.today, dialogShownThisSession).showDialog) {
      useRenewalReminderStore.getState().showDialog()
    }
  }, [reminder, state?.today, seen, dialogShownThisSession, dialogOpen, windowOpen])

  if (windowOpen && !windowKey.current && reminder) windowKey.current = reminder.key
  if (!windowOpen) windowKey.current = null

  return (
    <>
      {dialogOpen && reminder && state?.today && !windowOpen && <RenewalReminderDialog reminder={reminder} today={state.today} />}
      {windowOpen && windowKey.current && <RenewalReminderWindow reminderKey={windowKey.current} />}
    </>
  )
}
