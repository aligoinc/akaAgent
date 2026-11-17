import { ChevronDown, History } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import {
  CAMPAIGN_RESULT_RECIPIENT_HISTORY_LIMIT, CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE, CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE, campaignResultCells,
  campaignResultColumnCodes, campaignResultColumnName, campaignResultIdentityColumns, campaignResultRecipientTruncated, campaignResultText,
  type CampaignResultActionOption, type CampaignResultRecipient, type CampaignResultRecipientPage, type CampaignResultRecipientResult
} from '../../../../../shared/campaignResultActions'
import type { CampaignResultRecipientIpcQuery } from '../../../../../shared/campaignResultActionsIpc'
import './CampaignResults.css'

/** Dưới bề rộng này (khung chi tiết hẹp) mỗi data là một thẻ. */
const NARROW_WIDTH = 640

export interface CampaignResultMergedState { total: number; loading: boolean; failed: boolean }

function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? Number.POSITIVE_INFINITY))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

interface Display {
  /** Màu chữ của trạng thái khi danh mục không có màu (cùng hàm của tab Kết quả chạy/Data ban đầu). */
  statusColor(status: string): string
  formatTime(value: string | null | undefined): string
}

function ResultStatus({ result, display }: { result: CampaignResultRecipientResult; display: Display }) {
  const text = campaignResultText(result)
  const style: CSSProperties = { color: result.statusPresentation?.color || display.statusColor(result.status) }
  return <span className="crm-status">
    <span className="crm-status-name" style={style}>{text.status}</span>
    {text.subStatus && <span className="crm-substatus" style={{ color: result.subStatusPresentation?.color || undefined }}>{text.subStatus}</span>}
    {text.stageLabel && text.stageLabel.toLowerCase() !== text.status.toLowerCase() && <span className={`crm-stage is-${text.stage}`}>{text.stageLabel}</span>}
  </span>
}

function ResultCell({ latest, older, expanded, onToggle, actionName, display }: {
  latest: CampaignResultRecipientResult
  older: CampaignResultRecipientResult[]
  expanded: boolean
  onToggle(): void
  actionName: string
  display: Display
}) {
  const note = campaignResultText(latest).note
  return <div className="crm-cell">
    <ResultStatus result={latest} display={display} />
    <span className="crm-time">{display.formatTime(latest.createdAt)}</span>
    {note && <span className="crm-note" title={note}>{note}</span>}
    {older.length > 0 && <button type="button" className="crm-older-toggle" aria-expanded={expanded} onClick={onToggle}
      aria-label={`${expanded ? 'Ẩn' : 'Xem'} ${older.length} lượt ${actionName} trước`}>
      <History size={13} aria-hidden="true" />{expanded ? 'Ẩn lượt trước' : `+${older.length} lượt trước`}
    </button>}
    {expanded && <ol className="crm-older">{older.map(result => {
      const olderNote = campaignResultText(result).note
      return <li key={result.id}>
        <div className="crm-older-head"><ResultStatus result={result} display={display} /><span className="crm-time">{display.formatTime(result.createdAt)}</span></div>
        {olderNote && <div className="crm-note" title={olderNote}>{olderNote}</div>}
      </li>
    })}</ol>}
  </div>
}

type Load = { status: 'loading' } | { status: 'ready'; data: CampaignResultRecipientPage } | { status: 'error'; message: string }

/**
 * "Gộp hành động vào một dòng" (Desktop, cùng luật WebApp): mỗi data một dòng, mỗi hành động một cột (trạng thái, thời
 * gian, ghi chú của lượt mới nhất; các lượt trước mở tại chỗ). Một lượt đọc mỗi trang 100 data, chỉ khi tab hiện; đổi bộ
 * lọc về trang 1; giữ trang cũ trên màn hình trong lúc đọc trang mới. Khung hẹp hơn 640 px thì thành thẻ. Bộ lọc, sắp
 * xếp và Xuất Excel nằm ở thanh lọc của CampaignPanel.
 */
