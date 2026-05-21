import { useEffect, useState } from 'react'
import { CheckCircle2, Link2, MessageSquareText, Phone, X } from 'lucide-react'
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
  icon: 'sms' | 'zalo'
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
  }
]

function getIntegration(integrations: AkaBizIntegrations | null, kind: AkaBizIntegrationKind): AkaBizIntegrationInfo | null {
  return (kind === 'sms' ? integrations?.sms : integrations?.zaloWeb) || null
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
  const [usernames, setUsernames] = useState<Record<AkaBizIntegrationKind, string>>({ sms: '', zaloWeb: '' })
  const [loading, setLoading] = useState(true)
  const [busyKind, setBusyKind] = useState<AkaBizIntegrationKind | null>(null)
  const [editingIntegrations, setEditingIntegrations] = useState<Record<AkaBizIntegrationKind, boolean>>({
    sms: false,
    zaloWeb: false
  })

  const loadIntegrations = async () => {
    if (!window.electronAPI?.getAkaBizIntegrations) return
    setLoading(true)
    try {
      const data = await window.electronAPI.getAkaBizIntegrations()
      setIntegrations(data)
      setUsernames({
        sms: data.sms?.username || '',
        zaloWeb: data.zaloWeb?.username || ''
      })
      setEditingIntegrations({
        sms: !data.sms,
        zaloWeb: !data.zaloWeb
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

  const handleIntegrate = async (card: IntegrationCardConfig) => {
    const username = usernames[card.kind].trim()
    if (!username) {
      showAlert(`Vui lòng nhập username ${card.title}.`, 'error')
      return
    }
    if (!window.electronAPI?.lookupAkaBizIntegration || !window.electronAPI?.saveAkaBizIntegration) {
      showAlert('Tính năng tích hợp akaBiz chưa sẵn sàng.', 'error')
      return
    }

    setBusyKind(card.kind)
    try {
      const staff = await window.electronAPI.lookupAkaBizIntegration(card.kind, username)
      showConfirm(
        `Tìm thấy tài khoản ${card.title}:\nUsername: ${staff.username}\nTên: ${staff.name || '-'}\n\nXác nhận tích hợp tài khoản này?`,
        async () => {
          setBusyKind(card.kind)
          try {
            const payload: AkaBizStaffBasic = {
              ...staff,
              username
            }
            const saved = await window.electronAPI.saveAkaBizIntegration(card.kind, payload)
            setIntegrations(saved)
            setUsernames({
              sms: saved.sms?.username || usernames.sms,
              zaloWeb: saved.zaloWeb?.username || usernames.zaloWeb
            })
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
      setEditingIntegrations(prev => ({ ...prev, [card.kind]: true }))
      return
    }
    void handleIntegrate(card)
  }

  const handleCancelEdit = (card: IntegrationCardConfig, integration: AkaBizIntegrationInfo) => {
    setUsernames(prev => ({ ...prev, [card.kind]: integration.username }))
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
                          {card.icon === 'sms' ? <Phone size={18} /> : <MessageSquareText size={18} />}
                        </div>
                        <div>
                          <div className="akabiz-integration-title">{card.title}</div>
                        </div>
                      </div>

                      <div className="akabiz-integration-main">
                        {integration && !isEditing ? (
                          <div className="akabiz-integration-summary">
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
                          </div>
                        ) : (
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
