import { useEffect, useState, type FormEvent } from 'react'
import { FolderPlus, LoaderCircle, Lock } from 'lucide-react'
import type { DataGroup, DataTypeCategoryCode } from '../../../../shared/types'
import DataGroupFormDialog from './DataGroupFormDialog'
import { createDataGroupRequestId, getDataGroupApi } from './dataGroupApi'

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#64748b']

/**
 * Tạo nhóm data ngay tại chỗ chọn nhóm (form chiến dịch tìm data: "Tạo nhóm mới" cạnh ô chọn Nhóm data).
 * Loại nhóm khoá theo ô đang dùng để nhóm vừa tạo nhận được đúng loại data; tạo xong gọi `onCreated` để ô đó chọn luôn nhóm mới.
 * Chỉ dùng cho loại không gắn tài khoản Zalo (tạo nhóm gắn tài khoản vẫn qua màn Nhóm data).
 */
export default function QuickCreateDataGroupDialog({
  dataTypeCode: initialTypeCode,
  typeLabel: initialTypeLabel,
  subtitle,
  defaultName,
  typeChoices,
  boundZaloAccountIdFor,
  onCreated,
  onClose
}: {
  dataTypeCode: DataTypeCategoryCode
  typeLabel: string
  subtitle?: string
  defaultName: string
  /** Nhiều loại nhận được (khung "Sau khi chạy"): cho chọn loại thay vì khoá một loại. */
  typeChoices?: Array<{ code: DataTypeCategoryCode; label: string }>
  /** Loại gắn tài khoản Zalo (theo UID): tài khoản gắn với nhóm mới; null = không gắn. */
  boundZaloAccountIdFor?: (code: DataTypeCategoryCode) => number | null
  onCreated: (group: DataGroup) => void
  onClose: () => void
}) {
  const [dataTypeCode, setDataTypeCode] = useState<DataTypeCategoryCode>(initialTypeCode)
  const typeLabel = typeChoices?.find(choice => choice.code === dataTypeCode)?.label ?? initialTypeLabel
  const [name, setName] = useState(defaultName)
  const [color] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)])
  const [typeId, setTypeId] = useState<number | null>(null)
  const [typeName, setTypeName] = useState(typeLabel)
  const [typeError, setTypeError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Một mã yêu cầu cho cả lần mở hộp: bấm Tạo lại sau lỗi mạng không tạo hai nhóm.
  const [requestId] = useState(() => createDataGroupRequestId())

  useEffect(() => {
    let disposed = false
    setTypeId(null)
    setTypeError('')
    void (async () => {
      try {
        const items = await window.electronAPI.listDataTypeCategoryItems()
        const item = items.find(entry => entry.code === dataTypeCode && entry.isActive !== false)
        if (disposed) return
        if (item) {
          setTypeId(item.id)
          if (item.name) setTypeName(item.name)
        }
        else setTypeError(`Không tìm thấy loại dữ liệu "${typeLabel}".`)
      } catch (err) {
        if (!disposed) setTypeError(err instanceof Error ? err.message : 'Không tải được danh mục loại dữ liệu.')
      }
    })()
    return () => { disposed = true }
  }, [dataTypeCode, typeLabel])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    const api = getDataGroupApi()
    if (busy || !trimmed || typeId == null) return
    if (!api) {
      setError('Chức năng nhóm data chưa sẵn sàng.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await api.createDataGroup({
        name: trimmed,
        color,
        boundZaloAccountId: boundZaloAccountIdFor ? boundZaloAccountIdFor(dataTypeCode) : null,
        dataTypeCategoryItemId: typeId,
        requestId
      })
      onCreated(created)
    } catch (err) {
      console.error('Failed to quick-create data group:', err)
      setError(err instanceof Error && err.message ? err.message : 'Không thể tạo nhóm data.')
      setBusy(false)
    }
  }

  return (
    <DataGroupFormDialog title="Tạo nhóm data" subtitle={subtitle} busy={busy} onClose={onClose} icon={<FolderPlus size={20} />}>
      <form className="data-group-form" onSubmit={event => { void submit(event) }}>
        <div className="data-group-form-fields">
          <label className="data-group-form-field" htmlFor="quick-data-group-name">
            <span>Tên nhóm <span className="required">*</span></span>
            <input id="quick-data-group-name" className="stepper-input" value={name}
              onChange={event => setName(event.target.value)} maxLength={255} required disabled={busy} />
          </label>
          {typeChoices && typeChoices.length > 1 ? <label className="data-group-form-field" htmlFor="quick-data-group-type">
            <span>Loại nhóm</span>
            <select id="quick-data-group-type" className="stepper-input" value={dataTypeCode} disabled={busy}
              onChange={event => setDataTypeCode(event.target.value as DataTypeCategoryCode)}>
              {typeChoices.map(choice => <option key={choice.code} value={choice.code}>{choice.label}</option>)}
            </select>
            <small className="schedule-hint">Chỉ các loại nhận được data của chiến dịch này.</small>
          </label> : <div className="data-group-form-field">
            <span>Loại nhóm</span>
            <div className="stepper-input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, opacity: 0.85 }}>
              <span>{typeName}</span>
              <Lock size={14} aria-hidden="true" />
            </div>
            <small className="schedule-hint">Khoá theo ô đang chọn để nhóm mới nhận được data này.</small>
          </div>}
          {(typeError || error) && <div className="schedule-hint" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>{typeError || error}</div>}
        </div>
        <footer className="data-group-form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || typeId == null}>
            {busy && <LoaderCircle size={15} className="spin" />}{busy ? 'Đang tạo…' : 'Tạo và chọn nhóm'}
          </button>
        </footer>
      </form>
    </DataGroupFormDialog>
  )
}
