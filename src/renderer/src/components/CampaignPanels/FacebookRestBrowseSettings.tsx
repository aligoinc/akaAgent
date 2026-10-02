import { useId } from 'react'
import type { FacebookRestBrowseSettings as Settings } from '../../../../shared/facebookRestBrowse'

export default function FacebookRestBrowseSettings({ value, onChange }: { value: Settings; onChange: (value: Settings) => void }) {
  const fieldId = useId()
  const change = (patch: Partial<Settings>) => onChange({ ...value, ...patch })
  return <div className="facebook-rest-browse-settings">
    <label className="schedule-checkbox-label">
      <input type="checkbox" checked={value.enabled} onChange={e => change({ enabled: e.target.checked })} />
      <span>Kiêm nghỉ và lướt Facebook khi đạt giới hạn giờ</span>
    </label>
    {value.enabled && <>
      <div className="stepper-form-row" style={{ marginTop: 16 }}>
        <div className="stepper-form-group half">
          <label htmlFor={`${fieldId}-browse`}>Tổng thời gian lướt (giây)</label>
          <input id={`${fieldId}-browse`} className="stepper-input" type="number" min={1} step={1} value={value.browseSeconds}
            onChange={e => change({ browseSeconds: Number(e.target.value) })} />
        </div>
        <div className="stepper-form-group half">
          <label htmlFor={`${fieldId}-rest`}>Thời gian nghỉ (giây)</label>
          <input id={`${fieldId}-rest`} className="stepper-input" type="number" min={0} step={1} value={value.restSeconds}
            onChange={e => change({ restSeconds: Number(e.target.value) })} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="schedule-checkbox-label">
          <input type="checkbox" checked={value.browseTarget} onChange={e => change({ browseTarget: e.target.checked })} />
          <span>Lướt trong group/profile/page</span>
        </label>
        <label className="schedule-checkbox-label">
          <input type="checkbox" checked={value.browseHome} onChange={e => change({ browseHome: e.target.checked })} />
          <span>Lướt trang chủ</span>
        </label>
      </div>
      <p className="schedule-hint">Chọn cả hai nơi sẽ chia đều tổng thời gian lướt. Lướt xong mới nghỉ, sau đó chiến dịch chuyển về chờ xử lý. Thao tác không thực hiện được sẽ được bỏ qua.</p>
    </>}
  </div>
}
