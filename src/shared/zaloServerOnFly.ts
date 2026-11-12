import type { AuthUser } from './types'

/**
 * Tổ chức không Chat có tài khoản Zalo Server chạy trên Fly theo cờ engine v2 (V497; Desktop đọc bằng RPC V498
 * `aka_agent_zalo_server_on_fly_v1()` lúc đăng nhập, lưu ở `AuthUser.zaloServerOnFly`). App Server đã thả tổ chức, nên mọi
 * việc của tài khoản Server đi ChatApi như tổ chức có Chat: tiến trình chiến dịch, quét QR, kiểm phiên, đăng xuất, bạn bè/nhóm/
 * nhãn, kiểm SĐT. Runtime cục bộ và dữ liệu Chat (hội thoại, tin nhắn) vẫn chỉ dành cho tổ chức có Chat.
 */
export function isServerOnFlyUser(user: AuthUser): boolean {
  return user.zaloServerOnFly === true &&
    user.isChatSync !== true &&
    user.appAccess?.separateAccess !== true &&
    user.entitlements.zalo === true &&
    user.zaloAccountCapabilities?.server === true
}

/** Tài khoản Zalo Server của người đăng nhập đi ChatApi thay vì App Server: tổ chức có Chat, hoặc chạy trên Fly theo cờ. */
export function serverAccountsUseChatApi(user: AuthUser | null | undefined): boolean {
  return !!user && (user.isChatSync === true || isServerOnFlyUser(user))
}
