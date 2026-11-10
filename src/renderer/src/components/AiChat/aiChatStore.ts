import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  AiChatAttentionController, AiChatThreadController, type AiChatAgents, type AiChatAttentionState, type AiChatControllerState
} from '../../../../shared/aiChat'
import { aiChatTransport } from './aiChatTransport'

const AGENTS_MAX_AGE_MS = 10 * 60_000

/**
 * Hội thoại còn câu chờ hoặc có kết quả chưa xem của nhân viên đang đăng nhập (chấm báo ở tab Trợ lý và nút Trợ lý
 * của chiến dịch). Một bộ điều khiển cho cả trang: mọi nơi dùng chung một request.
 */
export const aiChatAttention = new AiChatAttentionController({ transport: aiChatTransport })

const visible = () => document.visibilityState === 'visible'

/** Danh sách agent hỏi đáp. `null` = chưa tải, tắt, hoặc API/DB chưa có (ẩn toàn bộ mục hỏi đáp, không báo lỗi). */
export function useAiChatAgents(scopeKey: string): AiChatAgents | null {
  const [agents, setAgents] = useState<AiChatAgents | null>(null)
  useEffect(() => {
    let cancelled = false
    let loadedAt = 0
    let controller: AbortController | null = null
    const load = () => {
      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      // Mọi lỗi (API/DB chưa có V488, mất mạng, client chưa hỗ trợ) đều chỉ làm ẩn mục hỏi đáp.
      Promise.resolve().then(() => aiChatTransport.agents(undefined, signal)).then(result => {
        if (cancelled) return
        loadedAt = Date.now()
        setAgents(result.enabled ? result : null)
      }).catch(() => { if (!cancelled) setAgents(null) })
    }
    const onFocus = () => { if (visible() && Date.now() - loadedAt > AGENTS_MAX_AGE_MS) load() }
    setAgents(null)
    load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      controller?.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [scopeKey])
  return agents
}

/** Theo dõi danh sách cần chú ý. Chỉ nơi sở hữu (trang Chiến dịch) truyền `owner` để tải và nghe focus; nơi khác chỉ đọc. */
export function useAiChatAttention(owner?: { scopeKey: string; enabled: boolean }): AiChatAttentionState {
  const state = useSyncExternalStore(aiChatAttention.subscribe, aiChatAttention.getState)
  const scopeKey = owner?.scopeKey
  const enabled = owner?.enabled === true
  useEffect(() => {
    if (scopeKey === undefined) return
    aiChatAttention.clear()
    if (!enabled) return
    aiChatAttention.setVisible(visible())
    void aiChatAttention.refresh()
    const onVisibility = () => aiChatAttention.setVisible(visible())
    const onFocus = () => { void aiChatAttention.refresh(60_000) }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      aiChatAttention.clear()
    }
  }, [scopeKey, enabled])
  return state
}

/** Một hội thoại đang mở trong tab Trợ lý. `active` = tab đang hiện; ẩn tab hoặc ẩn trình duyệt thì hỏi lại thưa hơn. */
export function useAiChatThread(active: boolean): { controller: AiChatThreadController; state: AiChatControllerState } {
  const [controller] = useState(() => new AiChatThreadController({
    transport: aiChatTransport,
    onPendingChanged: () => { void aiChatAttention.refresh() }
  }))
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  useEffect(() => {
    const apply = () => controller.setVisible(active && visible())
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [controller, active])
  // close() chứ không dispose(): StrictMode gắn lại effect với cùng một controller.
  useEffect(() => () => controller.close(), [controller])
  return { controller, state }
}
