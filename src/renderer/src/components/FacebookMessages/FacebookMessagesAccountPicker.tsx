import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import { accountInitials, loginStatusLabel } from './facebookMessagesView'

interface Props {
  accounts: AutoAccount[]
  selectedIds: number[]
  onSave: (ids: number[]) => void
  onClose: () => void
}

export default function FacebookMessagesAccountPicker({ accounts, selectedIds, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Set<number>>(() => new Set(selectedIds))
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return accounts
    return accounts.filter(account => account.name.toLowerCase().includes(keyword))
  }, [accounts, search])

  const toggle = (id: number) => {
    setDraft(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const draftCount = accounts.filter(account => draft.has(account.id)).length

  const handleSave = () => {
    // Giữ thứ tự của danh sách tài khoản; id tài khoản đã xoá thì bỏ đi.
    onSave(accounts.filter(account => draft.has(account.id)).map(account => account.id))
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }} onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="fb-messages-picker" role="dialog" aria-modal="true" aria-label="Chọn tài khoản hiện ở Tin nhắn Facebook">
        <div className="fb-messages-picker-header">
          <div className="fb-messages-picker-title">Chọn tài khoản hiện ở Tin nhắn Facebook</div>
          <button className="btn-icon" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="fb-messages-picker-note">
          Tài khoản được chọn sẽ mở Messenger chạy ngầm để đếm tin chưa đọc. Chọn càng nhiều, máy càng tốn RAM.
        </div>
        <div className="fb-messages-picker-search">
          <Search size={14} className="fb-messages-picker-search-icon" />
          <input
            type="text"
            className="stepper-input"
            placeholder="Tìm tài khoản"
            value={search}
            onChange={event => setSearch(event.target.value)}
            autoFocus
          />
        </div>
        <div className="fb-messages-picker-list">
          {accounts.length === 0 ? (
            <div className="fb-messages-picker-empty">Chưa có tài khoản Facebook nào. Hãy thêm tài khoản ở trang Chiến dịch.</div>
          ) : filtered.length === 0 ? (
            <div className="fb-messages-picker-empty">Không tìm thấy tài khoản.</div>
          ) : filtered.map(account => (
            <label key={account.id} className={`fb-messages-picker-row ${draft.has(account.id) ? 'is-selected' : ''}`}>
              <input type="checkbox" checked={draft.has(account.id)} onChange={() => toggle(account.id)} />
              <span className="fb-messages-avatar is-small">{accountInitials(account.name)}</span>
              <span className="fb-messages-picker-name" title={account.name}>{account.name}</span>
              <span className="fb-messages-picker-status">{loginStatusLabel(account.loginStatus)}</span>
            </label>
          ))}
        </div>
        <div className="fb-messages-picker-footer">
          <span className="fb-messages-picker-count">Đã chọn {draftCount}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
            <button className="btn btn-primary" onClick={handleSave}>Lưu</button>
          </div>
        </div>
      </div>
    </div>
  )
}
