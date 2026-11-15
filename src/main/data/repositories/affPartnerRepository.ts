import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'
import { issueRenewalLinkTicket } from './renewalReminderRepository'
import { parseRenewalLinkTicket } from '../../../shared/renewalReminder'
import {
  affPartnerPortalLink, isAffPartnerActive, parseAffPartnerSummary,
  type AffPartnerPortalLink, type AffPartnerSummary
} from '../../../shared/affPartner'
import { AffPartnerDesktopError } from '../../../shared/affPartnerDesktop'

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

/**
 * Đọc tóm tắt ở chế độ chỉ đọc, rồi xin vé dùng một lần (`aka_agent_renewal_link_ticket`, V521, không truyền sản phẩm).
 * Không được vé (DB chưa có hàm, lỗi mạng, vé sai dạng) thì trả link không vé: khách đăng nhập cổng bằng mật khẩu.
 * Chưa phải đối tác có mã → ném `AffPartnerDesktopError('aff_partner_not_partner')`.
 */
export async function getAffPartnerPortalLink(): Promise<AffPartnerDesktopPortalLink> {
  const summary = await getAffPartnerSummary(false)
  if (!isAffPartnerActive(summary)) throw new AffPartnerDesktopError('aff_partner_not_partner')
  const ticket = parseRenewalLinkTicket(await issueRenewalLinkTicket(null))
  return { ...affPartnerPortalLink(summary.portalUrl, ticket), portalUrl: summary.portalUrl }
}
