import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { AutoAccount, ZaloFriendBlocklistContact, AutoAccountContactGroup, ZaloFriendBlocklistMutationResult } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'
import { getAccountPlatformLabel } from '../../utils/accountLabels'
import { BLOCKLIST_PAGE_SIZE, useZaloFriendBlocklistPage } from './useZaloFriendBlocklistPage'

function formatIpcError(err: unknown, fallback: string): string {
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

const contactLabel = (contact: ZaloFriendBlocklistContact): string => (
  contact.name || contact.uid || `#${contact.id}`
)

export default function ZaloFriendBlocklistSettings({ initialAccountId, onBusyChange }: {
  initialAccountId?: number
  onBusyChange?: (busy: boolean) => void
} = {}) {
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const [accounts, setAccounts] = useState<AutoAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0)
  const [blocklists, setBlocklists] = useState<AutoAccountContactGroup[]>([])
  const [activeBlocklistId, setActiveBlocklistId] = useState<number | null>(null)
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<number>>(new Set())
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set())
  const [newBlocklistName, setNewBlocklistName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [friendSearch, setFriendSearch] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  const [revision, setRevision] = useState(0)
  const listRequest = useRef(0)
  const selectedAccountRef = useRef(selectedAccountId)
  selectedAccountRef.current = selectedAccountId

  const activeBlocklist = useMemo(
    () => blocklists.find(item => item.id === activeBlocklistId) || null,
    [blocklists, activeBlocklistId]
  )
  const friendPage = useZaloFriendBlocklistPage(selectedAccountId, activeBlocklistId, 'available', friendSearch, revision)
  const memberPage = useZaloFriendBlocklistPage(selectedAccountId, activeBlocklistId, 'members', memberSearch, revision)
  const loadingFriends = loadingData || friendPage.loading
  const loadingMembers = loadingData || memberPage.loading

  // Keep selections across pages of the same search, including rows not loaded now.
  useEffect(() => { setSelectedFriendIds(new Set()) }, [selectedAccountId, activeBlocklistId, friendSearch.trim()])
  useEffect(() => { setSelectedMemberIds(new Set()) }, [selectedAccountId, activeBlocklistId, memberSearch.trim()])

  const loadAccounts = async () => {
    if (!window.electronAPI?.listAccounts) return
    setLoadingAccounts(true)
    try {
      const rows = await window.electronAPI.listAccounts()
      const zaloAccounts = rows.filter(account => account.flatformType === 'zalo' && !account.isDelete)
      setAccounts(zaloAccounts)
      setSelectedAccountId(prev => (
        prev && zaloAccounts.some(account => account.id === prev)
          ? prev
          : zaloAccounts.find(account => account.id === initialAccountId)?.id || zaloAccounts[0]?.id || 0
      ))
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể tải tài khoản Zalo.'), 'error')
    } finally {
      setLoadingAccounts(false)
    }
  }

  const loadBlocklists = async (accountId: number, preserveOnError = false): Promise<string | undefined> => {
    const request = ++listRequest.current
    setLoadingData(true)
    try {
      const rows = accountId ? await window.electronAPI.listZaloFriendBlocklists(accountId) : []
      if (request !== listRequest.current || selectedAccountRef.current !== accountId) return
      setBlocklists(rows)
      setActiveBlocklistId(prev => rows.some(group => group.id === prev) ? prev : rows[0]?.id || null)
    } catch (err) {
      if (request !== listRequest.current || selectedAccountRef.current !== accountId) return
      const message = formatIpcError(err, 'Không thể tải danh sách không gửi tin.')
      if (!preserveOnError) {
        showAlert(message, 'error')
        setBlocklists([])
        setActiveBlocklistId(null)
      }
      return message
    } finally {
      if (request === listRequest.current && selectedAccountRef.current === accountId) setLoadingData(false)
    }
  }

  useEffect(() => {
    void loadAccounts()
    return () => { listRequest.current += 1 }
  }, [])

  useEffect(() => {
    void loadBlocklists(selectedAccountId)
  }, [selectedAccountId])

  const refreshAll = async () => {
    setSelectedFriendIds(new Set())
    setSelectedMemberIds(new Set())
    if (!selectedAccountId) {
      await loadAccounts()
      return
    }
    setRevision(value => value + 1)
    await loadBlocklists(selectedAccountId)
  }

  const toggleFriend = (contactId: number) => {
    setSelectedFriendIds(prev => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  const toggleMember = (contactId: number) => {
    setSelectedMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  const handleCreateBlocklist = async () => {
    const name = newBlocklistName.trim()
    if (!selectedAccountId) {
      showAlert('Vui lòng chọn tài khoản Zalo.', 'error')
      return
    }
    if (!name) {
      showAlert('Vui lòng nhập tên danh sách không gửi tin.', 'error')
      return
    }
    if (!window.electronAPI?.createZaloFriendBlocklist) {
      showAlert('Tính năng danh sách không gửi tin chưa sẵn sàng.', 'error')
      return
    }

    setBusy(true)
    try {
      const created = await window.electronAPI.createZaloFriendBlocklist(selectedAccountId, name)
      setNewBlocklistName('')
      await loadBlocklists(selectedAccountId)
      setActiveBlocklistId(created.id)
      showAlert('Đã tạo danh sách không gửi tin.', 'success')
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể tạo danh sách không gửi tin.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRenameBlocklist = async (group: AutoAccountContactGroup) => {
    const name = editingName.trim()
    if (!name || name === group.name) {
      setEditingId(null)
      setEditingName('')
      return
    }
    if (!window.electronAPI?.updateZaloFriendBlocklist) return

    setBusy(true)
    try {
      const updated = await window.electronAPI.updateZaloFriendBlocklist(group.id, name)
      setBlocklists(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item))
      setEditingId(null)
      setEditingName('')
      showAlert('Đã đổi tên danh sách không gửi tin.', 'success')
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể đổi tên danh sách không gửi tin.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteBlocklist = (group: AutoAccountContactGroup) => {
    if (!window.electronAPI?.deleteZaloFriendBlocklist) return
    showConfirm(
      `Xoá danh sách không gửi tin "${group.name}"?`,
      async () => {
        setBusy(true)
        try {
          await window.electronAPI.deleteZaloFriendBlocklist(group.id)
          await loadBlocklists(selectedAccountId)
          showAlert('Đã xoá danh sách không gửi tin.', 'success')
        } catch (err) {
          showAlert(formatIpcError(err, 'Không thể xoá danh sách không gửi tin.'), 'error')
        } finally {
          setBusy(false)
        }
      },
      { title: 'Xoá danh sách không gửi tin', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleMutateFriends = async (mode: 'add' | 'remove') => {
    const ids = Array.from(mode === 'add' ? selectedFriendIds : selectedMemberIds)
    const mutate = mode === 'add' ? window.electronAPI?.addFriendsToZaloFriendBlocklist : window.electronAPI?.removeFriendsFromZaloFriendBlocklist
    if (busy || !activeBlocklistId || ids.length === 0 || !mutate) return
    setBusy(true)
    try {
      let result: ZaloFriendBlocklistMutationResult
      try {
        result = await mutate(activeBlocklistId, ids)
      } catch (err) {
        // IPC errors can leave the write outcome unknown; retain IDs for an idempotent retry.
        result = { success: false, count: 0, remainingIds: ids, error: formatIpcError(err, 'Không thể xác nhận kết quả xử lý.') }
      }
      const remainingIds = result.success ? [] : result.remainingIds
      setSelectedFriendIds(new Set(mode === 'add' ? remainingIds : []))
      setSelectedMemberIds(new Set(mode === 'remove' ? remainingIds : []))
      // Refresh both pages even after a partial/uncertain write, without clearing pending IDs.
      setRevision(value => value + 1)
      const refreshError = await loadBlocklists(selectedAccountId, true)
      const action = mode === 'add' ? 'thêm' : 'xoá'
      const target = mode === 'add' ? 'vào' : 'khỏi'
      let message = result.count > 0
        ? `Đã ${action} ${result.count} bạn bè ${target} danh sách không gửi tin.`
        : result.success
          ? (mode === 'add' ? 'Bạn bè đã có trong danh sách không gửi tin.' : 'Không có bạn bè nào được xoá.')
          : `Chưa xác nhận ${action} được bạn bè nào.`
      if (!result.success) {
        message += `\n${remainingIds.length} bạn bè chưa xác nhận xử lý, vẫn được giữ chọn để thử lại.\n${formatIpcError(result.error, 'Không thể hoàn tất thao tác.')}`
      }
      if (refreshError) message += `\nChưa tải lại được số lượng danh sách: ${refreshError}`
      showAlert(message, result.success && !refreshError ? 'success' : 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleAddFriends = () => handleMutateFriends('add')
  const handleRemoveMembers = () => handleMutateFriends('remove')

  return (
    <div className="zalo-blocklist-settings">
      <div className="content-template-editor zalo-blocklist-editor">
        <div className="content-template-editor-head">
          <div className="content-template-title">Danh sách không gửi tin</div>
          <button type="button" className="btn btn-secondary" onClick={refreshAll} disabled={busy || loadingAccounts || loadingData}>
            <RefreshCw size={15} />
            <span>Tải lại</span>
          </button>
        </div>

        <div className="zalo-blocklist-toolbar">
          <div className="content-template-field">
            <label>Tài khoản Zalo</label>
            <div className="zalo-account-select-wrap">
              <select
                className="stepper-select zalo-account-select"
                value={selectedAccountId || ''}
                onChange={event => {
                  setSelectedAccountId(Number(event.target.value) || 0)
                  setActiveBlocklistId(null)
                  setBlocklists([])
                  setSelectedFriendIds(new Set())
                  setSelectedMemberIds(new Set())
                  setFriendSearch('')
                  setMemberSearch('')
                }}
                disabled={busy || loadingAccounts}
              >
                {accounts.length === 0 ? (
                  <option value="">Chưa có tài khoản Zalo</option>
                ) : accounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name} — {getAccountPlatformLabel(account)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="content-template-field">
            <label>Tên danh sách</label>
            <input
              className="stepper-input"
              value={newBlocklistName}
              onChange={event => setNewBlocklistName(event.target.value)}
              placeholder="Nhập tên danh sách"
              disabled={busy || !selectedAccountId}
            />
          </div>
          <button type="button" className="btn btn-primary zalo-blocklist-create-btn" onClick={handleCreateBlocklist} disabled={busy || !selectedAccountId}>
            <Plus size={15} />
            <span>Tạo</span>
          </button>
        </div>
      </div>

      <div className="zalo-blocklist-layout">
        <div className="zalo-blocklist-panel">
          <div className="content-template-list-head">
            <div className="content-template-title">Danh sách</div>
          </div>
          <div className="zalo-blocklist-list">
            {loadingData ? (
              <div className="text-center text-secondary" style={{ padding: 16 }}>Đang tải...</div>
            ) : blocklists.length === 0 ? (
              <div className="text-center text-secondary" style={{ padding: 16 }}>Chưa có danh sách không gửi tin.</div>
            ) : blocklists.map(group => (
              <div
                key={group.id}
                className={`zalo-blocklist-row ${activeBlocklistId === group.id ? 'is-active' : ''}`}
                onClick={() => {
                  if (busy || group.id === activeBlocklistId) return
                  setActiveBlocklistId(group.id)
                  setSelectedFriendIds(new Set())
                  setSelectedMemberIds(new Set())
                  setMemberSearch('')
                }}
              >
                <div className="zalo-blocklist-row-main">
                  {editingId === group.id ? (
                    <input
                      className="stepper-input"
                      value={editingName}
                      onChange={event => setEditingName(event.target.value)}
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => {
                        if (event.key === 'Enter') void handleRenameBlocklist(group)
                        if (event.key === 'Escape') {
                          setEditingId(null)
                          setEditingName('')
                        }
                      }}
                      disabled={busy}
                      autoFocus
                    />
                  ) : (
                    <>
                      <strong>{group.name}</strong>
                      <span>{group.contactCount || 0} bạn bè</span>
                    </>
                  )}
                </div>
                {editingId === group.id ? (
                  <>
                    <button type="button" className="btn-icon" title="Lưu" disabled={busy} onClick={event => {
                      event.stopPropagation()
                      void handleRenameBlocklist(group)
                    }}>
                      <Check size={14} />
                    </button>
                    <button type="button" className="btn-icon" title="Huỷ" disabled={busy} onClick={event => {
                      event.stopPropagation()
                      setEditingId(null)
                      setEditingName('')
                    }}>
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-icon" title="Đổi tên" disabled={busy} onClick={event => {
                    event.stopPropagation()
                    setEditingId(group.id)
                    setEditingName(group.name)
                  }}>
                    <Pencil size={14} />
                  </button>
                )}
                <button type="button" className="btn-icon danger" title="Xoá" disabled={busy} onClick={event => {
                  event.stopPropagation()
                  handleDeleteBlocklist(group)
                }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="zalo-blocklist-panel">
          <div className="zalo-blocklist-panel-head">
            <div>
              <div className="zalo-blocklist-panel-title">{activeBlocklist?.name || 'Bạn bè không gửi tin'}</div>
              <div className="zalo-blocklist-panel-meta">{memberPage.total} bạn bè</div>
            </div>
            <div className="zalo-blocklist-search">
              <Search size={15} />
              <input disabled={busy} value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="Tìm trong danh sách" />
            </div>
          </div>
          <div className="zalo-blocklist-table-wrap">
            <table className="campaign-grid content-template-table zalo-blocklist-table">
              <thead>
                <tr>
                  <th className="zalo-blocklist-check-col"></th>
                  <th>Tên</th>
                  <th className="zalo-blocklist-uid-col">UID</th>
                </tr>
              </thead>
              <tbody>
                {!activeBlocklistId ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Chưa chọn danh sách.</td></tr>
                ) : loadingMembers ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Đang tải...</td></tr>
                ) : memberPage.error ? (
                  <tr><td colSpan={3} role="alert">{formatIpcError(memberPage.error, 'Không thể tải danh sách.')}</td></tr>
                ) : memberPage.contacts.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-secondary">{memberSearch.trim() ? 'Không tìm thấy bạn bè phù hợp.' : 'Chưa có bạn bè trong danh sách.'}</td></tr>
                ) : memberPage.contacts.map(member => (
                  <tr key={member.id}>
                    <td className="zalo-blocklist-check-col">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.has(member.id)}
                        onChange={() => toggleMember(member.id)}
                        disabled={busy}
                      />
                    </td>
                    <td className="zalo-blocklist-name-cell" title={contactLabel(member)}>{contactLabel(member)}</td>
                    <td className="zalo-blocklist-uid-col" title={member.uid || undefined}>{member.uid || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="zalo-blocklist-pagination" aria-label="Phân trang Bạn bè không gửi tin">
            <span>{memberPage.total === 0 ? '0' : `${memberPage.page * BLOCKLIST_PAGE_SIZE + 1}–${Math.min((memberPage.page + 1) * BLOCKLIST_PAGE_SIZE, memberPage.total)}`} / {memberPage.total}</span>
            <button type="button" className="btn-icon" aria-label="Trang trước Bạn bè không gửi tin" disabled={busy || loadingMembers || memberPage.page === 0} onClick={() => memberPage.setPage(memberPage.page - 1)}><ChevronLeft size={16} /></button>
            <span>Trang {memberPage.page + 1} / {Math.max(1, Math.ceil(memberPage.total / BLOCKLIST_PAGE_SIZE))}</span>
            <button type="button" className="btn-icon" aria-label="Trang sau Bạn bè không gửi tin" disabled={busy || loadingMembers || (memberPage.page + 1) * BLOCKLIST_PAGE_SIZE >= memberPage.total} onClick={() => memberPage.setPage(memberPage.page + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="zalo-blocklist-panel-actions">
            <button type="button" className="btn btn-secondary" onClick={handleRemoveMembers} disabled={busy || loadingMembers || selectedMemberIds.size === 0}>
              <UserMinus size={15} />
              <span>Xoá khỏi danh sách{selectedMemberIds.size > 0 ? ` (${selectedMemberIds.size})` : ''}</span>
            </button>
          </div>
        </div>

        <div className="zalo-blocklist-panel">
          <div className="zalo-blocklist-panel-head">
            <div>
              <div className="zalo-blocklist-panel-title">Bạn bè Zalo</div>
              <div className="zalo-blocklist-panel-meta">{friendPage.total} có thể thêm</div>
            </div>
            <div className="zalo-blocklist-search">
              <Search size={15} />
              <input disabled={busy} value={friendSearch} onChange={event => setFriendSearch(event.target.value)} placeholder="Tìm bạn bè" />
            </div>
          </div>
          <div className="zalo-blocklist-table-wrap">
            <table className="campaign-grid content-template-table zalo-blocklist-table">
              <thead>
                <tr>
                  <th className="zalo-blocklist-check-col"></th>
                  <th>Tên</th>
                  <th className="zalo-blocklist-uid-col">UID</th>
                </tr>
              </thead>
              <tbody>
                {!selectedAccountId ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Chưa chọn tài khoản Zalo.</td></tr>
                ) : loadingFriends ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Đang tải...</td></tr>
                ) : friendPage.error ? (
                  <tr><td colSpan={3} role="alert">{formatIpcError(friendPage.error, 'Không thể tải danh sách.')}</td></tr>
                ) : friendPage.contacts.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-secondary">{friendSearch.trim() ? 'Không tìm thấy bạn bè phù hợp.' : 'Chưa có bạn bè để thêm.'}</td></tr>
                ) : friendPage.contacts.map(friend => (
                  <tr key={friend.id}>
                    <td className="zalo-blocklist-check-col">
                      <input
                        type="checkbox"
                        checked={selectedFriendIds.has(friend.id)}
                        onChange={() => toggleFriend(friend.id)}
                        disabled={busy || !activeBlocklistId}
                      />
                    </td>
                    <td className="zalo-blocklist-name-cell" title={contactLabel(friend)}>{contactLabel(friend)}</td>
                    <td className="zalo-blocklist-uid-col" title={friend.uid || undefined}>{friend.uid || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="zalo-blocklist-pagination" aria-label="Phân trang Bạn bè Zalo">
            <span>{friendPage.total === 0 ? '0' : `${friendPage.page * BLOCKLIST_PAGE_SIZE + 1}–${Math.min((friendPage.page + 1) * BLOCKLIST_PAGE_SIZE, friendPage.total)}`} / {friendPage.total}</span>
            <button type="button" className="btn-icon" aria-label="Trang trước Bạn bè Zalo" disabled={busy || loadingFriends || friendPage.page === 0} onClick={() => friendPage.setPage(friendPage.page - 1)}><ChevronLeft size={16} /></button>
            <span>Trang {friendPage.page + 1} / {Math.max(1, Math.ceil(friendPage.total / BLOCKLIST_PAGE_SIZE))}</span>
            <button type="button" className="btn-icon" aria-label="Trang sau Bạn bè Zalo" disabled={busy || loadingFriends || (friendPage.page + 1) * BLOCKLIST_PAGE_SIZE >= friendPage.total} onClick={() => friendPage.setPage(friendPage.page + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="zalo-blocklist-panel-actions">
            <button type="button" className="btn btn-primary" onClick={handleAddFriends} disabled={busy || loadingFriends || !activeBlocklistId || selectedFriendIds.size === 0}>
              <UserPlus size={15} />
              <span>Thêm vào danh sách{selectedFriendIds.size > 0 ? ` (${selectedFriendIds.size})` : ''}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
