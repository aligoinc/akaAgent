import { useState } from 'react'
import { Tag } from 'lucide-react'
import type { CampaignConfig } from '../../../../shared/types'
import {
  ZALO_TAG_AUTO_ADD_OFF_TEXT, ZALO_TAG_AUTO_ADD_ON_TEXT, ZALO_TAG_AUTO_ADD_RESUME, ZALO_TAG_AUTO_ADD_STOP,
  type ZaloTagAutoAddSetResult
} from '../../../../shared/zaloTagAutoAdd'
import { useUiStore } from '../../stores/uiStore'

/**
 * V660: dải "Đang tự thêm người mới được gắn tag" + nút Dừng / Tiếp tục ở chi tiết chiến dịch. Chỉ hiện với chiến dịch nhắn tin bạn
 * bè theo tag đã từng bật tính năng (khoá `zaloFriendTagAutoAddEnabled` có trong cài đặt).
 */
export function ZaloTagAutoAddBanner({ campaign, onChanged }: {
  campaign: CampaignConfig | undefined
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const showAlert = useUiStore(s => s.showAlert)
  const extra = campaign?.extraSettings
  if (!campaign || campaign.actionId !== 'zalo_message_friend' || extra?.zaloFriendTargetMode !== 'tagged_friends') return null
  if (typeof extra.zaloFriendTagAutoAddEnabled !== 'boolean') return null
  const on = extra.zaloFriendTagAutoAddEnabled

  const toggle = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.setCampaignZaloTagAutoAdd(campaign.id, !on) as ZaloTagAutoAddSetResult
      if (!result.ok) showAlert(result.message, 'error')
      else onChanged()
    } catch {
      showAlert('Không đổi được trạng thái tự thêm. Vui lòng thử lại.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, margin: '8px 12px', padding: '8px 8px 8px 12px', borderRadius: 10,
        border: `1px solid ${on ? 'var(--accent-border, #c7cbf5)' : 'var(--border-default)'}`,
        background: on ? 'var(--accent-soft, #f6f7ff)' : 'var(--bg-secondary)', fontSize: 13
      }}
    >
      <Tag size={16} aria-hidden="true" />
      <span style={{ flex: 1 }}>{on ? ZALO_TAG_AUTO_ADD_ON_TEXT : ZALO_TAG_AUTO_ADD_OFF_TEXT}</span>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void toggle()}>
        {on ? ZALO_TAG_AUTO_ADD_STOP : ZALO_TAG_AUTO_ADD_RESUME}
      </button>
    </div>
  )
}
