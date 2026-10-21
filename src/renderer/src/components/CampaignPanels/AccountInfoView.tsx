import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, RotateCcw, RefreshCw, X } from 'lucide-react'
import type { AccountActionOverview, AutoAccount, CampaignListItem } from '../../../../shared/types'
import { getCampaignAccountOverviewActionDescriptors } from '../../../../shared/campaignActionDescriptors'
import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { getAccountPlatformLabel } from '../../utils/accountLabels'

type AccountInfoViewMode = 'modal' | 'dock'

interface AccountInfoViewProps {
  account: AutoAccount
  campaign?: Pick<CampaignListItem, 'id' | 'name'>
  mode?: AccountInfoViewMode
  onClose?: () => void
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  return new Date(value).toLocaleString('vi-VN')
}

const getRemainingMinutes = (value?: string | null) => {
  if (!value) return null
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60000))
}

const getMobileDeviceLabel = (account: AutoAccount): string => {
  if (!account.mobileDeviceId) return 'Chưa đăng nhập'
  const info = account.mobileDeviceInfo || {}
  const deviceName = (
    typeof info.deviceName === 'string' ? info.deviceName :
      typeof info.name === 'string' ? info.name :
        typeof info.model === 'string' ? info.model :
          ''
  ).trim()
  const platform = (
    typeof info.platform === 'string' ? info.platform :
      typeof info.osName === 'string' ? info.osName :
        ''
  ).trim()
  return [deviceName, platform].filter(Boolean).join(' - ') || account.mobileDeviceId
}

const getVoiceCallCapability = (account: AutoAccount) => {
  const capability = account.mobileDeviceInfo?.voiceCall
  if (!capability || !account.mobileDeviceId) {
    return { label: 'Chưa cài APK phù hợp', detail: 'Thiết bị chưa gửi capability gọi tự động.' }
  }
  const status = capability.capabilityStatus || capability.status
  if (status === 'blocked') {
    return { label: 'Bị chặn', detail: capability.blockedReason || 'Thiếu quyền hoặc cấu hình thiết bị.' }
  }
  if (status === 'exact_profile' || status === 'exact') {
    const profileKey = capability.profileKey || capability.profileCode
    const profile = profileKey
      ? `${profileKey}${capability.profileVersion ? ` v${capability.profileVersion}` : ''}`
      : 'profile đã chứng nhận'
    return { label: 'Nhận biết chính xác', detail: profile }
  }
  if (status === 'fallback_ready' || status === 'fallback') {
    return {
      label: `Fallback ${capability.fallbackDelaySeconds || 15} giây`,
      detail: 'Kết quả bắt máy không được xác minh.'
    }
  }
  return { label: 'Chưa cài APK phù hợp', detail: capability.blockedReason || 'Thiết bị chưa sẵn sàng.' }
}

