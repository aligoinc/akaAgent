import { create } from 'zustand'

/** Thẻ của trang Tự động hóa trên Desktop. */
export type AutomationTab = 'journeys' | 'campaigns' | 'legacy'

export interface AutomationNavRequest {
  tab: AutomationTab
  /** Thẻ Quy trình: mở thẳng một quy trình (đường trong trang nhúng, ví dụ `/automation/12`). */
  path?: string
  /** Tăng mỗi lần mở để trang nhận yêu cầu mới dù cùng thẻ. */
  nonce: number
}

interface AutomationNavState {
  request: AutomationNavRequest | null
  /** App đăng ký: chuyển sang trang Tự động hóa. */
  showPage: (() => void) | null
  setShowPage: (handler: (() => void) | null) => void
  open: (tab: AutomationTab, path?: string) => boolean
}

/**
 * Mở trang Tự động hóa ở đúng thẻ từ chỗ khác của app (link "Tự động hóa › Từ chiến dịch" trong form chiến dịch,
 * "Xem tự động hóa" ở dòng nhóm). Form chiến dịch nằm trên `document.body` nên CSS ẩn nó khi đang ở trang Tự động hóa.
 */
export const useAutomationNavStore = create<AutomationNavState>((set, get) => ({
  request: null,
  showPage: null,
  setShowPage: handler => set({ showPage: handler }),
  open: (tab, path) => {
    const showPage = get().showPage
    set({ request: { tab, path, nonce: (get().request?.nonce ?? 0) + 1 } })
    if (!showPage) return false
    showPage()
    return true
  }
}))
