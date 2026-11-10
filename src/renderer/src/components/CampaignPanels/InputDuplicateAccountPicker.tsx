import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import './CampaignImportDuplicates.css'

/** Một tài khoản Zalo của nhân viên đang đăng nhập (nơi gọi đã lọc: chỉ Zalo, chưa xoá, của chính nhân viên). */
export interface InputDuplicateAccountOption {
  id: number
  name: string
  /** Tên nhóm tài khoản; rỗng = "Chưa có nhóm". */
  groupName: string
  typeLabel: string
  /** Đang được chọn cho chiến dịch này. */
  current: boolean
}

interface Props {
  accounts: InputDuplicateAccountOption[]
  selectedIds: number[]
  onClose: () => void
  onSave: (ids: number[]) => void
}

const NO_GROUP = 'Chưa có nhóm'
const searchText = (value: string) => value.toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')

/**
 * Chọn các tài khoản Zalo để đối chiếu (lựa chọn "Với các tài khoản Zalo bạn chọn"); chỉ lưu khi bấm Xong.
 * Chép từ akaAgentWebApp `apps/web/src/features/InputDuplicateAccountPicker.tsx`; lớp phủ nằm trên cửa sổ Upload (5100).
 */
export function InputDuplicateAccountPicker({ accounts, selectedIds, onClose, onSave }: Props) {
  const [selected, setSelected] = useState(() => new Set(selectedIds))
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const byName = new Map<string, InputDuplicateAccountOption[]>()
    for (const account of accounts) {
      const name = account.groupName.trim() || NO_GROUP
      byName.set(name, [...(byName.get(name) || []), account])
    }
    return Array.from(byName.entries())
      .sort(([a], [b]) => a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, 'vi'))
      .map(([name, items]) => ({ name, accounts: [...items].sort((a, b) => a.name.localeCompare(b.name, 'vi')) }))
  }, [accounts])
  const term = searchText(query.trim())
  const visibleGroups = groups
    .map(group => ({ ...group, visible: term ? group.accounts.filter(account => searchText(account.name).includes(term)) : group.accounts }))
    .filter(group => group.visible.length > 0)
  const setMany = (ids: number[], checked: boolean) => setSelected(current => {
    const next = new Set(current)
    ids.forEach(id => { if (checked) next.add(id); else next.delete(id) })
    return next
  })
  const count = accounts.filter(account => selected.has(account.id)).length

  return createPortal(<div className="modal-overlay campaign-import-modal-overlay" style={{ zIndex: 5200 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal input-dup-picker" role="dialog" aria-modal="true" aria-labelledby="input-dup-picker-title" aria-describedby="input-dup-picker-desc"
      onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title" id="input-dup-picker-title">Chọn tài khoản để đối chiếu</div>
        <button type="button" className="btn-icon" onClick={onClose} title="Đóng" aria-label="Đóng"><X size={18} /></button>
      </div>
      <div className="modal-body input-dup-picker-body">
        <p id="input-dup-picker-desc" className="text-muted" style={{ margin: 0 }}>
          Số đã có trong chiến dịch của các tài khoản được chọn sẽ bị bỏ qua. Chỉ hiện tài khoản Zalo của bạn trong tổ chức hiện tại.
        </p>
        <label className="input-dup-picker-search">
          <Search size={16} aria-hidden="true" />
          <input className="stepper-input" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Tìm theo tên tài khoản" aria-label="Tìm tài khoản" autoFocus />
        </label>
        <div className="input-dup-picker-toolbar">
          <span role="status"><strong>{count}/{accounts.length}</strong> tài khoản được chọn</span>
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMany(accounts.map(account => account.id), true)}>Chọn tất cả</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMany(accounts.map(account => account.id), false)}>Bỏ chọn tất cả</button>
          </div>
        </div>
        <div className="input-dup-picker-list">
          {visibleGroups.length === 0
            ? <div className="input-dup-picker-empty">{accounts.length ? `Không có tài khoản nào khớp “${query.trim()}”.` : 'Bạn chưa có tài khoản Zalo nào.'}</div>
            : visibleGroups.map(group => {
              const groupIds = group.accounts.map(account => account.id)
              const groupCount = groupIds.filter(id => selected.has(id)).length
              return <div key={group.name} className="input-dup-picker-group" role="group" aria-label={group.name}>
                <label>
                  <input type="checkbox" checked={groupCount === groupIds.length} onChange={() => setMany(groupIds, groupCount !== groupIds.length)}
                    ref={node => { if (node) node.indeterminate = groupCount > 0 && groupCount < groupIds.length }}
                    aria-label={`Chọn cả nhóm ${group.name}`} />
                  <span>{group.name}</span>
                  <span className="text-muted">{groupCount}/{groupIds.length}</span>
                </label>
                {group.visible.map(account => <label key={account.id} className="input-dup-picker-account">
                  <input type="checkbox" checked={selected.has(account.id)} onChange={event => setMany([account.id], event.target.checked)} />
                  <span className="input-dup-picker-account-name"><strong title={account.name}>{account.name}</strong><span>{account.typeLabel}</span></span>
                  {account.current && <span className="input-dup-picker-current">Đang chọn cho chiến dịch</span>}
                </label>)}
              </div>
            })}
        </div>
      </div>
      <div className="modal-footer">
        <span className="campaign-import-submit-hint">Tài khoản đã xóa không hiển thị. Lựa chọn được nhớ cho lần tải sau trên máy này.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
        <button type="button" className="btn btn-primary" disabled={count === 0}
          onClick={() => onSave(accounts.filter(account => selected.has(account.id)).map(account => account.id))}>
          {count === 0 ? 'Chọn ít nhất 1 tài khoản' : `Xong · ${count} tài khoản`}
        </button>
      </div>
    </div>
  </div>, document.body)
}
