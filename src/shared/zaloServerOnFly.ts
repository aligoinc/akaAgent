import type { AuthUser } from './types'

/**
 * Tổ chức không Chat có tài khoản Zalo Server chạy trên Fly theo cờ engine v2 (V497; Desktop chốt theo cờ lúc đăng nhập,
 * `resolveZaloServerOnFlyAtLogin`, lưu ở `AuthUser.zaloServerOnFly`). App Server đã thả tổ chức, nên mọi
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

/**
 * Chọn `AuthUser.zaloServerOnFly` lúc đăng nhập (chốt cho cả phiên): theo cờ engine v2 của tổ chức (`use_new_zalo_runtime`,
 * đọc bằng V513 lúc đăng nhập). Bật cờ = tài khoản Server chạy trên Fly, tắt = App Server. Tổ chức có Chat hoặc tách quyền app
 * thì false (tổ chức có Chat đi ChatApi theo `isChatSync`).
 * Không xét gói: tổ chức chưa có quyền Server thì `isServerOnFlyUser` vẫn false (không có tài khoản Server); gói Server đến giữa
 * phiên thì lượt đọc lại gói 30 giây khởi động lại kết nối và tài khoản Server đi ChatApi ngay, nên tài khoản Server đầu tiên
 * được tạo và quét QR trên Fly. Trước 14/11/2026 Desktop hỏi V498 (`aka_agent_zalo_server_on_fly_v1`) và chỉ hỏi khi đã có quyền
 * Server lúc đăng nhập, nên tổ chức mới tạo tài khoản Server đầu tiên trên App Server rồi bị chép phiên sang Fly.
 */
export function resolveZaloServerOnFlyAtLogin(input: {
  isChatSync: boolean
  separateAccess: boolean
  /** Cờ engine v2 của tổ chức (`aka_agent_engine_desktop_enabled_v1()`, V513). */
  orgEngineFlag: boolean
}): boolean {
  return !input.isChatSync && !input.separateAccess && input.orgEngineFlag
}

/** Tài khoản Zalo Server của người đăng nhập đi ChatApi thay vì App Server: tổ chức có Chat, hoặc chạy trên Fly theo cờ. */
export function serverAccountsUseChatApi(user: AuthUser | null | undefined): boolean {
  return !!user && (user.isChatSync === true || isServerOnFlyUser(user))
}
