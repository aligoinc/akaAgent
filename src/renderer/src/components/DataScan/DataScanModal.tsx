import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Maximize2, Minimize2, RefreshCw, Search, Square, X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import { AutoAccount, AutoAccountContact, ContactType } from '../../../../shared/types'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'

export type DataScanAction = 'facebook_friends' | 'facebook_groups' | 'facebook_pages'

interface DataScanActionDef {
  id: DataScanAction
  label: string
  contactType: ContactType
  emptyText: string
  loadingText: string
}

interface DataScanModalProps {
  initialAction?: DataScanAction
  initialAccountId?: number
  lockAction?: boolean
  onClose: () => void
  onSelect?: (contacts: AutoAccountContact[]) => void
}

const DATA_SCAN_ACTIONS: DataScanActionDef[] = [
  {
    id: 'facebook_friends',
    label: 'Facebook - Lấy danh sách bạn bè',
    contactType: 'friend',
    emptyText: 'Chưa có dữ liệu bạn bè',
    loadingText: 'Đang tải danh sách bạn bè...'
  },
  {
    id: 'facebook_groups',
    label: 'Facebook - Lấy danh sách group',
    contactType: 'group',
    emptyText: 'Chưa có dữ liệu group',
    loadingText: 'Đang tải danh sách group...'
  },
  {
    id: 'facebook_pages',
    label: 'Facebook - Lấy danh sách page',
    contactType: 'page',
    emptyText: 'Chưa có dữ liệu page',
    loadingText: 'Đang tải danh sách page...'
  }
]

const EXPORT_HEADERS = ['Tên', 'Uid']

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

const sanitizeFileSegment = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'data'
}

const getContactValue = (contact: AutoAccountContact) => contact.url || contact.uid || ''

const getContactInfo = (contact: AutoAccountContact) => {
  const extra = contact.extraData || {}
  const category = typeof extra.category === 'string' ? extra.category : ''
  const lastActivityText = typeof extra.lastActivityText === 'string' ? extra.lastActivityText : ''
  return category || lastActivityText || ''
}

const getGroupApprovalStatus = (contact: AutoAccountContact) => {
  if (contact.requiresPostApproval === true) return 'Chờ duyệt bài'
  if (contact.requiresPostApproval === false) return 'Không cần duyệt'
  return 'Chưa biết'
}

const getDedupeKey = (contact: AutoAccountContact) => {
  const value = getContactValue(contact) || contact.name || String(contact.id)
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./i, '').replace(/^web\./i, '').replace(/^m\./i, '').toLowerCase()
    if (url.pathname === '/profile.php' && url.searchParams.get('id')) {
      return `${host}/profile.php?id=${url.searchParams.get('id')}`
    }
    return `${host}${url.pathname.replace(/\/+$/g, '')}`.toLowerCase()
  } catch {
    return value.trim().replace(/\/+$/g, '').toLowerCase()
  }
}

const dedupeContacts = (contacts: AutoAccountContact[]) => {
  const seen = new Set<string>()
  const result: AutoAccountContact[] = []
  for (const contact of contacts) {
    const key = getDedupeKey(contact)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(contact)
  }
  return result
}

