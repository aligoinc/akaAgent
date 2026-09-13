import { useImperativeHandle, useRef, useState, type Dispatch, type Ref, type SetStateAction } from 'react'
import { Loader2 } from 'lucide-react'

export interface CampaignSaveProgressState {
  percent: number
  label: string
  processedRows?: number
  totalRows?: number
}

export interface CampaignSaveControlsHandle {
  setProgress: Dispatch<SetStateAction<CampaignSaveProgressState | null>>
}

export const waitForNextBrowserPaint = (): Promise<void> => (
  new Promise(resolve => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
)

interface CampaignSaveControlsProps {
  starting: boolean
  saving: boolean
  ref: Ref<CampaignSaveControlsHandle>
  idleLabel: string
  onSave: () => Promise<void>
  onCancel: () => void
  onStartingChange: (starting: boolean) => void
}

export default function CampaignSaveControls({
  starting,
  saving,
  ref,
  idleLabel,
  onSave,
  onCancel,
  onStartingChange
}: CampaignSaveControlsProps) {
  // Progress ticks update this component only; the form owns just its busy flags.
  const [progress, setProgress] = useState<CampaignSaveProgressState | null>(null)
  useImperativeHandle(ref, () => ({ setProgress }), [])
  const saveInFlightRef = useRef(false)
  const busy = starting || saving
  const visibleProgress = saving
    ? (progress || { percent: 1, label: 'Đang chuẩn bị dữ liệu chiến dịch...' })
    : starting
      ? { percent: 1, label: 'Đang chuẩn bị dữ liệu chiến dịch...' }
      : null

  const startSave = async (): Promise<void> => {
    if (saveInFlightRef.current || saving) return

    saveInFlightRef.current = true
    setProgress(null)
    onStartingChange(true)
    try {
      // Paint the lightweight button state before campaign validation normalizes
      // thousands of rows on the renderer thread.
      await waitForNextBrowserPaint()
      await onSave()
    } finally {
      saveInFlightRef.current = false
      onStartingChange(false)
    }
  }

  return (
    <>
      {visibleProgress && (
        <div
          className="campaign-save-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={visibleProgress.percent}
          aria-label="Tiến trình lưu chiến dịch"
          aria-valuetext={`${visibleProgress.percent}%. ${visibleProgress.label}`}
        >
          <div className="campaign-save-progress-header">
            <span className="campaign-save-progress-label" aria-live="polite">
              {visibleProgress.label}
            </span>
            <strong className="campaign-save-progress-percent">{visibleProgress.percent}%</strong>
          </div>
          <div className="campaign-progress-track">
            <span
              className="campaign-progress-fill campaign-save-progress-fill"
              style={{ width: `${visibleProgress.percent}%` }}
            />
          </div>
          {visibleProgress.processedRows !== undefined && visibleProgress.totalRows !== undefined && (
            <span className="campaign-save-progress-count">
              {visibleProgress.processedRows.toLocaleString('vi-VN')}
              {' / '}
              {visibleProgress.totalRows.toLocaleString('vi-VN')} data của bước hiện tại
            </span>
          )}
        </div>
      )}
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Huỷ</button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => { void startSave() }}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {saving ? `Đang lưu ${visibleProgress?.percent ?? 0}%` : 'Đang chuẩn bị...'}
          </>
        ) : idleLabel}
      </button>
    </>
  )
}
