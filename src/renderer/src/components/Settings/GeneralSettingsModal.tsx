import { useEffect, useState } from 'react'
import { CheckCircle2, FolderOpen, Link2, MessageSquareText, Monitor, Phone, X } from 'lucide-react'
import {
  AkaBizIntegrationInfo,
  AkaBizIntegrationKind,
  AkaBizIntegrations,
  AkaBizStaffBasic
} from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

interface GeneralSettingsModalProps {
  onClose: () => void
}

interface IntegrationCardConfig {
  kind: AkaBizIntegrationKind
  title: string
  description: string
  icon: 'sms' | 'zalo' | 'desktop'
}

const INTEGRATION_CARDS: IntegrationCardConfig[] = [
  {
    kind: 'sms',
    title: 'akaBiz Sms',
    description: 'Nhận số điện thoại tìm được từ chiến dịch Facebook.',
    icon: 'sms'
  },
  {
    kind: 'zaloWeb',
    title: 'akaBiz Zalo Web',
    description: 'Nhận số điện thoại và link group Zalo tìm được.',
    icon: 'zalo'
  },
  {
    kind: 'akaBizDesktop',
    title: 'akaBiz Desktop',
    description: 'Nhận số điện thoại và link group Zalo qua dữ liệu SQLite trên máy.',
    icon: 'desktop'
  }
]

function getIntegration(integrations: AkaBizIntegrations | null, kind: AkaBizIntegrationKind): AkaBizIntegrationInfo | null {
  if (kind === 'sms') return integrations?.sms || null
  if (kind === 'zaloWeb') return integrations?.zaloWeb || null
  return integrations?.akaBizDesktop || null
}

function formatAkaBizError(err: unknown, fallback: string): string {
  let message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  return message || fallback
}

