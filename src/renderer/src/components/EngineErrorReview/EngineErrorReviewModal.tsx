import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, SearchX, Undo2, X } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import {
  ENGINE_ERROR_ITEM_PAGE, ENGINE_ERROR_KIND_FILTERS, ENGINE_ERROR_LIST_PAGE, ENGINE_ERROR_NOTE_MAX, ENGINE_ERROR_NOTE_MIN,
  ENGINE_ERROR_REVIEW_MENU_LABEL, ENGINE_ERROR_STATUS_FILTERS,
  engineErrorAppliedNote, engineErrorConclusionLabel, engineErrorConfidenceLabel, engineErrorKindLabel, engineErrorProposalLabel,
  engineErrorReviewMessage, engineErrorStatusLabel,
  type EngineErrorCaseDetail, type EngineErrorCaseResponse, type EngineErrorCaseRow, type EngineErrorDecision, type EngineErrorItem,
  type EngineErrorList, type EngineErrorReviewIpcResult
} from '../../../../shared/engineErrorReview'

interface EngineErrorReviewModalProps {
  onClose: () => void
}

interface Filters {
  q: string
  status: string
  kind: string
  needsReview: boolean
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; list: EngineErrorList }

type DetailState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; detail: EngineErrorCaseDetail; items: EngineErrorItem[]; itemTotal: number }

const formatTime = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}
const formatCount = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const named = (name: string | null, id: number | null): string => (name ? name : id != null ? `#${id}` : '')

/**
 * Tab "Lỗi không xác định" cho admin akaBiz (V588): các ca lỗi bộ kiểm lỗi chiến dịch Facebook gom được, kết luận của Claude,
 * và hai việc chờ duyệt: câu cho khách (duyệt thì ghi vào kết quả chạy và ghi chú data của các lượt thuộc ca) và đề xuất mã lỗi mới
 * (duyệt chỉ ghi quyết định). Chỉ đọc DB khi mở, khi đổi bộ lọc và khi bấm nút; không hẹn giờ.
 */
