import { Edit3, FileText, RefreshCw, Trash2 } from 'lucide-react'
import type { CampaignDraftSummary } from '../../../../shared/campaignDrafts'

interface Props {
  draft: CampaignDraftSummary
  actionLabel: string
  accountLabel: string
  scheduleLabel: string
  updatedLabel: string
  opening: string | null
  onOpen: () => void
  onDelete: () => void
}

export default function CampaignDraftRow({ draft, actionLabel, accountLabel, scheduleLabel, updatedLabel, opening, onOpen, onDelete }: Props) {
  return (
    <div className="campaign-table-row is-draft" onClick={() => { if (!opening) onOpen() }}>
      <div className="campaign-col col-campaign" title={`${draft.name}\n${actionLabel}`}>
        <span className="campaign-row-select"><FileText size={15} aria-hidden="true" /></span>
        <div className="campaign-main-cell">
          <button type="button" className="campaign-name-line campaign-draft-name" disabled={opening !== null}
            onClick={event => { event.stopPropagation(); onOpen() }} aria-label={`Mở nháp ${draft.name}`}>
            {draft.name}
          </button>
          <div className="campaign-meta-line">{actionLabel}</div>
        </div>
      </div>
      <div className="campaign-col col-toggle" title="Mở nháp để tạo chiến dịch"><span className="campaign-cell-muted">—</span></div>
      <div className="campaign-col col-progress">
        <div className="campaign-status-stack">
          <span className="status-badge">Nháp</span>
        </div>
      </div>
      <div className="campaign-col col-assistant"><span className="campaign-cell-muted">—</span></div>
      <div className="campaign-col col-actions" onClick={event => event.stopPropagation()}>
        <div className="campaign-draft-actions">
          <button type="button" className="btn-icon campaign-control-button" title={`Sửa nháp ${draft.name}`}
            aria-label={`Sửa nháp ${draft.name}`} disabled={opening !== null} onClick={onOpen}>
            {opening === draft.id ? <RefreshCw size={14} className="spin" /> : <Edit3 size={14} />}
          </button>
          <button type="button" className="btn-icon campaign-control-button" title={`Xoá nháp ${draft.name}`}
            aria-label={`Xoá nháp ${draft.name}`} disabled={opening !== null} onClick={onDelete}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="campaign-col col-account" title={accountLabel}><div className="campaign-strong-line">{accountLabel}</div></div>
      <div className="campaign-col col-data-group"><span className="campaign-cell-muted">—</span></div>
      <div className="campaign-col col-send-date" title={scheduleLabel}><div className="campaign-send-time-line">{scheduleLabel}</div></div>
      <div className="campaign-col col-update-date" title={updatedLabel}><div className="campaign-strong-line">{updatedLabel}</div></div>
    </div>
  )
}
