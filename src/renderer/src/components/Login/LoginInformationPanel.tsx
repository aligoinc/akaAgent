import { AlertTriangle, ArrowUpRight, BookOpen, CheckCircle2, CircleAlert, CreditCard, Globe2, Info, MessageCircle, Sparkles } from 'lucide-react'
import type { LoginScreenContent } from '../../../../shared/types'
import { useLoginScreenContent } from '../../hooks/useLoginScreenContent'

const noticeIcons = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: CircleAlert }
const resourceLinks: {
  key: keyof LoginScreenContent['links']
  label: string
  detail: string
  icon: typeof Globe2
}[] = [
  { key: 'website', label: 'Website', detail: 'Khám phá akaBiz', icon: Globe2 },
  { key: 'userGuide', label: 'Hướng dẫn sử dụng', detail: 'Bắt đầu dễ dàng', icon: BookOpen },
  { key: 'upgradePayment', label: 'Nâng cấp và thanh toán', detail: 'Chọn gói phù hợp', icon: CreditCard },
  { key: 'contactUs', label: 'Liên hệ', detail: 'Kết nối với akaBiz', icon: MessageCircle }
]

export default function LoginInformationPanel() {
  const { notification, links } = useLoginScreenContent()
  const visibleLinks = resourceLinks.filter(link => links[link.key])
  const Icon = notification ? noticeIcons[notification.level] : Sparkles
  const urgent = notification?.level === 'warning' || notification?.level === 'error'

  return (
    <aside className="login-information" aria-label="Thông tin từ akaBiz">
      <div className="login-information-heading">
        <span className="login-information-dot" aria-hidden="true" />
        Thông tin từ akaBiz
      </div>

      <div className="login-information-body">
        <div
          className={`login-notice login-notice-${notification?.level ?? 'welcome'}`}
          role={notification ? (urgent ? 'alert' : 'status') : undefined}
          aria-live={notification ? 'polite' : undefined}
        >
          <div className="login-notice-symbol" aria-hidden="true"><Icon size={26} strokeWidth={1.6} /></div>
          <h2>{notification ? notification.title || 'Thông báo mới' : <>Chào mừng đến với <span>akaAgent</span></>}</h2>
          <div className="login-notice-scroll" tabIndex={notification ? 0 : undefined}>
            <p>{notification?.message || 'Chúc bạn một ngày làm việc hiệu quả. akaBiz luôn sẵn sàng đồng hành cùng bạn.'}</p>
            {notification?.linkUrl && (
              <a className="login-notice-link" href={notification.linkUrl} target="_blank" rel="noopener noreferrer">
                {notification.linkLabel || 'Xem chi tiết'}<ArrowUpRight size={16} aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </div>

      {visibleLinks.length > 0 && (
        <nav className="login-resources" aria-label="Liên kết hữu ích">
          <h3>Liên kết hữu ích</h3>
          <div className="login-resource-grid">
            {visibleLinks.map(({ key, label, detail, icon: LinkIcon }) => (
              <a key={key} className="login-resource" href={links[key]!} target="_blank" rel="noopener noreferrer">
                <LinkIcon className="login-resource-icon" size={20} strokeWidth={1.7} aria-hidden="true" />
                <span><strong>{label}</strong><small>{detail}</small></span>
                <ArrowUpRight className="login-resource-arrow" size={15} aria-hidden="true" />
              </a>
            ))}
          </div>
        </nav>
      )}
    </aside>
  )
}