export function CampaignResultMergedView({ campaignId, actionId, platform, active, query, reloadKey, actions, hasFilters, onState, statusColor, formatTime }: {
  campaignId: number
  actionId: string
  platform: string
  active: boolean
  query: CampaignResultRecipientIpcQuery
  reloadKey: number
  actions: readonly CampaignResultActionOption[] | null
  hasFilters: boolean
  onState(state: CampaignResultMergedState): void
  statusColor(status: string): string
  formatTime(value: string | null | undefined): string
}) {
  const queryKey = JSON.stringify(query)
  const [page, setPage] = useState(1)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [last, setLast] = useState<CampaignResultRecipientPage | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [retry, setRetry] = useState(0)
  const lastQueryKey = useRef(queryKey)
  if (lastQueryKey.current !== queryKey) {
    lastQueryKey.current = queryKey
    if (page !== 1) setPage(1)
  }

  useEffect(() => {
    if (!active || !window.electronAPI?.campaignResultActions) return
    let current = true
    setLoad({ status: 'loading' })
    window.electronAPI.campaignResultActions({ kind: 'page', campaignId, query: JSON.parse(queryKey), page, pageSize: CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE })
      .then(result => {
        if (!current) return
        if (result.ok) { setLoad({ status: 'ready', data: result.data }); setLast(result.data) }
        else setLoad({ status: 'error', message: result.message || CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE })
      })
      .catch(() => { if (current) setLoad({ status: 'error', message: CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE }) })
    return () => { current = false }
  }, [active, campaignId, queryKey, page, reloadKey, retry])

  const shown = load.status === 'ready' ? load.data : last
  const items = shown?.items ?? []
  const total = shown?.total ?? 0
  const pending = load.status === 'loading'
  const failed = load.status === 'error'
  const pageCount = Math.max(1, Math.ceil(total / CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  useEffect(() => { if (load.status === 'ready' && page > pageCount) setPage(pageCount) }, [load.status, page, pageCount])
  useEffect(() => setExpanded(new Set()), [queryKey, page])
  useEffect(() => onState({ total, loading: pending, failed }), [onState, total, pending, failed])

  const root = useRef<HTMLDivElement>(null)
  const narrow = useElementWidth(root) < NARROW_WIDTH
  const options = useMemo(() => actions ?? [], [actions])
  const codes = useMemo(() => campaignResultColumnCodes(options, items), [options, items])
  const identity = campaignResultIdentityColumns(actionId, platform)
  const optionByCode = new Map(options.map(option => [option.code, option]))
  const name = (code: string) => campaignResultColumnName(code, options, items)
  const display: Display = { statusColor, formatTime }
  const toggle = (key: string) => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const identityText = (recipient: CampaignResultRecipient) => identity.map(column => recipient[column.key]).filter(Boolean).join(' · ')
  const truncatedNote = (recipient: CampaignResultRecipient) => campaignResultRecipientTruncated(recipient)
    ? `${recipient.resultCount.toLocaleString('vi-VN')} lượt · hiện ${CAMPAIGN_RESULT_RECIPIENT_HISTORY_LIMIT} lượt mới nhất` : null
  const recipientStatus = (recipient: CampaignResultRecipient) => recipient.status
    ? <span className="crm-recipient-status" style={{ color: statusColor(recipient.status) }}>{recipient.status}</span> : null

  const from = total === 0 ? 0 : (currentPage - 1) * CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE + 1
  const to = total === 0 ? 0 : from + items.length - 1

  let body: ReactNode
  if (!shown && pending) body = <div className="text-center text-secondary" style={{ padding: 16 }}>Đang gộp kết quả theo data…</div>
  else if (failed) {
    body = <div className="crm-error" role="alert">
      <span>{load.message}</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Thử lại</button>
    </div>
  } else if (items.length === 0) {
    body = <div className="text-center text-muted" style={{ padding: 16, fontSize: 12 }}>{hasFilters ? 'Không có data phù hợp bộ lọc' : 'Chiến dịch chưa có data'}</div>
  } else if (narrow) {
    body = <ol className="crm-cards" aria-label="Kết quả theo data">{items.map(recipient => {
      const cells = campaignResultCells(recipient, codes)
      const done = codes.filter(code => cells.get(code)?.latest)
      const missing = codes.filter(code => !cells.get(code)?.latest)
      const note = truncatedNote(recipient)
      return <li key={recipient.id} className="crm-card">
        <div className="crm-card-head">
          <div className="crm-recipient"><strong>{recipient.name || '—'}</strong>{identityText(recipient) && <span>{identityText(recipient)}</span>}{note && <span className="crm-truncated">{note}</span>}</div>
          {recipientStatus(recipient)}
        </div>
        {done.length > 0 && <ul className="crm-card-actions">{done.map(code => {
          const cell = cells.get(code)!
          const key = `${recipient.id}:${code}`
          return <li key={code || '__none__'}>
            <span className="crm-card-action">{name(code)}</span>
            <ResultCell latest={cell.latest!} older={cell.older} expanded={expanded.has(key)} onToggle={() => toggle(key)} actionName={name(code)} display={display} />
          </li>
        })}</ul>}
        {missing.length > 0 && <p className="crm-card-missing">Chưa có lượt: {missing.map(name).join(', ')}</p>}
      </li>
    })}</ol>
  } else {
    body = <div className="crm-table-scroll">
      <table className="campaign-grid crm-table" style={{ fontSize: 12 }}>
        <thead><tr>
          <th scope="col" className="crm-recipient-col">Data</th>
          {codes.map(code => {
            const option = optionByCode.get(code)
            return <th scope="col" key={code || '__none__'}>
              <span className="crm-col-name">{name(code)}{option && !option.configured && code && <span className="result-action-badge">Không còn bật</span>}</span>
              {option && <span className="crm-col-sub">{option.count ? `${option.count.toLocaleString('vi-VN')} lượt` : 'Chưa có lượt'}</span>}
            </th>
          })}
        </tr></thead>
        <tbody>{items.map(recipient => {
          const cells = campaignResultCells(recipient, codes)
          const note = truncatedNote(recipient)
          return <tr key={recipient.id}>
            <th scope="row" className="crm-recipient-col">
              <div className="crm-recipient"><strong>{recipient.name || '—'}</strong>{identityText(recipient) && <span>{identityText(recipient)}</span>}</div>
              {recipientStatus(recipient)}
              {note && <span className="crm-truncated">{note}</span>}
            </th>
            {codes.map(code => {
              const cell = cells.get(code)
              const key = `${recipient.id}:${code}`
              return <td key={code || '__none__'}>{cell?.latest
                ? <ResultCell latest={cell.latest} older={cell.older} expanded={expanded.has(key)} onToggle={() => toggle(key)} actionName={name(code)} display={display} />
                : <span className="crm-none" aria-label="Chưa có lượt">—</span>}</td>
            })}
          </tr>
        })}</tbody>
      </table>
    </div>
  }

  return <div className={`crm-view${narrow ? ' is-narrow' : ''}${pending && shown ? ' is-refreshing' : ''}`} ref={root}>
    {body}
    {!failed && shown && <div className="campaign-input-data-pager">
      <span>{total > 0 ? `Hiển thị ${from}–${to} / ${total.toLocaleString('vi-VN')} data` : 'Không có dữ liệu'}</span>
      <div>
        <button type="button" className="btn-icon" aria-label="Trang trước" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={currentPage <= 1 || pending}><ChevronDown size={14} style={{ transform: 'rotate(90deg)' }} /></button>
        <span>Trang {currentPage}/{pageCount}</span>
        <button type="button" className="btn-icon" aria-label="Trang sau" onClick={() => setPage(value => Math.min(pageCount, value + 1))} disabled={currentPage >= pageCount || pending}><ChevronDown size={14} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>
    </div>}
    <p className="crm-footnote">Lượt của data đã xóa khỏi danh sách chỉ có ở chế độ Tất cả.</p>
  </div>
}
