import { useRef, useState } from 'react'
import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import type { AdminSetting } from '../../../../shared/admin'
import { api, Empty, ErrorNote, Modal, Reload, useAdminAction, useAdminQuery } from './common'

function SettingForm({ setting, onClose, onSaved }: { setting: AdminSetting; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(setting.description || '')
  const [value, setValue] = useState(setting.value || '')
  const [changed, setChanged] = useState(false)
  const [visible, setVisible] = useState(!setting.isSecret)
  const valueRevision = useRef(0)
  const changeValue = (nextValue: string) => {
    valueRevision.current++
    setValue(nextValue)
    setChanged(true)
  }
  const action = useAdminAction()
  const reveal = () => void action.run(async () => {
    if (visible) { setVisible(false); if (!changed) setValue(''); return }
    if (!changed) {
      const requestedRevision = valueRevision.current
      const current = await api().revealSetting(setting.id)
      if (current.version !== setting.version) throw new Error('Cấu hình đã được thay đổi. Đóng form và tải lại trước khi sửa.')
      // Preserve edits made while the reveal request was in flight.
      if (valueRevision.current === requestedRevision) setValue(current.value || '')
    }
    setVisible(true)
  })
  return <Modal title="Sửa cài đặt hệ thống" onClose={onClose} busy={action.busy} wide>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); void action.run(async () => {
      await api().saveSetting({ id: setting.id, description, ...(changed ? { value } : {}), expectedVersion: setting.version }); onSaved()
    }) }}>
      <label>Tên biến<input readOnly value={setting.key} /></label>
      <label>Mô tả<textarea aria-label="Mô tả" rows={3} value={description} maxLength={10000} onChange={e => setDescription(e.target.value)} /></label>
      <label>Giá trị{setting.isSecret ? <input type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder={changed || visible ? '' : 'Đã che — để nguyên để giữ giá trị hiện tại'} value={value} onChange={e => changeValue(e.target.value)} />
        : <textarea aria-label="Giá trị" rows={8} spellCheck={false} value={value} onChange={e => changeValue(e.target.value)} />}</label>
      {setting.isSecret && <button type="button" className="btn btn-secondary" disabled={action.busy} onClick={reveal}>{visible ? <EyeOff size={14} /> : <Eye size={14} />}{visible ? 'Ẩn giá trị' : 'Hiện giá trị'}</button>}
      <p className="admin-muted">{setting.isActive ? 'Cấu hình đang bật.' : 'Cấu hình đang tắt.'}{setting.isSecret && changed && !value ? ' Giá trị mới đang để rỗng.' : ''}</p>
      <ErrorNote error={action.error} /><footer><button type="button" className="btn btn-secondary" disabled={action.busy} onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={action.busy}>{action.busy ? 'Đang lưu…' : 'Lưu'}</button></footer>
    </form>
  </Modal>
}
export function AdminSettings() {
  const query = useAdminQuery(() => api().listSettings())
  const [editing, setEditing] = useState<AdminSetting | null>(null)
  const [search, setSearch] = useState('')
  const rows = (query.data || []).filter(row => `${row.key} ${row.description || ''}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="admin-section">
    <div className="admin-toolbar"><div><h2>Cài đặt hệ thống</h2><p>Các biến cấu hình đang có trong hệ thống</p></div><Reload busy={query.busy} onClick={() => void query.reload()} /></div>
    <input className="admin-search" aria-label="Tìm biến hệ thống" placeholder="Tìm theo tên biến hoặc mô tả…" value={search} onChange={e => setSearch(e.target.value)} />
    <ErrorNote error={query.error} />
    <div className="admin-table-wrap admin-grow"><table><thead><tr><th>Tên biến</th><th>Mô tả</th><th>Giá trị</th><th>Trạng thái</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><code>{row.key}</code></td><td className="admin-cell-message">{row.description}</td><td className="admin-cell-message">{row.isSecret ? <span><LockKeyhole size={13} /> Đã che</span> : (row.value || '—')}</td><td>{row.isActive ? 'Bật' : 'Tắt'}</td><td><button className="btn btn-secondary" disabled={query.busy} onClick={() => setEditing(row)}>Sửa</button></td></tr>)}</tbody></table>{!rows.length && <Empty busy={query.busy} />}</div>
    {editing && <SettingForm key={editing.id} setting={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void query.reload() }} />}
  </section>
}
