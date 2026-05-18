import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCw, Search, Users, X } from 'lucide-react'
import { AccountActionOverview, AutoAccount, AutoAccountContact, ContactType } from '../../../../shared/types'

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

const getLastActivityText = (contact: AutoAccountContact) => {
  const value = contact.extraData?.lastActivityText
  return typeof value === 'string' ? value : ''
}

const getGroupJoinStatus = (contact: AutoAccountContact) => {
  return contact.isJoined === true ? 'Đã tham gia' : 'Chưa tham gia'
}

const getGroupApprovalStatus = (contact: AutoAccountContact) => {
  if (contact.requiresPostApproval === true) return 'Chờ duyệt bài'
  if (contact.requiresPostApproval === false) return 'Không cần duyệt'
  return 'Chưa biết'
}

export default function AccountInfoModal({ account, onClose }: AccountInfoModalProps) {
  const [rows, setRows] = useState<AccountActionOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contactView, setContactView] = useState<ContactType | null>(null)
  const [contacts, setContacts] = useState<AutoAccountContact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [contactSearch, setContactSearch] = useState('')

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

  useEffect(() => {
    setContactView(null)
    setContacts([])
    setContactsError(null)
    setContactSearch('')
  }, [account.id])

  const loadContacts = useCallback(async (type: ContactType) => {
    if (!window.electronAPI?.listContacts) return
    setContactsLoading(true)
    setContactsError(null)
    try {
      const data = await window.electronAPI.listContacts(account.id, type)
      setContacts(data)
    } catch (err: any) {
      setContactsError(err?.message || 'Không thể tải danh sách contact')
    } finally {
      setContactsLoading(false)
    }
  }, [account.id])

  const openContactView = useCallback((type: ContactType) => {
    setContactView(type)
    setContactSearch('')
    loadContacts(type)
  }, [loadContacts])

  const refreshCurrentView = useCallback(() => {
    if (contactView) {
      loadContacts(contactView)
      return
    }
    loadOverview()
  }, [contactView, loadContacts, loadOverview])

  const limitedCount = useMemo(() => rows.filter(row => row.status.isDisable).length, [rows])
  const totalToday = useMemo(() => rows.reduce((sum, row) => sum + (row.status.countActionInDay || 0), 0), [rows])
  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLocaleLowerCase('vi-VN')
    if (!query) return contacts

    return contacts.filter(contact => {
      const searchable = [
        contact.name,
        contact.uid,
        contact.url,
        getLastActivityText(contact),
        contactView === 'group' ? getGroupJoinStatus(contact) : '',
        contactView === 'group' ? getGroupApprovalStatus(contact) : ''
      ].filter(Boolean).join(' ').toLocaleLowerCase('vi-VN')
      return searchable.includes(query)
    })
  }, [contactSearch, contactView, contacts])
  const contactViewTitle = contactView === 'friend' ? 'Danh sách bạn bè' : 'Danh sách group'

  return (
    <div className="modal-overlay">
      <div className="modal account-info-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Thông tin tài khoản</div>
            <div className="account-info-subtitle">{account.name}</div>
          </div>
          <div className="account-info-header-actions">
            <button
              className="btn btn-ghost btn-icon"
              onClick={refreshCurrentView}
              disabled={loading || contactsLoading}
              title="Làm mới"
            >
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

          <div className="account-info-view-actions">
            <button
              type="button"
              className={`btn ${contactView === null ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setContactView(null)}
            >
              <CheckCircle2 size={14} />
              Hành động
            </button>
            <button
              type="button"
              className={`btn ${contactView === 'friend' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => openContactView('friend')}
            >
              <Users size={14} />
              Xem bạn bè
            </button>
            <button
              type="button"
              className={`btn ${contactView === 'group' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => openContactView('group')}
            >
              <FolderOpen size={14} />
              Xem group
            </button>
          </div>

          {!contactView && error && (
            <div className="account-info-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {contactView ? (
            <>
              {contactsError && (
                <div className="account-info-error">
                  <AlertTriangle size={14} />
                  <span>{contactsError}</span>
                </div>
              )}

              <div className="account-info-contact-header">
                <div>
                  <div className="account-info-actions-title">{contactViewTitle}</div>
                  <div className="account-info-contact-count">
                    {contactView === 'group'
                      ? `${filteredContacts.length}/${contacts.length} group đã lưu`
                      : `${filteredContacts.length}/${contacts.length} contact đang hoạt động`}
                  </div>
                </div>
                <label className="account-info-contact-search">
                  <Search size={14} />
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={event => setContactSearch(event.target.value)}
                    placeholder={contactView === 'friend' ? 'Tìm bạn bè...' : 'Tìm group...'}
                  />
                </label>
              </div>

              {contactsLoading ? (
                <div className="text-center text-secondary account-info-loading">Đang tải...</div>
              ) : contacts.length === 0 ? (
                <div className="text-center text-muted account-info-loading">
                  {contactView === 'friend' ? 'Chưa có dữ liệu bạn bè' : 'Chưa có dữ liệu group'}
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="text-center text-muted account-info-loading">Không tìm thấy contact phù hợp</div>
              ) : (
                <table className="campaign-grid account-info-actions-table account-info-contact-table">
                  <thead>
                    <tr>
                      <th>Tên</th>
                      <th>UID/Slug</th>
                      <th>Link</th>
                      {contactView === 'group' && <th>Tham gia</th>}
                      {contactView === 'group' && <th>Duyệt bài</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(contact => (
                      <tr key={contact.id}>
                        <td className="account-info-contact-name">
                          <strong>{contact.name || '-'}</strong>
                        </td>
                        <td className="account-info-code">{contact.uid || '-'}</td>
                        <td>
                          {contact.url ? (
                            <a
                              className="account-info-contact-link"
                              href={contact.url}
                              target="_blank"
                              rel="noreferrer"
                              title={contact.url}
                            >
                              {contact.url}
                            </a>
                          ) : '-'}
                        </td>
                        {contactView === 'group' && (
                          <td>
                            <span className={`account-info-status ${contact.isJoined === true ? 'account-info-status-ok' : 'account-info-status-muted'}`}>
                              {getGroupJoinStatus(contact)}
                            </span>
                          </td>
                        )}
                        {contactView === 'group' && (
                          <td>
                            <span className={`account-info-status ${
                              contact.requiresPostApproval === true
                                ? 'account-info-status-limited'
                                : contact.requiresPostApproval === false
                                  ? 'account-info-status-ok'
                                  : 'account-info-status-muted'
                            }`}>
                              {getGroupApprovalStatus(contact)}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
