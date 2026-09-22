import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock3, FolderTree, Info, LockKeyhole, Monitor, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserRound, X } from 'lucide-react'
import { canManageStaff, staffErrorMessage, type ManagedStaff, type StaffDevice, type StaffGroup, type StaffPage, type StaffQuery } from '../../../shared/staffManagement'
import { useAuthStore } from '../stores/authStore'
import '../components/StaffManagement/staffManagement.css'

const api = () => window.electronAPI.staffManagement
const statusLabels = { active: 'Đang hoạt động', locked: 'Tạm khóa', expired: 'Hết hạn' }
const date = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) : '—'
const versionTargets = (rows: ManagedStaff[]) => rows.map(row => ({ id: row.id, expectedVersion: row.version }))
const groupName = (row: StaffGroup, organizationName: string) => row.parentId === null ? organizationName : row.name
const parentName = (row: StaffGroup, data: StaffPage) => {
  const parent = data.groups.find(group => group.id === row.parentId)
  return parent ? groupName(parent, data.organization.name) : '—'
}
type Editor = { kind: 'group'; row?: StaffGroup } | { kind: 'staff'; row?: ManagedStaff } | { kind: 'status' | 'device'; rows: ManagedStaff[] }

function orderedGroups(groups: StaffGroup[]): { row: StaffGroup; depth: number }[] {
  const result: { row: StaffGroup; depth: number }[] = []
  const visited = new Set<number>()
  const visit = (row: StaffGroup, depth: number) => {
    if (visited.has(row.id)) return
    visited.add(row.id)
    result.push({ row, depth })
    groups.filter(child => child.parentId === row.id).forEach(child => visit(child, depth + 1))
  }
  groups.filter(row => row.parentId === null || !groups.some(parent => parent.id === row.parentId)).forEach(row => visit(row, 0))
  groups.forEach(row => visit(row, 0))
  return result
}

