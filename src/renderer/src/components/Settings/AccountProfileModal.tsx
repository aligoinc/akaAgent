import { Info, Mail, Package, PackagePlus, Phone, User, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { renewalProductGroup, renewalReminderTexts, type RenewalReminder } from '../../../../shared/renewalReminder'
import type { AuthAccountProduct } from '../../../../shared/types'
import {
  UPGRADE_PORTAL_MORE_BUTTON_CAPTION,
  UPGRADE_PORTAL_MORE_BUTTON_LABEL,
  UPGRADE_PORTAL_PRODUCT_BUTTON_LABEL
} from '../../../../shared/upgradePortal'
import { useUpgradePortalStore } from '../../stores/upgradePortalStore'
import { useEmailPromptStore } from '../../stores/emailPromptStore'
import '../EmailPrompt/emailPrompt.css'

interface AccountProfileModalProps {
  onClose: () => void
}

function formatDate(value?: string | null): string {
  if (!value) return 'Chưa có dữ liệu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Chưa có dữ liệu'
  return date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function formatAccountLimit(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `${value} tài khoản`
    : 'Không giới hạn'
}

/** Gói đang được nhắc gia hạn có phải dòng này không (cùng id dòng sản phẩm; thiếu id thì cùng nhóm và cùng hạn). */
function isReminderProduct(reminder: RenewalReminder | null, product: AuthAccountProduct): boolean {
  if (!reminder || !product.isActive) return false
  const id = reminder.product.organizationProductId
  if (id !== null && product.organizationProductId !== null) return id === product.organizationProductId
  return reminder.product.group === renewalProductGroup(product.productId) && reminder.product.expirationDate === product.expirationDate
}

/**
 * Dòng Email (V652): đọc `profile` một lượt khi mở hộp thoại và sau mỗi lần lưu email. Tính năng tắt, DB chưa có hàm
 * hoặc đọc lỗi thì ẩn dòng.
 */
function useAccountEmail(): { visible: boolean; email: string | null } {
  const savedSeq = useEmailPromptStore(store => store.savedSeq)
  const [profile, setProfile] = useState<{ visible: boolean; email: string | null }>({ visible: false, email: null })
  useEffect(() => {
    const api = window.electronAPI?.emailPromptCall
    if (!api) return
    let active = true
    void api('profile').then(result => {
      if (!active) return
      setProfile(result.ok && result.data.enabled ? { visible: true, email: result.data.email } : { visible: false, email: null })
    }).catch(() => { if (active) setProfile({ visible: false, email: null }) })
    return () => { active = false }
  }, [savedSeq])
  return profile
}

export default function AccountProfileModal({ onClose }: AccountProfileModalProps) {
  const user = useAuthStore(state => state.user)
  const accountEmail = useAccountEmail()
  const openEmailChange = useEmailPromptStore(store => store.openChange)
  const reminderState = useRenewalReminderStore(state => state.state)
  const openRenewalWindow = useRenewalReminderStore(state => state.openWindow)
  // Form "Nâng cấp và mua gói": có id dòng sản phẩm thì cổng chọn sẵn đúng sản phẩm đó, không có thì mở chế độ mua hàng.
  const openUpgradePortal = (entitlementId: number | null) => {
    onClose()
    useUpgradePortalStore.getState().open({ from: 'account', entitlementId })
  }
  const reminder = reminderState?.enabled ? reminderState.reminder : null
  const reminderTexts = reminder && reminderState?.today ? renewalReminderTexts(reminder, reminderState.today) : null
  const products = useMemo(
    () => [...(user?.accountProducts || [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [user?.accountProducts]
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal account-profile-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Info size={17} />
            <span>Thông tin tài khoản</span>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body account-profile-body">
          <div className="account-profile-summary">
            <div className="account-profile-info">
              <span className="account-profile-info-icon">
                <User size={16} />
              </span>
              <span className="account-profile-info-copy">
                <span>Tên</span>
                <strong>{user?.name || 'Chưa có dữ liệu'}</strong>
              </span>
            </div>
            <div className="account-profile-info">
              <span className="account-profile-info-icon">
                <Phone size={16} />
              </span>
              <span className="account-profile-info-copy">
                <span>Số điện thoại</span>
                <strong>{user?.phone || 'Chưa có dữ liệu'}</strong>
              </span>
            </div>
            {accountEmail.visible && (
              <div className="account-profile-info account-profile-email">
                <span className="account-profile-info-icon">
                  <Mail size={16} />
                </span>
                <span className="account-profile-info-copy">
                  <span>Email</span>
                  <strong>{accountEmail.email || 'Chưa có email'}</strong>
                </span>
                <button type="button" className="account-profile-email-change" onClick={() => openEmailChange(accountEmail.email)}>
                  {accountEmail.email ? 'Đổi' : 'Thêm'}
                </button>
              </div>
            )}
          </div>

          <div className="account-profile-products">
            <div className="account-profile-section-title">
              <Package size={16} />
              <span>Các gói sản phẩm</span>
            </div>

            {products.length === 0 ? (
              <div className="account-profile-empty">Chưa có dữ liệu gói sản phẩm.</div>
            ) : (
              <div className="account-profile-product-list">
                {products.map((product, index) => (
                  <div
                    key={`${product.productId || 'product'}-${product.packageName || 'package'}-${index}`}
                    className="account-profile-product-card"
                  >
                    <div className="account-profile-product-main">
                      <div>
                        <strong>{product.displayName || 'Sản phẩm'}</strong>
                        <span className="account-profile-product-expiration">
                          <span>Hết hạn:</span>
                          <span className={`account-profile-product-date-chip ${product.isActive ? 'is-active' : 'is-expired'}`}>
                            {formatDate(product.expirationDate)}
                          </span>
                          {reminderTexts && isReminderProduct(reminder, product) && (
                            <span className="account-profile-renewal-days">
                              {reminder!.daysLeft <= 0 ? 'Hết hạn hôm nay' : `Còn ${reminder!.daysLeft} ngày`}
                            </span>
                          )}
                        </span>
                        <span className="account-profile-product-expiration">
                          <span>Giới hạn tài khoản:</span>
                          <span className="account-profile-product-limit-chip">
                            {formatAccountLimit(product.maxAccounts)}
                          </span>
                        </span>
                      </div>
                      <span className="account-profile-product-side">
                        <span className={`account-profile-product-status ${product.isActive ? 'is-active' : 'is-expired'}`}>
                          {product.isActive ? 'Còn hạn' : 'Hết hạn'}
                        </span>
                        {reminderTexts && isReminderProduct(reminder, product) ? (
                          <button type="button" className="renewal-reminder-primary" onClick={() => { onClose(); openRenewalWindow() }}>
                            {reminderTexts.button}
                          </button>
                        ) : (
                          <button type="button" className="renewal-reminder-secondary" onClick={() => openUpgradePortal(product.organizationProductId)}>
                            {UPGRADE_PORTAL_PRODUCT_BUTTON_LABEL}
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="account-profile-more-button" onClick={() => openUpgradePortal(null)}>
              <PackagePlus size={18} aria-hidden="true" />
              <span>
                <strong>{UPGRADE_PORTAL_MORE_BUTTON_LABEL}</strong>
                <small>{UPGRADE_PORTAL_MORE_BUTTON_CAPTION}</small>
              </span>
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