export default function GeneralSettingsModal({ onClose }: GeneralSettingsModalProps) {
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const [activeMenu] = useState<'akabiz'>('akabiz')
  const [integrations, setIntegrations] = useState<AkaBizIntegrations | null>(null)
  const [usernames, setUsernames] = useState<Record<AkaBizIntegrationKind, string>>({ sms: '', zaloWeb: '', akaBizDesktop: '' })
  const [desktopInstallPath, setDesktopInstallPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyKind, setBusyKind] = useState<AkaBizIntegrationKind | null>(null)
  const [editingIntegrations, setEditingIntegrations] = useState<Record<AkaBizIntegrationKind, boolean>>({
    sms: false,
    zaloWeb: false,
    akaBizDesktop: false
  })

  const loadIntegrations = async () => {
    if (!window.electronAPI?.getAkaBizIntegrations) return
    setLoading(true)
    try {
      const data = await window.electronAPI.getAkaBizIntegrations()
      setIntegrations(data)
      setUsernames({
        sms: data.sms?.username || '',
        zaloWeb: data.zaloWeb?.username || '',
        akaBizDesktop: data.akaBizDesktop?.username || ''
      })
      setDesktopInstallPath(data.akaBizDesktop?.installPath || '')
      setEditingIntegrations({
        sms: !data.sms,
        zaloWeb: !data.zaloWeb,
        akaBizDesktop: !data.akaBizDesktop
      })
    } catch (err) {
      showAlert(formatAkaBizError(err, 'Không thể tải tích hợp akaBiz.'), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadIntegrations()
  }, [])

  const handleSelectDesktopInstallPath = async () => {
    if (!window.electronAPI?.selectAkaBizDesktopInstallPath) {
      showAlert('Tính năng chọn thư mục akaBiz Desktop chưa sẵn sàng.', 'error')
      return
    }
    try {
      const selectedPath = await window.electronAPI.selectAkaBizDesktopInstallPath()
      if (selectedPath) setDesktopInstallPath(selectedPath)
    } catch (err) {
      showAlert(formatAkaBizError(err, 'Không thể chọn thư mục akaBiz Desktop.'), 'error')
    }
  }

  const handleIntegrate = async (card: IntegrationCardConfig) => {
    const username = usernames[card.kind].trim()
    if (!username) {
      showAlert(`Vui lòng nhập username ${card.title}.`, 'error')
      return
    }
    if (card.kind === 'akaBizDesktop' && !desktopInstallPath.trim()) {
      showAlert('Vui lòng chọn thư mục cài đặt akaBiz Desktop.', 'error')
      return
    }
    if (!window.electronAPI?.lookupAkaBizIntegration || !window.electronAPI?.saveAkaBizIntegration) {
      showAlert('Tính năng tích hợp akaBiz chưa sẵn sàng.', 'error')
      return
    }
    if (card.kind === 'akaBizDesktop' && !window.electronAPI?.validateAkaBizDesktopInstallPath) {
      showAlert('Tính năng kiểm tra thư mục akaBiz Desktop chưa sẵn sàng.', 'error')
      return
    }

    setBusyKind(card.kind)
    try {
      const desktopPath = card.kind === 'akaBizDesktop'
        ? await window.electronAPI.validateAkaBizDesktopInstallPath(desktopInstallPath)
        : null
      if (desktopPath) setDesktopInstallPath(desktopPath.installPath)

      const staff = await window.electronAPI.lookupAkaBizIntegration(card.kind, username)
      const desktopLine = card.kind === 'akaBizDesktop'
        ? `\nThư mục cài đặt: ${desktopPath?.installPath || desktopInstallPath.trim()}`
        : ''
      showConfirm(
        `Tìm thấy tài khoản ${card.title}:\nUsername: ${staff.username}\nTên: ${staff.name || '-'}${desktopLine}\n\nXác nhận tích hợp tài khoản này?`,
        async () => {
          setBusyKind(card.kind)
          try {
            const payload: AkaBizStaffBasic = {
              ...staff,
              username,
              installPath: desktopPath?.installPath
            }
            const saved = await window.electronAPI.saveAkaBizIntegration(card.kind, payload)
            setIntegrations(saved)
            setUsernames({
              sms: saved.sms?.username || usernames.sms,
              zaloWeb: saved.zaloWeb?.username || usernames.zaloWeb,
              akaBizDesktop: saved.akaBizDesktop?.username || usernames.akaBizDesktop
            })
            setDesktopInstallPath(saved.akaBizDesktop?.installPath || desktopInstallPath)
            setEditingIntegrations(prev => ({ ...prev, [card.kind]: false }))
            window.dispatchEvent(new Event('akabiz-integrations-updated'))
            showAlert(`Đã tích hợp ${card.title}.`, 'success')
          } catch (err) {
            showAlert(formatAkaBizError(err, `Không thể lưu tích hợp ${card.title}.`), 'error')
          } finally {
            setBusyKind(null)
          }
        },
        { title: 'Xác nhận tích hợp', confirmText: 'Xác nhận', variant: 'primary' }
      )
    } catch (err) {
      showAlert(formatAkaBizError(err, `Không thể tích hợp ${card.title}.`), 'error')
    } finally {
      setBusyKind(null)
    }
  }

  const handlePrimaryAction = (card: IntegrationCardConfig, integration: AkaBizIntegrationInfo | null, isEditing: boolean) => {
    if (integration && !isEditing) {
      setUsernames(prev => ({ ...prev, [card.kind]: integration.username }))
      if (card.kind === 'akaBizDesktop') setDesktopInstallPath(integration.installPath || '')
      setEditingIntegrations(prev => ({ ...prev, [card.kind]: true }))
      return
    }
    void handleIntegrate(card)
  }

  const handleCancelEdit = (card: IntegrationCardConfig, integration: AkaBizIntegrationInfo) => {
    setUsernames(prev => ({ ...prev, [card.kind]: integration.username }))
    if (card.kind === 'akaBizDesktop') setDesktopInstallPath(integration.installPath || '')
    setEditingIntegrations(prev => ({ ...prev, [card.kind]: false }))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="general-settings-modal" onClick={event => event.stopPropagation()}>
        <div className="general-settings-header">
          <div>
            <h2>Cài đặt chung</h2>
            <div className="general-settings-subtitle">Thiết lập tích hợp dùng chung cho tài khoản đang đăng nhập</div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="general-settings-body">
          <aside className="general-settings-sidebar">
            <button className={`general-settings-nav-item ${activeMenu === 'akabiz' ? 'active' : ''}`}>
              <Link2 size={15} />
              <span>Tích hợp akaBiz</span>
            </button>
          </aside>

          <section className="general-settings-content">
            {loading ? (
              <div className="text-center text-secondary" style={{ padding: 24 }}>Đang tải...</div>
            ) : (
              <div className="akabiz-integration-grid">
                {INTEGRATION_CARDS.map(card => {
                  const integration = getIntegration(integrations, card.kind)
                  const isEditing = !integration || editingIntegrations[card.kind]
                  const busy = busyKind === card.kind
                  return (
                    <div key={card.kind} className={`akabiz-integration-card ${isEditing ? 'editing' : 'connected'}`}>
                      <div className="akabiz-integration-card-head">
                        <div className="akabiz-integration-icon">
                          {card.icon === 'sms'
                            ? <Phone size={18} />
                            : card.icon === 'desktop'
                              ? <Monitor size={18} />
                              : <MessageSquareText size={18} />}
                        </div>
                        <div>
                          <div className="akabiz-integration-title">{card.title}</div>
                        </div>
                      </div>

                      <div className="akabiz-integration-main">
                        {integration && !isEditing ? (
                          <div className={`akabiz-integration-summary ${card.kind === 'akaBizDesktop' ? 'desktop' : ''}`}>
                            <div className="akabiz-integration-status">
                              <CheckCircle2 size={15} />
                              <span>Đã tích hợp</span>
                            </div>
                            <div className="akabiz-integration-info">
                              <span>Username</span>
                              <strong>{integration.username}</strong>
                            </div>
                            <div className="akabiz-integration-info">
                              <span>Tên</span>
                              <strong>{integration.name || '-'}</strong>
                            </div>
                            {card.kind === 'akaBizDesktop' && (
                              <div className="akabiz-integration-info">
                                <span>Thư mục cài đặt</span>
                                <strong title={integration.installPath || ''}>{integration.installPath || '-'}</strong>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="akabiz-edit-fields">
                            <div className="akabiz-username-field">
                              <label>Username</label>
                              <input
                                className="stepper-input"
                                value={usernames[card.kind]}
                                onChange={event => setUsernames(prev => ({ ...prev, [card.kind]: event.target.value }))}
                                placeholder="Nhập username"
                                disabled={busy}
                              />
                            </div>
                            {card.kind === 'akaBizDesktop' && (
                              <div className="akabiz-username-field">
                                <label>Thư mục cài đặt</label>
                                <div className="akabiz-path-input-row">
                                  <input
                                    className="stepper-input"
                                    value={desktopInstallPath}
                                    onChange={event => setDesktopInstallPath(event.target.value)}
                                    placeholder="Chọn thư mục akaBizDesktop"
                                    disabled={busy}
                                  />
                                  <button
                                    type="button"
                                    className="btn-icon akabiz-path-button"
                                    title="Chọn thư mục"
                                    onClick={handleSelectDesktopInstallPath}
                                    disabled={busy}
                                  >
                                    <FolderOpen size={16} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="akabiz-action-stack">
                        <button
                          className="btn btn-primary akabiz-integrate-button"
                          onClick={() => handlePrimaryAction(card, integration, isEditing)}
                          disabled={busy}
                        >
                          {busy ? 'Đang tìm...' : integration && !isEditing ? 'Tích hợp lại' : 'Tích hợp'}
                        </button>
                        {integration && isEditing && (
                          <button
                            type="button"
                            className="btn btn-ghost akabiz-cancel-button"
                            onClick={() => handleCancelEdit(card, integration)}
                            disabled={busy}
                          >
                            Hủy
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
