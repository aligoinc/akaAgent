import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS, campaignSheetSyncEndDates, campaignSheetSyncSummary, validateCampaignSheetSyncSchedule,
  type CampaignSheetSyncDraft
} from '../../../../shared/campaignSheetSync'
import './CampaignSheetSync.css'

interface Props {
  draft: CampaignSheetSyncDraft
  disabled?: boolean
  onChange: (draft: CampaignSheetSyncDraft | null) => void
}

/** Dòng tóm tắt trong phần data của form chiến dịch: "Đồng bộ Google Sheet · mỗi 6 giờ · đến 26/12/2026 [Sửa] [Bỏ]". */
export function CampaignSheetSyncFormNote({ draft, disabled, onChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [hours, setHours] = useState(draft.everyHours)
  const [endDate, setEndDate] = useState(draft.endDate)
  const { minDate, maxDate } = campaignSheetSyncEndDates()
  const error = editing ? validateCampaignSheetSyncSchedule(hours, endDate) : null
  return (
    <div className="campaign-sheet-sync-note" role="status">
      <span className="campaign-sheet-sync-icon"><RefreshCw size={14} aria-hidden="true" /></span>
      <span className="campaign-sheet-sync-note-text">
        <strong>{campaignSheetSyncSummary(draft.everyHours, draft.endDate)}</strong>
        {' '}· bắt đầu khi lưu chiến dịch
      </span>
      {!editing && <>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled}
          onClick={() => { setHours(draft.everyHours); setEndDate(draft.endDate); setEditing(true) }}>Sửa</button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => onChange(null)}>Bỏ</button>
      </>}
      {editing && <div className="campaign-sheet-sync-note-edit">
        <label>Đồng bộ mỗi{' '}
          <select className="stepper-input" value={hours} onChange={event => setHours(Number(event.target.value))}>
            {CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS.map(value => <option key={value} value={value}>{value} giờ</option>)}
          </select>
        </label>
        <label>đến hết ngày{' '}
          <input className="stepper-input" type="date" min={minDate} max={maxDate} value={endDate} onChange={event => setEndDate(event.target.value)} />
        </label>
        <button type="button" className="btn btn-primary btn-sm" disabled={disabled || Boolean(error)}
          onClick={() => { onChange({ ...draft, everyHours: hours, endDate }); setEditing(false) }}>Xong</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Hủy</button>
        {error && <span className="campaign-sheet-sync-error" role="alert">{error}</span>}
      </div>}
    </div>
  )
}
