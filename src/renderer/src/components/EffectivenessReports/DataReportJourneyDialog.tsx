// Ported from akaAgentWebApp apps/web/src/features/reports (same layout and wording); data comes over IPC.
import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Search, X } from 'lucide-react'
import { buildDataReportJourneyView, type DataReportJourneyView } from '../../../../shared/dataReports'
import { dataReportRequest } from './dataReportApi'

/** Same rule as the API (digits, spaces, "+", ".", "-", "(", ")"; 8-20 characters, at least 9 digits). */
export function isJourneyPhone(value: string): boolean {
  const text = value.trim()
  return /^[0-9+().\s-]{8,20}$/.test(text) && text.replace(/\D/g, '').length >= 9
}

const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
})
const formatDateTime = (value: string) => {
  const time = Date.parse(value)
  return Number.isFinite(time) ? dateTime.format(time) : ''
}

type JourneyState = { status: 'loading' } | { status: 'ready'; view: DataReportJourneyView } | { status: 'error'; message: string }

/**
 * "Hành trình một khách": every time this staff cared for one phone number, newest first, with positive outcomes only.
 * One read per search; closing or searching again aborts the earlier read and ignores its late answer.
 */
export function DataReportJourneyDialog({ phone: initialPhone, onClose }: { phone: string; onClose: () => void }) {
  const [phone, setPhone] = useState(initialPhone)
  const [query, setQuery] = useState(initialPhone)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<JourneyState>({ status: 'loading' })
  const [inputError, setInputError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ status: 'loading' })
    dataReportRequest({ kind: 'journey', phone: query.trim() }, controller.signal)
      .then(journey => { if (active) setState({ status: 'ready', view: buildDataReportJourneyView(journey) }) })
      .catch(error => {
        if (!active || controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Không thể tra hành trình khách.' })
      })
    return () => { active = false; controller.abort() }
  }, [query, revision])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (!isJourneyPhone(phone)) { setInputError('Vui lòng nhập số điện thoại hợp lệ.'); inputRef.current?.focus(); return }
    setInputError(null)
    if (phone.trim() === query.trim()) setRevision(value => value + 1)
    else setQuery(phone.trim())
  }

  const view = state.status === 'ready' ? state.view : null
  const title = useMemo(() => view?.found ? (view.name || view.phone || query) : query, [view, query])

  return <div className="eff-dialog-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="eff-dialog dr-journey" role="dialog" aria-modal="true" aria-labelledby="dr-journey-title">
      <div className="eff-dialog-head">
        <div>
          <h3 id="dr-journey-title"><History size={16} aria-hidden="true" /> Hành trình của khách</h3>
          <span>{title}{view?.found && view.name && view.phone ? ` · ${view.phone}` : ''}</span>
        </div>
        <div className="eff-dialog-actions">
          <form className="dr-journey-search" onSubmit={event => { event.preventDefault(); submit() }}>
            <label className="eff-search">
              <Search size={14} aria-hidden="true" />
              <input ref={inputRef} type="tel" inputMode="tel" value={phone} maxLength={20} aria-label="Số điện thoại"
                aria-invalid={inputError ? true : undefined} onChange={event => { setPhone(event.target.value); setInputError(null) }} />
            </label>
            <button type="submit" className="btn btn-secondary btn-sm">Tra cứu</button>
          </form>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
        </div>
        {inputError && <p className="dr-input-hint" role="alert">{inputError}</p>}
      </div>
      <div className="eff-dialog-body">
        {state.status === 'loading' && <p className="eff-muted" role="status">Đang tra hành trình…</p>}
        {state.status === 'error' && <p role="alert">{state.message} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)}>Thử lại</button></p>}
        {view && !view.found && <div className="dr-journey-empty">
          <p>Số điện thoại này hiện không nằm trong kho dữ liệu của bạn.</p>
          <p className="eff-muted">Thêm số vào nhóm data hoặc chạy chiến dịch tới số này, akaBiz sẽ ghi lại toàn bộ hành trình chăm sóc.</p>
        </div>}
        {view?.found && <>
          {view.summary.length > 0 && <ul className="dr-journey-summary">
            {view.summary.map(item => <li key={item.key}><strong>{item.value}</strong><span>{item.label}</span></li>)}
          </ul>}
          {view.dataGroups.length > 0 && <p className="dr-journey-groups"><span>Nằm trong nhóm data:</span> {view.dataGroups.map(group => group.name || 'Không tên').join(', ')}</p>}
          {view.steps.length > 0 ? <ol className="dr-timeline" aria-label="Các lần chăm sóc, mới nhất trước">
            {view.steps.map(step => <li key={step.id}>
              <time dateTime={step.at}>{formatDateTime(step.at)}</time>
              <div>
                <strong>{step.title}</strong>
                {step.detail && <span>{step.detail}</span>}
              </div>
              {step.outcome && <em>{step.outcome}</em>}
            </li>)}
          </ol> : <p className="eff-muted">Khách này đang nằm trong kho dữ liệu, sẵn sàng cho chiến dịch chăm sóc đầu tiên.</p>}
        </>}
      </div>
    </div>
  </div>
}
