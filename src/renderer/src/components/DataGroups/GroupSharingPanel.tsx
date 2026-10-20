import { useAuthStore } from '../../stores/authStore'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Share2, X } from 'lucide-react'
import { groupSharingError, type GroupAccess, type GroupKind, type GroupSharing, type GroupSharingApi, type GroupSharingScope, type GroupSharingStaff } from '../../../../shared/groupSharing'
import './groupSharing.css'

export function GroupSharingBadge({ access }: { access?: GroupAccess }) {
  if (access?.role !== 'shared') return null
  const label = access.ownerName || `Nhân viên #${access.ownerStaffId}`
  return <small className="group-sharing-badge" title={label}>{label}</small>
}

type GroupSharingProps = {
  api: GroupSharingApi; kind: GroupKind; groupId: number; groupName: string; access?: GroupAccess
  onChanged: () => unknown | Promise<unknown>
}

export function GroupSharingButton({ disabled = false, ...props }: GroupSharingProps & { disabled?: boolean }) {
  const session = useAuthStore(state => state.user)
  const [openedFor, setOpenedFor] = useState<{ kind: GroupKind; groupId: number; session: unknown } | null>(null)
  const open = openedFor?.kind === props.kind && openedFor.groupId === props.groupId && openedFor.session === session
  useEffect(() => { setOpenedFor(null) }, [props.kind, props.groupId, session])
  if (props.access?.role === 'shared' || props.access?.canManage === false) return null
  return <>
    <button type="button" className="btn btn-secondary btn-sm group-sharing-trigger" disabled={disabled}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpenedFor({ kind: props.kind, groupId: props.groupId, session })}>
      <Share2 size={13} /> Chia sẻ
    </button>
    {open && createPortal(<GroupSharingDialog {...props} onClose={() => setOpenedFor(null)} />, document.body)}
  </>
}

function GroupSharingDialog({ api, kind, groupId, groupName, access, onChanged, onClose }: GroupSharingProps & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      dialog?.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  const session = useAuthStore(state => state.user)
  const [sharing, setSharing] = useState<GroupSharing | null>(null)
  const [staff, setStaff] = useState<GroupSharingStaff[]>([])
  const [scope, setScope] = useState<GroupSharingScope>('private')
  const [recipients, setRecipients] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [staffReady, setStaffReady] = useState(false)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setSharing(null); setStaffReady(false); setStaff([]); setError(''); setBusy(false); setSearch('')
    void api.get(kind, groupId).then(async next => {
      if (current !== generation.current) return
      setSharing(next); setScope(next.scope); setRecipients(next.recipientIds)
      if (next.access.canManage) {
        const people = await api.staff()
        if (current === generation.current) { setStaff(people); setStaffReady(true) }
      }
    }).catch(cause => { if (current === generation.current) setError(groupSharingError(cause)) })
    return () => { generation.current++ }
  }, [api, kind, groupId, reload, session])
  const save = async () => {
    if (!sharing || busy || !staffReady) return
    const current = generation.current
    setBusy(true); setError('')
    try {
      const next = await api.save({ kind, groupId, scope, recipientIds: scope === 'selected' ? recipients : [], expectedRevision: sharing.revision })
      if (current !== generation.current) return
      setSharing(next); setScope(next.scope); setRecipients(next.recipientIds)
      await onChanged()
      if (current === generation.current) onClose()
    } catch (cause) {
      if (current === generation.current) setError(groupSharingError(cause))
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  const owner = sharing?.access.canManage ?? access?.canManage
  return <dialog ref={dialogRef} className="group-sharing-dialog" aria-labelledby={headingId} aria-modal="true"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => event.stopPropagation()}>
    <header className="group-sharing-dialog-header">
      <div><h3 id={headingId}>Chia sẻ nhóm</h3><p title={groupName}>{groupName}</p></div>
      <button type="button" className="btn-icon" aria-label="Đóng chia sẻ" disabled={busy} onClick={onClose}><X size={18} /></button>
    </header>
    <section className="group-sharing-panel" aria-label="Quyền chia sẻ">
    {owner === false ? <><GroupSharingBadge access={sharing?.access || access} /><p>Bạn có thể xem, sử dụng và sao chép về kho riêng.</p></> : sharing ? <>
      <label><input type="checkbox" checked={scope !== 'private'} disabled={busy} onChange={event => setScope(event.target.checked ? 'organization' : 'private')} />Chia sẻ trong tổ chức</label>
      {scope !== 'private' && <>
        <label><input type="radio" checked={scope === 'organization'} disabled={busy} onChange={() => setScope('organization')} />Tất cả thành viên</label>
        <label><input type="radio" checked={scope === 'selected'} disabled={busy} onChange={() => setScope('selected')} />Chọn nhân viên</label>
        {scope === 'selected' && <>
          <input aria-label="Tìm nhân viên để chia sẻ" placeholder="Tìm nhân viên..." value={search} disabled={busy} onChange={event => setSearch(event.target.value)} />
          <div className="group-sharing-staff">
            {staff.filter(person => person.name.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi'))).map(person =>
              <label key={person.id}><input type="checkbox" checked={recipients.includes(person.id)} disabled={busy} onChange={event => setRecipients(previous => event.target.checked ? [...previous, person.id] : previous.filter(id => id !== person.id))} />{person.name}<small>#{person.id}</small></label>)}
            {staff.length === 0 && <small>Không có nhân viên để chọn.</small>}
          </div>
          {recipients.some(id => !staff.some(person => person.id === id)) && <small>Một số người nhận không còn khả dụng. Bỏ họ khỏi danh sách trước khi lưu.</small>}
          {recipients.filter(id => !staff.some(person => person.id === id)).map(id => <label key={id}><input type="checkbox" checked disabled={busy} onChange={() => setRecipients(previous => previous.filter(value => value !== id))} />Nhân viên #{id} (không còn khả dụng)</label>)}
        </>}
      </>}
    </> : !error && <small>Đang tải quyền chia sẻ...</small>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setReload(value => value + 1)}>Tải lại</button></div>}
    </section>
    <footer className="group-sharing-dialog-footer">
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Đóng</button>
      {owner !== false && <button type="button" className="btn btn-primary" disabled={!sharing || busy || !staffReady || (scope === 'selected' && recipients.length === 0)} onClick={() => void save()}>{busy ? 'Đang lưu...' : 'Lưu chia sẻ'}</button>}
    </footer>
  </dialog>
}

export function GroupCopyButton({ api, kind, groupId, templateId, onCopied }: {
  api: GroupSharingApi; kind: GroupKind; groupId: number; templateId?: number
  onCopied: () => unknown | Promise<unknown>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const session = useAuthStore(state => state.user)
  const requestId = useRef<string | null>(null)
  const generation = useRef(0)
  useEffect(() => { generation.current++; requestId.current = null; setError(''); setBusy(false); return () => { generation.current++ } }, [kind, groupId, templateId, session])
  const copy = async () => {
    if (busy) return
    const current = generation.current
    requestId.current ||= crypto.randomUUID()
    setBusy(true); setError('')
    try {
      await api.copy({ kind, groupId, templateId, requestId: requestId.current })
      if (current !== generation.current) return
      requestId.current = null
      await onCopied()
    } catch (cause) {
      if (current === generation.current) setError(groupSharingError(cause))
    } finally { if (current === generation.current) setBusy(false) }
  }
  return <div className="group-copy-action"><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void copy()}>{busy ? 'Đang sao chép...' : templateId ? 'Sao chép mẫu về kho riêng' : 'Sao chép nhóm về kho riêng'}</button>{error && <small role="alert">{error}</small>}</div>
}
