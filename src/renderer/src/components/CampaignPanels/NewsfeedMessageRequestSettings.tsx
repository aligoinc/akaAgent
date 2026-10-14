import { useId } from 'react'
import { Inbox, Plus, Trash2 } from 'lucide-react'
import type { CampaignExtraSettings, NewsfeedMessageRequestRule } from '../../../../shared/types'
import './NewsfeedMessageRequestSettings.css'

type Settings = Required<Pick<CampaignExtraSettings,
  'newsfeedCheckMessageRequests' | 'newsfeedReplyMessageRequests' | 'newsfeedMessageRequestRules'>>

interface Props {
  value: Settings
  onChange: (patch: Partial<Settings>) => void
}

const createRule = (): NewsfeedMessageRequestRule => ({
  id: crypto.randomUUID(), keyword: '', replyContent: ''
})

export default function NewsfeedMessageRequestSettings({ value, onChange }: Props) {
  const id = useId()
  const { newsfeedCheckMessageRequests: enabled, newsfeedReplyMessageRequests: replyEnabled,
    newsfeedMessageRequestRules: rules } = value
  const updateRule = (ruleId: string, patch: Partial<NewsfeedMessageRequestRule>) => {
    onChange({ newsfeedMessageRequestRules: rules.map(rule => rule.id === ruleId ? { ...rule, ...patch } : rule) })
  }

  return (
    <div className={`newsfeed-action-card newsfeed-message-requests ${enabled ? 'is-enabled' : 'is-disabled'}`}>
      <div className="newsfeed-action-header">
        <label className="newsfeed-action-toggle">
          <input type="checkbox" checked={enabled}
            onChange={event => onChange({ newsfeedCheckMessageRequests: event.target.checked })} />
          <span className="newsfeed-action-title"><Inbox size={16} /><span>Kiểm tra tin nhắn chờ</span></span>
        </label>
      </div>
      <div className="newsfeed-action-body">
        <p className="schedule-hint">Cài đặt được lưu; tính năng kiểm tra và phản hồi tin nhắn chờ chưa hoạt động.</p>
        <label className="newsfeed-ai-toggle">
          <input type="checkbox" checked={replyEnabled} disabled={!enabled}
            onChange={event => onChange({
              newsfeedReplyMessageRequests: event.target.checked,
              ...(event.target.checked && rules.length === 0 ? { newsfeedMessageRequestRules: [createRule()] } : {})
            })} />
          <span>Phản hồi tin nhắn chờ theo từ khóa</span>
        </label>
        {replyEnabled && (
          <div className="newsfeed-message-request-rules">
            <p className="schedule-hint">Mỗi dòng gồm một từ khóa hoặc cụm từ và nội dung phản hồi tương ứng.</p>
            {rules.map((rule, index) => (
              <div className="newsfeed-message-request-rule" key={rule.id}>
                <div className="stepper-form-group">
                  <label htmlFor={`${id}-keyword-${rule.id}`}>Từ khóa {index + 1}</label>
                  <input id={`${id}-keyword-${rule.id}`} type="text" className="stepper-input"
                    value={rule.keyword} disabled={!enabled} placeholder="Ví dụ: giá bao nhiêu"
                    onChange={event => updateRule(rule.id, { keyword: event.target.value })} />
                </div>
                <div className="stepper-form-group">
                  <label htmlFor={`${id}-reply-${rule.id}`}>Nội dung phản hồi {index + 1}</label>
                  <textarea id={`${id}-reply-${rule.id}`} className="stepper-textarea" rows={3}
                    value={rule.replyContent} disabled={!enabled} placeholder="Nhập nội dung phản hồi"
                    onChange={event => updateRule(rule.id, { replyContent: event.target.value })} />
                </div>
                <button type="button" className="newsfeed-message-request-remove" disabled={!enabled}
                  aria-label={`Xóa phản hồi ${index + 1}`} title="Xóa phản hồi"
                  onClick={() => onChange({ newsfeedMessageRequestRules: rules.filter(item => item.id !== rule.id) })}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm newsfeed-message-request-add" disabled={!enabled}
              onClick={() => onChange({ newsfeedMessageRequestRules: [...rules, createRule()] })}>
              <Plus size={16} /> Thêm phản hồi theo từ khóa
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
