import { ChevronLeft, Phone, PhoneOff, Send, Users } from 'lucide-react'
import type { RecipientChannel, RecipientRenderedFriendRequest, RecipientRenderedMessage, RecipientScreen } from '../../../../../shared/recipientPreview'
import { RecipientBubbleView, RecipientTextParts } from './RecipientBubbles'

export const recipientInitials = (name: string) => name
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(-2)
  .map((part) => part[0])
  .join('')
  .toUpperCase() || 'KH'

interface RecipientPhoneProps {
  channel: RecipientChannel
  screen: RecipientScreen
  senderName: string
  senderPhone?: string | null
  groupName: string
  /** Nhắn tin/kết bạn người lạ: khách có thể chưa là bạn bè. */
  stranger: boolean
  message?: RecipientRenderedMessage | null
  friend?: RecipientRenderedFriendRequest | null
  /** Thẻ thu gọn trong "Xem tất cả": không vẽ khung máy. */
  compact?: boolean
}

function MessageScreen({ channel, senderName, groupName, stranger, message, compact }: RecipientPhoneProps) {
  const group = channel === 'zalo_group'
  const bubbles = message?.bubbles || []
  return <div className="rp-screen is-zalo">
    {!compact && <div className="rp-appbar is-zalo">
      <ChevronLeft size={18} aria-hidden="true" />
      <span className="rp-avatar">{group ? <Users size={15} aria-hidden="true" /> : recipientInitials(senderName)}</span>
      <span className="rp-appbar-title">
        <strong>{group ? groupName : senderName}</strong>
        <small>{group ? 'Nhóm Zalo' : stranger ? 'Chưa kết bạn' : 'Bạn bè'}</small>
      </span>
    </div>}
    <div className="rp-chat">
      {!compact && <span className="rp-day">Hôm nay</span>}
      {!compact && stranger && !group && <span className="rp-system">Tin từ người chưa kết bạn (minh họa)</span>}
      {group && bubbles.length > 0 && <span className="rp-sender-label">{senderName}</span>}
      {bubbles.map((bubble, index) => <div className="rp-row" key={index}><RecipientBubbleView bubble={bubble} compact={compact} /></div>)}
      {bubbles.length > 0 && !compact && <span className="rp-time">09:41</span>}
      {bubbles.length === 0 && <span className="rp-empty">Chưa có nội dung để xem trước</span>}
    </div>
    {!compact && <div className="rp-composer" aria-hidden="true"><span>Nhập tin nhắn</span><Send size={15} /></div>}
  </div>
}

function FriendRequestScreen({ senderName, friend, compact }: RecipientPhoneProps) {
  const parts = friend?.parts || []
  return <div className="rp-screen is-zalo">
    {!compact && <div className="rp-appbar is-zalo"><ChevronLeft size={18} aria-hidden="true" /><span className="rp-appbar-title"><strong>Lời mời kết bạn</strong></span></div>}
    <div className="rp-chat">
      {!compact && <span className="rp-section-label">Lời mời mới</span>}
      <div className="rp-friend-card">
        <div className="rp-friend-head">
          <span className="rp-avatar is-large">{recipientInitials(senderName)}</span>
          <span><strong>{senderName}</strong><small>Muốn kết bạn với bạn</small></span>
        </div>
        <div className="rp-friend-message">{parts.length ? <RecipientTextParts parts={parts} /> : <em>Không kèm lời nhắn</em>}</div>
        <div className="rp-friend-actions" aria-hidden="true"><span>Từ chối</span><span className="is-primary">Đồng ý</span></div>
      </div>
      {friend?.cut && <span className="rp-note">Phần gạch ngang bị cắt, khách không thấy.</span>}
    </div>
  </div>
}

function SmsScreen({ senderName, senderPhone, message, compact }: RecipientPhoneProps) {
  const bubbles = message?.bubbles || []
  return <div className="rp-screen is-sms">
    {!compact && <div className="rp-appbar is-sms">
      <span className="rp-avatar is-sms"><Phone size={16} aria-hidden="true" /></span>
      <strong>{senderPhone || senderName}</strong>
      <small>Tin nhắn SMS</small>
    </div>}
    <div className="rp-chat is-sms">
      {!compact && <span className="rp-time is-center">Hôm nay 09:41</span>}
      {bubbles.map((bubble, index) => <div className="rp-row" key={index}><RecipientBubbleView bubble={bubble} compact={compact} /></div>)}
      {bubbles.length === 0 && <span className="rp-empty">Chưa có nội dung để xem trước</span>}
    </div>
  </div>
}

function VoiceScreen({ senderName, senderPhone, message, compact }: RecipientPhoneProps) {
  const bubble = message?.bubbles[0]
  return <div className="rp-screen is-voice">
    {!compact && <div className="rp-call-head">
      <span className="rp-avatar is-large is-voice"><Phone size={20} aria-hidden="true" /></span>
      <strong>{senderPhone || senderName}</strong>
      <small>Cuộc gọi đến · giọng nói AI</small>
    </div>}
    <div className="rp-chat is-voice">
      <span className="rp-section-label">Lời thoại sẽ đọc</span>
      {bubble && bubble.kind === 'text' ? <div className="rp-transcript"><RecipientTextParts parts={bubble.parts} /></div> : <span className="rp-empty">Chưa có nội dung để xem trước</span>}
    </div>
    {!compact && <div className="rp-call-actions" aria-hidden="true"><span className="is-decline"><PhoneOff size={18} /></span><span className="is-accept"><Phone size={18} /></span></div>}
  </div>
}

export function RecipientPhone(props: RecipientPhoneProps) {
  const body = props.screen === 'friend_request' ? <FriendRequestScreen {...props} />
    : props.channel === 'sms' ? <SmsScreen {...props} />
      : props.channel === 'voice' ? <VoiceScreen {...props} />
        : <MessageScreen {...props} />
  if (props.compact) return <div className="rp-mini">{body}</div>
  return <div className="rp-phone" role="group" aria-label="Điện thoại của khách, minh họa">{body}</div>
}
