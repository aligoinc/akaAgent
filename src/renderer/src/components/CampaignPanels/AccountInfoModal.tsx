import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { AccountActionOverview, AutoAccount } from '../../../../shared/types'

interface AccountInfoModalProps {
  account: AutoAccount
  onClose: () => void
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  return new Date(value).toLocaleString('vi-VN')
}

const getRemainingMinutes = (value?: string | null) => {
  if (!value) return null
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000))
}

export default function AccountInfoModal({ account, onClose }: AccountInfoModalProps) {
  const [rows, setRows] = useState<AccountActionOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    if (!window.electronAPI?.getAccountActionOverview) return
    setLoading(true)
    setError(null)
    try {
      const data = await window.electronAPI.getAccountActionOverview(account.id)
      setRows(data)
    } catch (err: any) {
      setError(err?.message || 'Không thể tải thông tin hành động')
    } finally {
      setLoading(false)
    }
  }, [account.id])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  const limitedCount = useMemo(() => rows.filter(row => row.status.isDisable).length, [rows])
  const totalToday = useMemo(() => rows.reduce((sum, row) => sum + (row.status.countActionInDay || 0), 0), [rows])

  return (
    <div className="modal-overlay">
      <div className="modal account-info-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Thông tin tài khoản</div>
            <div className="account-info-subtitle">{account.name}</div>
          </div>
          <div className="account-info-header-actions">
            <button className="btn btn-ghost btn-icon" onClick={loadOverview} disabled={loading} title="Làm mới">
              <RefreshCw size={15} />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={onClose} title="Đóng">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="modal-body account-info-body">
          <div className="account-info-summary">
            <div className="account-info-field">
              <span>Nền tảng</span>
              <strong>{account.flatformType}</strong>
            </div>
            <div className="account-info-field">
              <span>Trạng thái tài khoản</span>
              <strong>{account.status}</strong>
            </div>
            <div className="account-info-field">
              <span>Trạng thái đăng nhập</span>
              <strong>{account.loginStatus}</strong>
            </div>
            <div className="account-info-field">
              <span>Kích hoạt</span>
              <strong>{account.isActive ? 'Đang bật' : 'Đã tắt'}</strong>
            </div>
            <div className="account-info-field">
              <span>Hành động hôm nay</span>
              <strong>{totalToday}</strong>
            </div>
            <div className="account-info-field">
              <span>Đang bị giới hạn</span>
              <strong>{limitedCount}/{rows.length}</strong>
            </div>
          </div>

          {error && (
            <div className="account-info-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="account-info-actions-title">Hành động</div>
          {loading ? (
            <div className="text-center text-secondary account-info-loading">Đang tải...</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted account-info-loading">Chưa có hành động nào</div>
          ) : (
            <table className="campaign-grid account-info-actions-table">
              <thead>
                <tr>
                  <th>Hành động</th>
                  <th>Mã</th>
                  <th>Hôm nay</th>
                  <th>Trạng thái</th>
                  <th>Mở lại lúc</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const remainingMinutes = getRemainingMinutes(row.status.dateEnable)
                  return (
                    <tr key={row.action.code}>
                      <td>
                        <strong>{row.action.name}</strong>
                      </td>
                      <td className="account-info-code">{row.action.code}</td>
                      <td>{row.status.countActionInDay}</td>
                      <td>
                        {row.status.isDisable ? (
                          <span className="account-info-status account-info-status-limited">
                            <AlertTriangle size={13} />
                            {remainingMinutes === null ? 'Bị giới hạn' : `Còn ${remainingMinutes} phút`}
                          </span>
                        ) : (
                          <span className="account-info-status account-info-status-ok">
                            <CheckCircle2 size={13} />
                            Bình thường
                          </span>
                        )}
                      </td>
                      <td>{formatDateTime(row.status.dateEnable)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