export default function DataScanModal({
  initialAction = 'facebook_friends',
  initialAccountId,
  lockAction = false,
  onClose,
  onSelect
}: DataScanModalProps) {
  const { accounts, loadAccounts } = useCampaignStore()
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const mountedRef = useRef(true)
  const scanRunIdRef = useRef(0)
  const stoppedScanIdsRef = useRef<Set<number>>(new Set())
  const completedScanIdsRef = useRef<Set<number>>(new Set())
  const [action, setAction] = useState<DataScanAction>(initialAction)
  const [accountId, setAccountId] = useState<number | ''>(initialAccountId || '')
  const [contacts, setContacts] = useState<AutoAccountContact[]>([])
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [dedupeOnOutput, setDedupeOnOutput] = useState(true)
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(100)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const [minimized, setMinimized] = useState(false)

  const actionDef = useMemo(
    () => DATA_SCAN_ACTIONS.find(item => item.id === action) || DATA_SCAN_ACTIONS[0],
    [action]
  )
  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === accountId),
    [accounts, accountId]
  )

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (accountId !== '') return
    const preferred = initialAccountId
      ? accounts.find(account => account.id === initialAccountId)
      : accounts.find(account => account.flatformType === 'facebook') || accounts[0]
    if (preferred) setAccountId(preferred.id)
  }, [accountId, accounts, initialAccountId])

  const loadCachedContacts = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      setContacts([])
      return
    }
    setLoading(true)
    try {
      const data = await window.electronAPI.listContacts(accountId, actionDef.contactType)
      setContacts(data)
    } catch (err: any) {
      console.error('Failed to load scan contacts:', err)
      showAlert(err?.message || 'Không thể tải danh sách data.', 'error')
    } finally {
      setLoading(false)
    }
  }, [accountId, actionDef.contactType, showAlert])

  useEffect(() => {
    setSelectedIds(new Set())
    loadCachedContacts()
  }, [loadCachedContacts])

  useEffect(() => {
    if (!window.electronAPI?.onContactsProgress) return
    const unsubscribe = window.electronAPI.onContactsProgress(({ message }) => {
      setProgressMessages(prev => [...prev.slice(-4), message])
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.onContactsCompleted || accountId === '') return
    const unsubscribe = window.electronAPI.onContactsCompleted(({ accountId: completedAccountId, contactType, result }) => {
      if (completedAccountId !== accountId || contactType !== actionDef.contactType) return

      const scanId = scanRunIdRef.current
      if (scanId === 0) return
      if (completedScanIdsRef.current.has(scanId)) return
      completedScanIdsRef.current.add(scanId)

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      setScanLoading(false)
      setMinimized(false)
      loadCachedContacts()

      if (!result.success) {
        if (!wasStopped) showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      if (!wasStopped) showAlert(`Đã tải ${result.count} data.`, 'success')
    })
    return unsubscribe
  }, [accountId, actionDef.contactType, loadCachedContacts, showAlert])

  const visibleContacts = useMemo(() => {
    if (actionDef.contactType !== 'group') return contacts
    return contacts.filter(contact => contact.isJoined === true)
  }, [actionDef.contactType, contacts])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN')
    if (!query) return visibleContacts
    return visibleContacts.filter(contact => [
      contact.name,
      contact.uid,
      contact.url,
      getContactInfo(contact),
      actionDef.contactType === 'group' ? getGroupApprovalStatus(contact) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [actionDef.contactType, search, visibleContacts])

  const allVisibleSelected = filteredContacts.length > 0 && filteredContacts.every(contact => selectedIds.has(contact.id))
  const selectedContacts = useMemo(
    () => visibleContacts.filter(contact => selectedIds.has(contact.id)),
    [selectedIds, visibleContacts]
  )
  const outputContacts = useMemo(
    () => dedupeOnOutput ? dedupeContacts(selectedContacts) : selectedContacts,
    [dedupeOnOutput, selectedContacts]
  )
  const tableColSpan = actionDef.contactType === 'group' ? 6 : 5
  const emptyTableText = contacts.length === 0
    ? actionDef.emptyText
    : actionDef.contactType === 'group' && visibleContacts.length === 0 && search.trim().length === 0
      ? 'Chưa có group đã tham gia.'
      : 'Không tìm thấy data phù hợp.'

  const toggleContact = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const contact of filteredContacts) next.delete(contact.id)
      } else {
        for (const contact of filteredContacts) next.add(contact.id)
      }
      return next
    })
  }

  const selectRange = () => {
    if (filteredContacts.length === 0) return
    const start = Math.max(1, Math.min(rangeStart, rangeEnd))
    const end = Math.min(filteredContacts.length, Math.max(rangeStart, rangeEnd))
    const contactsInRange = filteredContacts.slice(start - 1, end)
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const contact of contactsInRange) next.add(contact.id)
      return next
    })
  }

  const handleLoadData = async () => {
    if (!window.electronAPI || !accountId) {
      showAlert('Vui lòng chọn tài khoản trước.', 'error')
      return
    }
    if (selectedAccount?.flatformType !== 'facebook') {
      showAlert('Hành động này chỉ hỗ trợ tài khoản Facebook.', 'error')
      return
    }

    setScanLoading(true)
    setProgressMessages([])
    const scanId = scanRunIdRef.current + 1
    scanRunIdRef.current = scanId
    stoppedScanIdsRef.current.delete(scanId)
    completedScanIdsRef.current.delete(scanId)
    try {
      const loader = actionDef.contactType === 'friend'
        ? window.electronAPI.loadFriends
        : actionDef.contactType === 'group'
          ? window.electronAPI.loadGroups
          : window.electronAPI.loadPages
      const result = await loader(accountId)
      if (!mountedRef.current) return
      if (scanRunIdRef.current !== scanId) return
      if (completedScanIdsRef.current.has(scanId)) return

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      setScanLoading(false)
      setMinimized(false)

      if (!result.success) {
        if (wasStopped) return
        showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      await loadCachedContacts()
      if (wasStopped) return

      showAlert(`Đã tải ${result.count} data.`, 'success')
    } catch (err: any) {
      if (!mountedRef.current) return
      if (scanRunIdRef.current !== scanId || stoppedScanIdsRef.current.has(scanId)) return
      console.error('Failed to scan data:', err)
      showAlert(err?.message || 'Tải data thất bại.', 'error')
    } finally {
      const wasStopped = stoppedScanIdsRef.current.has(scanId)
      stoppedScanIdsRef.current.delete(scanId)
      if (mountedRef.current && scanRunIdRef.current === scanId && !wasStopped) {
        setScanLoading(false)
        setMinimized(false)
      }
    }
  }

  const cancelScan = async () => {
    if (!accountId || !window.electronAPI?.cancelContactLoad) return
    setProgressMessages(prev => [...prev.slice(-4), 'Đã dừng quét data.'])
    try {
      await window.electronAPI.cancelContactLoad(accountId)
    } catch (err) {
      console.warn('Failed to cancel contact load:', err)
    }
  }

  const handleStopScan = () => {
    stoppedScanIdsRef.current.add(scanRunIdRef.current)
    setScanLoading(false)
    setMinimized(false)
    cancelScan()
  }

  const handleClose = () => {
    if (!scanLoading) {
      onClose()
      return
    }

    showConfirm(
      'Tắt form sẽ dừng quá trình quét data đang chạy. Bạn có chắc muốn tắt form không?',
      async () => {
        await cancelScan()
        onClose()
      },
      { title: 'Dừng quét data', confirmText: 'Dừng và tắt', variant: 'danger' }
    )
  }

  const handleExport = () => {
    if (outputContacts.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi xuất Excel.', 'error')
      return
    }

    try {
      const rows = [
        EXPORT_HEADERS,
        ...outputContacts.map(contact => [
          contact.name || '',
          contact.uid || contact.url || ''
        ])
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 24 },
        { wch: 48 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const accountName = sanitizeFileSegment(selectedAccount?.name || 'account')
      const actionName = sanitizeFileSegment(actionDef.label)
      writeFile(workbook, `scan-data-${accountName}-${actionName}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất data ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export scan data:', err)
      showAlert('Không thể xuất file Excel.', 'error')
    }
  }

  const handleSelect = () => {
    if (!onSelect) return
    if (outputContacts.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi chọn.', 'error')
      return
    }
    onSelect(outputContacts)
    onClose()
  }

  return (
    <div className={`modal-overlay data-scan-overlay ${minimized ? 'minimized' : ''}`}>
      <div className={`campaign-full-modal data-scan-modal ${minimized ? 'minimized' : ''}`}>
        <div className="modal-header data-scan-header">
          <div>
            <div className="modal-title">Quét data</div>
            <div className="data-scan-subtitle">{outputContacts.length}/{selectedContacts.length || 0} data sẵn sàng</div>
          </div>
          <div className="data-scan-header-actions">
            {scanLoading && (
              <button
                className="btn-icon"
                onClick={() => setMinimized(prev => !prev)}
                title={minimized ? 'Mở rộng form' : 'Thu nhỏ form'}
              >
                {minimized ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
              </button>
            )}
            <button className="btn-icon" onClick={handleClose} title="Đóng">
              <X size={18} />
            </button>
          </div>
        </div>

        {minimized ? (
          <div className="data-scan-minimized-body">
            <div className="data-scan-minimized-title">
              <RefreshCw size={14} className="spin" />
              Đang tải data
            </div>
            <div className="data-scan-minimized-message">
              {progressMessages[progressMessages.length - 1] || actionDef.loadingText}
            </div>
            <div className="data-scan-minimized-actions">
              <button
                className="btn btn-danger btn-sm"
                onClick={handleStopScan}
              >
                <Square size={13} />
                Dừng
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="data-scan-body">
          <div className="data-scan-controls">
            <div className="stepper-form-group">
              <label>Hành động</label>
              <select
                className="stepper-input"
                value={action}
                onChange={event => setAction(event.target.value as DataScanAction)}
                disabled={scanLoading || lockAction}
              >
                {DATA_SCAN_ACTIONS.map(item => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>

            <div className="stepper-form-group">
              <label>Tài khoản</label>
              <select
                className="stepper-input"
                value={accountId}
                onChange={event => setAccountId(event.target.value ? Number(event.target.value) : '')}
                disabled={scanLoading}
              >
                <option value="">Chọn tài khoản</option>
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>

            <div className="stepper-form-group">
              <label>Loại tài khoản</label>
              <input className="stepper-input" value={selectedAccount?.flatformType || ''} disabled />
            </div>
          </div>

          <div className="data-scan-toolbar">
            <div className="data-scan-range">
              <span>Chọn từ STT</span>
              <input
                type="number"
                min={1}
                value={rangeStart}
                onChange={event => setRangeStart(Number(event.target.value) || 1)}
                className="stepper-input"
              />
              <span>đến</span>
              <input
                type="number"
                min={1}
                value={rangeEnd}
                onChange={event => setRangeEnd(Number(event.target.value) || 1)}
                className="stepper-input"
              />
              <button className="btn btn-secondary" onClick={selectRange}>Tích chọn</button>
            </div>

            <div className="data-scan-toolbar-right">
              <label className="data-scan-search">
                <Search size={14} />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Tìm theo tên, UID hoặc link..."
                />
              </label>
              {scanLoading ? (
                <button
                  className="btn btn-danger data-scan-load-button"
                  onClick={handleStopScan}
                >
                  <Square size={14} />
                  Dừng
                </button>
              ) : (
                <button className="btn btn-primary data-scan-load-button" onClick={handleLoadData} disabled={!accountId}>
                  <RefreshCw size={14} />
                  Tải data
                </button>
              )}
            </div>
          </div>

          <div className="data-scan-options">
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={dedupeOnOutput}
                onChange={event => setDedupeOnOutput(event.target.checked)}
              />
              <span>Lọc trùng dữ liệu khi chọn, xuất excel</span>
            </label>
            <span>{selectedIds.size} đã tích chọn</span>
          </div>

          {progressMessages.length > 0 && (
            <div className="data-scan-progress">
              {progressMessages.map((message, index) => (
                <div key={`${message}-${index}`}>{message}</div>
              ))}
            </div>
          )}

          <div className="stepper-grid-container data-scan-table-wrap">
            <table className="campaign-grid data-scan-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={filteredContacts.length === 0}
                    />
                  </th>
                  <th style={{ width: 64 }}>STT</th>
                  <th>Tên</th>
                  <th>UID</th>
                  <th>Link</th>
                  {actionDef.contactType === 'group' && <th>Duyệt bài</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={tableColSpan} className="text-center">{actionDef.loadingText}</td></tr>
                ) : filteredContacts.length === 0 ? (
                  <tr><td colSpan={tableColSpan} className="text-center text-muted">{emptyTableText}</td></tr>
                ) : (
                  filteredContacts.map((contact, index) => (
                    <tr
                      key={contact.id}
                      className={selectedIds.has(contact.id) ? 'data-scan-selected-row' : undefined}
                      onClick={() => toggleContact(contact.id)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleContact(contact.id)}
                          onClick={event => event.stopPropagation()}
                        />
                      </td>
                      <td>{index + 1}</td>
                      <td>{contact.name || '-'}</td>
                      <td>{contact.uid || '-'}</td>
                      <td className="data-scan-link-cell">{contact.url || '-'}</td>
                      {actionDef.contactType === 'group' && (
                        <td>
                          <span className="data-scan-status-badge">{getGroupApprovalStatus(contact)}</span>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer data-scan-footer">
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={14} />
            Xuất Excel
          </button>
          <div className="data-scan-footer-right">
            <button className="btn btn-ghost" onClick={handleClose}>{onSelect ? 'Huỷ' : 'Đóng'}</button>
            {onSelect && (
              <button className="btn btn-primary" onClick={handleSelect}>
                <Check size={14} />
                Chọn
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
