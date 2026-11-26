import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS, campaignSheetSyncEndDates, campaignSheetSyncReasonText, campaignSheetSyncStatusLabel,
  formatCampaignSheetSyncDate, validateCampaignSheetSyncSchedule,
  type CampaignSheetSyncRun, type CampaignSheetSyncSource
} from '../../../../shared/campaignSheetSync'
import { buildCampaignSheetSyncConfig, campaignSheetSyncValues } from '../../../../shared/campaignSheetSyncRows'
import { detectImportColumns, mapImportTable, verifyImportRows } from '../../../../shared/campaignImportVerification'
import type { CampaignImportPlatform } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'
import './CampaignSheetSync.css'

interface Props {
  campaignId: number
  campaignName?: string
  /** Gọi sau khi tắt / bật để danh sách chiến dịch cập nhật biểu tượng. */
  onChanged?: () => void
}

const formatTime = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  const parts = new Map(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit',
    month: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.get('hour')}:${parts.get('minute')} ${parts.get('day')}/${parts.get('month')}`
}
const shortLink = (url: string): string => url.replace(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/, 'docs.google.com/…/$1…')
const tone = (source: CampaignSheetSyncSource, active: boolean): '' | 'on' | 'warn' | 'danger' =>
  !active ? '' : source.status === 'error' ? 'danger' : source.status === 'retry' ? 'warn' : source.isEnabled ? 'on' : ''

function runText(run: CampaignSheetSyncRun): { text: string; bad?: boolean } {
  if (run.kind === 'run') {
    if (run.status === 'running') return { text: 'Đang đồng bộ' }
    if (run.status === 'interrupted') return { text: 'Bị gián đoạn, lượt sau đọc lại' }
    if (run.status === 'error') return { text: run.errorMessage || 'Không đọc được Sheet', bad: true }
    return { text: run.added ? `Thành công · ${run.added} dòng mới${run.duplicates ? `, ${run.duplicates} trùng đã bỏ` : ''}` : 'Không có dòng mới' }
  }
  if (run.kind === 'enable') return { text: 'Bật đồng bộ' }
  if (run.kind === 'edit') return { text: 'Sửa cài đặt đồng bộ' }
  if (run.kind === 'disable') return { text: 'Tắt đồng bộ' }
  if (run.kind === 'resume') return { text: 'Bật lại đồng bộ' }
  if (run.kind === 'campaign_left') return { text: 'Có chiến dịch rời nguồn đồng bộ' }
  return { text: campaignSheetSyncReasonText(run.errorCode) || run.errorMessage || 'Hệ thống dừng đồng bộ', bad: true }
}

/** Thẻ "Đồng bộ Google Sheet" trong chi tiết chiến dịch (V662). Không có nguồn thì không vẽ gì. Đọc khi mở, không poll. */
export function CampaignSheetSyncCard({ campaignId, campaignName, onChanged }: Props) {
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const [source, setSource] = useState<CampaignSheetSyncSource | null>(null)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [hours, setHours] = useState(6)
  const [endDate, setEndDate] = useState('')
  const [runs, setRuns] = useState<CampaignSheetSyncRun[] | null>(null)

  const load = useCallback(async () => {
    const result = await window.electronAPI.campaignSheetSyncCall<{ sync: CampaignSheetSyncSource | null; active?: boolean }>({ action: 'state', campaignId })
    if (!result.ok) { setSource(null); return }
    setSource(result.data.sync)
    setActive(Boolean(result.data.active))
  }, [campaignId])

  useEffect(() => {
    setSource(null); setRuns(null); setEditing(false)
    void load().catch(() => setSource(null))
  }, [load])

  if (!source) return null

  const run = async (request: Parameters<typeof window.electronAPI.campaignSheetSyncCall>[0], success?: string) => {
    setBusy(true)
    try {
      const result = await window.electronAPI.campaignSheetSyncCall<{ sync: CampaignSheetSyncSource }>(request)
      if (!result.ok) { showAlert(result.message, 'error'); return false }
      setSource(result.data.sync)
      setActive(result.data.sync.campaignIds.includes(campaignId))
      setEditing(false)
      if (runs) setRuns(null)
      if (success) showAlert(success, 'success')
      onChanged?.()
      return true
    } finally { setBusy(false) }
  }

  const stop = () => showConfirm(
    `Dòng mới trong Sheet sẽ không được thêm vào chiến dịch${campaignName ? ` "${campaignName}"` : ''} nữa. Data đã thêm vẫn giữ nguyên và chiến dịch vẫn chạy.`,
    async () => { await run({ action: 'stop', syncId: source.id, campaignId }, 'Đã tắt đồng bộ. Data đã thêm vẫn được giữ.') },
    { title: 'Tắt đồng bộ Google Sheet?', confirmText: 'Tắt đồng bộ', cancelText: 'Giữ đồng bộ', variant: 'danger' }
  )

  const saveSchedule = () => {
    const error = validateCampaignSheetSyncSchedule(hours, endDate)
    if (error) { showAlert(error, 'error'); return }
    if (!active || !source.isEnabled) {
      void run({ action: 'resume', syncId: source.id, campaignId, endDate }, 'Đã bật lại đồng bộ.')
      return
    }
    void run({ action: 'save', syncId: source.id, expectedRevision: source.revision, everyHours: hours, endDate, splitMode: source.splitMode },
      'Đã lưu cài đặt đồng bộ.')
  }

  // Kết nối lại khi cột / quyền của Sheet đổi: đọc Sheet như cửa sổ Upload, tự nhận cột, các dòng hiện có làm mốc.
  const reconnect = async () => {
    setBusy(true)
    try {
      const platform = source.config.platform as CampaignImportPlatform
      const tables = await window.electronAPI.loadCampaignDataFromSheet({ linkSheet: source.config.url, platform, actionId: source.actionId, responseMode: 'source' })
      const table = tables.tables[0]
      if (!table) throw new Error('Sheet không có dữ liệu.')
      const detected = detectImportColumns(table, platform, source.actionId)
      const config = buildCampaignSheetSyncConfig({ link: source.config.url, table, mapping: detected.mapping, skipHeader: detected.hasHeader,
        phonePolicy: source.config.phonePolicy, platform, actionId: source.actionId })
      if (!config) throw new Error('Không nhận ra cột dữ liệu chính trong Sheet. Hãy thêm dòng tiêu đề rõ ràng (ví dụ "SĐT", "UID", "Email").')
      const report = verifyImportRows(mapImportTable(table, config.mapping, config.hasHeader ? 1 : 0, 'Google Sheet'),
        { platform, actionId: source.actionId, kind: 'sheet', phonePolicy: config.phonePolicy })
      setBusy(false)
      showConfirm(
        `Đã đọc ${report.sourceRowCount.toLocaleString('vi-VN')} dòng. Các dòng đang có trong Sheet được coi là đã xử lý, chỉ dòng thêm sau lúc này mới vào chiến dịch.`,
        async () => {
          await run({ action: 'save', syncId: source.id, expectedRevision: source.revision, config, everyHours: source.everyHours,
            endDate: source.endDate, splitMode: source.splitMode, sheetValues: campaignSheetSyncValues(report) }, 'Đã kết nối lại Sheet.')
        },
        { title: 'Kết nối lại Google Sheet', confirmText: 'Kết nối lại', cancelText: 'Hủy' }
      )
    } catch (error) {
      setBusy(false)
      showAlert(error instanceof Error ? error.message : 'Không đọc được Sheet.', 'error')
    }
  }

  const toggleRuns = async () => {
    if (runs) { setRuns(null); return }
    const result = await window.electronAPI.campaignSheetSyncCall<{ runs: CampaignSheetSyncRun[] }>({ action: 'runs', syncId: source.id })
    if (result.ok) setRuns(result.data.runs)
    else showAlert(result.message, 'error')
  }

  const kind = tone(source, active)
  const reason = !active
    ? campaignSheetSyncReasonText(source.campaigns.find(item => item.campaignId === campaignId)?.leftReason || source.stoppedReason)
    : source.status === 'retry'
      ? `Không đọc được Sheet lúc ${formatTime(source.lastRunAt)}. Hệ thống sẽ thử lại lúc ${formatTime(source.nextRunAt)}.`
      : source.status === 'error' || source.status === 'expired' || source.status === 'paused'
        ? campaignSheetSyncReasonText(source.stoppedReason || source.lastErrorCode) || source.lastErrorMessage || ''
        : ''
  const needsReconnect = source.status === 'error' && ['sheet_columns_changed', 'sheet_config', 'sheet_read_blocked', 'sheet_too_large']
    .includes(source.stoppedReason || source.lastErrorCode || '')
  const canResume = !needsReconnect && (!active || !source.isEnabled)
  const added = source.campaigns.find(item => item.campaignId === campaignId)?.added ?? 0
  const { minDate, maxDate } = campaignSheetSyncEndDates()

  return (
    <section className={`campaign-sheet-sync-card${kind ? ` ${kind}` : ''}`} aria-label="Đồng bộ Google Sheet">
      <div className="campaign-sheet-sync-card-head">
        <div className="campaign-sheet-sync-card-title"><span className={`campaign-sheet-sync-icon${kind === 'danger' ? ' danger' : ''}`}><RefreshCw size={16} aria-hidden="true" /></span>Đồng bộ Google Sheet</div>
        <span className={`campaign-sheet-sync-pill${kind ? ` ${kind}` : ''}`}>{campaignSheetSyncStatusLabel(source, active)}</span>
      </div>
      <dl className="campaign-sheet-sync-grid">
        <dt>Link Sheet</dt><dd><a href={source.config.url} target="_blank" rel="noreferrer">{shortLink(source.config.url)}</a></dd>
        <dt>Chu kỳ</dt><dd>Mỗi {source.everyHours} giờ</dd>
        <dt>Đồng bộ đến</dt><dd>Hết ngày {formatCampaignSheetSyncDate(source.endDate)}</dd>
        <dt>Lần gần nhất</dt><dd>{source.lastSuccessAt ? `${formatTime(source.lastSuccessAt)} · thêm ${source.lastAdded} data` : 'Chưa có'}</dd>
        {active && source.isEnabled && <><dt>Lần kế tiếp</dt><dd>{formatTime(source.nextRunAt)}</dd></>}
        <dt>Đã thêm vào chiến dịch này</dt><dd>{added.toLocaleString('vi-VN')} data</dd>
      </dl>
      {reason && <div className="campaign-sheet-sync-reason">{reason}</div>}
      {editing && <div className="campaign-sheet-sync-note-edit">
        <label>Đồng bộ mỗi{' '}
          <select className="stepper-input" value={hours} disabled={!active || !source.isEnabled} onChange={event => setHours(Number(event.target.value))}>
            {CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS.map(value => <option key={value} value={value}>{value} giờ</option>)}
          </select>
        </label>
        <label>đến hết ngày{' '}
          <input className="stepper-input" type="date" min={minDate} max={maxDate} value={endDate} onChange={event => setEndDate(event.target.value)} />
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={saveSchedule}>{active && source.isEnabled ? 'Lưu' : 'Bật lại'}</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(false)}>Hủy</button>
      </div>}
      {!editing && <div className="campaign-sheet-sync-actions">
        {active && source.isEnabled && <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
          onClick={() => { setHours(source.everyHours); setEndDate(source.endDate); setEditing(true) }}>Sửa</button>}
        {needsReconnect && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void reconnect()}>Kết nối lại</button>}
        {canResume && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
          const expired = source.status === 'expired' || source.endDate < minDate
          if (expired) { setHours(source.everyHours); setEndDate(campaignSheetSyncEndDates().defaultDate); setEditing(true); return }
          void run({ action: 'resume', syncId: source.id, campaignId }, 'Đã bật lại đồng bộ.')
        }}>{source.status === 'expired' ? 'Gia hạn đồng bộ' : 'Bật lại'}</button>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void toggleRuns()}>{runs ? 'Ẩn lịch sử' : 'Lịch sử'}</button>
        {active && source.isEnabled && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={stop}>Tắt đồng bộ</button>}
      </div>}
      {runs && <div className="campaign-sheet-sync-runs" role="table" aria-label="Lịch sử đồng bộ">
        <div className="campaign-sheet-sync-run head" role="row"><span>Thời gian</span><span>Kết quả</span><span>Đã thêm</span></div>
        {runs.length === 0 && <div className="campaign-sheet-sync-run" role="row"><span>—</span><span>Chưa có lượt nào</span><span /></div>}
        {runs.map(item => {
          const line = runText(item)
          const mine = item.perCampaign?.find(entry => entry.campaignId === campaignId)
          return <div key={item.id} className="campaign-sheet-sync-run" role="row">
            <span>{formatTime(item.finishedAt || item.startedAt || item.createdAt)}</span>
            <span className={line.bad ? 'bad' : undefined}>{line.text}</span>
            <span>{item.kind === 'run' && item.status === 'success' ? `${mine?.added ?? 0} data` : ''}</span>
          </div>
        })}
      </div>}
    </section>
  )
}