export default function EngineErrorReviewModal({ onClose }: EngineErrorReviewModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [filters, setFilters] = useState<Filters>({ q: '', status: '', kind: '', needsReview: false })
  const [search, setSearch] = useState('')
  const [listState, setListState] = useState<ListState>({ kind: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<DetailState>({ kind: 'empty' })
  const [noteDraft, setNoteDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)

  const loadList = useCallback((active: Filters) => {
    const current = ++listRequest.current
    setListState({ kind: 'loading' })
    window.electronAPI.engineErrorReviewList({
      q: active.q || undefined, status: active.status || undefined, kind: active.kind || undefined,
      needsReview: active.needsReview, limit: ENGINE_ERROR_LIST_PAGE, offset: 0
    }).then(result => {
      if (current !== listRequest.current) return
      setListState(result.ok ? { kind: 'ready', list: result.data } : { kind: 'error', message: result.message })
    }).catch(() => {
      if (current !== listRequest.current) return
      setListState({ kind: 'error', message: engineErrorReviewMessage('unavailable') })
    })
  }, [])

  const loadDetail = useCallback((caseKey: string) => {
    const current = ++detailRequest.current
    setDetailState({ kind: 'loading' })
    setShowAnswer(false)
    window.electronAPI.engineErrorReviewCase(caseKey, { limit: ENGINE_ERROR_ITEM_PAGE, offset: 0 }).then(result => {
      if (current !== detailRequest.current) return
      if (!result.ok) {
        setDetailState({ kind: 'error', message: result.message })
        return
      }
      setDetailState({ kind: 'ready', detail: result.data.case, items: result.data.items, itemTotal: result.data.itemTotal })
      setNoteDraft(result.data.case.customerNote ?? '')
    }).catch(() => {
      if (current !== detailRequest.current) return
      setDetailState({ kind: 'error', message: engineErrorReviewMessage('unavailable') })
    })
  }, [])

  useEffect(() => {
    loadList(filters)
  }, [filters, loadList])

  useEffect(() => () => {
    listRequest.current++
    detailRequest.current++
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const selectCase = (caseKey: string) => {
    setSelectedKey(caseKey)
    loadDetail(caseKey)
  }

  const loadMoreCases = async () => {
    if (listState.kind !== 'ready' || loadingMore) return
    const current = listRequest.current
    setLoadingMore(true)
    try {
      const result = await window.electronAPI.engineErrorReviewList({
        q: filters.q || undefined, status: filters.status || undefined, kind: filters.kind || undefined,
        needsReview: filters.needsReview, limit: ENGINE_ERROR_LIST_PAGE, offset: listState.list.cases.length
      })
      if (current !== listRequest.current) return
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      const known = new Set(listState.list.cases.map(item => item.caseKey))
      setListState({
        kind: 'ready',
        list: { ...result.data, cases: [...listState.list.cases, ...result.data.cases.filter(item => !known.has(item.caseKey))] }
      })
    } catch {
      showAlert(engineErrorReviewMessage('unavailable'), 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const loadMoreItems = async () => {
    if (detailState.kind !== 'ready' || busy) return
    const current = detailRequest.current
    setBusy(true)
    try {
      const result = await window.electronAPI.engineErrorReviewCase(detailState.detail.caseKey, {
        limit: ENGINE_ERROR_ITEM_PAGE, offset: detailState.items.length
      })
      if (current !== detailRequest.current) return
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      const known = new Set(detailState.items.map(item => item.id))
      setDetailState({
        ...detailState, itemTotal: result.data.itemTotal,
        items: [...detailState.items, ...result.data.items.filter(item => !known.has(item.id))]
      })
    } catch {
      showAlert(engineErrorReviewMessage('unavailable'), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Ghi quyết định rồi cập nhật cả chi tiết lẫn dòng trong danh sách; số "chờ duyệt" tính lại ở lần tải danh sách kế tiếp. */
  const decide = async (run: () => Promise<EngineErrorReviewIpcResult<EngineErrorDecision>>, done: string) => {
    if (busy) return
    const current = detailRequest.current
    setBusy(true)
    try {
      const result = await run()
      if (!result.ok) {
        showAlert(result.message, 'error')
        return
      }
      const decision = result.data
      showAlert(done, 'success')
      setListState(state => state.kind !== 'ready' ? state : {
        kind: 'ready',
        list: {
          ...state.list,
          cases: state.list.cases.map(item => item.caseKey !== decision.caseKey ? item : {
            ...item, status: decision.status, customerNote: decision.customerNote,
            customerNoteStatus: decision.customerNoteStatus, codeProposalStatus: decision.codeProposalStatus
          })
        }
      })
      if (current !== detailRequest.current) return
      setDetailState(state => state.kind !== 'ready' || state.detail.caseKey !== decision.caseKey ? state : {
        ...state,
        detail: {
          ...state.detail, status: decision.status, customerNote: decision.customerNote,
          customerNoteStatus: decision.customerNoteStatus, customerNoteAt: decision.customerNoteAt,
          codeProposalStatus: decision.codeProposalStatus, codeProposalAt: decision.codeProposalAt
        }
      })
      if (decision.customerNote != null) setNoteDraft(decision.customerNote)
    } catch {
      showAlert(engineErrorReviewMessage('unavailable'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const approveNote = (detail: EngineErrorCaseDetail, itemTotal: number) => {
    const note = noteDraft.trim().replace(/\s+/g, ' ')
    if (note.length < ENGINE_ERROR_NOTE_MIN || note.length > ENGINE_ERROR_NOTE_MAX) {
      showAlert(engineErrorReviewMessage('note_length'), 'error')
      return
    }
    showConfirm(
      `Ghi câu này vào kết quả chạy và ghi chú data của ${formatCount(itemTotal)} lượt lỗi thuộc ca? Khách sẽ thấy: "${engineErrorAppliedNote(note, detail.publicCode)}"`,
      () => decide(
        () => window.electronAPI.engineErrorReviewNote(detail.caseKey, 'approve', note),
        'Đã duyệt câu cho khách. Câu sẽ được ghi vào kết quả chạy trong vài phút.'
      )
    )
  }

  const rejectNote = (detail: EngineErrorCaseDetail) => {
    const approved = detail.customerNoteStatus === 'approved'
    const run = () => decide(
      () => window.electronAPI.engineErrorReviewNote(detail.caseKey, 'reject'),
      approved ? 'Đã bỏ duyệt. Các lượt đã ghi sẽ được trả về câu cũ trong vài phút.' : 'Đã bỏ câu đề xuất.'
    )
    if (approved) showConfirm('Bỏ duyệt câu này? Các lượt đã ghi sẽ được trả về câu cũ.', run)
    else void run()
  }

  const list = listState.kind === 'ready' ? listState.list : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal engine-error-modal" role="dialog" aria-modal="true" aria-labelledby="engine-error-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title engine-error-title" id="engine-error-title">
            <SearchX size={17} />
            <span>{ENGINE_ERROR_REVIEW_MENU_LABEL}</span>
            {list && list.needsReview > 0 && <span className="engine-error-chip engine-error-chip-warning">{formatCount(list.needsReview)} ca chờ duyệt</span>}
          </div>
          <button type="button" className="btn-icon" onClick={onClose} title="Đóng">
            <X size={18} />
          </button>
        </div>

        {list && (
          <div className="engine-error-summary">
            <span>Đọc lỗi: <strong>{list.settings.enabled ? 'bật' : 'tắt'}</strong></span>
            <span>Giao việc cho Claude: <strong>{list.settings.enqueue ? 'bật' : 'tắt'}</strong></span>
            <span>Hôm nay đã giao: <strong>{formatCount(list.state.tasksToday)}</strong></span>
            {list.state.lastTickAt && <span>Lượt đọc gần nhất: <strong>{formatTime(list.state.lastTickAt)}</strong></span>}
            {ENGINE_ERROR_STATUS_FILTERS.filter(item => item.value && list.counts[item.value]).map(item => (
              <span key={item.value}>{item.label}: <strong>{formatCount(list.counts[item.value])}</strong></span>
            ))}
            {list.state.lastError && <span className="engine-error-summary-error">Lượt đọc gần nhất bị lỗi: {list.state.lastError}</span>}
          </div>
        )}

        <div className="engine-error-layout">
          <div className="engine-error-list-pane">
            <form
              className="engine-error-filters"
              onSubmit={event => {
                event.preventDefault()
                setFilters(current => ({ ...current, q: search.trim() }))
              }}
            >
              <input
                className="panel-input" value={search} onChange={event => setSearch(event.target.value)}
                placeholder="Tìm theo mã hoặc câu lỗi rồi Enter" aria-label="Tìm ca lỗi"
              />
              <div className="engine-error-filter-row">
                <select className="panel-input" value={filters.status} aria-label="Trạng thái" onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}>
                  {ENGINE_ERROR_STATUS_FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <select className="panel-input" value={filters.kind} aria-label="Loại ca" onChange={event => setFilters(current => ({ ...current, kind: event.target.value }))}>
                  {ENGINE_ERROR_KIND_FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div className="engine-error-filter-row">
                <label className="engine-error-check">
                  <input type="checkbox" checked={filters.needsReview} onChange={event => setFilters(current => ({ ...current, needsReview: event.target.checked }))} />
                  <span>Chỉ ca chờ duyệt</span>
                </label>
                <button type="button" className="btn btn-ghost btn-sm engine-error-inline-button" onClick={() => loadList(filters)} disabled={listState.kind === 'loading'}>
                  <RefreshCw size={13} className={listState.kind === 'loading' ? 'animate-spin' : undefined} /><span>Tải lại</span>
                </button>
              </div>
            </form>

            <div className="engine-error-cases">
              {listState.kind === 'loading' && <div className="engine-error-state">Đang tải danh sách ca lỗi...</div>}
              {listState.kind === 'error' && (
                <div className="engine-error-state">
                  <p>{listState.message}</p>
                  <button type="button" className="btn btn-secondary btn-sm engine-error-inline-button" onClick={() => loadList(filters)}>
                    <RefreshCw size={13} /><span>Thử lại</span>
                  </button>
                </div>
              )}
              {list && list.cases.length === 0 && <div className="engine-error-state">Không có ca lỗi nào khớp bộ lọc.</div>}
              {list && list.cases.map(item => (
                <CaseRow key={item.caseKey} item={item} selected={item.caseKey === selectedKey} onSelect={() => selectCase(item.caseKey)} />
              ))}
              {list && list.cases.length < list.total && (
                <button type="button" className="btn btn-ghost btn-sm engine-error-more" onClick={loadMoreCases} disabled={loadingMore}>
                  {loadingMore ? 'Đang tải...' : `Tải thêm (còn ${formatCount(list.total - list.cases.length)} ca)`}
                </button>
              )}
            </div>
          </div>

          <div className="engine-error-detail-pane">
            {detailState.kind === 'empty' && <div className="engine-error-state">Chọn một ca lỗi ở bên trái để xem chi tiết.</div>}
            {detailState.kind === 'loading' && <div className="engine-error-state">Đang tải chi tiết ca lỗi...</div>}
            {detailState.kind === 'error' && (
              <div className="engine-error-state">
                <p>{detailState.message}</p>
                {selectedKey && (
                  <button type="button" className="btn btn-secondary btn-sm engine-error-inline-button" onClick={() => loadDetail(selectedKey)}>
                    <RefreshCw size={13} /><span>Thử lại</span>
                  </button>
                )}
              </div>
            )}
            {detailState.kind === 'ready' && (
              <CaseDetail
                data={{ case: detailState.detail, items: detailState.items, itemTotal: detailState.itemTotal }}
                noteDraft={noteDraft}
                onNoteDraft={setNoteDraft}
                busy={busy}
                showAnswer={showAnswer}
                onToggleAnswer={() => setShowAnswer(current => !current)}
                onApproveNote={() => approveNote(detailState.detail, detailState.itemTotal)}
                onRejectNote={() => rejectNote(detailState.detail)}
                onCode={decision => decide(
                  () => window.electronAPI.engineErrorReviewCode(detailState.detail.caseKey, decision),
                  decision === 'approve' ? 'Đã duyệt đề xuất mã lỗi.' : 'Đã bỏ đề xuất mã lỗi.'
                )}
                onMark={status => decide(
                  () => window.electronAPI.engineErrorReviewMark(detailState.detail.caseKey, status),
                  status === 'known' ? 'Đã đánh dấu ca này là đã biết.' : 'Đã mở lại ca này.'
                )}
                onLoadMoreItems={loadMoreItems}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CaseRow({ item, selected, onSelect }: { item: EngineErrorCaseRow; selected: boolean; onSelect: () => void }) {
  const waiting = item.customerNoteStatus === 'proposed' || item.codeProposalStatus === 'proposed'
  return (
    <button type="button" className={`engine-error-case${selected ? ' selected' : ''}`} onClick={onSelect}>
      <div className="engine-error-case-top">
        <strong>{item.publicCode || item.errorCode || 'Không mã'}</strong>
        <span className="engine-error-chip">{engineErrorStatusLabel(item.status)}</span>
        {waiting && <span className="engine-error-chip engine-error-chip-warning">Chờ duyệt</span>}
        <span className="engine-error-case-time">{formatTime(item.lastSeenAt)}</span>
      </div>
      <div className="engine-error-case-pattern">{item.pattern || engineErrorKindLabel(item.kind)}</div>
      <div className="engine-error-case-meta">
        {[item.actionCode, item.step].filter(Boolean).join(' · ') || engineErrorKindLabel(item.kind)}
        {` · ${formatCount(item.hits)} lượt`}
        {item.pauses > 0 ? ` · dừng ${formatCount(item.pauses)} chiến dịch` : ''}
        {item.organizationCount > 0 ? ` · ${formatCount(item.organizationCount)} tổ chức` : ''}
      </div>
      {item.conclusion && <div className="engine-error-case-conclusion">{engineErrorConclusionLabel(item.conclusion)}</div>}
    </button>
  )
}

interface CaseDetailProps {
  data: EngineErrorCaseResponse
  noteDraft: string
  onNoteDraft: (value: string) => void
  busy: boolean
  showAnswer: boolean
  onToggleAnswer: () => void
  onApproveNote: () => void
  onRejectNote: () => void
  onCode: (decision: 'approve' | 'reject') => void
  onMark: (status: 'known' | 'new') => void
  onLoadMoreItems: () => void
}

function CaseDetail({
  data, noteDraft, onNoteDraft, busy, showAnswer, onToggleAnswer, onApproveNote, onRejectNote, onCode, onMark, onLoadMoreItems
}: CaseDetailProps) {
  const { case: detail, items, itemTotal } = data
  const draft = noteDraft.trim().replace(/\s+/g, ' ')
  const noteApproved = detail.customerNoteStatus === 'approved'
  const noteChanged = draft !== (detail.customerNote ?? '')
  const confidence = engineErrorConfidenceLabel(detail.confidence)
  const proposal = detail.codeProposal

  return (
    <div className="engine-error-detail">
      <section className="engine-error-section">
        <div className="engine-error-detail-head">
          <strong>{detail.publicCode || detail.errorCode || 'Không mã'}</strong>
          <span className="engine-error-chip">{engineErrorKindLabel(detail.kind)}</span>
          <span className="engine-error-chip">{engineErrorStatusLabel(detail.status)}</span>
          <span className="engine-error-detail-actions">
            {detail.status === 'known'
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMark('new')} disabled={busy}>Mở lại ca</button>
              : <button type="button" className="btn btn-ghost btn-sm" onClick={() => onMark('known')} disabled={busy || detail.status === 'queued'}>Đánh dấu đã biết</button>}
          </span>
        </div>
        <div className="engine-error-pattern">{detail.pattern || 'Không có câu lỗi'}</div>
        <div className="engine-error-facts">
          {detail.errorCode && <span>Mã nội bộ: <code>{detail.errorCode}</code></span>}
          {detail.actionCode && <span>Thao tác: <code>{detail.actionCode}</code></span>}
          {detail.step && <span>Bước: <code>{detail.step}</code></span>}
          <span>{formatCount(detail.hits)} lượt lỗi</span>
          {detail.pauses > 0 && <span>Dừng {formatCount(detail.pauses)} chiến dịch</span>}
          <span>Từ {formatTime(detail.firstSeenAt)} đến {formatTime(detail.lastSeenAt)}</span>
        </div>
      </section>

      <section className="engine-error-section">
        <h3 className="engine-error-heading">Kết luận của Claude</h3>
        {detail.reportAt ? (
          <>
            <div className="engine-error-facts">
              <span><strong>{engineErrorConclusionLabel(detail.conclusion)}</strong></span>
              {confidence && <span>Độ chắc: {confidence}</span>}
              <span>Báo cáo lúc {formatTime(detail.reportAt)}</span>
            </div>
            {detail.summary && <p className="engine-error-text">{detail.summary}</p>}
            {detail.answer && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleAnswer}>{showAnswer ? 'Ẩn báo cáo đầy đủ' : 'Xem báo cáo đầy đủ'}</button>
                {showAnswer && <pre className="engine-error-answer">{detail.answer}</pre>}
              </>
            )}
          </>
        ) : (
          <p className="engine-error-text engine-error-muted">
            {detail.status === 'queued' ? 'Ca này đang chờ Claude kiểm.' : detail.status === 'failed' ? 'Claude chưa trả lời kịp cho ca này.' : 'Ca này chưa được giao cho Claude.'}
          </p>
        )}
      </section>

      <section className="engine-error-section">
        <h3 className="engine-error-heading">
          Câu cho khách
          <span className={`engine-error-chip${detail.customerNoteStatus === 'proposed' ? ' engine-error-chip-warning' : noteApproved ? ' engine-error-chip-success' : ''}`}>
            {engineErrorProposalLabel(detail.customerNoteStatus)}
          </span>
        </h3>
        <p className="engine-error-text engine-error-muted">
          Sau khi duyệt, câu này thay câu lỗi trong kết quả chạy và ghi chú data của các lượt thuộc ca. Bỏ duyệt thì các lượt được trả về câu cũ.
        </p>
        <textarea
          className="panel-input engine-error-note" rows={2} maxLength={ENGINE_ERROR_NOTE_MAX * 2} value={noteDraft}
          onChange={event => onNoteDraft(event.target.value)} placeholder="Nhập câu ngắn, dễ hiểu cho khách (5 đến 200 ký tự)" aria-label="Câu cho khách"
        />
        <div className="engine-error-note-foot">
          <span className="engine-error-muted">
            {draft ? `Khách sẽ thấy: ${engineErrorAppliedNote(draft, detail.publicCode)}` : 'Chưa có câu.'}
          </span>
          <span className={draft.length > ENGINE_ERROR_NOTE_MAX ? 'engine-error-over' : 'engine-error-muted'}>{draft.length}/{ENGINE_ERROR_NOTE_MAX}</span>
        </div>
        <div className="engine-error-buttons">
          <button
            type="button" className="btn btn-primary btn-sm engine-error-inline-button" onClick={onApproveNote}
            disabled={busy || draft.length < ENGINE_ERROR_NOTE_MIN || draft.length > ENGINE_ERROR_NOTE_MAX || (noteApproved && !noteChanged)}
          >
            <Check size={13} /><span>{noteApproved ? 'Duyệt câu đã sửa' : 'Duyệt và ghi'}</span>
          </button>
          {(detail.customerNoteStatus === 'proposed' || noteApproved) && (
            <button type="button" className="btn btn-secondary btn-sm engine-error-inline-button" onClick={onRejectNote} disabled={busy}>
              <Undo2 size={13} /><span>{noteApproved ? 'Bỏ duyệt' : 'Bỏ câu này'}</span>
            </button>
          )}
          {detail.customerNoteAt && <span className="engine-error-muted">Quyết định lúc {formatTime(detail.customerNoteAt)}</span>}
        </div>
      </section>

      {proposal && (
        <section className="engine-error-section">
          <h3 className="engine-error-heading">
            Đề xuất mã lỗi mới
            <span className={`engine-error-chip${detail.codeProposalStatus === 'proposed' ? ' engine-error-chip-warning' : detail.codeProposalStatus === 'approved' ? ' engine-error-chip-success' : ''}`}>
              {engineErrorProposalLabel(detail.codeProposalStatus)}
            </span>
          </h3>
          <dl className="engine-error-proposal">
            {proposal.tenLoi && <><dt>Tên lỗi</dt><dd>{proposal.tenLoi}</dd></>}
            {proposal.cauChoKhach && <><dt>Câu cho khách</dt><dd>{proposal.cauChoKhach}</dd></>}
            {proposal.buocTiepTheo && <><dt>Bước tiếp theo</dt><dd>{proposal.buocTiepTheo}</dd></>}
            {proposal.cachXuLy && <><dt>Cách xử lý</dt><dd>{proposal.cachXuLy}</dd></>}
            {proposal.dauHieu && <><dt>Dấu hiệu nhận dạng</dt><dd>{proposal.dauHieu}</dd></>}
          </dl>
          <p className="engine-error-text engine-error-muted">
            Duyệt ở đây chỉ ghi lại quyết định. Mã mới được thêm vào bảng mã lỗi ở bước sau, không tự động.
          </p>
          {detail.codeProposalStatus !== 'applied' && (
            <div className="engine-error-buttons">
              <button type="button" className="btn btn-primary btn-sm engine-error-inline-button" onClick={() => onCode('approve')} disabled={busy || detail.codeProposalStatus === 'approved'}>
                <Check size={13} /><span>Duyệt đề xuất</span>
              </button>
              <button type="button" className="btn btn-secondary btn-sm engine-error-inline-button" onClick={() => onCode('reject')} disabled={busy || detail.codeProposalStatus === 'rejected'}>
                <Undo2 size={13} /><span>Bỏ đề xuất</span>
              </button>
              {detail.codeProposalAt && <span className="engine-error-muted">Quyết định lúc {formatTime(detail.codeProposalAt)}</span>}
            </div>
          )}
        </section>
      )}

      <section className="engine-error-section">
        <h3 className="engine-error-heading">Các lượt lỗi ({formatCount(itemTotal)})</h3>
        {items.length === 0 ? (
          <p className="engine-error-text engine-error-muted">Chưa có lượt nào được ghi cho ca này (chỉ giữ các lượt trong 30 ngày gần nhất).</p>
        ) : (
          <div className="engine-error-table-wrap">
            <table className="engine-error-table">
              <thead>
                <tr><th>Lúc</th><th>Khách hàng</th><th>Tài khoản</th><th>Chiến dịch</th><th>Data</th><th>Câu lỗi</th><th>Đã ghi câu</th></tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>{formatTime(item.occurredAt)}</td>
                    <td>
                      <div>{named(item.organizationName, item.organizationId)}</div>
                      <div className="engine-error-muted">{named(item.staffName, item.staffId)}</div>
                    </td>
                    <td>{named(item.accountName, item.accountId)}</td>
                    <td>
                      <div>{named(item.campaignName, item.campaignId)}</div>
                      {item.campaignId != null && item.campaignName && <div className="engine-error-muted">#{item.campaignId}</div>}
                    </td>
                    <td>{named(item.dataName, item.inputDataId)}</td>
                    <td className="engine-error-message">{item.message}</td>
                    <td>{item.noteAppliedAt ? formatTime(item.noteAppliedAt) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length < itemTotal && (
          <button type="button" className="btn btn-ghost btn-sm engine-error-more" onClick={onLoadMoreItems} disabled={busy}>
            Tải thêm (còn {formatCount(itemTotal - items.length)} lượt)
          </button>
        )}
      </section>
    </div>
  )
}
