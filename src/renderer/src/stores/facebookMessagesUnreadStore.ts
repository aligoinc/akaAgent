import { create } from 'zustand'
import type { FacebookUnreadSummary } from '../../../shared/facebookMessages'

/**
 * Số đoạn chat chưa đọc do trang Tin nhắn Facebook đếm (đọc DOM webview Messenger),
 * để mục "Tin nhắn Facebook" trên menu bên trái hiện tổng khi đang ở trang khác.
 * Không gọi DB; trang gỡ (đăng xuất / đổi nhân viên) thì đặt về null.
 */
interface FacebookMessagesUnreadState {
  summary: FacebookUnreadSummary | null
  summaryKey: string
  setSummary: (summary: FacebookUnreadSummary | null) => void
}

export const useFacebookMessagesUnreadStore = create<FacebookMessagesUnreadState>((set, get) => ({
  summary: null,
  summaryKey: '',
  setSummary: (summary) => {
    const summaryKey = summary ? JSON.stringify(summary) : ''
    if (summaryKey === get().summaryKey) return
    set({ summary, summaryKey })
  }
}))
