import { useEffect, useState } from 'react'
import { Bot } from 'lucide-react'
import JourneysEmbed from '../components/Automation/JourneysEmbed'
import '../styles/automationHub.css'

/**
 * Bot sự kiện (docs/EVENT_BOT_TECH.md mục 8): trang Web `/automation/event-bot?embed=desktop` nhúng cùng phiên với thẻ Quy trình.
 * Cài đặt, nhật ký, báo cáo đều ở trang Web; việc gửi tin của tài khoản Zalo QR / trình duyệt chạy trong app (EventBotRuntime).
 * Webview chỉ dựng khi mở trang lần đầu.
 */
export default function EventBotPage({ isActive }: { isActive: boolean }) {
  const [opened, setOpened] = useState(false)
  useEffect(() => { if (isActive) setOpened(true) }, [isActive])
  if (!opened) return null
  return <div className="automation-hub">
    <div className="automation-hub-body">
      <div className="automation-hub-panel" style={{ display: 'flex' }}>
        <JourneysEmbed isActive={isActive} view="eventBot" ariaLabel="Bot sự kiện" icon={<Bot size={16} aria-hidden="true" />}
          description="Bot tự gửi tin khi khách có sinh nhật, được gắn / gỡ tag Zalo, vào / ra nhóm điều kiện." />
      </div>
    </div>
  </div>
}
