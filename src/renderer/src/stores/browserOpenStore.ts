import { create } from 'zustand'

export interface AccountBrowserOpenRequest {
  accountId: number
  /** Trang https mở trong tab của tài khoản; bỏ trống thì mở trang chủ của nền tảng. */
  openUrl?: string
  reloadAfterOpen?: boolean
}

type AccountBrowserOpenHandler = (request: AccountBrowserOpenRequest) => void

interface BrowserOpenState {
  /** App đăng ký: chuyển sang trang Trình duyệt và mở tab của tài khoản. */
  handler: AccountBrowserOpenHandler | null
  setHandler: (handler: AccountBrowserOpenHandler | null) => void
  open: (request: AccountBrowserOpenRequest) => boolean
}

export const useBrowserOpenStore = create<BrowserOpenState>((set, get) => ({
  handler: null,
  setHandler: handler => set({ handler }),
  open: request => {
    const handler = get().handler
    if (!handler) return false
    handler(request)
    return true
  }
}))