function Dialog({ title, subtitle, kind, children, onClose, busy }: {
  title: string; subtitle: string; kind: Editor['kind']; children: ReactNode; onClose: () => void; busy: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const firstField = ref.current?.querySelector<HTMLElement>('input:not(:disabled):not([readonly]),select:not(:disabled)')
    ;(firstField || ref.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="sm-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className={`sm-dialog sm-dialog-${kind}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby="sm-dialog-title" aria-describedby="sm-dialog-subtitle" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() }
      if (event.key !== 'Tab') return
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header>
        <span className="sm-dialog-icon">{kind === 'group' ? <FolderTree size={15} /> : kind === 'device' ? <Monitor size={15} /> : <UserRound size={15} />}</span>
        <div className="sm-dialog-heading"><h2 id="sm-dialog-title">{title}</h2><p id="sm-dialog-subtitle">{subtitle}</p></div>
        <button className="sm-icon" type="button" aria-label="Đóng" disabled={busy} onClick={onClose}><X size={16} /></button>
      </header>
      {children}
    </div>
  </div>
}

function StaffEditor({ editor, data, onClose, onSaved }: { editor: Editor; data: StaffPage; onClose: () => void; onSaved: () => void }) {
  const groups = orderedGroups(data.groups)
  const root = data.groups.find(row => row.parentId === null)
  const [name, setName] = useState(editor.kind === 'staff' || editor.kind === 'group' ? editor.row?.name || '' : '')
  const [phone, setPhone] = useState(editor.kind === 'staff' ? editor.row?.phone || '' : '')
  const [group, setGroup] = useState(editor.kind === 'staff'
    ? String(editor.row?.groupIds[0] ?? groups[0]?.row.id ?? '')
    : editor.kind === 'group' ? String(editor.row?.parentId ?? root?.id ?? '') : '')
  const [isActive, setIsActive] = useState(true)
  const [isDepartmentManager, setIsDepartmentManager] = useState(editor.kind === 'staff'
    && !!editor.row?.managerGroupIds?.includes(editor.row.groupIds[0]))
  const [devices, setDevices] = useState<StaffDevice[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retryOnly, setRetryOnly] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const prepare = async () => {
    if (editor.kind !== 'device' || inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { const response = await api().prepareDevices(editor.rows.map(row => row.id)); if (alive.current) setDevices(response.items) }
    catch (reason) { if (alive.current) setError(staffErrorMessage(reason)) }
    finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { void prepare() }, [])
  const blockedParents = new Set<number>()
  if (editor.kind === 'group' && editor.row) {
    blockedParents.add(editor.row.id)
    for (let i = 0; i < data.groups.length; i++) for (const row of data.groups) if (row.parentId && blockedParents.has(row.parentId)) blockedParents.add(row.id)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (editor.kind === 'group') await api().saveGroup({ id: editor.row?.id, name: name.trim(), parentId: group ? Number(group) : null, expectedVersion: editor.row?.version, requestId: requestId.current })
      if (editor.kind === 'staff') await api().saveStaff({ id: editor.row?.id, name: name.trim(), phone, groupId: Number(group), isDepartmentManager, expectedVersion: editor.row?.version, requestId: requestId.current })
      if (editor.kind === 'status') await api().setStatus({ targets: versionTargets(editor.rows), isActive, requestId: requestId.current })
      if (editor.kind === 'device' && devices) await api().resetDevices({ targets: devices.map(row => ({ id: row.id, expectedVersion: row.version })), requestId: requestId.current })
      if (alive.current) onSaved()
    } catch (reason) {
      if (!alive.current) return
      const message = staffErrorMessage(reason)
      setError(message)
      const uncertain = message.includes('Không thể xác nhận')
      setRetryOnly(uncertain)
      if (!uncertain) requestId.current = crypto.randomUUID()
    } finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  const title = editor.kind === 'group' ? `${editor.row ? 'Sửa' : 'Thêm'} phòng ban`
    : editor.kind === 'staff' ? `${editor.row ? 'Sửa' : 'Thêm'} nhân viên`
      : editor.kind === 'status' ? 'Đổi trạng thái' : 'Đổi máy'
  const subtitle = editor.kind === 'group' ? 'Phòng ban dùng để phân công và lọc danh sách nhân viên'
    : editor.kind === 'staff' ? editor.row ? 'Cập nhật thông tin nhân viên' : 'Đăng nhập và hạn sử dụng được tạo tự động'
      : editor.rows.length > 1 ? `Áp dụng cho ${editor.rows.length} nhân viên đã chọn`
        : `${editor.rows[0].name} · ${editor.rows[0].username}`
  const newExpiry = new Date(`${data.organization.today}T00:00:00+07:00`)
  newExpiry.setUTCDate(newExpiry.getUTCDate() + data.organization.staffDurationDays + 1)
  const existingStaff = editor.kind === 'staff' ? editor.row : undefined
  const otherManagers = (data.groups.find(row => row.id === Number(group))?.managers || []).filter(manager => manager.id !== existingStaff?.id)
  const freeSeats = Math.max(0, data.organization.maxStaff - data.organization.staffCount)
  const expiryNote = data.organization.useOrganizationExpiration
    ? `Đang dùng hạn tổ chức: ${date(data.organization.expirationDate)}.`
    : existingStaff && !existingStaff.expirationDate
      ? 'Nhân viên chưa có hạn riêng nên dùng hạn tổ chức.'
      : 'Đang dùng hạn nhân viên. Nhân viên còn hạn vẫn cần gói sản phẩm tương ứng còn hiệu lực.'
  return <Dialog title={title} subtitle={subtitle} kind={editor.kind} onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <div className="sm-dialog-body">
        {editor.kind === 'group' && <fieldset disabled={busy || retryOnly}>
          <label><span>Tên phòng ban <span className="sm-required">*</span></span>
            <input required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Nhập tên phòng ban…" />
          </label>
          <label><span>Phòng ban cấp trên <span className="sm-required">*</span></span>
            <select value={group} onChange={event => setGroup(event.target.value)}>
              {!root && <option value="">{data.organization.name} (trực thuộc tổ chức)</option>}
              {groups.filter(({ row }) => !blockedParents.has(row.id)).map(({ row, depth }) =>
                <option key={row.id} value={row.id}>{'— '.repeat(depth)}{groupName(row, data.organization.name)}{row.parentId === null ? ' (trực thuộc tổ chức)' : ''}</option>)}
            </select>
          </label>
          <p className="sm-field-help">Không được chọn chính phòng ban này hoặc phòng ban con của nó.</p>
        </fieldset>}
        {editor.kind === 'staff' && <fieldset disabled={busy || retryOnly}>
          <div className="sm-form-grid">
            <label><span>Tên nhân viên <span className="sm-required">*</span></span>
              <input required maxLength={200} value={name} onChange={event => setName(event.target.value)} placeholder="Nhập họ tên nhân viên…" />
            </label>
            <label><span>Số điện thoại <span className="sm-required">*</span></span>
              <input className="sm-mono" required type="tel" maxLength={20} value={phone} onChange={event => setPhone(event.target.value)} placeholder="Nhập số điện thoại…" />
            </label>
          </div>
          <div>
            <div id="sm-staff-department-label" className="sm-field-label">Phòng ban <span className="sm-required">*</span></div>
            <div className="sm-department-chips" role="radiogroup" aria-labelledby="sm-staff-department-label">
              {groups.map(({ row }) => <label key={row.id} className="sm-radio-chip">
                <input required type="radio" name="staff-department" value={row.id} checked={group === String(row.id)} onChange={event => setGroup(event.target.value)} />
                <span>{groupName(row, data.organization.name)}{row.parentId === null ? ' · Tổ chức' : ''}</span>
              </label>)}
            </div>
          </div>
          <label className={`sm-manager-option ${isDepartmentManager ? 'sm-manager-selected' : ''}`}>
            <input type="checkbox" checked={isDepartmentManager} aria-label="Là trưởng phòng" aria-describedby="sm-manager-help" onChange={event => setIsDepartmentManager(event.target.checked)} />
            <span><strong>Là trưởng phòng</strong><small id="sm-manager-help">{otherManagers.length
              ? `${otherManagers.map(manager => manager.name).join(', ')} hiện là trưởng phòng. ${isDepartmentManager ? 'Lưu sẽ chuyển quyền trưởng phòng sang nhân viên này.' : 'Bật lựa chọn này để thay trưởng phòng hiện tại.'}`
              : 'Mỗi phòng có tối đa một trưởng phòng.'}</small></span>
          </label>
          <p className="sm-field-help">Trưởng phòng xem được hội thoại của phòng và phòng con trong Chat khi có quyền trên tài khoản Zalo. Quyền này không cấp admin tổ chức.</p>
          <section className="sm-info-card sm-login-card" aria-labelledby="sm-login-info-title">
            <h3 id="sm-login-info-title"><LockKeyhole size={14} />Thông tin đăng nhập — {existingStaff ? 'giữ nguyên' : 'tự động tạo'}</h3>
            <div className="sm-form-grid">
              <div><label>Tên đăng nhập
                <input readOnly className="sm-mono" aria-describedby="sm-username-help" value={existingStaff?.username || `${data.organization.id}.${phone.replace(/[^\d+]/g, '').replace(/^\+?84/, '0')}`} />
              </label><p id="sm-username-help" className="sm-field-help">{existingStaff ? 'Không thay đổi khi sửa số điện thoại' : 'id tổ chức [.] số điện thoại'}</p></div>
              <div><label>Mật khẩu
                <input readOnly className="sm-mono" aria-describedby="sm-password-help" value={existingStaff ? '••••••' : '123456'} />
              </label><p id="sm-password-help" className="sm-field-help">{existingStaff ? 'Giữ nguyên mật khẩu hiện tại' : 'Mặc định, nhân viên tự đổi sau khi đăng nhập'}</p></div>
            </div>
          </section>
          <section className="sm-info-card sm-expiry-card" aria-labelledby="sm-expiry-info-title">
            <h3 id="sm-expiry-info-title"><Clock3 size={14} />Hạn sử dụng — {existingStaff ? 'giữ nguyên' : 'tự động tạo'}</h3>
            <dl>
              <div><dt>Ngày tạo</dt><dd>{date(existingStaff?.createdAt || `${data.organization.today}T00:00:00+07:00`)}</dd></div>
              {!existingStaff && <>
                <div><dt>Số ngày sử dụng của tổ chức</dt><dd>{data.organization.staffDurationDays} ngày</dd></div>
                <div><dt>Công thức</dt><dd>Ngày tạo + {data.organization.staffDurationDays} + 1</dd></div>
              </>}
              <div className="sm-expiry-value"><dt>{existingStaff ? 'Hạn nhân viên' : 'Hạn nhân viên dự kiến'}</dt><dd>{date(existingStaff ? existingStaff.expirationDate : newExpiry.toISOString())}</dd></div>
              {existingStaff && <div><dt>Hạn sử dụng hiệu lực</dt><dd>{date(existingStaff.effectiveExpirationDate)}</dd></div>}
            </dl>
            <p>{expiryNote}{!existingStaff && ' Hạn chính thức được tính khi tạo nhân viên.'}</p>
          </section>
          {!existingStaff && <div className="sm-note"><Info size={14} /><span>Còn {freeSeats}/{data.organization.maxStaff} chỗ của tổ chức.</span></div>}
        </fieldset>}
        {editor.kind === 'status' && <>
          <fieldset className="sm-status-options" disabled={busy || retryOnly}>
            <legend className="sm-sr-only">Trạng thái nhân viên</legend>
            {([true, false] as const).map(active => <label key={String(active)} className={`sm-status-option sm-status-${active ? 'active' : 'locked'}`}>
              <input type="radio" name="staff-status" value={String(active)} checked={isActive === active} onChange={() => setIsActive(active)} />
              <span className="sm-status-option-body"><i className="sm-status-dot" /><span><strong>{active ? statusLabels.active : statusLabels.locked}</strong><small>{active ? 'Được đăng nhập và chạy tác vụ khi còn hạn sử dụng' : 'Không đăng nhập được, dữ liệu vẫn giữ nguyên'}</small></span><span className="sm-radio-check"><Check size={12} /></span></span>
            </label>)}
          </fieldset>
          <div className="sm-note"><Info size={14} /><span>Hết hạn được tính tự động. Không thể tự khóa hoặc khóa admin hoạt động cuối cùng.</span></div>
        </>}
        {editor.kind === 'device' && <>
          {devices ? <ul className="sm-device-list">{devices.map(row => <li key={row.id}>
            <span className="sm-dialog-icon"><Monitor size={15} /></span>
            <div><strong>{row.name}</strong><span>{row.isBound ? row.label || 'Đã liên kết máy' : 'Chưa liên kết máy'}{row.isBound && row.platform ? ` · ${row.platform}` : ''}</span></div>
            <span className={`sm-badge ${row.isBound ? 'sm-badge-green' : ''}`}>{row.isBound ? 'Đã liên kết' : 'Chưa liên kết'}</span>
          </li>)}</ul> : <p role="status">{busy ? 'Đang kiểm tra liên kết máy…' : 'Chưa tải được liên kết máy.'}</p>}
          {!devices && !busy && <button type="button" onClick={() => void prepare()}>Tải lại liên kết</button>}
          <div className="sm-note sm-note-warning"><Info size={14} /><span>Gỡ liên kết để nhân viên đăng nhập trên máy mới. Không trừ lượt đổi máy; phiên đang mở tiếp tục hoạt động.</span></div>
        </>}
        {error && <div className="sm-error" role="alert">{error}</div>}
        {retryOnly && <p className="sm-muted">Bấm thử lại để xác nhận cùng yêu cầu. Các giá trị được giữ nguyên để tránh thực hiện hai lần.</p>}
      </div>
      <footer>
        <span>{editor.kind === 'staff' && !existingStaff ? 'Kiểm tra trùng SĐT và số lượng nhân viên trước khi lưu' : ''}</span>
        <button type="button" disabled={busy} onClick={onClose}>Hủy</button>
        <button className="sm-primary" type="submit" disabled={busy || (editor.kind === 'device' && !devices)}>
          {busy ? 'Đang xử lý…' : retryOnly ? 'Thử lại cùng yêu cầu' : editor.kind === 'device' ? 'Xác nhận đổi máy' : editor.kind === 'status' ? 'Cập nhật trạng thái' : 'Lưu'}
        </button>
      </footer>
    </form>
  </Dialog>
}

export default function StaffManagementPage() {
  const user = useAuthStore(state => state.user)
  const allowed = canManageStaff(user)
  const [data, setData] = useState<StaffPage | null>(null)
  const [query, setQuery] = useState<StaffQuery>({ page: 0, status: 'all', groupId: null, search: '' })
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focusedId, setFocusedId] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [secrets, setSecrets] = useState<Record<number, string>>({})
  const [revealing, setRevealing] = useState<Set<number>>(new Set())
  const generation = useRef(0)
  const secretRequests = useRef(new Map<number, symbol>())
  const selectAll = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timer)
  }, [notice, revision])
  useEffect(() => {
    const timer = setTimeout(() => setQuery(previous => previous.search === search.trim() ? previous : { ...previous, search: search.trim(), page: 0 }), 250)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const current = ++generation.current
    secretRequests.current.clear(); setSecrets({}); setRevealing(new Set()); setSelected(new Set()); setLoading(true); setError('')
    if (!allowed) { setData(null); setEditor(null); return }
    api().list(query).then(response => {
      if (generation.current !== current) return
      if (!response.items.length && response.total && (query.page || 0) > 0) { setQuery(previous => ({ ...previous, page: 0 })); return }
      setData(response)
    }).catch(reason => { if (generation.current === current) { setData(null); setError(staffErrorMessage(reason)) } })
      .finally(() => { if (generation.current === current) setLoading(false) })
    return () => { generation.current++; secretRequests.current.clear() }
  }, [query, revision, allowed])
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selected.size > 0 && selected.size !== data?.items.length }, [selected, data])
  const changeQuery = (patch: StaffQuery) => { setSecrets({}); secretRequests.current.clear(); setQuery(previous => ({ ...previous, page: 0, ...patch })) }
  const reveal = async (row: ManagedStaff) => {
    if (secrets[row.id] !== undefined || revealing.has(row.id)) {
      secretRequests.current.delete(row.id)
      setSecrets(previous => { const next = { ...previous }; delete next[row.id]; return next })
      setRevealing(previous => { const next = new Set(previous); next.delete(row.id); return next }); return
    }
    const token = Symbol(), current = generation.current
    secretRequests.current.set(row.id, token)
    setRevealing(previous => new Set(previous).add(row.id))
    try {
      const result = await api().revealPassword(row.id)
      if (current === generation.current && secretRequests.current.get(row.id) === token) setSecrets(previous => ({ ...previous, [row.id]: result.password }))
    } catch (reason) { if (current === generation.current && secretRequests.current.get(row.id) === token) setError(staffErrorMessage(reason)) }
    finally { if (current === generation.current && secretRequests.current.get(row.id) === token) { secretRequests.current.delete(row.id); setRevealing(previous => { const next = new Set(previous); next.delete(row.id); return next }) } }
  }
  if (!allowed) return null
  const rows = data?.items || []
  const selectedRows = rows.filter(row => selected.has(row.id))
  const focusedRow = rows.find(row => row.id === focusedId) || rows[0]
  const actionRows = selectedRows.length ? selectedRows : focusedRow ? [focusedRow] : []
  const selectedGroup = data?.groups.find(row => row.id === query.groupId)
  const quotaFull = !!data && data.organization.staffCount >= data.organization.maxStaff
  const editRow = actionRows.length === 1 ? actionRows[0] : undefined
  const pickGroup = (id: number) => { if (!loading) changeQuery({ groupId: id }) }
  return <main className="staff-management" aria-label="Quản lý nhân viên">
    <div className="sm-page-heading">
      <div className="sm-page-identity">
        <h1>Quản lý nhân viên</h1>
        <p>{data ? `${data.organization.name} · id tổ chức ${data.organization.id} · số ngày sử dụng mặc định ${data.organization.staffDurationDays}` : 'Đang tải thông tin tổ chức…'}</p>
      </div>
      {data && <>
        <div className="sm-summary-card"><span>Nhân viên</span><strong>{data.organization.staffCount} / {data.organization.maxStaff}</strong><i /><span className={`sm-badge ${quotaFull ? 'sm-badge-red' : 'sm-badge-green'}`}>{quotaFull ? 'Đã đầy' : `Còn ${data.organization.maxStaff - data.organization.staffCount} chỗ`}</span></div>
        <div className="sm-summary-card"><span>Hạn dùng tính theo</span><strong className="sm-mode-badge">{data.organization.useOrganizationExpiration ? `Hạn của tổ chức · ${date(data.organization.expirationDate)}` : 'Hạn của nhân viên'}</strong></div>
      </>}
      <button className="sm-reload" aria-label="Tải lại" title="Tải lại" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button>
    </div>
    {error && <div className="sm-error" role="alert">{error}<button onClick={() => setRevision(value => value + 1)}>Thử lại</button></div>}
    {notice && <div className="sm-success" role="status"><Check size={16} />{notice}<button className="sm-icon" aria-label="Ẩn thông báo" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <section className="sm-panel sm-departments" aria-labelledby="sm-department-title">
      <div className="sm-panel-title">
        <h2 id="sm-department-title"><span className="sm-step">1</span>Danh sách phòng ban</h2>
        <span className="sm-count">{data?.groups.filter(row => row.parentId !== null).length || 0} phòng ban</span>
        <div className="sm-heading-actions">
          <button className="sm-primary" disabled={!data || loading} onClick={() => setEditor({ kind: 'group' })}><Plus size={14} />Thêm phòng ban</button>
          <button disabled={!selectedGroup || selectedGroup.parentId === null || loading} title={selectedGroup?.parentId === null ? 'Dòng tổ chức không chỉnh sửa tại đây' : undefined} aria-label={selectedGroup ? `Sửa phòng ban ${selectedGroup.name}` : 'Sửa phòng ban'} onClick={() => selectedGroup && selectedGroup.parentId !== null && setEditor({ kind: 'group', row: selectedGroup })}><Pencil size={14} />Sửa</button>
        </div>
      </div>
      <div className="sm-table-scroll sm-group-scroll">
        <table>
          <caption className="sm-sr-only">Chọn phòng ban để lọc cả nhân viên thuộc phòng ban con.</caption>
          <thead><tr><th className="sm-number" scope="col">STT</th><th scope="col">Tên phòng ban</th><th scope="col">Phòng ban cấp trên</th><th className="sm-group-staff-count" scope="col">Nhân viên</th></tr></thead>
          <tbody>
            {data && orderedGroups(data.groups).map(({ row, depth }, index) => <tr key={row.id} tabIndex={loading ? -1 : 0} aria-selected={query.groupId === row.id} className={`sm-pick-row ${query.groupId === row.id ? 'sm-selected-row' : ''}`} onClick={() => pickGroup(row.id)} onKeyDown={event => {
              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); pickGroup(row.id) }
            }}>
              <td className="sm-number sm-muted">{row.parentId === null ? '—' : index}</td>
              <td><span className="sm-department-name" style={{ paddingLeft: depth ? (depth - 1) * 16 : 0 }}>{depth > 0 && <i />}{groupName(row, data.organization.name)}{row.parentId === null && <span className="sm-badge sm-badge-green">Tổ chức</span>}</span>
                {!!row.managers?.length && <span className="sm-department-manager" style={{ paddingLeft: depth ? (depth - 1) * 16 : 0 }}><UserRound size={12} />Trưởng phòng: {row.managers.map(manager => manager.name).join(', ')}</span>}
              </td>
              <td className="sm-muted">{parentName(row, data)}</td>
              <td className="sm-group-staff-count">{row.staffCount}</td>
            </tr>)}
            {!data?.groups.length && <tr><td colSpan={4} className="sm-empty">{loading ? 'Đang tải phòng ban…' : 'Chưa có phòng ban. Thêm phòng ban để phân công nhân viên.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
    <section className="sm-panel sm-staff" aria-labelledby="sm-staff-title" aria-busy={loading}>
      <div className="sm-panel-title">
        <h2 id="sm-staff-title"><span className="sm-step">2</span>Danh sách nhân viên</h2>
        <span className="sm-staff-scope" title={selectedGroup ? `${selectedGroup.name} và các phòng ban con` : 'Toàn tổ chức'}>{selectedGroup ? `đang lọc theo: ${selectedGroup.name}` : 'Toàn tổ chức'}{selectedGroup && <button className="sm-icon" aria-label="Xem toàn tổ chức" disabled={loading} onClick={() => changeQuery({ groupId: null })}><X size={13} /></button>}</span>
        <div className="sm-heading-actions">
          <label className="sm-search"><Search size={14} /><input aria-label="Tìm nhân viên" placeholder="Tìm tên, SĐT, username…" value={search} maxLength={200} onChange={event => { setSecrets({}); secretRequests.current.clear(); setSearch(event.target.value) }} /></label>
          <button className="sm-primary" disabled={!data || loading || quotaFull || !data.groups.length} title={quotaFull ? 'Đã sử dụng hết số lượng nhân viên' : !data?.groups.length ? 'Hãy thêm phòng ban trước' : undefined} onClick={() => setEditor({ kind: 'staff' })}><Plus size={14} />Thêm nhân viên</button>
        </div>
      </div>
      <div className="sm-toolbar">
        <div className="sm-filter-chips" role="group" aria-label="Lọc trạng thái">
          {(['all', 'active', 'locked', 'expired'] as const).map(status => <button key={status} className="sm-chip" aria-pressed={query.status === status} onClick={() => changeQuery({ status })}>{status === 'all' ? 'Tất cả' : statusLabels[status]}</button>)}
        </div>
        <div className="sm-row-actions">
          <span className="sm-selection">{selectedRows.length ? `Đã chọn ${selectedRows.length} nhân viên` : focusedRow ? `Đang chọn: ${focusedRow.name}` : 'Chưa chọn nhân viên'}</span>
          <button className="sm-chip" disabled={loading || !actionRows.length} onClick={() => setEditor({ kind: 'device', rows: actionRows })}><Monitor size={13} />Đổi máy</button>
          <button className="sm-chip" disabled={loading || !actionRows.length} onClick={() => setEditor({ kind: 'status', rows: actionRows })}><RefreshCw size={13} />Đổi trạng thái</button>
          <button className="sm-chip" disabled={loading || !editRow} aria-label={editRow ? `Sửa nhân viên ${editRow.name}` : 'Sửa nhân viên'} title={actionRows.length > 1 ? 'Sửa chỉ áp dụng cho 1 nhân viên' : undefined} onClick={() => editRow && setEditor({ kind: 'staff', row: editRow })}><Pencil size={13} />Sửa</button>
          {selected.size > 0 && <button className="sm-text-button sm-clear-selection" onClick={() => setSelected(new Set())}>Bỏ chọn</button>}
        </div>
      </div>
      <div className="sm-table-scroll">
        <table className="sm-staff-table">
          <caption className="sm-sr-only">Danh sách nhân viên. Chọn dòng để sửa, đổi máy hoặc đổi trạng thái; đánh dấu để thao tác nhiều người.</caption>
          <thead><tr>
            <th className="sm-check-cell" scope="col"><input ref={selectAll} aria-label="Chọn tất cả nhân viên trên trang" type="checkbox" disabled={loading || !rows.length} checked={rows.length > 0 && selected.size === rows.length} onChange={event => setSelected(new Set(event.target.checked ? rows.map(row => row.id) : []))} /></th>
            {['STT', 'Trạng thái', 'Tên', 'SĐT', 'Username', 'Mật khẩu', 'Ngày tạo', 'Hạn sử dụng', 'Còn lại', 'Phòng ban'].map(label => <th key={label} scope="col">{label}</th>)}
          </tr></thead>
          <tbody>
            {!loading && rows.map((row, index) => <tr key={row.id} tabIndex={0} aria-selected={focusedRow?.id === row.id || selected.has(row.id)} className={`sm-pick-row ${focusedRow?.id === row.id || selected.has(row.id) ? 'sm-selected-row' : ''}`} onClick={() => setFocusedId(row.id)} onKeyDown={event => {
              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setFocusedId(row.id) }
            }}>
              <td className="sm-check-cell"><input type="checkbox" aria-label={`Chọn ${row.name}`} checked={selected.has(row.id)} onClick={event => event.stopPropagation()} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next })} /></td>
              <td className="sm-muted">{(query.page || 0) * 100 + index + 1}</td>
              <td><span className={`sm-status sm-status-${row.status}`}><i className="sm-status-dot" />{statusLabels[row.status]}</span></td>
              <td><span className="sm-name">{row.name}{row.isAdmin && <ShieldCheck size={13} aria-label="Admin" />}</span></td>
              <td className="sm-mono">{row.phone}</td><td className="sm-mono">{row.username}</td>
              <td><div className="sm-password"><span>{secrets[row.id] !== undefined ? secrets[row.id] : '••••••'}</span><button className="sm-text-button" aria-label={`${secrets[row.id] !== undefined || revealing.has(row.id) ? 'Ẩn' : 'Hiện'} mật khẩu ${row.name}`} onClick={event => { event.stopPropagation(); void reveal(row) }}>{secrets[row.id] !== undefined || revealing.has(row.id) ? 'Ẩn' : 'Hiện'}</button></div></td>
              <td className="sm-muted">{date(row.createdAt)}</td>
              <td className="sm-muted" title={`Hạn nhân viên: ${date(row.expirationDate)}; nguồn: ${row.expirySource === 'staff' ? 'nhân viên, giới hạn bởi gói' : 'tổ chức'}`}>{date(row.effectiveExpirationDate)}</td>
              <td><span className={`sm-days ${row.status === 'expired' ? 'sm-expired' : row.daysRemaining !== null && row.daysRemaining <= 15 ? 'sm-soon' : ''}`}>{row.daysRemaining === null ? '—' : row.status === 'expired' ? 'Hết hạn' : `${row.daysRemaining} ngày`}</span></td>
              <td className="sm-muted"><span className="sm-staff-departments">{row.groupNames.length ? row.groupNames.map((name, groupIndex) => <span key={`${row.groupIds[groupIndex]}-${groupIndex}`} className={row.managerGroupIds?.includes(row.groupIds[groupIndex]) ? 'sm-manager-role' : undefined}>
                {row.managerGroupIds?.includes(row.groupIds[groupIndex]) && <UserRound size={13} aria-label="Trưởng phòng" />}<span>{name}</span>
              </span>) : '—'}</span></td>
            </tr>)}
            {(loading || !rows.length) && <tr><td colSpan={11} className="sm-empty" role="status">{loading ? 'Đang tải nhân viên…' : 'Không có nhân viên phù hợp.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="sm-pagination">
        <span>{data?.total ? `${(query.page || 0) * 100 + 1}–${Math.min(((query.page || 0) + 1) * 100, data.total)} / ${data.total} nhân viên` : '0 nhân viên'} · 100 người/trang</span>
        <div className="sm-pagination-controls"><button className="sm-icon" aria-label="Trang trước" disabled={loading || !query.page} onClick={() => changeQuery({ page: (query.page || 0) - 1 })}><ChevronLeft size={16} /></button><span>Trang {(query.page || 0) + 1}</span><button className="sm-icon" aria-label="Trang sau" disabled={loading || ((query.page || 0) + 1) * 100 >= (data?.total || 0)} onClick={() => changeQuery({ page: (query.page || 0) + 1 })}><ChevronRight size={16} /></button></div>
        <span className="sm-login-rule">Mật khẩu mặc định <b>123456</b> · Username = <b>{data?.organization.id ?? 'ID tổ chức'}.SĐT</b></span>
      </div>
    </section>
    {data && <div className="sm-expiry-note"><Info size={14} /><span>{data.organization.useOrganizationExpiration ? 'Nhân viên dùng hạn tổ chức.' : 'Dùng hạn nhân viên; chưa có hạn riêng thì dùng hạn tổ chức.'} Luôn cần gói sản phẩm còn hiệu lực. Hạn tổ chức: <strong>{date(data.organization.expirationDate)}</strong>.</span></div>}
    {editor && data && <StaffEditor editor={editor} data={data} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice('Đã lưu thay đổi.'); setRevision(value => value + 1) }} />}
  </main>
}
