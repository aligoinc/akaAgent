import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Folder, X } from 'lucide-react'

const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]:not(:disabled)'

export default function DataGroupFormDialog({ title, busy, onClose, children, icon, subtitle, className = '' }: {
  title: string
  busy: boolean
  onClose: () => void
  children: ReactNode
  icon?: ReactNode
  subtitle?: string
  className?: string
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef(document.activeElement)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    const initialFocus = dialog?.querySelector<HTMLElement>('input:not(:disabled)')
      || dialog?.querySelector<HTMLElement>(focusableSelector) || dialog
    initialFocus?.focus()
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
      <section ref={dialogRef} className={`data-group-form-modal ${className}`} role="dialog" aria-modal="true"
        aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (!busy) onClose()
          }
          if (event.key !== 'Tab') return
          // A nested portal must not also run its parent dialog's focus trap.
          event.stopPropagation()
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector))
            .filter(item => item.getClientRects().length > 0 && !item.closest('[inert]'))
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
          <span className="data-group-form-icon">{icon || <Folder size={20} />}</span>
          <div className="data-group-form-heading"><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" className="btn-icon" aria-label="Đóng form nhóm data" onClick={onClose} disabled={busy}><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body
  )
}
