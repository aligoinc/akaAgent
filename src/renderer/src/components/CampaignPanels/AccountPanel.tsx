import { useState, useEffect, useMemo } from 'react'
import { FolderCog, Loader2, Plus, ServerCog, X } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import { useAuthStore } from '../../stores/authStore'
import { AutoAccount, ZaloLoginQrEvent, EmailAccountConfig } from '../../../../shared/types'

const EMPTY_EMAIL_CONFIG: EmailAccountConfig = {
  brandName: '', host: 'smtp.gmail.com', port: 587, secure: false, user: '', pass: '', fromEmail: '', replyTo: '', cc: ''
}
const ZALO_QR_TTL_MS = 100_000

import AccountContextMenu from './AccountContextMenu'
import AccountInfoModal from './AccountInfoModal'
import AccountGroupAssignModal from './AccountGroupAssignModal'
import AccountGroupManagerModal from './AccountGroupManagerModal'
import ProxyManagerModal from './ProxyManagerModal'
import { useUiStore } from '../../stores/uiStore'
import { canUsePlatform, getFirstAllowedPlatform } from '../../utils/entitlements'

interface AccountPanelProps {
  onNavigateToBrowser?: (request: { accountId: number; reloadAfterOpen?: boolean }) => void
  onFilterCampaigns?: (accountId: number | null) => void
}

const getErrorMessage = (err: unknown, fallback: string) => {
  const rawMessage = err instanceof Error
    ? err.message
    : typeof err === 'object' && err && 'message' in err
      ? String((err as { message?: unknown }).message || '')
      : ''

  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (message) return message
  if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message?: unknown }).message || fallback)
  }
  return fallback
}

const normalizeEmailConfig = (config?: Partial<EmailAccountConfig> | null): EmailAccountConfig => {
  const merged = { ...EMPTY_EMAIL_CONFIG, ...(config || {}) }
  const secure = merged.secure === true
  const port = Math.floor(Number(merged.port))
  return {
    brandName: String(merged.brandName || '').trim(),
    host: String(merged.host || '').trim(),
    port: Number.isFinite(port) && port > 0 ? port : (secure ? 465 : 587),
    secure,
    user: String(merged.user || '').trim(),
    pass: String(merged.pass ?? ''),
    fromEmail: String(merged.fromEmail || '').trim(),
    replyTo: String(merged.replyTo || '').trim(),
    cc: String(merged.cc || '').trim()
  }
}

const areEmailConfigsEqual = (
  left: EmailAccountConfig | null,
  right: EmailAccountConfig | null
): boolean => {
  if (!left || !right) return false
  const a = normalizeEmailConfig(left)
  const b = normalizeEmailConfig(right)
  return (
    a.brandName === b.brandName &&
    a.host === b.host &&
    a.port === b.port &&
    a.secure === b.secure &&
    a.user === b.user &&
    a.pass === b.pass &&
    a.fromEmail === b.fromEmail &&
    a.replyTo === b.replyTo &&
    a.cc === b.cc
  )
}

const formatQrRemaining = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const restSeconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

const getPlatformLabel = (platform: string): string => {
  switch (platform) {
    case 'facebook': return 'Facebook'
    case 'zalo': return 'Zalo'
    case 'email': return 'Email'
    case 'sms': return 'SMS'
    default: return platform
  }
}

