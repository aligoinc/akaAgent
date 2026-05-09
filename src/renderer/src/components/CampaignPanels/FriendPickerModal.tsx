import { useState, useEffect } from 'react'
import { X, Search, Check } from 'lucide-react'

interface Contact {
  id: number
  name: string
  uid?: string
  url?: string
  type?: string
}

interface FriendPickerModalProps {
  accountId: number
  onClose: () => void
  onSelect: (contacts: Contact[]) => void
}

export default function FriendPickerModal({ accountId, onClose, onSelect }: FriendPickerModalProps) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        if (window.electronAPI) {
          const data = await window.electronAPI.listContacts(accountId, 'friend')
          setContacts(data)
        }
      } catch (err) {
        console.error('Failed to load contacts:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [accountId])

  const filtered = contacts.filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(q) || (c.uid || '').toLowerCase().includes(q)
  })

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)))
    }
  }

  const handleConfirm = () => {
    const selected = contacts.filter(c => selectedIds.has(c.id))
    onSelect(selected)
    onClose()
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }}>
      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: 12,
        width: 560,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        border: '1px solid var(--border-default)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-default)'
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Chọn bạn bè ({contacts.length})
          </div>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px 8px', position: 'relative' }}>
          <Search size={14} style={{
            position: 'absolute',
            left: 32,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-tertiary)'
          }} />
          <input
            type="text"
            placeholder="Tìm kiếm theo tên hoặc UID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="stepper-input"
            style={{ width: '100%', paddingLeft: 32 }}
          />
        </div>

        {/* Select all */}
        <div style={{
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 12,
          color: 'var(--text-secondary)'
        }}>
          <label className="schedule-checkbox-label" style={{ fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onChange={toggleAll}
            />
            <span>Chọn tất cả ({filtered.length})</span>
          </label>
          <span>{selectedIds.size} đã chọn</span>
        </div>

        {/* List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 20px',
          minHeight: 200,
          maxHeight: 400
        }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Đang tải danh sách bạn bè...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              {contacts.length === 0
                ? 'Chưa có bạn bè. Hãy load danh sách bạn bè trong tab Trình duyệt trước.'
                : 'Không tìm thấy kết quả.'}
            </div>
          ) : (
            filtered.map(c => (
              <div
                key={c.id}
                onClick={() => toggleSelect(c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 8px',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  borderRadius: 6,
                  transition: 'background 0.15s',
                  background: selectedIds.has(c.id) ? 'var(--bg-accent-subtle)' : 'transparent'
                }}
              >
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: selectedIds.has(c.id)
                    ? '2px solid var(--accent-primary)'
                    : '2px solid var(--border-default)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: selectedIds.has(c.id) ? 'var(--accent-primary)' : 'transparent',
                  flexShrink: 0
                }}>
                  {selectedIds.has(c.id) && <Check size={13} color="#fff" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {c.name || 'Không tên'}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {c.uid || '—'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8
        }}>
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
          >
            Thêm {selectedIds.size > 0 ? `${selectedIds.size} bạn bè` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
