// Phần riêng của Desktop cho mục "Đối tác akaBiz" (docs/AFF_PARTNER_DESKTOP.md). `affPartner.ts` chép nguyên văn từ
// akaAgentWebApp `packages/control-api/src/affPartner.ts` (sửa ở WebApp trước rồi chép lại); tệp này chỉ nối hợp đồng đó với IPC.

export const AFF_PARTNER_IPC = {
  /** Tóm tắt của đối tác: mã, link, số liệu, mức hoa hồng (gọi `aka_agent_aff_partner(true)` mỗi lần mở hộp thoại). */
  summary: 'aff-partner:summary',
  /** Tiến trình chính xin vé rồi mở trang quản lý hoa hồng bằng trình duyệt ngoài; trả `{ signed }`. */
  openPortal: 'aff-partner:open-portal'
} as const

export type AffPartnerDesktopErrorCode =
  | 'aff_partner_not_partner'
  | 'aff_partner_invalid_link'
  | 'aff_partner_open_failed'
  | 'aff_partner_unavailable'

const MESSAGES: Record<AffPartnerDesktopErrorCode, string> = {
  aff_partner_not_partner: 'Tài khoản này chưa có mã giới thiệu. Anh/chị mở lại mục Đối tác akaBiz rồi thử lại.',
  aff_partner_invalid_link: 'Chưa mở được trang quản lý hoa hồng. Anh/chị thử lại sau ít phút.',
  aff_partner_open_failed: 'Không mở được trình duyệt. Anh/chị thử lại giúp em nhé.',
  aff_partner_unavailable: 'Chưa tải được thông tin chương trình giới thiệu. Anh/chị thử lại sau ít phút.'
}

export class AffPartnerDesktopError extends Error {
  readonly code: AffPartnerDesktopErrorCode
  constructor(code: AffPartnerDesktopErrorCode) {
    super(MESSAGES[code])
    this.name = 'AffPartnerDesktopError'
    this.code = code
  }
}

export type AffPartnerIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: AffPartnerDesktopErrorCode; message: string }

export interface AffPartnerOpenPortalResult {
  /** true: link có vé, khách vào thẳng trang; false: khách đăng nhập cổng bằng mật khẩu. */
  signed: boolean
}

/**
 * Chỉ cho mở link `https:` cùng origin với trang quản lý hoa hồng trong tóm tắt, không kèm tên/mật khẩu trong URL.
 * Mọi trường hợp khác trả null: tiến trình chính không bao giờ mở URL lạ.
 */
export function affPartnerSafePortalUrl(url: unknown, portalUrl: unknown): string | null {
  if (typeof url !== 'string' || typeof portalUrl !== 'string') return null
  try {
    const target = new URL(url)
    const portal = new URL(portalUrl)
    if (target.protocol !== 'https:' || portal.protocol !== 'https:') return null
    if (target.username || target.password) return null
    if (target.origin !== portal.origin) return null
    return target.toString()
  } catch {
    return null
  }
}
