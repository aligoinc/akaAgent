import { X } from 'lucide-react'
import { useId } from 'react'
import type { RecipientPreviewScreenModel, RecipientRenderContext, RecipientScreen, RecipientWarning } from '../../../../../shared/recipientPreview'
import { RecipientVersionBrowser } from './RecipientVersionBrowser'
import { recipientChannelLabel, recipientShareMode, type RecipientPreviewInput } from './recipientPreviewModel'

export { RECIPIENT_GALLERY_PAGE_SIZE } from './RecipientVersionBrowser'

interface RecipientPreviewGalleryProps {
  input: RecipientPreviewInput
  screens: RecipientPreviewScreenModel[]
  ctx: RecipientRenderContext
  warnings: RecipientWarning[]
  initialScreen: RecipientScreen
  senderName: string
  senderPhone?: string | null
  groupName: string
  stranger: boolean
  busy?: boolean
  onSelect: (screen: RecipientScreen, index: number) => void
  onEdit: (target: RecipientWarning['target']) => void
  onClose: () => void
}

/** Lớp phủ "Xem tất cả" của khung "Khách sẽ nhận". */
export function RecipientPreviewGallery({
  input, screens, ctx, warnings, initialScreen, senderName, senderPhone, groupName, stranger, busy = false, onSelect, onEdit, onClose,
}: RecipientPreviewGalleryProps) {
  const titleId = useId()
  const share = recipientShareMode(input.source)

  return <div className="rp-gallery-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div
      className="rp-gallery"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="rp-gallery-head">
        <div>
          <h2 id={titleId}>Tất cả phiên bản khách có thể nhận</h2>
          <span>{recipientChannelLabel(ctx.channel, share)} · Gửi từ {senderName} · {ctx.mode === 'raw' ? 'giữ nguyên biến' : ctx.mode === 'row' ? 'theo dòng data đang chọn' : 'khách mẫu'}</span>
        </div>
        <button type="button" className="rp-icon-button" aria-label="Đóng danh sách phiên bản" onClick={onClose} autoFocus><X size={18} aria-hidden="true" /></button>
      </div>
      <RecipientVersionBrowser
        screens={screens}
        ctx={ctx}
        warnings={warnings}
        initialScreen={initialScreen}
        senderName={senderName}
        senderPhone={senderPhone}
        groupName={groupName}
        stranger={stranger}
        busy={busy}
        onSelect={onSelect}
        onEdit={onEdit}
        footerAction={<button type="button" className="rp-button is-primary" onClick={onClose}>Về form</button>}
      />
    </div>
  </div>
}