export default function AccountInfoView({ account, campaign, mode = 'modal', onClose }: AccountInfoViewProps) {
  const [rows, setRows] = useState<AccountActionOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [enablingActionCode, setEnablingActionCode] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const enablingAction = useRef(false)
  const user = useAuthStore(state => state.user)
  const loadCampaignConfig = useCampaignStore(state => state.loadCampaignConfig)
  const campaignId = campaign?.id
  const isModal = mode === 'modal'
  const isSmsAccount = account.flatformType === 'sms'
  const voiceCallCapability = getVoiceCallCapability(account)

  const loadOverview = useCallback(async () => {
    if (!window.electronAPI?.getAccountActionOverview) return
    const version = ++requestVersion.current
    const isCurrent = () => requestVersion.current === version && useAuthStore.getState().user === user
    setLoading(true)
    setError(null)
    setRows([])
    try {
      let actionCodes: string[] | undefined
      if (campaignId !== undefined) {
        const config = await loadCampaignConfig(campaignId, { force: true })
        if (!isCurrent()) return
        if (!config) throw new Error('Không thể tải cấu hình chiến dịch. Vui lòng thử lại.')
        if (config.accountId !== account.id) throw new Error('Tài khoản của chiến dịch đã thay đổi. Vui lòng mở lại form.')
        actionCodes = Array.from(new Set(getCampaignAccountOverviewActionDescriptors(config).map(action => action.code)))
        if (actionCodes.length === 0) return
      }
      const data = await window.electronAPI.getAccountActionOverview(account.id, actionCodes)
      if (isCurrent()) setRows(data)
    } catch (err: any) {
      if (isCurrent()) setError(err?.message || 'Không thể tải thông tin hành động')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [account.id, campaignId, loadCampaignConfig, user])

  useEffect(() => {
    enablingAction.current = false
    setEnablingActionCode(null)
    void loadOverview()
    return () => { requestVersion.current += 1 }
  }, [loadOverview])

  const refreshCurrentView = useCallback(() => {
    loadOverview()
  }, [loadOverview])

  const handleEnableActionNow = useCallback(async (actionCode: string) => {
    if (!window.electronAPI?.enableAccountActionNow || enablingAction.current || useAuthStore.getState().user !== user) return
    const version = requestVersion.current
    const isCurrent = () => requestVersion.current === version && useAuthStore.getState().user === user
    enablingAction.current = true
    setEnablingActionCode(actionCode)
    setError(null)
    try {
      await window.electronAPI.enableAccountActionNow(account.id, actionCode)
      if (!isCurrent()) return
      enablingAction.current = false
      setEnablingActionCode(null)
      await loadOverview()
    } catch (err: any) {
      if (isCurrent()) setError(err?.message || 'Không thể chạy lại hành động ngay')
    } finally {
      if (isCurrent()) {
        enablingAction.current = false
        setEnablingActionCode(null)
      }
    }
  }, [account.id, loadOverview, user])

  const limitedCount = useMemo(() => rows.filter(row => row.status.isDisable).length, [rows])
  const totalToday = useMemo(() => rows.reduce((sum, row) => sum + (row.status.countActionInDay || 0), 0), [rows])

  return (
    <>
      <div className={isModal ? 'modal-header' : 'account-info-dock-header'}>
        <div>
          <div className={isModal ? 'modal-title' : 'account-info-dock-title'}>{campaign ? 'Hành động của tài khoản' : 'Thông tin tài khoản'}</div>
          <div className="account-info-subtitle">{account.name}{campaign ? ` · ${campaign.name}` : ''}</div>
        </div>
        <div className="account-info-header-actions">
          <button
            className="btn btn-ghost btn-icon"
            onClick={refreshCurrentView}
            disabled={loading || Boolean(enablingActionCode)}
            title="Làm mới"
          >
            <RefreshCw size={15} />
          </button>
          {isModal && onClose && (
            <button className="btn btn-ghost btn-icon" onClick={onClose} title="Đóng">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className={`${isModal ? 'modal-body ' : ''}account-info-body ${isModal ? '' : 'account-info-body-dock'}`}>
        {!campaign && <div className="account-info-summary">
          <div className="account-info-field">
            <span>Nền tảng</span>
            <strong>{getAccountPlatformLabel(account)}</strong>
          </div>
          {account.flatformType === 'facebook' && <div className="account-info-field">
            <span>UID xác minh gần nhất</span><strong>{account.facebookUid || 'Chưa có'}</strong>
          </div>}
          {isSmsAccount && (
            <>
              <div className="account-info-field">
                <span>Tên đăng nhập</span>
                <strong>{account.username || '-'}</strong>
              </div>
              <div className="account-info-field">
                <span>Mật khẩu</span>
                <strong>{account.password || '-'}</strong>
              </div>
              <div className="account-info-field">
                <span>Điện thoại mobile</span>
                <strong>{getMobileDeviceLabel(account)}</strong>
              </div>
              <div className="account-info-field">
                <span>Lần dùng mobile</span>
                <strong>{formatDateTime(account.mobileDeviceLastSeenAt || account.mobileDeviceRegisteredAt)}</strong>
              </div>
              <div className="account-info-field" title={voiceCallCapability.detail}>
                <span>Gọi tự động</span>
                <strong>{voiceCallCapability.label}</strong>
              </div>
              <div className="account-info-field">
                <span>Heartbeat gọi</span>
                <strong>{formatDateTime(
                  account.mobileDeviceInfo?.voiceCall?.heartbeatAt
                    || account.mobileDeviceInfo?.voiceCall?.lastHeartbeatAt
                )}</strong>
              </div>
            </>
          )}
          {!isSmsAccount && (
            <>
              <div className="account-info-field">
                <span>Trạng thái tài khoản</span>
                <strong>{account.status}</strong>
              </div>
              <div className="account-info-field">
                <span>Trạng thái đăng nhập</span>
                <strong>{account.loginStatus}</strong>
              </div>
            </>
          )}
          <div className="account-info-field">
            <span>Kích hoạt</span>
            <strong>{account.isActive ? 'Đang bật' : 'Đã tắt'}</strong>
          </div>
          <div className="account-info-field">
            <span>Nhóm tài khoản</span>
            <strong>{account.accountGroupName || 'Không thuộc nhóm'}</strong>
          </div>
          <div className="account-info-field">
            <span>Hành động hôm nay</span>
            <strong>{totalToday}</strong>
          </div>
          <div className="account-info-field">
            <span>Đang bị giới hạn</span>
            <strong>{limitedCount}/{rows.length}</strong>
          </div>
        </div>}

        {error && (
          <div className="account-info-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="account-info-actions-title">Hành động</div>
        {loading ? (
          <div className="text-center text-secondary account-info-loading">Đang tải...</div>
        ) : error && rows.length === 0 ? null : rows.length === 0 ? (
          <div className="text-center text-muted account-info-loading">{campaign ? 'Chiến dịch này không có hành động áp dụng giới hạn trên tài khoản.' : 'Chưa có hành động nào'}</div>
        ) : (
          <table className="campaign-grid account-info-actions-table">
            <thead>
              <tr>
                <th>Hành động</th>
                <th>Hôm nay</th>
                <th>Trong giờ</th>
                <th>Trạng thái</th>
                <th>Mở lại lúc</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const remainingMinutes = getRemainingMinutes(row.status.dateEnable)
                const isEnabling = enablingActionCode === row.action.code
                return (
                  <tr key={row.action.code}>
                    <td>
                      <strong>{row.action.name}</strong>
                    </td>
                    <td>{row.status.countActionInDay}</td>
                    <td>{row.windowActionCount}</td>
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
                    <td>
                      {row.status.isDisable ? (
                        <button
                          className="btn btn-secondary btn-sm account-info-run-now-btn"
                          type="button"
                          disabled={Boolean(enablingActionCode)}
                          onClick={() => handleEnableActionNow(row.action.code)}
                          title="Bật lại hành động này ngay"
                        >
                          <RotateCcw size={13} className={isEnabling ? 'spin' : ''} />
                          <span>{isEnabling ? 'Đang mở...' : 'Chạy lại ngay'}</span>
                        </button>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
