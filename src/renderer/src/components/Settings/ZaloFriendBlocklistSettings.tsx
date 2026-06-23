import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Plus, RefreshCw, Search, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { AutoAccount, AutoAccountContact, AutoAccountContactGroup } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

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

const contactLabel = (contact: AutoAccountContact): string => (
  contact.name || contact.uid || `#${contact.id}`
)

export default function ZaloFriendBlocklistSettings() {
  const showAlert = useUiStore(s => s.showAlert)
  const showConfirm = useUiStore(s => s.showConfirm)
  const [accounts, setAccounts] = useState<AutoAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0)
  const [blocklists, setBlocklists] = useState<AutoAccountContactGroup[]>([])
  const [friends, setFriends] = useState<AutoAccountContact[]>([])
  const [members, setMembers] = useState<AutoAccountContact[]>([])
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
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [busy, setBusy] = useState(false)

  const activeBlocklist = useMemo(
    () => blocklists.find(item => item.id === activeBlocklistId) || null,
    [blocklists, activeBlocklistId]
  )
  const memberIds = useMemo(() => new Set(members.map(member => member.id)), [members])
  const normalizedFriendSearch = friendSearch.trim().toLocaleLowerCase('vi-VN')
  const normalizedMemberSearch = memberSearch.trim().toLocaleLowerCase('vi-VN')
  const availableFriends = useMemo(() => {
    const rows = friends.filter(friend => !memberIds.has(friend.id))
    if (!normalizedFriendSearch) return rows
    return rows.filter(friend => `${friend.name || ''}\n${friend.uid || ''}`.toLocaleLowerCase('vi-VN').includes(normalizedFriendSearch))
  }, [friends, memberIds, normalizedFriendSearch])
  const filteredMembers = useMemo(() => {
    if (!normalizedMemberSearch) return members
    return members.filter(member => `${member.name || ''}\n${member.uid || ''}`.toLocaleLowerCase('vi-VN').includes(normalizedMemberSearch))
  }, [members, normalizedMemberSearch])

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
          : zaloAccounts[0]?.id || 0
      ))
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể tải tài khoản Zalo.'), 'error')
    } finally {
      setLoadingAccounts(false)
    }
  }

  const loadBlocklistsAndFriends = async (accountId: number) => {
    if (!accountId || !window.electronAPI?.listZaloFriendBlocklists || !window.electronAPI?.listContacts) {
      setBlocklists([])
      setFriends([])
      setMembers([])
      setActiveBlocklistId(null)
      return
    }

    setLoadingData(true)
    try {
      const [nextBlocklists, contacts] = await Promise.all([
        window.electronAPI.listZaloFriendBlocklists(accountId),
        window.electronAPI.listContacts(accountId, 'person')
      ])
      const nextFriends = contacts.filter(contact => contact.isFriend)
      setBlocklists(nextBlocklists)
      setFriends(nextFriends)
      setActiveBlocklistId(prev => (
        prev && nextBlocklists.some(group => group.id === prev)
          ? prev
          : nextBlocklists[0]?.id || null
      ))
      setSelectedFriendIds(new Set())
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể tải danh sách không gửi tin.'), 'error')
      setBlocklists([])
      setFriends([])
      setMembers([])
      setActiveBlocklistId(null)
    } finally {
      setLoadingData(false)
    }
  }

  const loadMembers = async (groupId: number | null) => {
    if (!groupId || !window.electronAPI?.listZaloFriendBlocklistFriends) {
      setMembers([])
      setSelectedMemberIds(new Set())
      return
    }

    setLoadingMembers(true)
    try {
      const rows = await window.electronAPI.listZaloFriendBlocklistFriends(groupId)
      setMembers(rows)
      setSelectedMemberIds(new Set())
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể tải bạn bè trong danh sách không gửi tin.'), 'error')
      setMembers([])
      setSelectedMemberIds(new Set())
    } finally {
      setLoadingMembers(false)
    }
  }

  useEffect(() => {
    void loadAccounts()
  }, [])

  useEffect(() => {
    void loadBlocklistsAndFriends(selectedAccountId)
  }, [selectedAccountId])

  useEffect(() => {
    void loadMembers(activeBlocklistId)
  }, [activeBlocklistId])

  const refreshAll = async () => {
    if (!selectedAccountId) {
      await loadAccounts()
      return
    }
    await Promise.all([
      loadBlocklistsAndFriends(selectedAccountId),
      loadMembers(activeBlocklistId)
    ])
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
      await loadBlocklistsAndFriends(selectedAccountId)
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
          await loadBlocklistsAndFriends(selectedAccountId)
          if (activeBlocklistId === group.id) {
            setMembers([])
            setActiveBlocklistId(null)
          }
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

  const handleAddFriends = async () => {
    if (!activeBlocklistId || selectedFriendIds.size === 0 || !window.electronAPI?.addFriendsToZaloFriendBlocklist) return
    setBusy(true)
    try {
      const result = await window.electronAPI.addFriendsToZaloFriendBlocklist(activeBlocklistId, Array.from(selectedFriendIds))
      setSelectedFriendIds(new Set())
      await Promise.all([
        loadBlocklistsAndFriends(selectedAccountId),
        loadMembers(activeBlocklistId)
      ])
      showAlert(result.count > 0 ? `Đã thêm ${result.count} bạn bè vào danh sách không gửi tin.` : 'Bạn bè đã có trong danh sách không gửi tin.', 'success')
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể thêm bạn bè vào danh sách không gửi tin.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveMembers = async () => {
    if (!activeBlocklistId || selectedMemberIds.size === 0 || !window.electronAPI?.removeFriendsFromZaloFriendBlocklist) return
    setBusy(true)
    try {
      const result = await window.electronAPI.removeFriendsFromZaloFriendBlocklist(activeBlocklistId, Array.from(selectedMemberIds))
      setSelectedMemberIds(new Set())
      await Promise.all([
        loadBlocklistsAndFriends(selectedAccountId),
        loadMembers(activeBlocklistId)
      ])
      showAlert(result.count > 0 ? `Đã xoá ${result.count} bạn bè khỏi danh sách không gửi tin.` : 'Không có bạn bè nào được xoá.', 'success')
    } catch (err) {
      showAlert(formatIpcError(err, 'Không thể xoá bạn bè khỏi danh sách không gửi tin.'), 'error')
    } finally {
      setBusy(false)
    }
  }

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
                onChange={event => setSelectedAccountId(Number(event.target.value) || 0)}
                disabled={busy || loadingAccounts}
              >
                {accounts.length === 0 ? (
                  <option value="">Chưa có tài khoản Zalo</option>
                ) : accounts.map(account => (
                  <option key={account.id} value={account.id}>{account.name}</option>
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
                onClick={() => setActiveBlocklistId(group.id)}
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
              <div className="zalo-blocklist-panel-meta">{members.length} bạn bè</div>
            </div>
            <div className="zalo-blocklist-search">
              <Search size={15} />
              <input value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="Tìm trong danh sách" />
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
                ) : filteredMembers.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Chưa có bạn bè trong danh sách.</td></tr>
                ) : filteredMembers.map(member => (
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
          <div className="zalo-blocklist-panel-actions">
            <button type="button" className="btn btn-secondary" onClick={handleRemoveMembers} disabled={busy || selectedMemberIds.size === 0}>
              <UserMinus size={15} />
              <span>Xoá khỏi danh sách</span>
            </button>
          </div>
        </div>

        <div className="zalo-blocklist-panel">
          <div className="zalo-blocklist-panel-head">
            <div>
              <div className="zalo-blocklist-panel-title">Bạn bè Zalo</div>
              <div className="zalo-blocklist-panel-meta">{availableFriends.length} có thể thêm</div>
            </div>
            <div className="zalo-blocklist-search">
              <Search size={15} />
              <input value={friendSearch} onChange={event => setFriendSearch(event.target.value)} placeholder="Tìm bạn bè" />
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
                ) : loadingData ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Đang tải...</td></tr>
                ) : availableFriends.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-secondary">Chưa có bạn bè để thêm.</td></tr>
                ) : availableFriends.map(friend => (
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
          <div className="zalo-blocklist-panel-actions">
            <button type="button" className="btn btn-primary" onClick={handleAddFriends} disabled={busy || !activeBlocklistId || selectedFriendIds.size === 0}>
              <UserPlus size={15} />
              <span>Thêm vào danh sách</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
