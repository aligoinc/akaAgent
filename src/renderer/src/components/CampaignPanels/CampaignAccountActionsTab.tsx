import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Lock, RefreshCw, RotateCcw } from 'lucide-react'
import type { CampaignListItem } from '../../../../shared/types'
import {
  CAMPAIGN_ACCOUNT_ACTION_UNITS, CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE, describeCampaignActionLimitSource,
  type CampaignAccountActionRow, type CampaignAccountActionsResult
} from '../../../../shared/campaignAccountActions'
import { formatDiagnosticTime } from '../../../../shared/campaignDiagnostics'
import { useAuthStore } from '../../stores/authStore'
import './CampaignAccountActionsTab.css'

interface CampaignAccountActionsTabProps {
  campaign: Pick<CampaignListItem, 'id' | 'accountId' | 'accountName'>
  /** Tên nhóm của tài khoản theo danh sách tài khoản (hiện khi bộ chạy áp giới hạn của nhóm). */
  accountGroupName?: string | null
  /** Đổi khi hành động của tài khoản vừa được mở khóa ở nơi khác: tải lại. */
  refreshKey?: number
  onCount?(campaignId: number, count: number | null): void
  onActionsChanged?(accountId: number): void
}

const unitOf = (code: string) => CAMPAIGN_ACCOUNT_ACTION_UNITS[code] || 'lượt'
const percent = (used: number, limit: number) => Math.min(100, Math.max(0, Math.round(used / Math.max(1, limit) * 100)))
const dayFull = (row: CampaignAccountActionRow) => row.limited && row.dayUsed !== null && row.dayLimit !== null && row.dayUsed >= row.dayLimit
const windowFull = (row: CampaignAccountActionRow) => row.limited && row.windowUsed !== null && row.windowLimit !== null && row.windowUsed >= row.windowLimit
const clockTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const formatClock = (value: string) => {
  const time = Date.parse(value)
  return Number.isFinite(time) ? clockTime.format(time) : ''
}
const errorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : ''
  // IPC bọc lỗi main bằng tiền tố "Error invoking remote method ...: Error: ".
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback
}

function StatusCell({ row }: { row: CampaignAccountActionRow }) {
  if (row.disabled) return <div className="campaign-account-actions-status-cell">
    <span className="campaign-account-actions-status is-locked"><Lock size={12} aria-hidden="true" />Bị giới hạn</span>
    {row.remainingMinutes !== null && <small>Còn {row.remainingMinutes} phút</small>}
    {row.disabledReason && <small className="campaign-account-actions-reason" title={row.disabledReason}>{row.disabledReason}</small>}
  </div>
  if (dayFull(row)) return <span className="campaign-account-actions-status is-full"><AlertTriangle size={12} aria-hidden="true" />Đạt giới hạn ngày</span>
  if (windowFull(row)) return <span className="campaign-account-actions-status is-window"><Clock3 size={12} aria-hidden="true" />Đạt giới hạn trong giờ</span>
  return <span className="campaign-account-actions-status is-ok"><CheckCircle2 size={12} aria-hidden="true" />Bình thường</span>
}

function UsageCell({ used, limit, label }: { used: number | null; limit: number | null; label: string }) {
  if (used === null) return <span className="text-muted" title="Bộ đếm ghi ngày sau hôm nay, chưa xác minh được">—</span>
  if (limit === null) return <strong className="campaign-account-actions-count">{used}</strong>
  const tone = used >= limit ? 'is-full' : percent(used, limit) >= 80 ? 'is-high' : 'is-ok'
  return <div className={`campaign-account-actions-usage ${tone}`}>
    <strong className="campaign-account-actions-count">{used}/{limit}</strong>
    <span className="campaign-account-actions-meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)} aria-valuetext={`${used}/${limit}`}><span style={{ width: `${percent(used, limit)}%` }} /></span>
  </div>
}

