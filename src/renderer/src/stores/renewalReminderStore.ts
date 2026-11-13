import { create } from 'zustand'
import {
  dismissRenewalBanner,
  markRenewalDialogShown,
  parseRenewalReminderSeen,
  type RenewalReminderSeen,
  type RenewalReminderState
} from '../../../shared/renewalReminder'

/**
 * Nhắc gia hạn (docs/RENEWAL_REMINDER_DESKTOP.md). Tiến trình chính tính thông báo; store chỉ giữ trạng thái nhận về,
 * trạng thái "đã xem" (localStorage theo tổ chức + nhân viên) và cờ "hộp thoại đã hiện trong lần mở này" (RAM).
 * Không đọc DB, không hẹn giờ.
 */
const SEEN_KEY_PREFIX = 'akaAgent.renewalReminder.seen'
const SUCCESS_VISIBLE_MS = 15_000
/** Sự kiện để dải thông báo chung đọc lại (bỏ thông báo nhắc gia hạn kiểu cũ khi giao diện mới bật). */
export const APP_NOTIFICATION_REFRESH_EVENT = 'aka-agent:app-notification-refresh'

const seenKey = (scope: string): string => `${SEEN_KEY_PREFIX}:${scope}`

function readSeen(scope: string | null): RenewalReminderSeen | null {
  if (!scope) return null
  try { return parseRenewalReminderSeen(window.localStorage.getItem(seenKey(scope))) } catch { return null }
}

function writeSeen(scope: string | null, seen: RenewalReminderSeen): void {
  if (!scope) return
  try { window.localStorage.setItem(seenKey(scope), JSON.stringify(seen)) } catch { /* Không lưu được thì lần sau hiện lại. */ }
}

interface RenewalReminderStore {
  scope: string | null
  state: RenewalReminderState | null
  /** Giờ máy khách lúc nhận `state`, để tính "bây giờ" theo giờ máy chủ. */
  receivedAtMs: number
  seen: RenewalReminderSeen | null
  dialogShownThisSession: boolean
  dialogOpen: boolean
  windowOpen: boolean
  /** Sau khi mở trình duyệt ngoài: lần cửa sổ được focus kế tiếp thì đọc lại một lần. */
  refreshOnFocus: boolean
  successUntil: number
  enter(scope: string | null): void
  receive(state: RenewalReminderState): void
  dismissBanner(): void
  showDialog(): void
  closeDialog(): void
  openWindow(): void
  closeWindow(): void
  markRefreshOnFocus(): void
  consumeRefreshOnFocus(): boolean
  markRenewed(): void
}

let generation = 0

export const useRenewalReminderStore = create<RenewalReminderStore>((set, get) => ({
  scope: null,
  state: null,
  receivedAtMs: 0,
  seen: null,
  dialogShownThisSession: false,
  dialogOpen: false,
  windowOpen: false,
  refreshOnFocus: false,
  successUntil: 0,

  enter(scope) {
    if (scope === get().scope) return
    const request = ++generation
    set({
      scope, state: null, receivedAtMs: 0, seen: readSeen(scope), dialogShownThisSession: false,
      dialogOpen: false, windowOpen: false, refreshOnFocus: false, successUntil: 0
    })
    if (!scope || !window.electronAPI?.getRenewalReminderState) return
    void window.electronAPI.getRenewalReminderState().then(state => {
      if (request === generation) get().receive(state)
    }).catch(() => { /* Tắt/không có dữ liệu: không hiện gì. */ })
  },

  receive(state) {
    if (!get().scope || !state || typeof state !== 'object') return
    const wasEnabled = get().state?.enabled === true
    set({ state, receivedAtMs: Date.now() })
    if (state.enabled && !wasEnabled) {
      try { window.dispatchEvent(new Event(APP_NOTIFICATION_REFRESH_EVENT)) } catch { /* ignore */ }
    }
    if (!state.reminder) set({ dialogOpen: false })
  },

  dismissBanner() {
    const { state, seen, scope } = get()
    if (!state?.reminder || !state.today) return
    const next = dismissRenewalBanner(state.reminder, seen, state.today)
    writeSeen(scope, next)
    set({ seen: next })
  },

  showDialog() {
    const { state, seen, scope } = get()
    if (!state?.reminder || !state.today) return
    const next = markRenewalDialogShown(state.reminder, seen, state.today)
    writeSeen(scope, next)
    set({ seen: next, dialogShownThisSession: true, dialogOpen: true })
  },

  closeDialog() { set({ dialogOpen: false }) },
  openWindow() { if (get().state?.reminder) set({ windowOpen: true, dialogOpen: false }) },
  closeWindow() { set({ windowOpen: false }) },
  markRefreshOnFocus() { set({ refreshOnFocus: true }) },
  consumeRefreshOnFocus() {
    if (!get().refreshOnFocus) return false
    set({ refreshOnFocus: false })
    return true
  },
  markRenewed() { set({ successUntil: Date.now() + SUCCESS_VISIBLE_MS }) }
}))

export const RENEWAL_SUCCESS_VISIBLE_MS = SUCCESS_VISIBLE_MS
