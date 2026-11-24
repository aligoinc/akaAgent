import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, X } from 'lucide-react'
import { CAMPAIGN_FORM_AI_MAX_PROMPT, CAMPAIGN_FORM_AI_TIMEOUT, type CampaignFormAiResult } from '../../../../shared/campaignFormAi'
import type { AkaSettingsChange, AkaSettingsExample } from './akaSettingsChanges'
import './campaignScheduleAi.css'

// "aka Cài đặt" (docs/FB_AI_FILTER_PLAN.md mục 2.2): ô nổi giữ chỗ và cách mở cũ. Box có danh sách ô đã đổi thì điền xong
// ô nổi không tự đóng: hiện các ô đã đổi (cũ → mới), nút Hoàn tác, và đánh dấu "aka điền" lên ô trên form tới khi khách sửa ô đó.
export const AKA_SETTINGS_TITLE = 'aka Cài đặt'
const FIELD_SELECTOR = 'input, select, textarea'
const FILLED_ATTRIBUTE = 'data-aka-filled'
let filledListenerInstalled = false
function ensureFilledListener() {
  if (filledListenerInstalled || typeof document === 'undefined') return
  filledListenerInstalled = true
  // Khách tự sửa ô thì bỏ nhãn "aka điền" của ô đó. React đổi giá trị không phát sự kiện nên lần điền của aka không tự xoá nhãn.
  const clear = (event: Event) => {
    const target = event.target as Element | null
    target?.closest?.(`[${FILLED_ATTRIBUTE}]`)?.removeAttribute(FILLED_ATTRIBUTE)
  }
  document.addEventListener('input', clear, true)
  document.addEventListener('change', clear, true)
}
function readFieldValues(root: ParentNode): Map<Element, string> {
  const values = new Map<Element, string>()
  root.querySelectorAll(FIELD_SELECTOR).forEach(element => {
    const field = element as HTMLInputElement
    values.set(element, field.type === 'checkbox' || field.type === 'radio' ? String(field.checked) : String(field.value ?? ''))
  })
  return values
}
function markChangedFields(before: Map<Element, string>): Element[] {
  const marked = new Set<Element>()
  before.forEach((value, element) => {
    if (!element.isConnected) return
    const field = element as HTMLInputElement
    const now = field.type === 'checkbox' || field.type === 'radio' ? String(field.checked) : String(field.value ?? '')
    if (now === value) return
    const host = element.closest('.stepper-form-group') ?? element.closest('label') ?? element.parentElement
    if (host) marked.add(host)
  })
  marked.forEach(host => host.setAttribute(FILLED_ATTRIBUTE, ''))
  return Array.from(marked)
}

export interface CampaignFormAiProps<Patch> {
  disabled: boolean
  authScope: string
  zIndex?: number
  onBusyChange: (busy: boolean) => void
  /** Form trả về hàm hoàn tác thì ô nổi hiện nút Hoàn tác. */
  onApply: (patch: Patch) => void | (() => void)
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
  /** Câu mẫu "Thử nhanh": bấm vào là điền sẵn ô mô tả. */
  examples?: AkaSettingsExample[]
  /** Có thì điền xong không tự đóng mà hiện danh sách ô đã đổi (tính trước khi điền). */
  describeChanges?: (patch: Patch) => AkaSettingsChange[]
}
interface ResultView { changes: AkaSettingsChange[]; undo?: () => void }

