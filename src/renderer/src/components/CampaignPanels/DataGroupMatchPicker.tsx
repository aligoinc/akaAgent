import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, Search, X } from 'lucide-react'
import { DATA_GROUP_MATCHES_MAX_OTHER_GROUPS } from '../../../../shared/dataGroupMemberMatches'
import './CampaignImportDuplicates.css'

/** Một nhóm data khác của chính nhân viên đang đăng nhập (nơi gọi đã bỏ nhóm đang nhập và nhóm được chia sẻ). */
export interface DataGroupMatchOption {
  id: number
  name: string
  memberCount: number
}

export interface DataGroupMatchOptions {
  groups: DataGroupMatchOption[]
  /** Chưa tải hết danh sách nhóm: chọn hết danh sách không có nghĩa là "tất cả nhóm khác". */
  partial: boolean
}

interface Props {
  /** Tải danh sách nhóm khi mở hộp (trang Nhóm data chỉ giữ một trang 50 nhóm). */
  load: () => Promise<DataGroupMatchOptions>
  /** `null` = tất cả nhóm khác. */
  selectedIds: number[] | null
  onClose: () => void
  onSave: (ids: number[] | null, names: string[]) => void
}

const searchText = (value: string) => value.toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')

/**
 * Chọn các nhóm data khác để đối chiếu (lựa chọn "Bỏ data đã có ở nhóm data khác"); chỉ lưu khi bấm Xong.
 * Cùng giao diện với akaAgentWebApp `apps/web/src/features/DataGroupMatchPicker.tsx`; Desktop tải danh sách nhóm lúc mở
 * hộp. Lớp phủ nằm trên cửa sổ nhập (5100).
 */
export function DataGroupMatchPicker({ load, selectedIds, onClose, onSave }: Props) {
  const [options, setOptions] = useState<DataGroupMatchOptions | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(selectedIds ?? []))
  const [query, setQuery] = useState('')

  useEffect(() => {
    let disposed = false
    setOptions(null); setError('')
    load().then(result => {
      if (disposed) return
      setOptions(result)
      // Đang là "tất cả nhóm khác": mở hộp thì mọi nhóm đều được chọn sẵn.
      if (selectedIds === null) setSelected(new Set(result.groups.map(group => group.id)))
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : 'Không tải được danh sách nhóm data.')
    })
    return () => { disposed = true }
  }, [attempt])

  const groups = options?.groups ?? []
  const partial = options?.partial ?? false
  const term = searchText(query.trim())
  const visible = term ? groups.filter(group => searchText(group.name).includes(term)) : groups
  const setMany = (ids: number[], checked: boolean) => setSelected(current => {
    const next = new Set(current)
    ids.forEach(id => { if (checked) next.add(id); else next.delete(id) })
    return next
  })
  const picked = groups.filter(group => selected.has(group.id))
  const count = picked.length
  const all = Boolean(options) && count === groups.length && !partial
  const tooMany = !all && count > DATA_GROUP_MATCHES_MAX_OTHER_GROUPS

  return createPortal(<div className="modal-overlay campaign-import-modal-overlay" style={{ zIndex: 5200 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal input-dup-picker" role="dialog" aria-modal="true" aria-labelledby="data-group-match-picker-title" aria-describedby="data-group-match-picker-desc"
      onMouseDown={event => event.stopPropagation()}>
      <div className="modal-header">
        <div className="modal-title" id="data-group-match-picker-title">Chọn nhóm data để đối chiếu</div>
        <button type="button" className="btn-icon" onClick={onClose} title="Đóng" aria-label="Đóng"><X size={18} /></button>
      </div>
      <div className="modal-body input-dup-picker-body">
        <p id="data-group-match-picker-desc" className="text-muted" style={{ margin: 0 }}>
          Data đã có trong các nhóm được chọn sẽ không được thêm vào nhóm đang nhập. Chỉ hiện nhóm data của chính bạn.
          {partial ? ' Bạn có nhiều nhóm hơn danh sách này; để đối chiếu với mọi nhóm, bấm Hủy và giữ lựa chọn “tất cả”.' : ''}
        </p>
        <label className="input-dup-picker-search">
          <Search size={16} aria-hidden="true" />
          <input className="stepper-input" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Tìm theo tên nhóm" aria-label="Tìm nhóm data" autoFocus disabled={!options} />
        </label>
        <div className="input-dup-picker-toolbar">
          <span role="status"><strong>{count}/{groups.length}</strong> nhóm được chọn</span>
          <div>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!options} onClick={() => setMany(groups.map(group => group.id), true)}>Chọn tất cả</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!options} onClick={() => setMany(groups.map(group => group.id), false)}>Bỏ chọn tất cả</button>
          </div>
        </div>
        <div className="input-dup-picker-list">
          {error
            ? <div className="input-dup-picker-empty" role="alert">{error} <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>
            : !options
              ? <div className="input-dup-picker-empty" role="status"><LoaderCircle size={16} className="spin" /> Đang tải danh sách nhóm…</div>
              : visible.length === 0
                ? <div className="input-dup-picker-empty">{groups.length ? `Không có nhóm nào khớp “${query.trim()}”.` : 'Bạn chưa có nhóm data nào khác.'}</div>
                : <div className="input-dup-picker-group" role="group" aria-label="Nhóm data của bạn">
                  {visible.map(group => <label key={group.id} className="input-dup-picker-account">
                    <input type="checkbox" checked={selected.has(group.id)} onChange={event => setMany([group.id], event.target.checked)} />
                    <span className="input-dup-picker-account-name"><strong title={group.name}>{group.name}</strong>
                      <span>{group.memberCount.toLocaleString('vi-VN')} data</span></span>
                  </label>)}
                </div>}
        </div>
        {tooMany && <span className="campaign-import-dedup-field-error" role="alert">
          Chọn tối đa {DATA_GROUP_MATCHES_MAX_OTHER_GROUPS} nhóm{partial ? '.' : ', hoặc chọn tất cả.'}
        </span>}
      </div>
      <div className="modal-footer">
        <span className="campaign-import-submit-hint">Nhóm được người khác chia sẻ và nhóm đã xóa không hiển thị.</span>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
        <button type="button" className="btn btn-primary" disabled={!options || count === 0 || tooMany}
          onClick={() => onSave(all ? null : picked.map(group => group.id), picked.map(group => group.name))}>
          {!options ? 'Đang tải…' : count === 0 ? 'Chọn ít nhất 1 nhóm' : all ? `Xong · tất cả ${count} nhóm` : `Xong · ${count} nhóm`}
        </button>
      </div>
    </div>
  </div>, document.body)
}
