import { refreshContentTemplateLibrary, useContentTemplateStore } from '../../stores/contentTemplateStore'
import './contentTemplateLoadNotice.css'

export default function ContentTemplateLoadNotice() {
  const error = useContentTemplateStore(state => state.error)
  const loading = useContentTemplateStore(state => state.loading)
  if (!error) return null
  return (
    <div className="content-template-load-notice" role="alert">
      <span>{error}</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={loading}
        onClick={() => void refreshContentTemplateLibrary()}>
        {loading ? 'Đang tải…' : 'Thử lại'}
      </button>
    </div>
  )
}
