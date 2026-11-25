import { useEffect } from 'react'
import { emailPromptDayKey } from '../../../../shared/emailPrompt'
import { useEmailPromptStore } from '../../stores/emailPromptStore'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { useUpgradePortalStore } from '../../stores/upgradePortalStore'
import EmailPromptDialog from './EmailPromptDialog'

/** Đọc `state` sau khi giao diện chính đã vẽ xong một lúc (khách thấy mình đã vào được app rồi mới thấy form). */
const FIRST_STATE_DELAY_MS = 1_500
/** Nhịp kiểm (chỉ đọc DOM / store, không gọi DB) khi đang chờ hộp thoại khác đóng. */
const WAIT_CHECK_MS = 800
/** Bộ nhắc gia hạn chưa nhận được trạng thái sau ngần này thì thôi chờ nó. */
const RENEWAL_WAIT_MAX_MS = 8_000

/**
 * Có hộp thoại khác đang mở không: hộp nhắc gia hạn / cửa sổ Gia hạn gói, form Nâng cấp và mua gói, và mọi lớp phủ
 * `.modal-overlay` (hộp cập nhật, form tạo / sửa chiến dịch, thông báo, xác nhận...) hoặc `aria-modal` khác.
 */
function otherDialogOpen(renewalWaitUntil: number): boolean {
  const renewal = useRenewalReminderStore.getState()
  if (renewal.dialogOpen || renewal.windowOpen) return true
  if (!renewal.state && Date.now() < renewalWaitUntil) return true
  if (useUpgradePortalStore.getState().request) return true
  const nodes = document.querySelectorAll('.modal-overlay, [aria-modal="true"], [role="alertdialog"]')
  for (const node of Array.from(nodes)) {
    if (!(node instanceof HTMLElement) || node.closest('[data-email-prompt]')) continue
    return true
  }
  return false
}

/**
 * Form xin email (V652). Lượt `state` đầu tiên ~1,5 giây sau khi vào giao diện chính; DB bảo hiện thì chờ mọi hộp thoại
 * khác đóng (hai lần kiểm liền nhau đều trống) rồi mới mở, không chồng hộp thoại. Sang ngày VN mới mà chưa có email
 * thì đọc `state` lại một lần, kiểm lúc cửa sổ được focus / hiện lại hoặc khi bộ nhắc gia hạn đổi ngày. Không hẹn giờ đọc DB.
 */
export default function EmailPromptHost({ scope }: { scope: string | null }) {
  const open = useEmailPromptStore(store => store.open)
  const pendingAuto = useEmailPromptStore(store => store.pendingAuto)

  useEffect(() => {
    const store = useEmailPromptStore.getState()
    store.enter(scope)
    if (!scope) return
    const timer = window.setTimeout(() => { void useEmailPromptStore.getState().loadState() }, FIRST_STATE_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      useEmailPromptStore.getState().enter(null)
    }
  }, [scope])

  // Chờ hộp thoại khác đóng rồi mới hiện form tự động.
  useEffect(() => {
    if (!pendingAuto || open) return
    const renewalWaitUntil = Date.now() + RENEWAL_WAIT_MAX_MS
    let clearChecks = 0
    const timer = window.setInterval(() => {
      if (otherDialogOpen(renewalWaitUntil)) { clearChecks = 0; return }
      clearChecks += 1
      if (clearChecks >= 2) {
        window.clearInterval(timer)
        useEmailPromptStore.getState().showAuto()
      }
    }, WAIT_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [pendingAuto, open])

  // Sang ngày mới (Desktop mở liền nhiều ngày): chưa có email thì hỏi lại một lần.
  useEffect(() => {
    if (!scope) return
    const recheck = (serverDay?: string) => {
      const store = useEmailPromptStore.getState()
      if (store.open || store.loading || !store.dayKey || !store.state?.enabled || !store.state.chip) return
      if (store.dayKey === (serverDay ?? emailPromptDayKey())) return
      void store.loadState()
    }
    const onFocus = () => recheck()
    const onVisibility = () => { if (document.visibilityState === 'visible') recheck() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    const unsubscribe = useRenewalReminderStore.subscribe((next, previous) => {
      if (next.state?.today && next.state.today !== previous.state?.today) recheck(next.state.today)
    })
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribe()
    }
  }, [scope])

  return open ? <EmailPromptDialog /> : null
}
