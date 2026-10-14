import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, X } from 'lucide-react'
import { CAMPAIGN_FORM_AI_MAX_PROMPT, CAMPAIGN_FORM_AI_TIMEOUT, type CampaignFormAiResult } from '../../../../shared/campaignFormAi'
import './campaignScheduleAi.css'

export interface CampaignFormAiProps<Patch> {
  disabled: boolean
  authScope: string
  zIndex?: number
  onBusyChange: (busy: boolean) => void
  onApply: (patch: Patch) => void
}
interface Props<Patch> extends CampaignFormAiProps<Patch> {
  title: string
  closeLabel: string
  label: string
  placeholder: string
  hint: string
  submitLabel: string
  unavailableMessage: string
  generateRequest: (requestId: string, description: string) => Promise<CampaignFormAiResult<Patch>>
  cancelRequest: (requestId: string) => Promise<void>
}

export default function CampaignFormAiPopover<Patch>({ disabled, authScope, zIndex = 3100, onBusyChange, onApply,
  title, closeLabel, label, placeholder, hint, submitLabel, unavailableMessage, generateRequest, cancelRequest }: Props<Patch>) {
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const flight = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const restoringFocus = useRef(false)
  const latest = useRef({ onBusyChange, onApply, authScope })
  latest.current = { onBusyChange, onApply, authScope }
  const id = useId()
  const openPopover = () => {
    document.dispatchEvent(new CustomEvent('campaign-form-ai:open', { detail: id }))
    setOpen(true)
  }
  useEffect(() => {
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id && !flight.current) setOpen(false)
    }
    document.addEventListener('campaign-form-ai:open', otherOpened)
    return () => document.removeEventListener('campaign-form-ai:open', otherOpened)
  }, [id])

  const cancelFlight = () => {
    const owned = flight.current
    flight.current = null
    if (owned) {
      clearTimeout(owned.timer)
      void cancelRequest(owned.id).catch(() => {})
    }
  }
  const cancel = () => { cancelFlight(); setBusy(false); onBusyChange(false); setError('') }
  const closePopover = () => {
    setOpen(false)
    // Wait until the form is unlocked before returning keyboard focus; focus must not reopen the popover.
    requestAnimationFrame(() => {
      restoringFocus.current = true
      button.current?.focus({ preventScroll: true })
      restoringFocus.current = false
    })
  }

  useEffect(() => {
    setBusy(false); setError(''); latest.current.onBusyChange(false)
    return () => { cancelFlight(); latest.current.onBusyChange(false) }
  }, [authScope])

  useLayoutEffect(() => {
    if (!open) return
    const reposition = () => {
      if (!button.current || !panel.current) return
      const anchor = button.current.getBoundingClientRect(), rect = panel.current.getBoundingClientRect()
      setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - rect.height - 8)) })
    }
    reposition()
    const observer = new ResizeObserver(reposition)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', reposition); document.removeEventListener('scroll', reposition, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!flight.current && !panel.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation()
        cancelFlight(); setBusy(false); latest.current.onBusyChange(false); setError(''); closePopover()
      }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key, true) }
  }, [open])

  const generate = async () => {
    if (flight.current || disabled || !description.trim()) return
    const requestId = crypto.randomUUID(), scope = authScope
    setError(''); setBusy(true); onBusyChange(true)
    // Bound the renderer too, so a lost IPC response never leaves the form locked.
    const timer = setTimeout(() => {
      if (flight.current?.id !== requestId) return
      cancelFlight(); setBusy(false); latest.current.onBusyChange(false); setError(unavailableMessage)
    }, CAMPAIGN_FORM_AI_TIMEOUT)
    flight.current = { id: requestId, timer }
    try {
      const result = await generateRequest(requestId, description.trim())
      if (flight.current?.id !== requestId || latest.current.authScope !== scope) return
      if (result.ok) { latest.current.onApply(result.patch); closePopover() }
      else if (result.code !== 'cancelled') setError(result.message)
    } catch {
      if (flight.current?.id === requestId && latest.current.authScope === scope) setError(unavailableMessage)
    } finally {
      if (flight.current?.id === requestId) {
        clearTimeout(timer); flight.current = null; setBusy(false); latest.current.onBusyChange(false)
      }
    }
  }

  return <>
    <button ref={button} type="button" className="btn-icon assistant campaign-schedule-ai-trigger"
      aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={open}
      disabled={disabled || busy} onMouseEnter={() => { if (!disabled) openPopover() }}
      onFocus={() => { if (!disabled && !restoringFocus.current) openPopover() }}
      onClick={event => { event.stopPropagation(); openPopover(); requestAnimationFrame(() => textarea.current?.focus()) }}>
      <Sparkles size={15} />
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-labelledby={`${id}-title`} className="campaign-schedule-ai-popover"
      style={{ ...position, zIndex }} onClick={event => event.stopPropagation()}>
      <div className="campaign-schedule-ai-heading">
        <strong id={`${id}-title`}><Sparkles size={15} /> {title}</strong>
        <button type="button" className="btn-icon" aria-label={closeLabel} onClick={() => { cancel(); closePopover() }}><X size={16} /></button>
      </div>
      <label htmlFor={`${id}-description`}>{label}</label>
      <textarea ref={textarea} id={`${id}-description`} className="stepper-input" rows={3} maxLength={CAMPAIGN_FORM_AI_MAX_PROMPT}
        placeholder={placeholder} value={description} disabled={busy || disabled}
        onChange={event => { setDescription(event.target.value); setError('') }}
        onKeyDown={event => {
          if (event.key !== 'Enter') return
          event.stopPropagation()
          if (event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          if (!event.repeat) void generate()
        }} />
      <div className="campaign-schedule-ai-hint">{hint}</div>
      {error && <div className="campaign-schedule-ai-error" role="alert">{error}</div>}
      <div className="campaign-schedule-ai-actions">
        {busy && <button type="button" className="btn btn-ghost" onClick={cancel}>Hủy yêu cầu</button>}
        <button type="button" className="btn btn-primary" disabled={busy || disabled || !description.trim()} onClick={() => { void generate() }}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Đang xử lý yêu cầu…</> : submitLabel}
        </button>
      </div>
    </div>, document.body)}
  </>
}