export default function CampaignFormAiPopover<Patch>({ disabled, authScope, zIndex = 3100, onBusyChange, onApply,
  title, closeLabel, label, placeholder, hint, submitLabel, unavailableMessage, generateRequest, cancelRequest,
  examples, describeChanges }: Props<Patch>) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ResultView | null>(null)
  const [undone, setUndone] = useState(false)
  const markedFields = useRef<Element[]>([])
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
  const clearMarks = () => { markedFields.current.forEach(element => element.removeAttribute(FILLED_ATTRIBUTE)); markedFields.current = [] }
  useEffect(() => { if (!open) { setResult(null); setUndone(false) } }, [open])
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
  const undoResult = () => {
    if (!result?.undo) return
    result.undo()
    clearMarks(); setResult(null); setUndone(true)
  }
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
    setError(''); setResult(null); setUndone(false); setBusy(true); onBusyChange(true)
    // Bound the renderer too, so a lost IPC response never leaves the form locked.
    const timer = setTimeout(() => {
      if (flight.current?.id !== requestId) return
      cancelFlight(); setBusy(false); latest.current.onBusyChange(false); setError(unavailableMessage)
    }, CAMPAIGN_FORM_AI_TIMEOUT)
    flight.current = { id: requestId, timer }
    try {
      const result = await generateRequest(requestId, description.trim())
      if (flight.current?.id !== requestId || latest.current.authScope !== scope) return
      if (result.ok) {
        if (!describeChanges) { latest.current.onApply(result.patch); closePopover(); return }
        const changes = describeChanges(result.patch)
        const root = button.current?.closest('.stepper-content') ?? null
        const before = root ? readFieldValues(root) : null
        const undo = latest.current.onApply(result.patch)
        clearMarks()
        if (before && changes.length) {
          ensureFilledListener()
          // Đợi React vẽ lại form rồi mới so giá trị từng ô.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (flight.current) return
            markedFields.current = markChangedFields(before)
          }))
        }
        setResult({ changes, undo: typeof undo === 'function' ? undo : undefined })
      } else if (result.code !== 'cancelled') setError(result.message)
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
      aria-label={title} title={AKA_SETTINGS_TITLE} aria-haspopup="dialog" aria-expanded={open}
      disabled={disabled || busy} onMouseEnter={() => { if (!disabled) openPopover() }}
      onFocus={() => { if (!disabled && !restoringFocus.current) openPopover() }}
      onClick={event => { event.stopPropagation(); openPopover(); requestAnimationFrame(() => textarea.current?.focus()) }}>
      <Sparkles size={15} />
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-label={title} className="campaign-schedule-ai-popover"
      style={{ ...position, zIndex }} onClick={event => event.stopPropagation()}>
      <div className="campaign-schedule-ai-heading">
        <strong id={`${id}-title`}><Sparkles size={15} /> {AKA_SETTINGS_TITLE}</strong>
        <button type="button" className="btn-icon" aria-label={closeLabel} onClick={() => { cancel(); closePopover() }}><X size={16} /></button>
      </div>
      <label htmlFor={`${id}-description`}>{label}</label>
      <textarea ref={textarea} id={`${id}-description`} className="stepper-input" rows={3} maxLength={CAMPAIGN_FORM_AI_MAX_PROMPT}
        placeholder={placeholder} value={description} disabled={busy || disabled}
        onChange={event => { setDescription(event.target.value); setError(''); setUndone(false) }}
        onKeyDown={event => {
          if (event.key !== 'Enter') return
          event.stopPropagation()
          if (event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          if (!event.repeat) void generate()
        }} />
      {examples && examples.length > 0 && <div className="aka-settings-examples">
        <span>Thử nhanh:</span>
        {examples.map(example => <button key={example.label} type="button" className="aka-settings-example" disabled={busy || disabled}
          onClick={() => { setDescription(example.text); setError(''); setUndone(false); textarea.current?.focus() }}>{example.label}</button>)}
      </div>}
      <div className="campaign-schedule-ai-hint">{hint}</div>
      {error && <div className="campaign-schedule-ai-error" role="alert">{error}</div>}
      {result && <div className="aka-settings-result" role="status">
        {result.changes.length > 0 ? <>
          <strong>aka đã điền {result.changes.length} ô</strong>
          <ul className="aka-settings-changes">
            {result.changes.map((change, index) => <li key={`${change.label}-${index}`}>
              <span className="aka-settings-change-label">{change.label}</span>
              <span className="aka-settings-change-values"><span className="aka-settings-change-before">{change.before}</span>
                {' → '}<span className="aka-settings-change-after">{change.after}</span></span>
            </li>)}
          </ul>
        </> : <div>Các ô đã đúng như mô tả, aka không đổi gì.</div>}
      </div>}
      {undone && <div className="campaign-schedule-ai-hint" role="status">Đã hoàn tác, các ô trở lại như trước.</div>}
      <div className="campaign-schedule-ai-actions">
        {busy && <button type="button" className="btn btn-ghost" onClick={cancel}>Hủy yêu cầu</button>}
        {!busy && result?.undo && result.changes.length > 0 && <button type="button" className="btn btn-ghost" onClick={undoResult}>Hoàn tác</button>}
        {!busy && result && <button type="button" className="btn btn-ghost" onClick={() => { setResult(null); closePopover() }}>Xong</button>}
        <button type="button" className="btn btn-primary" disabled={busy || disabled || !description.trim()} onClick={() => { void generate() }}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Đang xử lý yêu cầu…</> : submitLabel}
        </button>
      </div>
    </div>, document.body)}
  </>
}