/**
 * Tab "Hành động" của chi tiết chiến dịch: hành động tài khoản chiến dịch đang chọn dùng, trạng thái khóa, giới
 * hạn ngày/khung giờ hiệu lực (nhóm → chiến dịch → mặc định, trần gói), số đã chạy và giờ mở lại. Một lượt đọc
 * khi mở tab/bấm Làm mới/sau mở khóa; không polling, không tự thử lại. Phản hồi của phiên/chiến dịch cũ bị bỏ.
 */
export default function CampaignAccountActionsTab({ campaign, accountGroupName, refreshKey = 0, onCount, onActionsChanged }: CampaignAccountActionsTabProps) {
  const user = useAuthStore(state => state.user)
  const [data, setData] = useState<CampaignAccountActionsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enablingCode, setEnablingCode] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const enabling = useRef(false)
  const onCountRef = useRef(onCount)
  onCountRef.current = onCount

  const load = useCallback(async () => {
    if (!window.electronAPI?.getCampaignAccountActions) return
    const version = ++requestVersion.current
    const isCurrent = () => requestVersion.current === version && useAuthStore.getState().user === user
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getCampaignAccountActions(campaign.id)
      if (!isCurrent()) return
      setData(result)
      onCountRef.current?.(campaign.id, result.actions.length)
    } catch (reason) {
      if (isCurrent()) setError(errorMessage(reason, CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [campaign.id, user])

  useEffect(() => {
    void load()
    return () => { requestVersion.current += 1 }
  }, [load, refreshKey])

  const enableNow = useCallback(async (code: string) => {
    if (!window.electronAPI?.enableAccountActionNow || enabling.current || !data?.actions.some(row => row.code === code && row.disabled)) return
    if (useAuthStore.getState().user !== user) return
    const version = requestVersion.current
    const accountId = data.accountId
    enabling.current = true
    setEnablingCode(code)
    setError(null)
    try {
      await window.electronAPI.enableAccountActionNow(accountId, code)
      if (useAuthStore.getState().user !== user) return
      onActionsChanged?.(accountId)
      if (requestVersion.current === version) await load()
    } catch (reason) {
      if (requestVersion.current === version && useAuthStore.getState().user === user) {
        setError(errorMessage(reason, 'Không thể chạy lại hành động ngay.'))
      }
    } finally {
      enabling.current = false
      setEnablingCode(null)
    }
  }, [data, load, onActionsChanged, user])

  const rows = data?.actions ?? []
  const limitedCount = rows.filter(row => row.limited).length
  const groupSourced = !!data?.groupApplied && rows.some(row => row.dayLimitSource === 'group' || row.windowLimitSource === 'group')
  const capped = rows.some(row => row.dayLimitCapped)
  // Cột Thao tác chỉ có khi có hành động đang bị giới hạn.
  const showActions = rows.some(row => row.disabled)
  const groupLabel = accountGroupName || null

  return <div className="campaign-account-actions">
    <div className="campaign-account-actions-toolbar">
      <div className="campaign-account-actions-heading">
        <strong>Hành động của chiến dịch</strong>
        <span>Tài khoản {campaign.accountName || `#${campaign.accountId}`}{data ? ` · Cập nhật lúc ${formatClock(data.checkedAt)}` : ''}</span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (!enabling.current) void load() }} disabled={loading || !!enablingCode}>
        <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" /> Làm mới
      </button>
    </div>
    {data && (groupSourced || capped || limitedCount > 1) && <ul className="campaign-account-actions-notes">
      {groupSourced && <li>Tài khoản thuộc nhóm {groupLabel ? <strong>{groupLabel}</strong> : 'tài khoản'}: giới hạn đã cài trong nhóm được ưu tiên hơn cài đặt của chiến dịch.</li>}
      {capped && <li>Gói hiện tại giới hạn số lượt/ngày của một số hành động; giới hạn ngày đã được cắt theo gói.</li>}
      {limitedCount > 1 && <li>{data.continueWhenActionLimitReached
        ? 'Khi 1 hành động đạt giới hạn, chiến dịch tiếp tục chạy các hành động còn lượt.'
        : 'Khi 1 hành động đạt giới hạn, chiến dịch tạm không chạy và tự chạy lại khi giới hạn được mở.'}</li>}
    </ul>}
    {error && <div role="alert" className="account-info-error campaign-account-actions-error"><AlertTriangle size={14} /><span>{error}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading || !!enablingCode}>Thử lại</button></div>}
    {!data ? (loading && <div role="status" className="text-center text-secondary account-info-loading">Đang tải hành động của chiến dịch...</div>)
      : !rows.length ? <div className="text-center text-muted account-info-loading">Chiến dịch chưa có hành động nào được bật.</div>
        : <div className="campaign-account-actions-scroll"><table className="campaign-grid campaign-account-actions-table">
          <thead><tr>
            <th>Hành động</th><th>Trạng thái</th><th>Giới hạn trong ngày</th><th>Giới hạn trong giờ</th>
            <th>Đã chạy trong ngày</th><th>Đã chạy trong giờ</th><th>Giờ mở lại</th>{showActions && <th>Thao tác</th>}
          </tr></thead>
          <tbody>{rows.map(row => {
            const unit = unitOf(row.code)
            const spinning = enablingCode === row.code
            return <tr key={row.code} className={row.disabled ? 'is-locked' : dayFull(row) ? 'is-full' : undefined}>
              <td className="campaign-account-actions-name"><strong>{row.name}</strong></td>
              <td><StatusCell row={row} /></td>
              <td>{row.limited && row.dayLimit !== null
                ? <div className="campaign-account-actions-limit"><strong>{row.dayLimit} {unit}</strong><small>{describeCampaignActionLimitSource(row.dayLimitSource, {
                  groupName: groupLabel, campaignValue: row.campaignDayLimit, effectiveValue: row.dayLimit,
                  capped: row.dayLimitCapped, packageDailyLimit: row.packageDailyLimit })}</small></div>
                : <span className="text-muted">Không giới hạn lượt</span>}</td>
              <td>{row.limited && row.windowLimit !== null
                ? <div className="campaign-account-actions-limit"><strong>{row.windowLimit} {unit} / {row.windowMinutes} phút</strong><small>{describeCampaignActionLimitSource(row.windowLimitSource, {
                  groupName: groupLabel, campaignValue: row.campaignWindowLimit, effectiveValue: row.windowLimit })}</small></div>
                : <span className="text-muted">—</span>}</td>
              <td><UsageCell used={row.dayUsed} limit={row.limited ? row.dayLimit : null} label={`${row.name} đã chạy trong ngày`} /></td>
              <td>{row.limited && row.windowUsed !== null
                ? <UsageCell used={row.windowUsed} limit={row.windowLimit} label={`${row.name} đã chạy trong ${row.windowMinutes} phút`} />
                : <span className="text-muted">—</span>}</td>
              <td>{row.disabled
                ? row.enableAt ? <strong className="campaign-account-actions-reopen">{formatDiagnosticTime(row.enableAt)}</strong> : <span className="text-muted">Chưa có giờ mở lại</span>
                : dayFull(row) ? <div className="campaign-account-actions-limit"><strong className="campaign-account-actions-reopen">{formatDiagnosticTime(data.nextDayStartsAt)}</strong><small>Sang ngày mới</small></div>
                  : <span className="text-muted">—</span>}</td>
              {showActions && <td>{row.disabled
                ? <button type="button" className="btn btn-secondary btn-sm account-info-run-now-btn" disabled={!!enablingCode || loading}
                  onClick={() => void enableNow(row.code)} title="Bật lại hành động này ngay"><RotateCcw size={13} className={spinning ? 'spin' : ''} aria-hidden="true" /><span>{spinning ? 'Đang mở...' : 'Chạy lại ngay'}</span></button>
                : <span className="text-muted">—</span>}</td>}
            </tr>
          })}</tbody>
        </table></div>}
  </div>
}
