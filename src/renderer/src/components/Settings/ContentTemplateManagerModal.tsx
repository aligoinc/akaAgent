import { createPortal } from 'react-dom'
import ContentTemplateWorkspace from '../ContentTemplates/ContentTemplateWorkspace'
import type { ContentTemplateChannelName } from '../../../../shared/types'

interface ContentTemplateManagerModalProps {
  onClose: () => void
  initialChannel?: ContentTemplateChannelName
}

export default function ContentTemplateManagerModal({ onClose, initialChannel }: ContentTemplateManagerModalProps) {
  return createPortal(
    <div className="ctw-modal-overlay" onClick={onClose}>
      <div className="ctw-modal-shell" onClick={event => event.stopPropagation()}>
        <ContentTemplateWorkspace modal initialChannel={initialChannel} onClose={onClose} />
      </div>
    </div>,
    document.body
  )
}
