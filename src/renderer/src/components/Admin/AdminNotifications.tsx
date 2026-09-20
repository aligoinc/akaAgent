import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { AdminNotification } from '../../../../shared/admin'
import { readNotificationDraft, vietnamDateInput, writeNotificationDraft, type AdminNotificationDraft } from '../../../../shared/adminNotification'
import { api, Empty, ErrorNote, Modal, Pagination, Reload, useAdminAction, useAdminQuery } from './common'

function NotificationForm({ target, onClose, onSaved }: { target: AdminNotification; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<AdminNotificationDraft>(() => readNotificationDraft(target.rawValue))
  const action = useAdminAction()
  const update = (field: keyof AdminNotificationDraft, value: string) => setDraft(previous => ({ ...previous, [field]: value }))
  return <Modal title={`Thông báo: ${target.username}`} busy={action.busy} onClose={onClose} wide>
    <form className="admin-form" onSubmit={event => { event.preventDefault(); void action.run(async () => {
      await api().saveNotification({ staffId: target.staffId, rawValue: writeNotificationDraft(target.rawValue, draft), expectedVersion: target.version }); onSaved()
    }) }}>
      <p className="admin-muted">{target.organizationName}{!target.isActive ? ' · Đang tắt / khách hàng ngừng hoạt động' : ''}</p>
      <label>Nội dung thông báo<textarea aria-label="Nội dung thông báo" required autoFocus rows={5} maxLength={90000} value={draft.message} onChange={e => update('message', e.target.value)} /></label>
      <details><summary>Tùy chọn hiển thị</summary><div className="admin-form-grid">
        <label>Tiêu đề<input value={draft.title} onChange={e => update('title', e.target.value)} /></label>
        <label>Mức độ<select value={draft.level} onChange={e => update('level', e.target.value)}><option value="info">Thông tin</option><option value="success">Thành công</option><option value="warning">Cảnh báo</option><option value="error">Lỗi</option></select></label>
        <label>Nhãn liên kết<input value={draft.linkLabel} onChange={e => update('linkLabel', e.target.value)} /></label>
        <label>URL liên kết<input type="url" value={draft.linkUrl} onChange={e => update('linkUrl', e.target.value)} /></label>
        <label>Bắt đầu (giờ Việt Nam)<input type="datetime-local" value={vietnamDateInput(draft.startsAt)} onChange={e => update('startsAt', e.target.value ? `${e.target.value}:00+07:00` : '')} /></label>
        <label>Kết thúc (giờ Việt Nam)<input type="datetime-local" value={vietnamDateInput(draft.endsAt)} onChange={e => update('endsAt', e.target.value ? `${e.target.value}:00+07:00` : '')} /></label>
      </div></details>
      <div className={`admin-notification-preview admin-notification-${draft.level}`}><small>Xem trước nội dung</small><strong>{draft.title}</strong><p>{draft.message || 'Nội dung thông báo'}</p>{draft.linkUrl && <span>{draft.linkLabel || 'Xem chi tiết'}</span>}</div>
      <ErrorNote error={action.error} /><footer><button type="button" className="btn btn-secondary" disabled={action.busy} onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={action.busy}>{action.busy ? 'Đang lưu…' : 'Lưu thông báo'}</button></footer>
    </form>
  </Modal>
}

function StaffPicker({ onSelect, onClose }: { onSelect: (target: AdminNotification) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [submitted, setSubmitted] = useState('')
  const query = useAdminQuery(() => submitted.length >= 2 ? api().searchStaff(submitted) : Promise.resolve([]), [submitted])
  return <Modal title="Chọn khách hàng nhận thông báo" onClose={onClose}>
    <form className="admin-toolbar admin-customer-search" onSubmit={event => { event.preventDefault(); setSubmitted(search.trim()); if (search.trim() === submitted) void query.reload() }}>
      <label className="admin-grow">Username<input autoFocus minLength={2} required value={search} onChange={e => setSearch(e.target.value)} placeholder="Nhập ít nhất 2 ký tự" /></label><button className="btn btn-primary" disabled={query.busy}><Search size={14} /> Tìm</button>
    </form>
    <ErrorNote error={query.error} />
    <div className="admin-staff-results">{query.data?.map(row => <button key={row.staffId} type="button" onClick={() => onSelect(row)}><strong>{row.username}</strong><span>{row.organizationName} · #{row.organizationId}{!row.isActive ? ' · Ngừng hoạt động' : ''}</span><small>{row.rawValue ? 'Đã có thông báo — mở để chỉnh sửa' : 'Chưa có thông báo'}</small></button>)}</div>
    {!query.data?.length && <Empty busy={query.busy}>{submitted ? 'Không tìm thấy khách hàng.' : 'Tìm khách hàng trên toàn hệ thống bằng username.'}</Empty>}
  </Modal>
}

export function AdminNotifications() {
  const [cursor, setCursor] = useState<string | null>(null)
  const global = useAdminQuery(() => api().getGlobalNotification())
  const list = useAdminQuery(() => api().listNotifications(cursor), [cursor])
  const [editing, setEditing] = useState<AdminNotification | null>(null)
  const [picker, setPicker] = useState(false)
  const [deleting, setDeleting] = useState<AdminNotification | null>(null)
  const action = useAdminAction()
  const reload = async () => { await Promise.all([global.reload(), list.reload()]) }
  const saved = () => { setEditing(null); void reload() }
  return <section className="admin-section admin-scroll">
    <div className="admin-toolbar"><div><h2>Thông báo trên Web/App</h2><p>Dùng chung cho khách hàng akaAgent trên Web và App</p></div><Reload busy={global.busy || list.busy} onClick={() => void reload()} /></div>
    <ErrorNote error={global.error || list.error || action.error} />
    <article className="admin-card"><div className="admin-toolbar"><h3>Thông báo chung</h3><button className="btn btn-secondary" disabled={!global.data || global.busy} onClick={() => setEditing(global.data)}>Sửa</button><button className="btn btn-ghost" disabled={!global.data?.rawValue || global.busy} onClick={() => setDeleting(global.data)}>Xóa</button></div>
      {global.data ? <><p className="admin-prewrap">{readNotificationDraft(global.data.rawValue).message || 'Chưa có thông báo chung.'}</p>{!global.data.isActive && <p className="admin-muted">Cấu hình thông báo chung hiện đang tắt.</p>}</> : <Empty busy={global.busy} />}
    </article>
    <div className="admin-toolbar"><h3>Thông báo theo khách hàng</h3><button className="btn btn-primary" onClick={() => setPicker(true)}><Plus size={14} /> Thêm</button></div>
    <div className="admin-table-wrap"><table><thead><tr><th>Username</th><th>Tổ chức</th><th>Nội dung</th><th>Thao tác</th></tr></thead><tbody>{list.data?.items.map(row => <tr key={row.staffId}><td><strong>{row.username}</strong></td><td>{row.organizationName}<small>#{row.organizationId}</small></td><td className="admin-cell-message">{readNotificationDraft(row.rawValue).message || row.rawValue}</td><td><div className="admin-row-actions"><button className="btn btn-secondary" disabled={list.busy} onClick={() => setEditing(row)}>Sửa</button><button className="btn btn-ghost" disabled={list.busy} onClick={() => setDeleting(row)}>Xóa</button></div></td></tr>)}</tbody></table></div>
    {!list.data?.items.length && <Empty busy={list.busy}>Chưa có thông báo riêng cho khách hàng.</Empty>}
    <Pagination cursor={cursor} nextCursor={list.data?.nextCursor} busy={list.busy} onChange={setCursor} />
    {picker && <StaffPicker onClose={() => setPicker(false)} onSelect={row => { setPicker(false); setEditing(row) }} />}
    {editing && <NotificationForm key={editing.staffId ?? 'global'} target={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    {deleting && <Modal title="Xóa thông báo" onClose={() => setDeleting(null)} busy={action.busy}><p>Xóa nội dung thông báo của {deleting.username}?</p><ErrorNote error={action.error} /><div className="admin-footer"><button className="btn btn-secondary" disabled={action.busy} onClick={() => setDeleting(null)}>Hủy</button><button className="btn btn-danger" disabled={action.busy} onClick={() => void action.run(async () => { await api().saveNotification({ staffId: deleting.staffId, rawValue: '', expectedVersion: deleting.version }); setDeleting(null); await reload() })}>Xóa nội dung</button></div></Modal>}
  </section>
}
