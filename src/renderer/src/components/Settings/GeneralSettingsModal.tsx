import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Ban, CheckCircle2, Edit3, FolderOpen, Link2, Mail, MessageSquareText, Monitor, Phone, Plus, Save, Search, Tags, Trash2, X } from 'lucide-react'
import {
  AkaBizContactTag,
  AkaBizIntegrationInfo,
  AkaBizIntegrationKind,
  AkaBizIntegrations,
  AkaBizStaffBasic,
  EmailNotificationSettings
} from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import ZaloFriendBlocklistSettings from './ZaloFriendBlocklistSettings'

export type GeneralSettingsMenu = 'akabiz' | 'akabizTags' | 'emailNotifications' | 'zaloBlocklists' | 'chatSync'

interface GeneralSettingsModalProps {
  initialMenu?: GeneralSettingsMenu
  onClose: () => void
}

interface IntegrationCardConfig {
  kind: AkaBizIntegrationKind
  title: string
  description: string
  icon: 'sms' | 'zalo' | 'desktop'
}

type SettingsMenu = GeneralSettingsMenu

interface AkaBizTagFormState {
  id: number | null
  name: string
}

const DEFAULT_EMAIL_NOTIFICATION_SETTINGS: EmailNotificationSettings = {
  isEnabled: false,
  recipientEmails: [],
  notifyCampaignCompleted: true,
  dailyReportEnabled: false,
  dailyReportTime: '18:00'
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

function parseRecipientEmails(value: string): string[] {
  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of value.split(/[,\n;]/)) {
    const email = raw.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

export default function GeneralSettingsModal({ initialMenu = 'akabiz', onClose }: GeneralSettingsModalProps) {
  const user = useAuthStore(state => state.user)
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const [activeMenu, setActiveMenu] = useState<SettingsMenu>(initialMenu)
  const [integrations, setIntegrations] = useState<AkaBizIntegrations | null>(null)
  const [usernames, setUsernames] = useState<Record<AkaBizIntegrationKind, string>>({ sms: '', zaloWeb: '', akaBizDesktop: '' })
  const [desktopInstallPath, setDesktopInstallPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyKind, setBusyKind] = useState<AkaBizIntegrationKind | null>(null)
  const [akabizTags, setAkaBizTags] = useState<AkaBizContactTag[]>([])
  const [akabizTagsLoading, setAkaBizTagsLoading] = useState(true)
  const [akabizTagBusy, setAkaBizTagBusy] = useState(false)
  const [akabizTagSearch, setAkaBizTagSearch] = useState('')
  const [akabizTagForm, setAkaBizTagForm] = useState<AkaBizTagFormState>({ id: null, name: '' })
  const [emailSettings, setEmailSettings] = useState<EmailNotificationSettings>(DEFAULT_EMAIL_NOTIFICATION_SETTINGS)
  const [emailRecipientsText, setEmailRecipientsText] = useState('')
  const [emailSettingsLoading, setEmailSettingsLoading] = useState(true)
  const [emailSettingsBusy, setEmailSettingsBusy] = useState(false)
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

  const loadAkaBizTags = async () => {
    if (!window.electronAPI?.listAkaBizContactTags) return
    setAkaBizTagsLoading(true)
    try {
      const rows = await window.electronAPI.listAkaBizContactTags()
      setAkaBizTags(rows)
    } catch (err) {
      showAlert(formatAkaBizError(err, 'Không thể tải tag akaBiz.'), 'error')
    } finally {
      setAkaBizTagsLoading(false)
    }
  }

  const loadEmailSettings = async () => {
    if (!window.electronAPI?.getEmailNotificationSettings) return
    setEmailSettingsLoading(true)
    try {
      const data = await window.electronAPI.getEmailNotificationSettings()
      setEmailSettings(data)
      setEmailRecipientsText((data.recipientEmails || []).join('\n'))
    } catch (err) {
      showAlert(formatAkaBizError(err, 'Không thể tải cài đặt thông báo email.'), 'error')
    } finally {
      setEmailSettingsLoading(false)
    }
  }

  useEffect(() => {
    loadIntegrations()
    loadAkaBizTags()
    loadEmailSettings()
  }, [])

  useEffect(() => {
    setActiveMenu(initialMenu)
  }, [initialMenu])

  const resetAkaBizTagForm = () => {
    setAkaBizTagForm({ id: null, name: '' })
  }

  const renderChatSyncContent = () => {
    const products = user?.chatSyncProducts || []
    return (
      <div className="chat-sync-settings">
        <div className="chat-sync-settings-head">
          <div>
            <h3>Đồng bộ Chat</h3>
            <p>Quyền được cấp theo từng sản phẩm Zalo (16/18) của tổ chức. Thông tin này chỉ xem.</p>
          </div>
          <span className={`chat-sync-effective-status ${user?.isChatSync ? 'is-enabled' : ''}`}>
            {user?.isChatSync ? 'Đang bật' : 'Chưa bật'}
          </span>
        </div>
        {products.length === 0 ? (
          <div className="chat-sync-empty">Tổ chức chưa có sản phẩm để hiển thị.</div>
        ) : (
          <div className="chat-sync-product-list">
            <div className="chat-sync-product-row chat-sync-product-header" aria-hidden="true">
              <span>Tên sản phẩm</span>
              <span>Đồng bộ Chat</span>
            </div>
            {products.map(product => (
              <div className="chat-sync-product-row" key={product.organizationProductId}>
                <div className="chat-sync-product-name">
                  <strong>{product.displayName}</strong>
                  {product.packageName && product.packageName !== product.displayName && (
                    <span>{product.packageName}</span>
                  )}
                  {!product.isActive && <span className="chat-sync-product-expired">Đã hết hạn</span>}
                </div>
                <label className="chat-sync-readonly-check" title="Cài đặt do quản trị sản phẩm cấp">
                  <input type="checkbox" checked={product.isChatSync} disabled readOnly />
                  <span>{product.isChatSync ? 'Có' : 'Không'}</span>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const handleEditAkaBizTag = (tag: AkaBizContactTag) => {
    setAkaBizTagForm({ id: tag.id, name: tag.name })
    setActiveMenu('akabizTags')
  }

  const handleSaveAkaBizTag = async () => {
    const name = akabizTagForm.name.trim()
    if (!name) {
      showAlert('Vui lòng nhập tên tag akaBiz.', 'error')
      return
    }
    if (!window.electronAPI?.createAkaBizContactTag || !window.electronAPI?.updateAkaBizContactTag) {
      showAlert('Tính năng tag akaBiz chưa sẵn sàng.', 'error')
      return
    }

    setAkaBizTagBusy(true)
    try {
      if (akabizTagForm.id) {
        await window.electronAPI.updateAkaBizContactTag(akabizTagForm.id, name)
        showAlert('Đã cập nhật tag akaBiz.', 'success')
      } else {
        await window.electronAPI.createAkaBizContactTag(name)
        showAlert('Đã tạo tag akaBiz.', 'success')
      }
      resetAkaBizTagForm()
      await loadAkaBizTags()
      window.dispatchEvent(new Event('akabiz-contact-tags-updated'))
    } catch (err) {
      showAlert(formatAkaBizError(err, 'Không thể lưu tag akaBiz.'), 'error')
    } finally {
      setAkaBizTagBusy(false)
    }
  }

  const handleDeleteAkaBizTag = (tag: AkaBizContactTag) => {
    if (!window.electronAPI?.deleteAkaBizContactTag) {
      showAlert('Tính năng xoá tag akaBiz chưa sẵn sàng.', 'error')
      return
    }
    showConfirm(
      `Bạn có muốn xoá tag akaBiz "${tag.name}" không?`,
      async () => {
        setAkaBizTagBusy(true)
        try {
          await window.electronAPI.deleteAkaBizContactTag(tag.id)
          if (akabizTagForm.id === tag.id) resetAkaBizTagForm()
          await loadAkaBizTags()
          window.dispatchEvent(new Event('akabiz-contact-tags-updated'))
          showAlert('Đã xoá tag akaBiz.', 'success')
        } catch (err) {
          showAlert(formatAkaBizError(err, 'Không thể xoá tag akaBiz.'), 'error')
        } finally {
          setAkaBizTagBusy(false)
        }
      },
      { title: 'Xoá tag akaBiz', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleSaveEmailSettings = async () => {
    if (!window.electronAPI?.saveEmailNotificationSettings) {
      showAlert('Tính năng thông báo email chưa sẵn sàng.', 'error')
      return
    }
    const recipientEmails = parseRecipientEmails(emailRecipientsText)
    if (emailSettings.isEnabled && recipientEmails.length === 0) {
      showAlert('Vui lòng nhập ít nhất một email nhận thông báo.', 'error')
      return
    }

    setEmailSettingsBusy(true)
    try {
      const saved = await window.electronAPI.saveEmailNotificationSettings({
        ...emailSettings,
        recipientEmails,
        dailyReportTime: emailSettings.dailyReportTime || '18:00'
      })
      setEmailSettings(saved)
      setEmailRecipientsText((saved.recipientEmails || []).join('\n'))
      showAlert('Đã lưu cài đặt thông báo email.', 'success')
    } catch (err) {
      showAlert(formatAkaBizError(err, 'Không thể lưu cài đặt thông báo email.'), 'error')
    } finally {
      setEmailSettingsBusy(false)
    }
  }

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

  const normalizedAkaBizTagSearch = akabizTagSearch.trim().toLowerCase()
  const filteredAkaBizTags = normalizedAkaBizTagSearch
    ? akabizTags.filter(tag => tag.name.toLowerCase().includes(normalizedAkaBizTagSearch))
    : akabizTags

  const renderEmailNotificationContent = () => (
    <div className="email-notification-settings">
      <div className="content-template-editor">
        <div className="content-template-editor-head">
          <div className="content-template-title">Nhận thông báo</div>
        </div>

        {emailSettingsLoading ? (
          <div className="text-center text-secondary" style={{ padding: 24 }}>Đang tải...</div>
        ) : (
          <>
            <div className="email-notification-form-grid">
              <label className="schedule-checkbox-label email-notification-toggle">
                <input
                  type="checkbox"
                  checked={emailSettings.isEnabled}
                  onChange={event => setEmailSettings(prev => ({ ...prev, isEnabled: event.target.checked }))}
                  disabled={emailSettingsBusy}
                />
                <span>Bật thông báo email</span>
              </label>

              <div className="content-template-field full">
                <label>Email nhận thông báo</label>
                <input
                  className="stepper-input email-notification-recipient-input"
                  value={emailRecipientsText}
                  onChange={event => setEmailRecipientsText(event.target.value)}
                  placeholder="Nhập email nhận thông báo"
                  disabled={emailSettingsBusy}
                />
              </div>

              <div className="email-notification-option-list">
                <label className="schedule-checkbox-label">
                  <input
                    type="checkbox"
                    checked={emailSettings.notifyCampaignCompleted}
                    onChange={event => setEmailSettings(prev => ({ ...prev, notifyCampaignCompleted: event.target.checked }))}
                    disabled={emailSettingsBusy || !emailSettings.isEnabled}
                  />
                  <span>Gửi khi chiến dịch hoàn thành</span>
                </label>
                <label className="schedule-checkbox-label">
                  <input
                    type="checkbox"
                    checked={emailSettings.dailyReportEnabled}
                    onChange={event => setEmailSettings(prev => ({ ...prev, dailyReportEnabled: event.target.checked }))}
                    disabled={emailSettingsBusy || !emailSettings.isEnabled}
                  />
                  <span>Báo cáo hàng ngày</span>
                </label>
              </div>

              <div className="content-template-field email-notification-time-field">
                <label>Giờ gửi báo cáo</label>
                <input
                  type="time"
                  className="stepper-input"
                  value={(emailSettings.dailyReportTime || '18:00').slice(0, 5)}
                  onChange={event => setEmailSettings(prev => ({ ...prev, dailyReportTime: event.target.value }))}
                  disabled={emailSettingsBusy || !emailSettings.isEnabled || !emailSettings.dailyReportEnabled}
                />
              </div>
            </div>

            <div className="content-template-editor-actions">
              <button type="button" className="btn btn-primary" onClick={handleSaveEmailSettings} disabled={emailSettingsBusy}>
                <Save size={15} />
                <span>{emailSettingsBusy ? 'Đang lưu...' : 'Lưu cài đặt'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  const renderAkaBizTagsContent = () => (
    <div className="content-template-settings akabiz-tag-settings">
      <div className="content-template-editor akabiz-tag-editor">
        <div className="content-template-editor-head">
          <div className="content-template-title">
            {akabizTagForm.id ? 'Sửa tag akaBiz' : 'Thêm tag akaBiz'}
          </div>
          {akabizTagForm.id && (
            <button type="button" className="btn btn-ghost" onClick={resetAkaBizTagForm} disabled={akabizTagBusy}>
              Hủy sửa
            </button>
          )}
        </div>
        <div className="akabiz-tag-form-row">
          <div className="content-template-field akabiz-tag-name-field">
            <label>Tên tag</label>
            <input
              className="stepper-input"
              value={akabizTagForm.name}
              onChange={event => setAkaBizTagForm(prev => ({ ...prev, name: event.target.value }))}
              placeholder="Ví dụ: Khách quan tâm"
              disabled={akabizTagBusy}
            />
          </div>
          <button type="button" className="btn btn-primary akabiz-tag-save-button" onClick={handleSaveAkaBizTag} disabled={akabizTagBusy}>
            <Plus size={15} />
            <span>{akabizTagBusy ? 'Đang lưu...' : akabizTagForm.id ? 'Lưu thay đổi' : 'Thêm tag'}</span>
          </button>
        </div>
      </div>

      <div className="content-template-list-head">
        <div className="content-template-title">Danh sách tag</div>
        <div className="content-template-search">
          <Search size={15} />
          <input
            value={akabizTagSearch}
            onChange={event => setAkaBizTagSearch(event.target.value)}
            placeholder="Tìm tag akaBiz"
          />
        </div>
      </div>

      <div className="content-template-table-wrap">
        <table className="campaign-grid content-template-table">
          <thead>
            <tr>
              <th>Tên tag</th>
              <th>Số contact</th>
              <th>Ngày tạo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {akabizTagsLoading ? (
              <tr><td colSpan={4} className="text-center text-secondary">Đang tải...</td></tr>
            ) : filteredAkaBizTags.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-secondary">Chưa có tag akaBiz.</td></tr>
            ) : filteredAkaBizTags.map(tag => (
              <tr key={tag.id}>
                <td className="content-template-name">{tag.name}</td>
                <td>{tag.contactCount || 0}</td>
                <td>{tag.createdAt ? new Date(tag.createdAt).toLocaleDateString('vi-VN') : '-'}</td>
                <td>
                  <div className="content-template-row-actions">
                    <button type="button" className="btn-icon" title="Sửa tag" onClick={() => handleEditAkaBizTag(tag)} disabled={akabizTagBusy}>
                      <Edit3 size={15} />
                    </button>
                    <button type="button" className="btn-icon danger" title="Xoá tag" onClick={() => handleDeleteAkaBizTag(tag)} disabled={akabizTagBusy}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return createPortal(
    <div className="modal-overlay general-settings-modal-overlay" onClick={onClose}>
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
            <button
              className={`general-settings-nav-item ${activeMenu === 'chatSync' ? 'active' : ''}`}
              onClick={() => setActiveMenu('chatSync')}
            >
              <MessageSquareText size={15} />
              <span>Đồng bộ Chat</span>
            </button>
            <button
              className={`general-settings-nav-item ${activeMenu === 'akabiz' ? 'active' : ''}`}
              onClick={() => setActiveMenu('akabiz')}
            >
              <Link2 size={15} />
              <span>Tích hợp akaBiz</span>
            </button>
            <button
              className={`general-settings-nav-item ${activeMenu === 'akabizTags' ? 'active' : ''}`}
              onClick={() => setActiveMenu('akabizTags')}
            >
              <Tags size={15} />
              <span>Tag akaBiz</span>
            </button>
            <button
              className={`general-settings-nav-item ${activeMenu === 'emailNotifications' ? 'active' : ''}`}
              onClick={() => setActiveMenu('emailNotifications')}
            >
              <Mail size={15} />
              <span>Nhận thông báo</span>
            </button>
            <button
              className={`general-settings-nav-item ${activeMenu === 'zaloBlocklists' ? 'active' : ''}`}
              onClick={() => setActiveMenu('zaloBlocklists')}
            >
              <Ban size={15} />
              <span>Danh sách không gửi tin</span>
            </button>
          </aside>

          <section className={`general-settings-content ${activeMenu === 'zaloBlocklists' ? 'zalo-blocklist-content' : ''}`}>
            {activeMenu === 'chatSync' ? renderChatSyncContent() : activeMenu === 'akabiz' ? (loading ? (
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
            )) : activeMenu === 'akabizTags' ? renderAkaBizTagsContent() : activeMenu === 'emailNotifications' ? renderEmailNotificationContent() : <ZaloFriendBlocklistSettings />}
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}
