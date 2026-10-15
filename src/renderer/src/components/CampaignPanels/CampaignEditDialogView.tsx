import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { CampaignEditFlow, EditableCampaign } from '../../../../shared/campaignEditFlow'

export function CampaignEditDialogView<T extends EditableCampaign>({ flow }: { flow: CampaignEditFlow<T> }) {
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.kind === 'closed') return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('[data-primary-focus]')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [state.kind])
  if (state.kind === 'closed') return null
  const saving = state.kind === 'save-status'
  const message = saving ? 'Bạn muốn chiến dịch ở trạng thái nào sau khi lưu?'
    : state.kind === 'confirm' ? 'Chiến dịch này sẽ tạm dừng để bạn có thể sửa. Bạn có muốn tiếp tục?'
      : state.kind === 'error' ? state.error
        : state.kind === 'checking' ? 'Đang kiểm tra chiến dịch…' : 'Đang chờ chiến dịch tạm dừng…'
  return createPortal(<div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'grid', placeItems: 'center' }}>
    <div ref={dialog} className="campaign-full-modal campaign-feedback-modal" role="dialog" aria-modal="true" aria-label={saving ? 'Trạng thái sau khi lưu' : 'Tạm dừng để sửa chiến dịch'}
      style={{ width: 'min(440px, calc(100vw - 32px))', height: 'auto', minHeight: 0, margin: 0 }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); flow.cancel() }
        if (event.key === 'Tab') {
          const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
          const first = buttons[0], last = buttons[buttons.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <div className="modal-header"><strong>{saving ? 'Trạng thái sau khi lưu' : 'Tạm dừng để sửa chiến dịch'}</strong><button type="button" className="btn-icon" aria-label="Đóng" onClick={flow.cancel}>×</button></div>
      <div style={{ padding: 24 }} aria-live="polite">
        <p>{message}</p>
        {saving && <p className="text-muted">Chờ xử lý: tiếp tục theo lịch và giới hạn đã cấu hình.</p>}
      </div>
      <div className="modal-footer">
        {saving ? <>
          <button type="button" data-primary-focus className="btn btn-secondary" onClick={() => flow.selectSaveStatus('tạm dừng')}>Tạm dừng</button>
          <button type="button" className="btn btn-primary" onClick={() => flow.selectSaveStatus('chờ xử lý')}>Chờ xử lý</button>
        </> : <>
          <button type="button" data-primary-focus className="btn btn-ghost" onClick={flow.cancel}>{state.kind === 'confirm' ? 'Không' : 'Hủy chờ'}</button>
          {state.kind === 'confirm' && <button type="button" className="btn btn-primary" onClick={() => void flow.confirmPause()}>Có</button>}
          {state.kind === 'error' && <button type="button" className="btn btn-primary" onClick={flow.retry}>Thử lại</button>}
          {state.kind === 'waiting' && <button type="button" className="btn btn-secondary" onClick={flow.refresh}>Kiểm tra lại</button>}
        </>}
      </div>
    </div>
  </div>, document.body)
}
