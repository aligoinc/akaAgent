import { Info, Package, Phone, User, X } from 'lucide-react'
import { useMemo } from 'react'
import { useAuthStore } from '../../stores/authStore'

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

export default function AccountProfileModal({ onClose }: AccountProfileModalProps) {
  const user = useAuthStore(state => state.user)
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
                        </span>
                        <span className="account-profile-product-expiration">
                          <span>Giới hạn tài khoản:</span>
                          <span className="account-profile-product-limit-chip">
                            {formatAccountLimit(product.maxAccounts)}
                          </span>
                        </span>
                      </div>
                      <span className={`account-profile-product-status ${product.isActive ? 'is-active' : 'is-expired'}`}>
                        {product.isActive ? 'Còn hạn' : 'Hết hạn'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
