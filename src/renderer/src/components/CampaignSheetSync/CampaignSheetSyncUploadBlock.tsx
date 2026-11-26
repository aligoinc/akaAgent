import { RefreshCw } from 'lucide-react'
import {
  CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS, campaignSheetSyncEndDates, formatCampaignSheetSyncDate, validateCampaignSheetSyncSchedule
} from '../../../../shared/campaignSheetSync'
import './CampaignSheetSync.css'

interface Props {
  disabled?: boolean
  enabled: boolean
  everyHours: number
  endDate: string
  minEveryHours: number
  onEnabledChange: (value: boolean) => void
  onEveryHoursChange: (value: number) => void
  onEndDateChange: (value: string) => void
}

/** Khối "Đồng bộ định kỳ" ở tab Link sheet của cửa sổ Upload (V662). */
export function CampaignSheetSyncUploadBlock({
  disabled, enabled, everyHours, endDate, minEveryHours, onEnabledChange, onEveryHoursChange, onEndDateChange
}: Props) {
  const { minDate, maxDate } = campaignSheetSyncEndDates()
  const error = enabled ? validateCampaignSheetSyncSchedule(everyHours, endDate, new Date(), minEveryHours) : null
  const hours = CAMPAIGN_SHEET_SYNC_HOUR_OPTIONS.filter(value => value >= minEveryHours)
  return (
    <fieldset className={`campaign-sheet-sync-block${enabled ? ' active' : ''}`} disabled={disabled}>
      <legend>Đồng bộ định kỳ</legend>
      <label className="campaign-sheet-sync-toggle">
        <input type="checkbox" checked={enabled} onChange={event => onEnabledChange(event.target.checked)} />
        <RefreshCw size={14} aria-hidden="true" />
        Đồng bộ liên tục từ link Google Sheet này
      </label>
      {enabled && <>
        <div className="campaign-sheet-sync-fields">
          <label className="campaign-sheet-sync-field">
            <span>Đồng bộ mỗi</span>
            <select className="stepper-input" value={everyHours} onChange={event => onEveryHoursChange(Number(event.target.value))}>
              {hours.map(value => <option key={value} value={value}>{value} giờ</option>)}
            </select>
          </label>
          <label className="campaign-sheet-sync-field">
            <span>Đồng bộ đến hết ngày</span>
            <input className="stepper-input" type="date" min={minDate} max={maxDate} value={endDate}
              aria-invalid={Boolean(error)} onChange={event => onEndDateChange(event.target.value)} />
            <small>Tối đa 365 ngày, tới {formatCampaignSheetSyncDate(maxDate)}</small>
          </label>
        </div>
        {error && <div className="campaign-sheet-sync-error" role="alert">{error}</div>}
        <div className="campaign-sheet-sync-help">
          Cứ {everyHours} giờ hệ thống đọc lại Sheet và thêm các dòng mới vào chiến dịch, kể cả khi chiến dịch đang chạy và khi
          bạn tắt phần mềm. Không xoá hay sửa data đã có. Giữ quyền "Bất kỳ ai có đường liên kết" và không đổi thứ tự cột của Sheet.
        </div>
      </>}
    </fieldset>
  )
}
