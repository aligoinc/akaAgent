import { create } from 'zustand'

export interface AccountBrowserOpenRequest {
  accountId: number
  /** Trang https mở trong tab của tài khoản; bỏ trống thì mở trang chủ của nền tảng. */
  openUrl?: string
  reloadAfterOpen?: boolean
  /** false: chỉ cho tab tải trang ở phía sau, chưa chuyển sang trang Trình duyệt (gọi `showPage` sau). Mặc định true. */
  showPage?: boolean
}

export interface AccountBrowserOpenHandler {
  /** App đăng ký: chọn tab của tài khoản, tải trang, và (mặc định) chuyển sang trang Trình duyệt. */
  open: (request: AccountBrowserOpenRequest) => void
  /** Chuyển sang trang Trình duyệt. */
  showPage: () => void
}

interface BrowserOpenState {
  handler: AccountBrowserOpenHandler | null
  setHandler: (handler: AccountBrowserOpenHandler | null) => void
  open: (request: AccountBrowserOpenRequest) => boolean
  showPage: () => boolean
}

export const useBrowserOpenStore = create<BrowserOpenState>((set, get) => ({
  handler: null,
  setHandler: handler => set({ handler }),
  open: request => {
    const handler = get().handler
    if (!handler) return false
    handler.open(request)
    return true
  },
  showPage: () => {
    const handler = get().handler
    if (!handler) return false
    handler.showPage()
    return true
  }
}))