export default function AccountPanel({ onNavigateToBrowser, onFilterCampaigns }: AccountPanelProps) {
  const {
    accounts,
    accountGroups,
    proxies,
    loadAccounts,
    loadAccountGroups,
    loadProxies,
    createAccount,
    updateAccount,
    deleteAccount,
    createAccountGroup,
    updateAccountGroup,
    deleteAccountGroup,
    createProxy,
    updateProxy,
    deleteProxy
  } = useCampaignStore()
  const entitlements = useAuthStore(state => state.user?.entitlements)
  const canUseFacebookAccount = canUsePlatform('facebook', entitlements)
  const canUseZaloFeature = canUsePlatform('zalo', entitlements)
  const canUseEmailFeature = canUsePlatform('email', entitlements)
  const allowedAccountPlatforms = useMemo(
    () => ['facebook', 'zalo', 'email'].filter(platform => canUsePlatform(platform, entitlements)),
    [entitlements]
  )
  const defaultAccountPlatform = getFirstAllowedPlatform(entitlements)
  const [showForm, setShowForm] = useState(false)
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [showProxyManager, setShowProxyManager] = useState(false)
  const [groupManagerPlatform, setGroupManagerPlatform] = useState('facebook')
  const [proxyManagerPlatform, setProxyManagerPlatform] = useState('facebook')
  const [groupAssignAccount, setGroupAssignAccount] = useState<AutoAccount | null>(null)
  const [editingAccount, setEditingAccount] = useState<AutoAccount | null>(null)
  const [infoAccount, setInfoAccount] = useState<AutoAccount | null>(null)
  const [savingAccount, setSavingAccount] = useState(false)
  const [zaloLoginAccount, setZaloLoginAccount] = useState<AutoAccount | null>(null)
  const [zaloLoginEvent, setZaloLoginEvent] = useState<ZaloLoginQrEvent | null>(null)
  const [zaloLoginStarting, setZaloLoginStarting] = useState(false)
  const [zaloQrExpiresAt, setZaloQrExpiresAt] = useState<number | null>(null)
  const [zaloQrRemainingSeconds, setZaloQrRemainingSeconds] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    flatformType: defaultAccountPlatform,
    accountGroupId: null as number | null,
    proxyId: null as number | null
  })
  const [emailConfig, setEmailConfig] = useState<EmailAccountConfig>({ ...EMPTY_EMAIL_CONFIG })
  const [originalEmailConfig, setOriginalEmailConfig] = useState<EmailAccountConfig | null>(null)
  const [verifyingEmail, setVerifyingEmail] = useState(false)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    account: AutoAccount
    position: { x: number; y: number }
  } | null>(null)

  useEffect(() => {
    loadAccounts()
    loadAccountGroups()
    loadProxies()
  }, [loadAccounts, loadAccountGroups, loadProxies])

  useEffect(() => {
    if (!formData.flatformType || allowedAccountPlatforms.includes(formData.flatformType)) return
    setFormData(prev => ({ ...prev, flatformType: defaultAccountPlatform, accountGroupId: null }))
    if (formData.flatformType === 'email') {
      setEmailConfig({ ...EMPTY_EMAIL_CONFIG })
      setOriginalEmailConfig(null)
    }
  }, [allowedAccountPlatforms, defaultAccountPlatform, formData.flatformType])

  useEffect(() => {
    if (!window.electronAPI?.onZaloLoginQrEvent) return
    return window.electronAPI.onZaloLoginQrEvent((event) => {
      const activeAccountId = zaloLoginAccount?.id
      if (activeAccountId && event.accountId !== activeAccountId) return

      setZaloLoginEvent(prev => {
        return event
      })
      if (event.status === 'qr' && event.qrImage) {
        const expiresAt = Date.now() + ZALO_QR_TTL_MS
        setZaloQrExpiresAt(expiresAt)
        setZaloQrRemainingSeconds(Math.ceil(ZALO_QR_TTL_MS / 1000))
      } else if (event.status !== 'qr') {
        setZaloQrExpiresAt(null)
        setZaloQrRemainingSeconds(null)
      }
      if (event.status === 'success') {
        loadAccounts()
        setZaloLoginAccount(null)
        setZaloLoginEvent(null)
        useUiStore.getState().showAlert(event.message || 'Đăng nhập Zalo thành công', 'success')
      } else if (event.status === 'error') {
        loadAccounts()
        useUiStore.getState().showAlert(event.message || 'Đăng nhập Zalo thất bại', 'error')
      }
    })
  }, [loadAccounts, zaloLoginAccount?.id])

  useEffect(() => {
    if (!zaloQrExpiresAt || !zaloLoginAccount) return
    const updateCountdown = () => {
      setZaloQrRemainingSeconds(Math.max(0, Math.ceil((zaloQrExpiresAt - Date.now()) / 1000)))
    }
    updateCountdown()
    const intervalId = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(intervalId)
  }, [zaloQrExpiresAt, zaloLoginAccount?.id])

  const resetForm = () => {
    setFormData({ name: '', flatformType: defaultAccountPlatform, accountGroupId: null, proxyId: null })
    setEmailConfig({ ...EMPTY_EMAIL_CONFIG })
    setOriginalEmailConfig(null)
  }

  const closeAccountForm = () => {
    if (savingAccount) return
    setShowForm(false)
    setEditingAccount(null)
    resetForm()
  }

  const handleVerifyEmail = async () => {
    if (verifyingEmail) return
    if (!canUseEmailFeature) {
      useUiStore.getState().showAlert('Tính năng Email chưa được kích hoạt hoặc đã hết hạn.', 'error')
      return
    }
    const normalizedEmailConfig = normalizeEmailConfig(emailConfig)
    setEmailConfig(normalizedEmailConfig)
    if (!normalizedEmailConfig.host || !normalizedEmailConfig.fromEmail) {
      useUiStore.getState().showAlert('Vui lòng nhập Server name và Email gửi', 'error')
      return
    }
    setVerifyingEmail(true)
    try {
      const result = await window.electronAPI.verifyEmailConfig(normalizedEmailConfig)
      if (result.ok) {
        useUiStore.getState().showAlert('Kết nối SMTP thành công', 'success')
      } else {
        useUiStore.getState().showAlert(`Kết nối SMTP thất bại: ${result.error || ''}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi kiểm tra SMTP: ${err.message}`, 'error')
    } finally {
      setVerifyingEmail(false)
    }
  }

  const openCreateForm = () => {
    setEditingAccount(null)
    resetForm()
    setShowForm(true)
  }

  const openGroupManager = (platform = formData.flatformType) => {
    setGroupManagerPlatform(canUsePlatform(platform, entitlements) ? platform : defaultAccountPlatform)
    setShowGroupManager(true)
  }

  const openProxyManager = (platform = formData.flatformType) => {
    setProxyManagerPlatform(canUsePlatform(platform, entitlements) ? platform : defaultAccountPlatform || 'facebook')
    setShowProxyManager(true)
  }

  const formAccountGroups = accountGroups.filter(group => group.flatformType === formData.flatformType && group.isActive)
  const activeProxies = proxies.filter(proxy => proxy.isActive && !proxy.isDelete)

  const handleSubmit = async () => {
    if (savingAccount || !formData.name.trim()) return
    setSavingAccount(true)
    try {
      const proxyChanged = Boolean(editingAccount && (editingAccount.proxyId ?? null) !== formData.proxyId)
      if (proxyChanged && editingAccount?.flatformType === 'zalo' && editingAccount.status === 'đang chạy') {
        useUiStore.getState().showAlert('Không thể đổi proxy khi tài khoản Zalo đang chạy', 'error')
        return
      }
      const normalizedEmailConfig = normalizeEmailConfig(emailConfig)
      if (formData.flatformType === 'email') {
        if (!canUseEmailFeature) {
          useUiStore.getState().showAlert('Tính năng Email chưa được kích hoạt hoặc đã hết hạn.', 'error')
          return
        }
        setEmailConfig(normalizedEmailConfig)
        if (!normalizedEmailConfig.host || !normalizedEmailConfig.fromEmail || !normalizedEmailConfig.user || !normalizedEmailConfig.pass) {
          useUiStore.getState().showAlert('Vui lòng nhập đủ Server name, Email gửi, Username, Password', 'error')
          return
        }
      }
      if (formData.flatformType === 'zalo' && !canUseZaloFeature) {
        useUiStore.getState().showAlert('Tính năng Zalo chưa được kích hoạt hoặc đã hết hạn.', 'error')
        return
      }
      if (formData.flatformType === 'facebook' && !canUseFacebookAccount) {
        useUiStore.getState().showAlert('Tính năng Facebook chưa được kích hoạt hoặc đã hết hạn.', 'error')
        return
      }

      const payload = {
        name: formData.name,
        flatformType: formData.flatformType,
        accountGroupId: formData.accountGroupId,
        proxyId: formData.proxyId
      }

      let accountId: number
      let createdZaloAccount: AutoAccount | null = null
      let createdFacebookAccount: AutoAccount | null = null
      if (editingAccount) {
        await updateAccount(editingAccount.id, payload)
        accountId = editingAccount.id
        if (proxyChanged) {
          if (editingAccount.flatformType === 'zalo') {
            useUiStore.getState().showAlert('Đã lưu proxy thành công.', 'success')
          } else {
            useUiStore.getState().showAlert('Đã lưu proxy cho tài khoản. Nếu tab Trình duyệt đang mở, hãy tự tải lại trang để áp dụng proxy mới.', 'info')
          }
        }
      } else {
        const created = await createAccount(payload)
        accountId = created.id
        if (created.flatformType === 'zalo') {
          createdZaloAccount = created
        } else if (created.flatformType === 'facebook') {
          createdFacebookAccount = created
        }
      }

      if (formData.flatformType === 'email') {
        const emailConfigChanged = !editingAccount || !areEmailConfigsEqual(normalizedEmailConfig, originalEmailConfig)
        if (emailConfigChanged) {
          const result = await window.electronAPI.saveEmailConfig(accountId, normalizedEmailConfig)
          await loadAccounts()
          if (result.verified) {
            useUiStore.getState().showAlert('Đã lưu cấu hình & kết nối SMTP thành công', 'success')
          } else {
            useUiStore.getState().showAlert(`Đã lưu cấu hình. Kết nối SMTP thất bại: ${result.error || ''}`, 'error')
          }
        }
      }

      setShowForm(false)
      setEditingAccount(null)
      resetForm()
      if (createdZaloAccount) {
        await handleZaloLoginQr(createdZaloAccount)
      } else if (createdFacebookAccount) {
        useUiStore.getState().showAlert(
          `Đã thêm tài khoản Facebook "${createdFacebookAccount.name}" thành công.`,
          'success',
          onNavigateToBrowser
            ? {
              action: {
                label: 'Đăng nhập FB',
                onClick: () => onNavigateToBrowser({ accountId: createdFacebookAccount.id, reloadAfterOpen: true })
              }
            }
            : undefined
        )
      }
    } catch (err) {
      console.error('Failed to save account:', err)
      useUiStore.getState().showAlert(getErrorMessage(err, 'Không lưu được tài khoản'), 'error')
    } finally {
      setSavingAccount(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, account: AutoAccount) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      account,
      position: { x: e.clientX, y: e.clientY }
    })
  }

  const handleEdit = (account: AutoAccount) => {
    setEditingAccount(account)
    setFormData({
      name: account.name,
      flatformType: account.flatformType,
      accountGroupId: account.accountGroupId ?? null,
      proxyId: account.proxyId ?? null
    })
    setEmailConfig({ ...EMPTY_EMAIL_CONFIG })
    setOriginalEmailConfig(null)
    if (account.flatformType === 'email') {
      window.electronAPI?.getEmailConfig?.(account.id)
        .then(cfg => {
          if (!cfg) return
          const normalizedEmailConfig = normalizeEmailConfig(cfg)
          setEmailConfig(normalizedEmailConfig)
          setOriginalEmailConfig(normalizedEmailConfig)
        })
        .catch(() => {})
    }
    setShowForm(true)
  }

  const handleDelete = (account: AutoAccount) => {
    useUiStore.getState().showConfirm(
      `Xoá tài khoản "${account.name}"?`,
      async () => { await deleteAccount(account.id) },
      { title: 'Xoá tài khoản', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleResetSmsMobileDevice = (account: AutoAccount) => {
    if (account.flatformType !== 'sms') return
    useUiStore.getState().showConfirm(
      `Đổi điện thoại cho tài khoản "${account.name}"? Điện thoại cũ sẽ không còn được giữ liên kết, app SMS trên điện thoại mới có thể đăng nhập lại bằng tài khoản này.`,
      async () => {
        if (!window.electronAPI?.resetSmsAccountMobileDevice) {
          useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
          return
        }
        await window.electronAPI.resetSmsAccountMobileDevice(account.id)
        await loadAccounts()
        useUiStore.getState().showAlert('Đã cho phép tài khoản SMS đăng nhập trên điện thoại mới.', 'success')
      },
      { title: 'Đổi điện thoại SMS', confirmText: 'Đổi điện thoại', variant: 'primary' }
    )
  }

  const handleViewBrowser = (accountId: number) => {
    onNavigateToBrowser?.({ accountId, reloadAfterOpen: false })
  }

  const handleReloadPage = async (account: AutoAccount) => {
    if (!window.electronAPI?.reloadAccountPage) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.reloadAccountPage(account.id, account.flatformType)
      if (!result.success) {
        const reason = String(result.reason || '')
        if (
          onNavigateToBrowser &&
          (reason.includes('Tab trình duyệt chưa được mở') || reason.includes('Tab trình duyệt không khả dụng'))
        ) {
          onNavigateToBrowser({ accountId: account.id, reloadAfterOpen: true })
          return
        }
        useUiStore.getState().showAlert(`Không thể load lại: ${result.reason}`, 'error')
      }
    } catch (err) {
      useUiStore.getState().showAlert(`Không thể load lại: ${getErrorMessage(err, 'Lỗi không xác định')}`, 'error')
    }
  }

  const handleCheckLogin = async (account: AutoAccount) => {
    if (!window.electronAPI?.checkFacebookLogin) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.checkFacebookLogin(account.id)
      await loadAccounts() // Refresh to get updated loginStatus
      if (result.loggedIn) {
        useUiStore.getState().showAlert(`✅ ${account.name}: Đã đăng nhập Facebook`, 'success')
      } else {
        useUiStore.getState().showAlert(`❌ ${account.name}: ${result.reason || 'Chưa đăng nhập'}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi kiểm tra: ${err.message}`, 'error')
    }
  }

  const handleZaloLoginQr = async (account: AutoAccount) => {
    if (!canUseZaloFeature) {
      useUiStore.getState().showAlert('Tính năng Zalo chưa được kích hoạt hoặc đã hết hạn.', 'error')
      return
    }
    if (!window.electronAPI?.startZaloLoginQr) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    setZaloLoginAccount(account)
    setZaloLoginEvent({ accountId: account.id, status: 'qr', message: 'Đang tạo mã QR...' })
    setZaloQrExpiresAt(null)
    setZaloQrRemainingSeconds(null)
    setZaloLoginStarting(true)
    try {
      const result = await window.electronAPI.startZaloLoginQr(account.id)
      if (!result.success) {
        setZaloLoginAccount(null)
        setZaloLoginEvent(null)
        setZaloQrExpiresAt(null)
        setZaloQrRemainingSeconds(null)
        useUiStore.getState().showAlert(result.reason || 'Không thể bắt đầu đăng nhập Zalo', 'error')
      }
    } catch (err: any) {
      setZaloLoginAccount(null)
      setZaloLoginEvent(null)
      setZaloQrExpiresAt(null)
      setZaloQrRemainingSeconds(null)
      useUiStore.getState().showAlert(`Lỗi đăng nhập Zalo: ${err.message}`, 'error')
    } finally {
      setZaloLoginStarting(false)
    }
  }

  const handleCloseZaloLogin = async () => {
    const accountId = zaloLoginAccount?.id
    const shouldCancel = !['success', 'error', 'expired', 'cancelled'].includes(zaloLoginEvent?.status || '')
    setZaloLoginAccount(null)
    setZaloLoginEvent(null)
    setZaloQrExpiresAt(null)
    setZaloQrRemainingSeconds(null)
    if (accountId && shouldCancel) {
      await window.electronAPI?.cancelZaloLoginQr?.(accountId).catch(() => {})
    }
  }

  const handleCheckZaloSession = async (account: AutoAccount) => {
    if (!window.electronAPI?.checkZaloSession) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    try {
      const result = await window.electronAPI.checkZaloSession(account.id)
      await loadAccounts()
      if (result.loggedIn) {
        useUiStore.getState().showAlert(`${account.name}: Đã đăng nhập Zalo`, 'success')
      } else {
        useUiStore.getState().showAlert(`${account.name}: ${result.reason || 'Chưa đăng nhập Zalo'}`, 'error')
      }
    } catch (err: any) {
      useUiStore.getState().showAlert(`Lỗi kiểm tra Zalo: ${err.message}`, 'error')
    }
  }

  const handleLogoutZalo = async (account: AutoAccount) => {
    if (!window.electronAPI?.logoutZalo) {
      useUiStore.getState().showAlert('Tính năng này cần Electron API', 'error')
      return
    }
    useUiStore.getState().showConfirm(
      `Đăng xuất Zalo khỏi tài khoản "${account.name}"?`,
      async () => {
        const result = await window.electronAPI.logoutZalo(account.id)
        await loadAccounts()
        useUiStore.getState().showAlert(result.reason || 'Đã xoá session Zalo khỏi tài khoản', 'success')
      },
      { title: 'Đăng xuất Zalo', confirmText: 'Đăng xuất', variant: 'danger' }
    )
  }

  const handleResume = async (account: AutoAccount) => {
    await updateAccount(account.id, { status: 'chờ xử lý' })
  }

  const handlePause = async (account: AutoAccount) => {
    await updateAccount(account.id, { status: 'tạm dừng' })
  }

  const handleEnable = async (account: AutoAccount) => {
    await updateAccount(account.id, { isActive: true, status: 'chờ xử lý' })
  }

  const handleDisable = async (account: AutoAccount) => {
    await updateAccount(account.id, { isActive: false, status: 'tạm dừng' })
  }

  const handleViewInfo = (account: AutoAccount) => {
    setInfoAccount(account)
  }

  const handleChangeGroup = (account: AutoAccount) => {
    setGroupAssignAccount(account)
  }

  const handleAssignAccountsToGroup = async (accountIds: number[], accountGroupId: number | null) => {
    for (const accountId of accountIds) {
      await updateAccount(accountId, { accountGroupId })
    }
  }

  const handleFilterCampaigns = (accountId: number) => {
    onFilterCampaigns?.(accountId)
  }

  const getAccountStatusClass = (status: string) => {
    switch (status) {
      case 'chờ xử lý': return 'status-pending'
      case 'đang chạy': return 'status-running'
      case 'tạm dừng': return 'status-paused'
      default: return 'status-unknown'
    }
  }

  const getLoginColor = (login: string) => {
    switch (login) {
      case 'đã đăng nhập': return 'var(--accent-success)'
      case 'checkpoint': return 'var(--accent-error)'
      default: return 'var(--text-tertiary)'
    }
  }

  return (
    <div className="campaign-panel">
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Tài khoản</span>
        <div className="campaign-panel-header-actions">
          <button className="btn btn-secondary btn-icon" onClick={() => openGroupManager()} title="Nhóm tài khoản">
            <FolderCog size={14} />
          </button>
          <button className="btn btn-primary btn-icon" onClick={openCreateForm} title="Thêm tài khoản">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay account-form-modal-overlay" onMouseDown={closeAccountForm}>
          <div className="modal account-form-modal" onMouseDown={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">{editingAccount ? 'Sửa tài khoản' : 'Thêm tài khoản'}</div>
                <div className="account-info-subtitle">
                  {editingAccount ? editingAccount.name : 'Tạo tài khoản automation mới'}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={closeAccountForm}
                title="Đóng"
                disabled={savingAccount}
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body account-form-modal-body">
              <div className="account-form-grid">
                <div className="stepper-form-group">
                  <label>Tên tài khoản <span className="required">*</span></label>
                  <input
                    type="text"
                    placeholder="Tên tài khoản"
                    value={formData.name}
                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="stepper-input"
                    autoFocus
                  />
                </div>

                <div className="stepper-form-group">
                  <label>Nền tảng</label>
                  <select
                    value={formData.flatformType}
                    onChange={e => setFormData(prev => ({ ...prev, flatformType: e.target.value, accountGroupId: null }))}
                    className="stepper-input"
                    disabled={!!editingAccount}
                  >
                    {canUseFacebookAccount && <option value="facebook">Facebook</option>}
                    {canUseZaloFeature && <option value="zalo">Zalo</option>}
                    {canUseEmailFeature && <option value="email">Email</option>}
                  </select>
                </div>

                <div className="stepper-form-group">
                  <label>Nhóm tài khoản</label>
                  <div className="account-form-inline-field">
                    <select
                      value={formData.accountGroupId ?? ''}
                      onChange={e => setFormData(prev => ({
                        ...prev,
                        accountGroupId: e.target.value ? Number(e.target.value) : null
                      }))}
                      className="stepper-input"
                    >
                      <option value="">Không thuộc nhóm</option>
                      {formAccountGroups.map(group => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-secondary btn-icon"
                      onClick={() => openGroupManager(formData.flatformType)}
                      title="Tạo hoặc sửa nhóm"
                      type="button"
                    >
                      <FolderCog size={14} />
                    </button>
                  </div>
                </div>

                <div className="stepper-form-group">
                  <label>Proxy</label>
                  <div className="account-form-inline-field">
                    <select
                      value={formData.proxyId ?? ''}
                      onChange={e => setFormData(prev => ({
                        ...prev,
                        proxyId: e.target.value ? Number(e.target.value) : null
                      }))}
                      className="stepper-input"
                    >
                      <option value="">Không dùng proxy</option>
                      {activeProxies.map(proxy => (
                        <option key={proxy.id} value={proxy.id}>
                          {proxy.name} ({proxy.protocol}://{proxy.host}:{proxy.port})
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-secondary btn-icon"
                      onClick={() => openProxyManager(formData.flatformType)}
                      title="Tạo hoặc sửa proxy"
                      type="button"
                    >
                      <ServerCog size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {canUseEmailFeature && formData.flatformType === 'email' && (
                <div className="account-form-email-section">
                  <div className="account-form-section-title">Cấu hình SMTP</div>
                  <div className="account-form-email-grid">
                    <div className="stepper-form-group">
                      <label>Email gửi <span className="required">*</span></label>
                      <input className="stepper-input" value={emailConfig.fromEmail} onChange={e => setEmailConfig(p => ({ ...p, fromEmail: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Thương hiệu</label>
                      <input className="stepper-input" placeholder="Tên người gửi" value={emailConfig.brandName || ''} onChange={e => setEmailConfig(p => ({ ...p, brandName: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Username <span className="required">*</span></label>
                      <input className="stepper-input" value={emailConfig.user} onChange={e => setEmailConfig(p => ({ ...p, user: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Password <span className="required">*</span></label>
                      <input className="stepper-input" type="password" value={emailConfig.pass} onChange={e => setEmailConfig(p => ({ ...p, pass: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Reply-To</label>
                      <input className="stepper-input" value={emailConfig.replyTo || ''} onChange={e => setEmailConfig(p => ({ ...p, replyTo: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Email CC</label>
                      <input className="stepper-input" value={emailConfig.cc || ''} onChange={e => setEmailConfig(p => ({ ...p, cc: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Server name <span className="required">*</span></label>
                      <input className="stepper-input" placeholder="SMTP host" value={emailConfig.host} onChange={e => setEmailConfig(p => ({ ...p, host: e.target.value }))} />
                    </div>
                    <div className="stepper-form-group">
                      <label>Port</label>
                      <div className="account-form-inline-field account-form-port-row">
                        <input className="stepper-input" type="number" value={emailConfig.port} onChange={e => setEmailConfig(p => ({ ...p, port: Number(e.target.value) || 0 }))} />
                        <label className="account-form-checkbox">
                          <input type="checkbox" checked={emailConfig.secure} onChange={e => setEmailConfig(p => ({ ...p, secure: e.target.checked, port: e.target.checked ? 465 : 587 }))} />
                          <span>SSL</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <button className="btn btn-secondary account-form-test-button" onClick={handleVerifyEmail} disabled={verifyingEmail} type="button">
                    {verifyingEmail && <Loader2 size={14} className="animate-spin" />}
                    {verifyingEmail ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeAccountForm} disabled={savingAccount} type="button">Huỷ</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={savingAccount || !formData.name.trim()} type="button">
                {savingAccount && <Loader2 size={14} className="animate-spin" />}
                {savingAccount ? 'Đang lưu...' : editingAccount ? 'Cập nhật' : 'Tạo'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="campaign-panel-content">
        {accounts.length === 0 ? (
          <div className="empty-state"><div className="empty-state-text">Chưa có tài khoản</div></div>
        ) : (
          accounts.map(account => {
            const isSmsAccount = account.flatformType === 'sms'
            const showSecondaryMeta = !isSmsAccount || account.accountGroupName || account.proxyName

            return (
              <div
                key={account.id}
                className={`account-card ${isSmsAccount ? '' : getAccountStatusClass(account.status)} ${!account.isActive ? 'disabled' : ''}`}
                onContextMenu={(e) => handleContextMenu(e, account)}
                title="Nhấn chuột phải để xem menu"
              >
                <div className="account-card-info">
                  <div className="account-card-name">
                    {!isSmsAccount && (
                      <span className={`account-status-dot ${!account.isActive ? 'is-disabled' : getAccountStatusClass(account.status)}`} aria-hidden="true" />
                    )}
                    <span className="account-card-name-text" title={account.name}>{account.name}</span>
                  </div>
                  <div className="account-card-meta">
                    <span className="account-tag" style={{ color: 'var(--accent-info)' }}>{getPlatformLabel(account.flatformType)}</span>
                    {!isSmsAccount && (
                      <span style={{ color: getLoginColor(account.loginStatus), fontSize: '10px' }}>{account.loginStatus}</span>
                    )}
                  </div>
                  {showSecondaryMeta && (
                    <div className="account-card-meta">
                      {!isSmsAccount && <span className="account-card-status">{account.status}</span>}
                      {account.accountGroupName && (
                        <span className="account-group-tag" title={account.accountGroupName}>{account.accountGroupName}</span>
                      )}
                      {account.proxyName && (
                        <span className="account-group-tag" title={`${account.proxyProtocol}://${account.proxyHost}:${account.proxyPort}`}>
                          {account.proxyName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <AccountContextMenu
          account={contextMenu.account}
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onViewBrowser={handleViewBrowser}
          onReloadPage={handleReloadPage}
          onCheckLogin={handleCheckLogin}
          onZaloLoginQr={handleZaloLoginQr}
          onCheckZaloSession={handleCheckZaloSession}
          onLogoutZalo={handleLogoutZalo}
          onResetSmsMobileDevice={handleResetSmsMobileDevice}
          onResume={handleResume}
          onPause={handlePause}
          onEnable={handleEnable}
          onDisable={handleDisable}
          onViewInfo={handleViewInfo}
          onEdit={handleEdit}
          onChangeGroup={handleChangeGroup}
          onDelete={handleDelete}
          onFilterCampaigns={handleFilterCampaigns}
        />
      )}

      {infoAccount && (
        <AccountInfoModal
          account={infoAccount}
          onClose={() => setInfoAccount(null)}
        />
      )}

      {showGroupManager && (
        <AccountGroupManagerModal
          groups={accountGroups}
          accounts={accounts}
          initialPlatform={groupManagerPlatform}
          onClose={() => setShowGroupManager(false)}
          onCreateGroup={createAccountGroup}
          onUpdateGroup={updateAccountGroup}
          onDeleteGroup={deleteAccountGroup}
          onAssignAccounts={handleAssignAccountsToGroup}
        />
      )}

      {showProxyManager && (
        <ProxyManagerModal
          proxies={proxies}
          accounts={accounts}
          initialPlatform={proxyManagerPlatform}
          onClose={() => setShowProxyManager(false)}
          onCreateProxy={createProxy}
          onUpdateProxy={updateProxy}
          onDeleteProxy={deleteProxy}
          onProxyCreated={(proxy) => {
            setFormData(prev => ({ ...prev, proxyId: proxy.id }))
          }}
        />
      )}

      {groupAssignAccount && (
        <AccountGroupAssignModal
          account={groupAssignAccount}
          groups={accountGroups}
          onClose={() => setGroupAssignAccount(null)}
          onManageGroups={(platform) => {
            setGroupAssignAccount(null)
            openGroupManager(platform)
          }}
          onSave={async (accountId, accountGroupId) => {
            await handleAssignAccountsToGroup([accountId], accountGroupId)
          }}
        />
      )}

      {zaloLoginAccount && (
        <div style={zaloOverlayStyle}>
          <div style={zaloModalStyle}>
            <div style={zaloModalHeaderStyle}>
              <div>
                <strong>Đăng nhập Zalo</strong>
                <div style={zaloModalSubTextStyle}>{zaloLoginAccount.name}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleCloseZaloLogin}>Đóng</button>
            </div>
            <div style={zaloQrBodyStyle}>
              {zaloLoginEvent?.qrImage ? (
                <img src={zaloLoginEvent.qrImage} alt="Zalo QR" style={zaloQrImageStyle} />
              ) : zaloLoginEvent?.status === 'scanned' ? (
                <div style={zaloScannedProfileStyle}>
                  {zaloLoginEvent.avatarUrl ? (
                    <img src={zaloLoginEvent.avatarUrl} alt="" style={zaloScannedAvatarStyle} />
                  ) : (
                    <div style={zaloScannedAvatarPlaceholderStyle}>
                      {(zaloLoginEvent.displayName || zaloLoginAccount.name || 'Z').trim().charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={zaloScannedNameStyle}>{zaloLoginEvent.displayName || zaloLoginAccount.name}</div>
                </div>
              ) : zaloLoginEvent?.status === 'expired' ? (
                <div style={zaloQrExpiredStyle}>
                  <strong>Mã QR đã hết hạn</strong>
                </div>
              ) : (
                <div style={zaloQrPlaceholderStyle}>
                  {zaloLoginStarting && <Loader2 size={18} className="animate-spin" />}
                </div>
              )}
              {zaloLoginEvent?.qrImage && zaloQrRemainingSeconds !== null && (
                <div style={zaloQrCountdownStyle}>
                  Mã QR hết hạn sau {formatQrRemaining(zaloQrRemainingSeconds)}
                </div>
              )}
              {zaloLoginEvent?.avatarUrl && zaloLoginEvent.status !== 'scanned' && (
                <img src={zaloLoginEvent.avatarUrl} alt="" style={zaloAvatarStyle} />
              )}
              <div style={zaloModalMessageStyle}>
                {zaloLoginEvent?.displayName && zaloLoginEvent.status !== 'scanned' && <strong>{zaloLoginEvent.displayName}</strong>}
                <span>{zaloLoginEvent?.message || 'Đang chờ trạng thái đăng nhập Zalo...'}</span>
                {zaloLoginEvent?.status === 'expired' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleZaloLoginQr(zaloLoginAccount)}
                    disabled={zaloLoginStarting}
                    style={zaloRetryButtonStyle}
                  >
                    {zaloLoginStarting && <Loader2 size={14} className="animate-spin" />}
                    {zaloLoginStarting ? 'Đang tạo QR...' : 'Đăng nhập lại'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const zaloOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
}

const zaloModalStyle: React.CSSProperties = {
  width: 'min(360px, calc(100vw - 32px))',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-lg)',
  padding: 16
}

const zaloModalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 16
}

const zaloModalSubTextStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 12,
  marginTop: 2
}

const zaloQrBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12
}

const zaloQrImageStyle: React.CSSProperties = {
  width: 220,
  height: 220,
  objectFit: 'contain',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  background: '#fff'
}

const zaloQrCountdownStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 12,
  lineHeight: 1.4,
  textAlign: 'center'
}

const zaloQrPlaceholderStyle: React.CSSProperties = {
  width: 220,
  height: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  background: 'var(--bg-secondary)'
}

const zaloQrExpiredStyle: React.CSSProperties = {
  width: 220,
  height: 220,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 18,
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  color: 'var(--text-secondary)',
  fontSize: 13,
  lineHeight: 1.4,
  textAlign: 'center'
}

const zaloScannedProfileStyle: React.CSSProperties = {
  width: 220,
  height: 220,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 16,
  border: '1px solid var(--border-primary)',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  textAlign: 'center'
}

const zaloScannedAvatarStyle: React.CSSProperties = {
  width: 76,
  height: 76,
  borderRadius: 38,
  objectFit: 'cover',
  border: '1px solid var(--border-primary)'
}

const zaloScannedAvatarPlaceholderStyle: React.CSSProperties = {
  width: 76,
  height: 76,
  borderRadius: 38,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-primary)',
  fontSize: 28,
  fontWeight: 700
}

const zaloScannedNameStyle: React.CSSProperties = {
  maxWidth: '100%',
  color: 'var(--text-primary)',
  fontSize: 14,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const zaloAvatarStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 20,
  objectFit: 'cover'
}

const zaloRetryButtonStyle: React.CSSProperties = {
  alignSelf: 'center',
  marginTop: 4,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6
}

const zaloModalMessageStyle: React.CSSProperties = {
  minHeight: 40,
  color: 'var(--text-secondary)',
  fontSize: 13,
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  gap: 4
}
