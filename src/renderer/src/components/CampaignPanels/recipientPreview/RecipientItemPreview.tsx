import { useMemo, useState } from 'react'
import {
  RECIPIENT_SAMPLE,
  recipientMessageVersions,
  recipientPreviewChannel,
  renderRecipientMessage,
  type RecipientPreviewSource
} from '../../../../../shared/recipientPreview'
import type { CampaignAdvancedContentItem } from '../../../../../shared/types'
import { VOICE_CALL_MAX_TTS_INPUT_CHARS } from '../../../../../shared/voiceCall'
import { RecipientPhone } from './RecipientPhone'
import { recipientMediaSummary } from './RecipientBubbles'
import {
  DEFAULT_RECIPIENT_VIEW,
  recipientIsStranger,
  recipientRenderContext,
  recipientSequenceLabel,
  recipientShareMode,
  type RecipientPreviewInput
} from './recipientPreviewModel'
import './RecipientPreview.css'

interface RecipientItemPreviewProps {
  /** Dữ liệu khung "Khách sẽ nhận" của form (hành động, người gửi, tuỳ chọn gửi). */
  base: RecipientPreviewInput
  /** Một mục Nội dung nâng cao đang sửa trong modal. */
  item: CampaignAdvancedContentItem
  /** Điền khách mẫu hay giữ nguyên biến. */
  sampleData: boolean
  /** Nút "Đổi mẫu ngẫu nhiên" của modal: đổi cách trộn và media ngẫu nhiên. */
  seed: number
}

/**
 * Ô xem trước một mục Nội dung nâng cao trên điện thoại khách (Zalo nhắn tin, SMS), cùng luật và bộ vẽ với
 * khung "Khách sẽ nhận": thứ tự media/chữ như runtime, điền biến, đếm tin SMS. Chỉ đọc state modal.
 */
export function RecipientItemPreview({ base, item, sampleData, seed }: RecipientItemPreviewProps) {
  const [today] = useState(() => new Date())
  const source = useMemo<RecipientPreviewSource>(() => ({
    ...base.source,
    content: '',
    advanced: true,
    advancedContentSource: 'manual',
    advancedItems: [item]
  }), [base.source, item])
  const version = useMemo(() => recipientMessageVersions(source)[0], [source])
  const ctx = useMemo(() => recipientRenderContext(
    { ...base, source, rows: [] },
    { ...DEFAULT_RECIPIENT_VIEW, mode: sampleData ? 'sample' : 'raw', seed, mediaSeed: seed },
    today
  ), [base, source, sampleData, seed, today])
  const message = useMemo(() => version ? renderRecipientMessage(version, ctx) : null, [version, ctx])
  const channel = recipientPreviewChannel(source.actionCode)
  if (!channel) return null

  const share = recipientShareMode(source)
  const sender = base.senders[0]
  const mobile = channel === 'sms' || channel === 'voice'
  const meta = !message ? ''
    : channel === 'sms'
      ? `${message.chars.toLocaleString('vi-VN')} ký tự · ${message.smsSegments || 0} tin · ${message.smsUnicode ? 'Unicode có dấu' : 'không dấu'}`
      : channel === 'voice'
        ? `${message.chars.toLocaleString('vi-VN')}/${VOICE_CALL_MAX_TTS_INPUT_CHARS.toLocaleString('vi-VN')} ký tự kể cả thông báo AI`
        : `${message.chars.toLocaleString('vi-VN')} ký tự${message.media.length ? ` · ${recipientMediaSummary(message.media)}` : ''}`
  const sequence = message ? recipientSequenceLabel(message.sequence, message.media.length, share) : ''
  return (
    <div className="rp-item-preview">
      <RecipientPhone
        channel={channel}
        screen="message"
        senderName={sender?.name || 'Tài khoản của bạn'}
        senderPhone={mobile ? sender?.phone : null}
        groupName={RECIPIENT_SAMPLE.groupName}
        stranger={recipientIsStranger(source) && !share}
        message={message}
      />
      {sequence && <p className="rp-caption-line">{sequence}</p>}
      {meta && <p className="rp-item-meta">{meta}</p>}
    </div>
  )
}
