import { useEffect, useRef } from 'react'
import { useCampaignStore } from '../stores/campaignStore'
import { useDesktopPollingStore } from '../stores/desktopPollingStore'
import {
  DESKTOP_UI_ATTENTION_RECHECK_MS, DESKTOP_UI_ATTENTIVE, desktopUiAttentionEnabled, desktopUiIdle,
  desktopUiPollSeconds, desktopUiReadsPaused, normalizeDesktopUiAttention, type DesktopUiAttention
} from '../../../shared/desktopUiReads'

/** Hỏi trạng thái cửa sổ là lệnh nội bộ; quá hạn này mà chưa trả lời thì coi như đang có người nhìn. */
const ATTENTION_ASK_TIMEOUT_MS = 5000
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const

/** One UI timer, two independent intervals; no runtime/scheduler timers. */
export function useDesktopUiPolling(scope: string | null, active: boolean, hasServerAccounts: boolean): void {
  const settings = useDesktopPollingStore(state => state.settings)
  const current = useRef({ active, hasServerAccounts, settings })
  current.current = { active, hasServerAccounts, settings }
  const reschedule = useRef<() => void>(() => {})
  useEffect(() => { useDesktopPollingStore.getState().enter(scope) }, [scope])
  useEffect(() => {
    if (!scope) return
    let disposed = false
    let accountsRunning = false
    let campaignsRunning = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let accountEventDue = 0
    // Web có thể sửa tài khoản Desktop (v461). Không thêm polling nền: chỉ đọc lại khi
    // người dùng quay lại cửa sổ và lần đọc trước đã cũ hơn chu kỳ tài khoản.
    let focusRefreshDue = 0
    // "Có ai đang nhìn không" (docs/DESKTOP_UI_IDLE_READS.md). Cửa sổ chính đặt backgroundThrottling=false nên
    // visibilityState không báo được khi thu nhỏ; tiến trình chính trả lời thay. Các khóa cài đặt tắt (mặc định)
    // thì không hỏi gì và mọi nhánh dưới đây cho đúng kết quả như trước khi có phần này.
    let attention: DesktopUiAttention = { ...DESKTOP_UI_ATTENTIVE }
    let attentionAt = 0
    let attentionAsking = false
    let attentionAskAgain = false
    let inputAt = 0
    const visible = () => document.visibilityState === 'visible'
    const attentionEnabled = () => desktopUiAttentionEnabled(current.current.settings)
    // Vừa có thao tác ngay trong cửa sổ này thì chắc chắn có người nhìn, bất kể tiến trình chính trả lời gì.
    const view = (): DesktopUiAttention => !attentionEnabled() || Date.now() - inputAt < DESKTOP_UI_ATTENTION_RECHECK_MS
      ? DESKTOP_UI_ATTENTIVE
      : attention
    const paused = () => desktopUiReadsPaused(current.current.settings, view())
    const degraded = () => paused() || desktopUiIdle(current.current.settings, view())
    const arm = () => {
      clearTimeout(timer)
      if (disposed || !visible()) return
      // Đang hỏi trạng thái cửa sổ: lượt hỏi xong sẽ tự chạy và hẹn lại.
      if (attentionAsking) return
      const { active, hasServerAccounts, settings } = current.current
      const state = useCampaignStore.getState()
      const due: number[] = []
      if (paused()) {
        // Cửa sổ thu nhỏ/ẩn hoặc màn hình khóa: không đọc DB, chỉ hỏi lại trạng thái cửa sổ. Sự kiện và lượt đọc
        // đến hạn được giữ nguyên, quay lại là đọc ngay một lượt.
        due.push(attentionAt + DESKTOP_UI_ATTENTION_RECHECK_MS)
      } else {
        const seen = view()
        if (!accountsRunning) {
          if (accountEventDue) due.push(accountEventDue)
          if (focusRefreshDue) due.push(focusRefreshDue)
          if (active && hasServerAccounts) due.push(state.accountsReadAt + desktopUiPollSeconds(settings.accounts, settings, seen) * 1000)
        }
        if (!campaignsRunning && active && state.campaignPageActive && state.campaignPageQuery) {
          due.push(state.campaignsReadAt + desktopUiPollSeconds(settings.campaigns, settings, seen) * 1000)
          if (state.campaignPageDirty) due.push(state.campaignPageDueAt)
        }
        // Đang giãn vì máy không có thao tác: hỏi lại định kỳ để biết khi có người quay lại.
        if (due.length && desktopUiIdle(settings, seen)) due.push(attentionAt + DESKTOP_UI_ATTENTION_RECHECK_MS)
      }
      if (due.length) timer = setTimeout(run, Math.max(0, Math.min(...due) - Date.now()))
    }
    const execute = () => {
      if (disposed || !visible()) return
      if (paused()) { arm(); return }
      const state = useCampaignStore.getState()
      const { active, hasServerAccounts, settings } = current.current
      const seen = view()
      const now = Date.now()
      // At most one read of each kind, as before. A slow account read must not
      // block a campaign state event (or vice versa).
      if (!accountsRunning && ((accountEventDue && now >= accountEventDue)
        || (focusRefreshDue && now >= focusRefreshDue)
        || (active && hasServerAccounts && now - state.accountsReadAt >= desktopUiPollSeconds(settings.accounts, settings, seen) * 1000))) {
        accountsRunning = true
        const invalidate = accountEventDue > 0
        accountEventDue = 0
        focusRefreshDue = 0
        void state.loadAccounts({ silent: true, invalidate }).finally(() => { accountsRunning = false; arm() })
      }
      if (!campaignsRunning && active && state.campaignPageActive && state.campaignPageQuery
        && ((state.campaignPageDirty && now >= state.campaignPageDueAt)
          || now - state.campaignsReadAt >= desktopUiPollSeconds(settings.campaigns, settings, seen) * 1000)) {
        campaignsRunning = true
        void state.loadCampaigns({ silent: true, passive: true }).finally(() => { campaignsRunning = false; arm() })
      }
      arm()
    }
    const ask = () => {
      attentionAsking = true
      attentionAskAgain = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      // Lỗi, thiếu lệnh hoặc quá hạn đều rơi về "đang có người nhìn": không bao giờ kẹt ở trạng thái ngừng đọc.
      void Promise.race([
        Promise.resolve().then(() => window.electronAPI.getDesktopUiAttention()),
        new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), ATTENTION_ASK_TIMEOUT_MS) })
      ]).then(normalizeDesktopUiAttention, () => ({ ...DESKTOP_UI_ATTENTIVE })).then(next => {
        clearTimeout(timeout)
        attentionAsking = false
        if (disposed) return
        attention = next
        attentionAt = Date.now()
        if (attentionAskAgain && visible() && attentionEnabled()) { ask(); return }
        execute()
      })
    }
    const run = () => {
      if (disposed || !visible()) return
      if (!attentionEnabled()) { execute(); return }
      if (attentionAsking) return
      ask()
    }
    // Cửa sổ vừa thu nhỏ/khôi phục/ẩn/hiện: hỏi lại ngay thay vì chờ lượt hỏi định kỳ.
    const attentionChanged = () => {
      if (disposed || !attentionEnabled() || !visible()) return
      if (attentionAsking) { attentionAskAgain = true; return }
      ask()
    }
    const onInput = () => {
      if (disposed || !attentionEnabled()) return
      const wasDegraded = degraded()
      inputAt = Date.now()
      if (wasDegraded) execute()
    }
    const accountEvent = () => {
      if (!accountEventDue) accountEventDue = Date.now() + 300
      arm()
    }
    const onFocus = () => {
      const { hasServerAccounts, settings } = current.current
      if (visible() && !hasServerAccounts && !focusRefreshDue
        && Date.now() - useCampaignStore.getState().accountsReadAt >= settings.accounts * 1000) {
        focusRefreshDue = Date.now() + 300
      }
      arm()
      if (degraded()) attentionChanged()
    }
    const unsubscribe = window.electronAPI.onAccountStatusUpdated(accountEvent)
    const unsubscribeAttention = window.electronAPI.onDesktopUiAttentionChanged?.(attentionChanged) ?? (() => {})
    const unsubscribeStore = useCampaignStore.subscribe(arm)
    reschedule.current = arm
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    for (const event of INPUT_EVENTS) window.addEventListener(event, onInput, { capture: true, passive: true })
    arm()
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe(); unsubscribeAttention(); unsubscribeStore()
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
      for (const event of INPUT_EVENTS) window.removeEventListener(event, onInput, { capture: true })
      reschedule.current = () => {}
    }
  }, [scope])
  useEffect(() => { reschedule.current() }, [active, hasServerAccounts, settings])
}
