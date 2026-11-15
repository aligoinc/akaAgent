import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import { issueRenewalLinkTicket } from './renewalReminderRepository'
import { parseRenewalLinkTicket } from '../../../shared/renewalReminder'
import {
  AFF_PARTNER_PORTAL_ORIGIN, AFF_PARTNER_PORTAL_PATH,
  affPartnerPortalLink, isAffPartnerActive, parseAffPartnerSummary,
  type AffPartnerPortalLink, type AffPartnerSummary
} from '../../../shared/affPartner'

const client = () => getSupabaseClient()
const AFF_PARTNER_TIMEOUT_MS = 15_000

/**
 * `aka_agent_aff_partner(p_create)` (akaAgent V546): tóm tắt đối tác giới thiệu của nhân viên trong phiên Desktop.
 * `create=true` cấp mã nếu chưa có (lúc mở hộp thoại); `false` chỉ đọc (trước khi mở trang quản lý).
 * Không ném lỗi: DB chưa có hàm (PGRST202) → `not_installed`, lỗi khác → `unavailable`.
 */
export async function getAffPartnerSummary(create: boolean): Promise<AffPartnerSummary> {
  requireCurrentUser()
  try {
    const { data, error } = await client()
      .rpc('aka_agent_aff_partner', { p_create: create === true })
      .abortSignal(AbortSignal.timeout(AFF_PARTNER_TIMEOUT_MS))
    if (error) {
      if (error.code === 'PGRST202') return { enabled: false, reason: 'not_installed' }
      console.warn('[AffPartner] Không đọc được thông tin giới thiệu:', error.code || 'unknown')
      return { enabled: false, reason: 'unavailable' }
    }
    return parseAffPartnerSummary(data)
  } catch {
    console.warn('[AffPartner] Không đọc được thông tin giới thiệu.')
    return { enabled: false, reason: 'unavailable' }
  }
}

/** Link mở trang quản lý hoa hồng, kèm `portalUrl` của tóm tắt để bên mở link kiểm origin. */
export interface AffPartnerDesktopPortalLink extends AffPartnerPortalLink {
  portalUrl: string
}

const DEFAULT_PORTAL_URL = `${AFF_PARTNER_PORTAL_ORIGIN}${AFF_PARTNER_PORTAL_PATH}`

/**
 * Mục menu "Đối tác akaBiz": mọi tài khoản đều mở được trang đối tác của cổng; chưa có mã thì cổng cấp ở lần mở đầu tiên.
 * Đọc tóm tắt ở chế độ chỉ đọc chỉ để lấy địa chỉ cổng (chưa có mã, chương trình tắt hoặc đọc lỗi thì dùng địa chỉ mặc
 * định), rồi xin vé dùng một lần (`aka_agent_renewal_link_ticket`, V521, không truyền sản phẩm).
 * Không được vé (DB chưa có hàm, lỗi mạng, vé sai dạng) thì trả link không vé: khách đăng nhập cổng bằng mật khẩu.
 */
export async function getAffPartnerPortalLink(): Promise<AffPartnerDesktopPortalLink> {
  const summary = await getAffPartnerSummary(false)
  const portalUrl = isAffPartnerActive(summary) ? summary.portalUrl : DEFAULT_PORTAL_URL
  const ticket = parseRenewalLinkTicket(await issueRenewalLinkTicket(null))
  return { ...affPartnerPortalLink(portalUrl, ticket), portalUrl }
}
