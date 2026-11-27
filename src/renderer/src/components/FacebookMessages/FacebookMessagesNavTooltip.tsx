import {
  FACEBOOK_UNREAD_TOOLTIP_MAX_ACCOUNTS,
  type FacebookUnreadSummary
} from '../../../../shared/facebookMessages'
import { accountInitials } from './facebookMessagesView'

interface Props {
  id: string
  summary: FacebookUnreadSummary
}

/** Ô hiện khi rê chuột vào mục "Tin nhắn Facebook" trên menu: tổng + số của từng tài khoản. */
export default function FacebookMessagesNavTooltip({ id, summary }: Props) {
  const shown = summary.accounts.slice(0, FACEBOOK_UNREAD_TOOLTIP_MAX_ACCOUNTS)
  const hidden = summary.accounts.length - shown.length
  return (
    <div id={id} role="tooltip" className="app-sidebar-nav-tooltip fb-messages-nav-tooltip">
      <div className="fb-messages-nav-tooltip-head">
        <span className="fb-messages-nav-tooltip-title">Tin nhắn Facebook</span>
        <span className="fb-messages-nav-tooltip-total">
          {summary.total > 0 ? `${summary.total} đoạn chat chưa đọc` : 'Không có tin mới'}
        </span>
      </div>
      <div className="fb-messages-nav-tooltip-divider" />
      <div className="fb-messages-nav-tooltip-list">
        {shown.map(account => (
          <div key={account.id} className="fb-messages-nav-tooltip-row">
            <span className="fb-messages-nav-tooltip-avatar" aria-hidden="true">{accountInitials(account.name)}</span>
            <span className="fb-messages-nav-tooltip-name">{account.name}</span>
            {account.state === 'logged_out' ? (
              <span className="fb-messages-nav-tooltip-state is-warning">Chưa đăng nhập</span>
            ) : account.state === 'loading' ? (
              <span className="fb-messages-nav-tooltip-state">Đang tải...</span>
            ) : (
              <span className={`fb-messages-nav-tooltip-count ${account.unread > 0 ? '' : 'is-zero'}`}>{account.unread}</span>
            )}
          </div>
        ))}
        {hidden > 0 && <div className="fb-messages-nav-tooltip-more">+{hidden} tài khoản khác</div>}
      </div>
    </div>
  )
}
