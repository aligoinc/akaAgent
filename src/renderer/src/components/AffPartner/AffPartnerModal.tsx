import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, HandCoins, RefreshCw, X } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import {
  affPartnerDisabledMessage, affPartnerShareText, formatAffPartnerMoney, formatAffPartnerRate, isAffPartnerActive,
  type AffPartnerActive, type AffPartnerSummary
} from '../../../../shared/affPartner'

interface AffPartnerModalProps {
  onClose: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summary: AffPartnerSummary }

const formatCount = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * Hộp thoại "Giới thiệu nhận hoa hồng" (docs/AFF_PARTNER_DESKTOP.md). Đọc DB một lần mỗi lần mở (hoặc khi bấm Thử lại);
 * không hẹn giờ. Trang quản lý hoa hồng đầy đủ mở bằng trình duyệt ngoài qua tiến trình chính.
 */
export default function AffPartnerModal({ onClose }: AffPartnerModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [opening, setOpening] = useState(false)
  const request = useRef(0)

  const load = useCallback(() => {
    const current = ++request.current
    setState({ kind: 'loading' })
    window.electronAPI.affPartnerSummary().then(result => {
      if (current !== request.current) return
      setState(result.ok ? { kind: 'ready', summary: result.data.summary } : { kind: 'error', message: result.message })
    }).catch(() => {
      if (current !== request.current) return
      setState({ kind: 'error', message: affPartnerDisabledMessage('unavailable') })
    })
  }, [])

  useEffect(() => {
    load()
    return () => { request.current++ }
  }, [load])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const copy = async (value: string, done: string) => {
    try {
      await navigator.clipboard.writeText(value)
      showAlert(done, 'success')
    } catch {
      showAlert('Chưa sao chép được. Anh/chị thử lại giúp em nhé.', 'error')
    }
  }

  const openPortal = async () => {
    if (opening) return
    setOpening(true)
    try {
      const result = await window.electronAPI.affPartnerOpenPortal()
      if (!result.ok) showAlert(result.message, 'error')
      else if (!result.data.signed) showAlert('Đã mở trang quản lý hoa hồng. Anh/chị đăng nhập bằng tài khoản akaBiz để tiếp tục.', 'info')
    } catch {
      showAlert('Chưa mở được trang quản lý hoa hồng. Anh/chị thử lại sau ít phút.', 'error')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal aff-partner-modal" role="dialog" aria-modal="true" aria-labelledby="aff-partner-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title aff-partner-title" id="aff-partner-title">
            <HandCoins size={17} />
            <span>Giới thiệu nhận hoa hồng</span>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body aff-partner-body">
          {state.kind === 'loading' && <div className="aff-partner-state">Đang tải thông tin giới thiệu...</div>}
          {state.kind === 'error' && (
            <div className="aff-partner-state">
              <p>{state.message}</p>
              <button type="button" className="btn btn-secondary" onClick={load}>
                <RefreshCw size={15} /><span>Thử lại</span>
              </button>
            </div>
          )}
          {state.kind === 'ready' && !state.summary.enabled && (
            <div className="aff-partner-state"><p>{affPartnerDisabledMessage(state.summary.reason)}</p></div>
          )}
          {state.kind === 'ready' && state.summary.enabled && !isAffPartnerActive(state.summary) && (
            <div className="aff-partner-state">
              <p>Chưa cấp được mã giới thiệu cho tài khoản này. Anh/chị thử lại sau ít phút.</p>
              <button type="button" className="btn btn-secondary" onClick={load}>
                <RefreshCw size={15} /><span>Thử lại</span>
              </button>
            </div>
          )}
          {state.kind === 'ready' && isAffPartnerActive(state.summary) && (
            <AffPartnerDetails summary={state.summary} onCopy={copy} />
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Đóng</button>
          {state.kind === 'ready' && isAffPartnerActive(state.summary) && (
            <button type="button" className="btn btn-primary aff-partner-portal-button" onClick={openPortal} disabled={opening}>
              {opening ? <RefreshCw size={15} className="animate-spin" /> : <ExternalLink size={15} />}
              <span>{opening ? 'Đang mở...' : 'Mở trang quản lý hoa hồng'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function AffPartnerDetails({ summary, onCopy }: { summary: AffPartnerActive; onCopy: (value: string, done: string) => void }) {
  const { partner, stats, program, rates, defaultRate } = summary
  const rows = rates.length
    ? rates.map(item => ({ key: String(item.productId), name: item.productName, purchaseRate: item.purchaseRate, trialReward: item.trialReward }))
    : [{ key: 'default', name: 'Mọi sản phẩm', purchaseRate: defaultRate.purchaseRate, trialReward: defaultRate.trialReward }]

  return (
    <>
      {partner.status !== 'active' && (
        <div className="aff-partner-notice aff-partner-notice-warning">
          {partner.status === 'banned'
            ? 'Mã giới thiệu của anh/chị đang bị khóa. Anh/chị liên hệ akaBiz để được hỗ trợ.'
            : 'Mã giới thiệu của anh/chị đang tạm dừng, lượt giới thiệu mới chưa được tính hoa hồng.'}
        </div>
      )}

      <section className="aff-partner-code-card">
        <span className="aff-partner-label">Mã giới thiệu</span>
        <div className="aff-partner-code-row">
          <strong className="aff-partner-code">{partner.code}</strong>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCopy(partner.code, 'Đã sao chép mã giới thiệu.')}>
            <Copy size={14} /><span>Sao chép</span>
          </button>
        </div>
        <span className="aff-partner-label">Trang giới thiệu của anh/chị</span>
        <div className="aff-partner-link">{partner.pageUrl}</div>
        <div className="aff-partner-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCopy(partner.pageUrl, 'Đã sao chép link trang giới thiệu.')}>
            <Copy size={14} /><span>Sao chép link</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCopy(affPartnerShareText(partner), 'Đã sao chép câu mời.')}>
            <Copy size={14} /><span>Sao chép câu mời</span>
          </button>
        </div>
      </section>

      <section className="aff-partner-stats">
        <Stat label="Lượt xem trang" value={formatCount(stats.visits)} />
        <Stat label="Đăng ký dùng thử" value={formatCount(stats.trials)} />
        <Stat label="Đã mua" value={formatCount(stats.purchased)} />
        <Stat label="Hoa hồng đang giữ" value={formatAffPartnerMoney(stats.commissionPending)} />
        <Stat label="Hoa hồng được rút" value={formatAffPartnerMoney(stats.commissionApproved)} />
        <Stat label="Hoa hồng đã nhận" value={formatAffPartnerMoney(stats.commissionPaid)} />
      </section>

      {!partner.hasPayoutInfo && (
        <div className="aff-partner-notice">
          Anh/chị chưa có tài khoản nhận hoa hồng. Bổ sung ở trang quản lý hoa hồng để akaBiz chuyển tiền.
        </div>
      )}

      <section>
        <h3 className="aff-partner-heading">Mức hoa hồng theo sản phẩm</h3>
        <table className="aff-partner-rates">
          <thead>
            <tr><th>Sản phẩm</th><th>Khách mua</th><th>Khách dùng thử</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key}>
                <td>{row.name}</td>
                <td>{formatAffPartnerRate(row.purchaseRate)} giá trị đơn</td>
                <td>{row.trialReward > 0 ? formatAffPartnerMoney(row.trialReward) : 'Không có'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="aff-partner-heading">Cách hoạt động</h3>
        <ul className="aff-partner-howto">
          <li>Người xem trang giới thiệu rồi đăng ký dùng thử trong {program.visitWindowDays} ngày được tính cho anh/chị.</li>
          <li>Khách mua trong {program.purchaseWindowDays} ngày kể từ ngày dùng thử thì anh/chị nhận hoa hồng theo mức ở trên.</li>
          <li>
            {program.holdDays > 0 ? `Hoa hồng được giữ ${program.holdDays} ngày sau khi khách thanh toán` : 'Hoa hồng được ghi nhận sau khi khách thanh toán'}
            {program.minPayout > 0 ? `, akaBiz chuyển khi số được rút từ ${formatAffPartnerMoney(program.minPayout)}.` : '.'}
          </li>
        </ul>
      </section>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="aff-partner-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
