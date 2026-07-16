import { createPortal } from 'react-dom'
import ContentTemplateWorkspace from '../ContentTemplates/ContentTemplateWorkspace'

interface ContentTemplateManagerModalProps {
  onClose: () => void
}

export default function ContentTemplateManagerModal({ onClose }: ContentTemplateManagerModalProps) {
  return createPortal(
    <div className="ctw-modal-overlay" onClick={onClose}>
      <div className="ctw-modal-shell" onClick={event => event.stopPropagation()}>
        <ContentTemplateWorkspace modal onClose={onClose} />
      </div>
    </div>,
    document.body
  )
}
