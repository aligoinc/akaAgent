// "Agent chọn bạn bè" trong form chiến dịch Desktop (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md; phương án Web
// akaAgentWebApp docs/CAMPAIGN_FRIEND_AGENT_PLAN.md). Dùng chung cho CampaignFormModal và CampaignAgentFormModal: nút cạnh
// "Chọn bạn bè Zalo", ghi chú nguồn dưới thanh công cụ và cửa sổ Agent `campaign_recipients`. Người khớp được thêm vào danh
// sách data của form qua `appendRows` (bỏ người đã có); không ghi DB. Ghi chú nguồn chỉ ở bộ nhớ của form.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { dataGroupAgentCampaignFormVisible } from '../../../../../shared/dataGroupAgent'
import type { DataGroupAgentSetting } from '../../../../../shared/dataGroupAgentIpc'
import type { CampaignInputData } from '../../../../../shared/types'
import { useAuthStore } from '../../../stores/authStore'
import { useUiStore } from '../../../stores/uiStore'
import DataGroupAgentDialog, { type FriendRecipientsAdded } from './DataGroupAgentDialog'

const formatCount = (value: number) => value.toLocaleString('vi-VN')

export interface CampaignFriendAgentOptions {
  /** Loại `zalo_message_friend`, chế độ "Chọn bạn bè để gửi", không phải sửa chiến dịch đã lưu. */
  eligible: boolean
  rowCount: number
  /** Tài khoản đang chọn trong form, đúng thứ tự (tài khoản đầu là mặc định). */
  accountIds: readonly number[]
  /** Thêm dòng vào danh sách data của form, trả số dòng mới thật sự thêm (bỏ người đã có). */
  appendRows: (rows: Partial<CampaignInputData>[]) => number
  /** Mở bảng chọn bạn bè Zalo (có quét danh bạ) khi tài khoản chưa có danh bạ. */
  onOpenScan: () => void
}

export interface CampaignFriendAgent {
  available: boolean
  open: boolean
  button: ReactNode
  note: ReactNode
  dialog: ReactNode
}

export function useCampaignFriendAgent({ eligible, rowCount, accountIds, appendRows, onOpenScan }: CampaignFriendAgentOptions): CampaignFriendAgent {
  const showAlert = useUiStore(state => state.showAlert)
  const user = useAuthStore(state => state.user)
  const [setting, setSetting] = useState<DataGroupAgentSetting | null>(null)
  const settingRequested = useRef(false)
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Array<{ id: number; text: string }>>([])

  // Công tắc web.data_group_agent: một lượt mỗi lần mở form, chỉ khi form đang ở loại dùng được (không theo nhịp).
  useEffect(() => {
    if (!eligible || setting || settingRequested.current) return
    settingRequested.current = true
    let active = true
    void window.electronAPI.dataGroupAgent({ kind: 'setting' }).then(result => {
      if (active && result.ok) setSetting(result.data)
    }).catch(() => {})
    return () => { active = false; settingRequested.current = false }
  }, [eligible, setting])

  const available = eligible && dataGroupAgentCampaignFormVisible(setting?.audience, user?.isAdminAkabiz, setting?.campaignForm)
  // Danh sách bị xóa hết thì ghi chú nguồn cũ không còn đúng.
  useEffect(() => { if (!rowCount) setNotes(current => current.length ? [] : current) }, [rowCount])

  const openDialog = useCallback(() => {
    if (accountIds.length === 0) { showAlert('Vui lòng chọn tài khoản trước.', 'error'); return }
    setOpen(true)
  }, [accountIds.length, showAlert])

  const handleRecipients = ({ result, accountName, conditions }: FriendRecipientsAdded) => {
    const added = appendRows(result.recipients.map(recipient => ({
      name: recipient.name ?? '', uid: recipient.uid, phone: '', email: '', note: '', status: 'chờ xử lý'
    })))
    const existing = result.recipients.length - added
    setOpen(false)
    const missing = result.missing ? ` ${formatCount(result.missing)} người vừa rời danh bạ nên không thêm.` : ''
    if (added === 0) {
      showAlert(`Những bạn bè Agent chọn đã có trong danh sách.${missing}`, 'info')
      return
    }
    showAlert(`Đã thêm ${formatCount(added)} bạn bè vào danh sách.${existing ? ` ${formatCount(existing)} người đã có sẵn trong danh sách.` : ''}${missing}`, 'success')
    const at = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }).format(new Date())
    setNotes(current => [...current, { id: Date.now(), text: `Agent đã thêm ${formatCount(added)} bạn bè lúc ${at} từ tài khoản ${accountName}${conditions ? `: ${conditions}` : ''}.` }].slice(-3))
  }

  const button = available
    ? <button type="button" className="btn btn-secondary campaign-friend-agent-button" onClick={openDialog}
      title="Mô tả bạn bè muốn gửi bằng lời, Agent lọc giúp"><Sparkles size={14} /> Agent chọn bạn bè</button>
    : null
  const note = !available ? null
    : notes.length > 0 && rowCount > 0
      ? <div className="campaign-friend-agent-notes" role="note" aria-label="Bạn bè do Agent chọn">{notes.map(item => <p key={item.id}>
        <Sparkles size={14} aria-hidden="true" /><span>{item.text}</span></p>)}</div>
      : rowCount === 0
        ? <p className="campaign-friend-agent-hint">Chọn tay từng người, hoặc tả bằng lời để Agent lọc giúp, ví dụ “bạn bè có tag VIP, 30 ngày nay chưa được nhắn”.</p>
        : null
  const dialog = open && available
    ? <DataGroupAgentDialog purpose="campaign_recipients" scope={`${user?.organizationId ?? ''}:${user?.staffId ?? ''}`} accountIds={accountIds}
      onClose={() => setOpen(false)}
      onOpenScan={() => { setOpen(false); onOpenScan() }}
      onRecipients={handleRecipients} />
    : null
  return { available, open, button, note, dialog }
}
