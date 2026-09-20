import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Folder, X } from 'lucide-react'

export default function DataGroupFormDialog({ title, busy, onClose, children }: {
  title: string
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef(document.activeElement)
  const titleId = useId()

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus()
    return () => {
      const previousFocus = returnFocusRef.current
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (busy) dialogRef.current?.focus()
  }, [busy])

  return createPortal(
    <div className="data-group-form-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section ref={dialogRef} className="data-group-form-modal" role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (!busy) onClose()
          }
          if (event.key !== 'Tab') return
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
          )).filter(item => item.getClientRects().length > 0)
          const first = items[0]
          const last = items[items.length - 1]
          if (!first) {
            event.preventDefault()
            event.currentTarget.focus()
          } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
            event.preventDefault()
            first.focus()
          }
        }}>
        <header className="data-group-form-header">
          <span className="data-group-form-icon"><Folder size={20} /></span>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn-icon" aria-label="Đóng form nhóm data" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body
  )
}
