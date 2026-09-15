import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Info, RefreshCw } from 'lucide-react'
import type { AutoAccountContact } from '../../../../shared/types'
import './facebookPageIdentitySettings.css'

const formatIpcErrorMessage = (error: unknown, fallback: string) =>
  (error instanceof Error ? error.message : String(error || fallback)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')

interface Props {
  accountId: number | null
  multipleAccounts: boolean
  enabled: boolean
  pageUid: string
  pageName: string
  onToggle: (enabled: boolean) => void
  onSelect: (uid: string, name: string) => void
}

export default function FacebookPageIdentitySettings({ accountId, multipleAccounts, enabled, pageUid, pageName, onToggle, onSelect }: Props) {
  const [pages, setPages] = useState<AutoAccountContact[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const generation = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const request = ++generation.current
    setPages([]); setError(''); setUpdatedAt(''); setOpen(false); setLoading(false)
    if (!enabled || accountId === null) return
    setLoading(true)
    window.electronAPI.listContacts(accountId, 'page').then(rows => {
      if (request !== generation.current) return
      setPages(rows.filter(row => !row.isDelete && row.uid && row.name))
      setUpdatedAt(rows.map(row => row.updatedAt || '').sort().at(-1) || '')
    }).catch(err => {
      if (request === generation.current) setError(formatIpcErrorMessage(err, 'Không tải được danh sách Page.'))
    }).finally(() => { if (request === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [accountId, enabled])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      if (!trigger.current || !menu.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const scroller = trigger.current.closest('.stepper-content')?.getBoundingClientRect()
      if (scroller && (anchor.bottom <= scroller.top || anchor.top >= scroller.bottom)) {
        setOpen(false)
        return
      }
      const gap = 4
      const margin = 8
      const width = Math.min(anchor.width, window.innerWidth - margin * 2)
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin)
      const above = Math.max(0, anchor.top - gap - margin)
      const desiredHeight = Math.min(260, menu.current.scrollHeight + 2)
      const openAbove = below < desiredHeight && above > below
      const overlay = trigger.current.closest('.modal-overlay')
      const overlayZIndex = overlay ? Number.parseInt(getComputedStyle(overlay).zIndex, 10) : 0
      setMenuPosition({
        left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)),
        width,
        maxHeight: Math.max(1, Math.min(260, openAbove ? above : below)),
        ...(openAbove ? { bottom: window.innerHeight - anchor.top + gap } : { top: anchor.bottom + gap }),
        zIndex: (Number.isFinite(overlayZIndex) ? overlayZIndex : 1000) + 1
      })
    }
    const onScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) updatePosition()
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    if (trigger.current) observer.observe(trigger.current)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, pages])

  const refresh = async () => {
    if (accountId === null || loading) return
    const request = ++generation.current
    setLoading(true); setError(''); setOpen(false)
    try {
      const result = await window.electronAPI.loadPages(accountId)
      if (request !== generation.current) return
      if (!result.success) throw new Error(result.error || 'Không tải được Page từ tài khoản.')
      const rows = await window.electronAPI.listContacts(accountId, 'page')
      if (request !== generation.current) return
      const next = rows.filter(row => !row.isDelete && row.uid && row.name)
      setPages(next); setUpdatedAt(new Date().toISOString())
      const selected = next.find(row => row.uid === pageUid)
      if (pageUid) onSelectRef.current(selected?.uid || '', selected?.name || '')
    } catch (err) {
      if (request === generation.current) setError(formatIpcErrorMessage(err, 'Không tải được Page từ tài khoản.'))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }

  const selected = pages.find(page => page.uid === pageUid)
  const displayName = selected?.name || pageName
  const choose = (page: AutoAccountContact) => {
    onSelect(page.uid || '', page.name); setOpen(false); trigger.current?.focus()
  }
  const focusOption = (last = false) => requestAnimationFrame(() => {
    const options = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    const index = last ? (options?.length || 1) - 1 : Math.max(0, pages.findIndex(page => page.uid === pageUid))
    options?.[index]?.focus()
  })

  return <div ref={root} className={`stepper-form-group facebook-page-identity ${enabled ? 'is-enabled' : ''}`}>
    <div className="facebook-page-identity-heading">
      <button type="button" role="switch" aria-checked={enabled} aria-label="Chạy bằng Page"
        className="facebook-page-identity-switch" disabled={multipleAccounts}
        onClick={() => onToggle(!enabled)}><span /></button>
      <div><strong>Chạy bằng Page</strong><p>Chiến dịch thao tác dưới danh nghĩa Fanpage thay vì tài khoản cá nhân.</p></div>
    </div>
    {multipleAccounts && <p className="facebook-page-identity-help">Chọn đúng 1 tài khoản chính để chạy bằng Page.</p>}
    {enabled && <div className="facebook-page-identity-body">
      <div className="facebook-page-identity-label"><label id="campaign-page-label">Chọn Page <span className="required">*</span></label>
        <span aria-live="polite">{loading ? 'Đang tải danh sách…' : `${pages.length} Page${updatedAt ? ` · cập nhật ${new Date(updatedAt).toLocaleString('vi-VN')}` : ''}`}</span></div>
      <div className="facebook-page-identity-controls">
        <button ref={trigger} type="button" className="stepper-input facebook-page-identity-select" aria-labelledby="campaign-page-label"
          aria-haspopup="listbox" aria-expanded={open} aria-controls="campaign-page-options" disabled={loading || accountId === null}
          onClick={() => { setOpen(!open); if (!open) focusOption() }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); focusOption(event.key === 'ArrowUp') }
          }}>
          {pageUid && <span className="facebook-page-avatar">{displayName.trim().charAt(0).toUpperCase()}</span>}
          <span className="facebook-page-identity-name" title={pageUid ? `${displayName} · ID ${pageUid}` : undefined}><span>{displayName || '-- Chọn Page --'}</span>{pageUid && <small>ID {pageUid}</small>}</span>
          <ChevronDown size={17} />
        </button>
        <button type="button" className="btn btn-secondary facebook-page-identity-load" disabled={loading || accountId === null} onClick={() => void refresh()}>
          <RefreshCw size={17} className={loading ? 'is-spinning' : ''} />{loading ? 'Đang tải' : 'Load Page'}
        </button>
      </div>
      {open && createPortal(<div ref={menu} className="facebook-page-identity-menu" style={menuPosition} id="campaign-page-options" role="listbox" aria-labelledby="campaign-page-label"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }
          if (event.key === 'Tab') { setOpen(false); trigger.current?.focus() }
          const options = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])
          const index = options.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'ArrowDown' ? (index + 1) % options.length : event.key === 'ArrowUp' ? (index - 1 + options.length) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : -1
          if (next >= 0) { event.preventDefault(); options[next]?.focus() }
        }}>
        {pages.map(page => <button type="button" role="option" tabIndex={-1} aria-selected={page.uid === pageUid} key={page.uid} onClick={() => choose(page)}>
          <span className="facebook-page-avatar">{page.name.trim().charAt(0).toUpperCase()}</span>
          <span className="facebook-page-identity-name"><span>{page.name}</span><small>ID {page.uid}</small></span>
          {page.uid === pageUid && <Check size={17} />}
        </button>)}
        {!pages.length && <p>Chưa có Page nào — bấm <b>Load Page</b> để lấy danh sách từ tài khoản.</p>}
      </div>, document.body)}
      {accountId === null && <p className="facebook-page-identity-help">Chọn tài khoản chính để tải danh sách Page.</p>}
      {error && <p className="facebook-page-identity-error" role="alert">{error}</p>}
      <div className="facebook-page-identity-hint"><Info size={14} /><span>Chiến dịch chạy bằng Page đã chọn và chuyển về danh tính trước đó khi kết thúc. Page cần có quyền thực hiện hành động này.</span></div>
    </div>}
  </div>
}
