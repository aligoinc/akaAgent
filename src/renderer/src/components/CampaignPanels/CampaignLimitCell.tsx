import { Check, Clock3, Lock, Users } from 'lucide-react'
import {
  campaignLimitActionView, campaignLimitShortName, formatCampaignLimitTime,
  type CampaignLimitAction, type CampaignLimitActionView, type CampaignLimitProgressItem
} from '../../../../shared/campaignLimitProgress'
import './CampaignLimitCell.css'

interface CampaignLimitCellProps {
  item: CampaignLimitProgressItem | null | undefined
  /** Giờ máy chủ (ms). */
  now: number
  nextDayStartsAt: number
  accountName?: string
  /** Chiến dịch tạm dừng: số màu xám, không báo "nghỉ theo giờ". */
  muted?: boolean
  /** Lượt đọc gần nhất lỗi: giữ số cũ và làm mờ. */
  stale?: boolean
  onOpen?(): void
}

const percent = (used: number, limit: number) => Math.min(100, Math.max(0, Math.round(used / Math.max(1, limit) * 100)))
/** Giờ chạy lại làm tròn lên phút: lượt rời khung lúc 10:41:30 thì chạy lại từ 10:42. */
const minuteCeil = (ms: number) => Math.ceil(ms / 60_000) * 60_000

/** Dòng giải thích dưới thanh tiến độ của một hành động (trống khi đang chạy bình thường). */
export function campaignLimitActionNote(action: CampaignLimitAction, view: CampaignLimitActionView, now: number): { tone: 'lock' | 'wait' | 'done'; text: string } | null {
  if (view.state === 'locked') return { tone: 'lock', text: view.resumeAt !== null ? `Tạm khóa · mở lại ${formatCampaignLimitTime(minuteCeil(view.resumeAt), now)}` : 'Tạm khóa · chưa có giờ mở lại' }
  if (view.state === 'day') return { tone: 'done', text: view.resumeAt !== null ? `Đủ lượt hôm nay · lượt mới từ ${formatCampaignLimitTime(view.resumeAt, now)}` : 'Đủ lượt hôm nay' }
  if (view.state === 'window') return { tone: 'wait', text: view.resumeAt !== null ? `Nghỉ theo giờ · chạy tiếp khoảng ${formatCampaignLimitTime(minuteCeil(view.resumeAt), now)}` : 'Nghỉ theo giờ' }
  return null
}

function tooltip(action: CampaignLimitAction, view: CampaignLimitActionView, now: number, accountName?: string): string {
  const lines = [`${action.name}${accountName ? ` · ${accountName}` : ''}`]
  if (action.limited && action.dayLimit !== null) lines.push(`Hôm nay: ${action.dayUsed ?? '—'}/${action.dayLimit} lượt`)
  if (action.limited && action.windowLimit !== null) lines.push(`Trong ${action.windowMinutes} phút gần nhất: ${view.windowUsed}${action.windowAtLeast ? '+' : ''}/${action.windowLimit} lượt`)
  const note = campaignLimitActionNote(action, view, now)
  if (note) lines.push(note.text)
  if (view.state === 'locked' && action.lockReason) lines.push(action.lockReason)
  if (action.sharedCampaigns > 0) lines.push(`Lượt tính theo tài khoản: hôm nay tài khoản này còn chạy ${action.sharedCampaigns} chiến dịch khác có cùng hành động.`)
  return lines.join('\n')
}

/**
 * Ô "Giới hạn lượt" của một chiến dịch trong danh sách: mỗi hành động một dòng gồm thanh tiến độ hôm nay,
 * số đã chạy/giới hạn ngày và số trong giờ; thêm một dòng khi hành động đang nghỉ theo giờ, đủ lượt ngày
 * hoặc bị khóa. Bấm vào ô mở tab "Hành động" của khung chi tiết.
 */
export function CampaignLimitCell({ item, now, nextDayStartsAt, accountName, muted = false, stale = false, onOpen }: CampaignLimitCellProps) {
  if (!item || !item.actions.length) return <span className="campaign-cell-muted">—</span>
  const body = item.actions.map(action => {
    const view = campaignLimitActionView(action, now, nextDayStartsAt)
    const note = campaignLimitActionNote(action, view, now)
    const dayUsed = view.state !== 'day' && now >= nextDayStartsAt ? 0 : action.dayUsed
    // Số trong giờ: ẩn khi đủ lượt ngày/bị khóa (không còn ý nghĩa), khi khung trống, hoặc khi giới hạn giờ
    // không thấp hơn giới hạn ngày và chưa đầy.
    const showWindow = action.limited && action.windowLimit !== null && view.state !== 'day' && view.state !== 'locked'
      && view.windowUsed > 0 && (view.windowFull || !view.windowMoot) && !muted
    return <div className={`campaign-limit-row is-${view.state}`} key={action.code} title={tooltip(action, view, now, accountName)}>
      <span className="campaign-limit-name">{campaignLimitShortName(action)}{action.sharedCampaigns > 0 && <Users size={10} className="campaign-limit-shared" aria-label="Dùng chung lượt với chiến dịch khác" />}</span>
      {action.limited && action.dayLimit !== null
        ? <><span className="campaign-limit-track" role="progressbar" aria-label={`${action.name} đã chạy hôm nay`} aria-valuemin={0} aria-valuemax={action.dayLimit}
          aria-valuenow={Math.min(dayUsed ?? 0, action.dayLimit)} aria-valuetext={`${dayUsed ?? '—'}/${action.dayLimit}`}><span style={{ width: `${percent(dayUsed ?? 0, action.dayLimit)}%` }} /></span>
        <strong className="campaign-limit-day">{dayUsed ?? '—'}/{action.dayLimit}</strong></>
        : <span className="campaign-limit-unlimited">Không giới hạn lượt</span>}
      <span className={`campaign-limit-hour${view.windowFull ? ' is-full' : ''}`}>{showWindow && <><Clock3 size={10} aria-hidden="true" />{view.windowUsed}{action.windowAtLeast ? '+' : ''}/{action.windowLimit}</>}</span>
      {note && !(muted && note.tone === 'wait') && <span className={`campaign-limit-note is-${note.tone}`}>
        {note.tone === 'lock' ? <Lock size={10} aria-hidden="true" /> : note.tone === 'done' ? <Check size={10} aria-hidden="true" /> : null}{note.text}
      </span>}
    </div>
  })
  const className = `campaign-limit-cell${muted ? ' is-muted' : ''}${stale ? ' is-stale' : ''}`
  return onOpen
    ? <button type="button" className={className} onClick={event => { event.stopPropagation(); onOpen() }} aria-label="Xem giới hạn lượt ở tab Hành động">{body}</button>
    : <div className={className}>{body}</div>
}
