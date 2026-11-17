import { Check, Merge } from 'lucide-react'
import {
  CAMPAIGN_RESULT_ACTIONS_NOT_READY, type CampaignResultActionOption, type CampaignResultActionView
} from '../../../../../shared/campaignResultActions'
import type { CampaignResultActionsState } from './useCampaignResultActions'
import './CampaignResults.css'

const count = (value: number) => value.toLocaleString('vi-VN')

/**
 * Nội dung bảng chọn của bộ lọc Hành động (cùng hành vi WebApp): Tất cả (mặc định), từng hành động của chiến dịch kèm số
 * lượt trên cả chiến dịch, hoặc "Gộp hành động vào một dòng". "Tất cả" và "Gộp" dùng được ngay khi danh sách còn đang
 * tải. DB chưa có hàm hoặc token Desktop chưa được cấp quyền thì chỉ còn "Tất cả" kèm một dòng báo. Khung bảng chọn
 * (vị trí, đóng khi bấm ra ngoài/Esc/cuộn) do CampaignPanel lo như các bộ lọc khác của tab.
 */
export function CampaignResultActionList({ value, state, usesInputData, onChoose, onRetry }: {
  value: CampaignResultActionView
  state: CampaignResultActionsState
  /** false: chiến dịch không dùng data đầu vào (không có chế độ gộp). */
  usesInputData: boolean
  onChoose(value: CampaignResultActionView): void
  onRetry(): void
}) {
  const notReady = state.status === 'error' && state.notReady
  const actions = notReady ? [] : state.data?.actions ?? []
  const selected = (option: CampaignResultActionOption) => value.kind === 'action' && value.code === option.code

  return <>
    <div role="listbox" aria-label="Hành động" className="result-action-list">
      <button type="button" role="option" aria-selected={value.kind === 'all'}
        className={`report-option-button result-action-option${value.kind === 'all' ? ' selected' : ''}`} onClick={() => onChoose({ kind: 'all' })}>
        <span className="result-action-check" aria-hidden="true">{value.kind === 'all' && <Check size={14} strokeWidth={2.6} />}</span>
        <span className="result-action-name"><strong>Tất cả</strong></span>
        {state.data && !notReady && <span className="result-action-count">{count(state.data.total)}</span>}
      </button>

      {!notReady && <div className="result-action-heading" aria-hidden="true">Theo từng hành động</div>}
      {state.status === 'loading' && !state.data && <div className="result-action-message" role="status">Đang tải hành động…</div>}
      {state.status === 'error' && <div className="result-action-message" role={notReady ? 'note' : 'alert'}>
        <span>{notReady ? CAMPAIGN_RESULT_ACTIONS_NOT_READY : state.message}</span>
        {!notReady && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Thử lại</button>}
      </div>}
      {state.status === 'ready' && actions.length === 0 && <div className="result-action-message">Chiến dịch chưa có hành động nào.</div>}
      {actions.map(option => <button key={option.code || '__none__'} type="button" role="option" aria-selected={selected(option)}
        className={`report-option-button result-action-option${selected(option) ? ' selected' : ''}${option.count === 0 ? ' is-empty' : ''}`}
        onClick={() => onChoose({ kind: 'action', code: option.code })}>
        <span className="result-action-check" aria-hidden="true">{selected(option) && <Check size={14} strokeWidth={2.6} />}</span>
        <span className="result-action-name">
          <span className="result-action-title">{option.name}
            {!option.configured && option.code && <span className="result-action-badge" title="Hành động đã chạy nhưng hiện không còn bật trong cấu hình chiến dịch">Không còn bật</span>}
          </span>
          {option.configured && option.count === 0 && <span className="result-action-sub">Đã cấu hình, chưa có lượt</span>}
        </span>
        <span className="result-action-count">{count(option.count)}</span>
      </button>)}

      {usesInputData && !notReady && <>
        <div className="result-action-divider" aria-hidden="true" />
        <button type="button" role="option" aria-selected={value.kind === 'merged'}
          className={`report-option-button result-action-option is-merge${value.kind === 'merged' ? ' selected' : ''}`} onClick={() => onChoose({ kind: 'merged' })}>
          <span className="result-action-check" aria-hidden="true">{value.kind === 'merged' ? <Check size={14} strokeWidth={2.6} /> : <Merge size={14} />}</span>
          <span className="result-action-name">
            <span className="result-action-title">Gộp hành động vào một dòng</span>
            <span className="result-action-sub">Mỗi data một dòng, đủ mọi hành động</span>
          </span>
        </button>
      </>}
    </div>
    {!notReady && <p className="result-action-footnote">Số lượt tính trên cả chiến dịch, không theo các bộ lọc khác.</p>}
  </>
}
