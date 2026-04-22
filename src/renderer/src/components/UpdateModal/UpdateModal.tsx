import { useEffect, useState } from 'react'
import { X, Download, ArrowUpCircle, AlertCircle, CheckCircle } from 'lucide-react'

type Phase = 'idle' | 'downloading' | 'installing' | 'done' | 'error'

interface UpdateModalProps {
  localVersion: string
  remoteVersion: string
  onClose: () => void
}

export default function UpdateModal({ localVersion, remoteVersion, onClose }: UpdateModalProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState<string>('')
  const [transferred, setTransferred] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!window.electronAPI?.onUpdateProgress) return
    return window.electronAPI.onUpdateProgress((p) => {
      setPhase(p.phase)
      if (typeof p.percent === 'number') setPercent(p.percent)
      if (typeof p.transferred === 'number') setTransferred(p.transferred)
      if (typeof p.total === 'number') setTotal(p.total)
      if (p.message) setMessage(p.message)
    })
  }, [])

  const handleInstall = async (): Promise<void> => {
    if (!window.electronAPI?.downloadAndInstallUpdate) return
    setPhase('downloading')
    setPercent(0)
    setMessage('')
    try {
      const res = await window.electronAPI.downloadAndInstallUpdate()
      if (!res.success) {
        setPhase('error')
        setMessage(res.error || 'Không thể cập nhật')
      }
    } catch (err) {
      setPhase('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = phase === 'downloading' || phase === 'installing'
  const formatSize = (bytes: number): string => {
    if (!bytes) return '0 MB'
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 10000, position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      <div
        className="campaign-full-modal"
        style={{
          width: '440px',
          height: 'auto',
          minHeight: 'unset',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          margin: 0
        }}
      >
        <div
          className="campaign-modal-top"
          style={{
            height: 'auto',
            padding: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--border-default)'
          }}
        >
          <h2
            className="section-title"
            style={{
              margin: 0,
              border: 'none',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 16
            }}
          >
            {phase === 'error' ? (
              <AlertCircle color="var(--accent-error)" size={20} />
            ) : phase === 'done' ? (
              <CheckCircle color="var(--accent-success)" size={20} />
            ) : (
              <ArrowUpCircle color="var(--accent-primary, #7c3aed)" size={20} />
            )}
            <span>Có bản cập nhật mới</span>
          </h2>
          {!busy && (
            <button className="btn-icon" onClick={onClose} title="Đóng">
              <X size={18} />
            </button>
          )}
        </div>

        <div
          className="campaign-modal-body"
          style={{ padding: '20px 20px 8px', fontSize: 14, color: 'var(--text-primary)' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary, #aaa)' }}>Phiên bản hiện tại:</span>
              <span style={{ fontWeight: 500 }}>{localVersion}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary, #aaa)' }}>Phiên bản mới:</span>
              <span style={{ fontWeight: 600, color: 'var(--accent-primary, #7c3aed)' }}>
                {remoteVersion}
              </span>
            </div>
          </div>

          {phase === 'idle' && (
            <div style={{ color: 'var(--text-secondary, #aaa)', fontSize: 13, lineHeight: 1.5 }}>
              Nhấn "Cập nhật ngay" để tải và cài đặt phiên bản mới. Ứng dụng sẽ tự đóng và trình cài đặt sẽ chạy.
            </div>
          )}

          {(phase === 'downloading' || phase === 'installing' || phase === 'done') && (
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  width: '100%',
                  height: 8,
                  background: 'var(--bg-secondary, #1a1a22)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  marginBottom: 8
                }}
              >
                <div
                  style={{
                    width: `${phase === 'done' ? 100 : percent}%`,
                    height: '100%',
                    background: 'var(--accent-primary, #7c3aed)',
                    transition: 'width 0.15s linear'
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: 'var(--text-secondary, #aaa)'
                }}
              >
                <span>
                  {phase === 'downloading' && `Đang tải… ${percent}%`}
                  {phase === 'installing' && (message || 'Đang khởi chạy bộ cài đặt…')}
                  {phase === 'done' && (message || 'Hoàn tất')}
                </span>
                {phase === 'downloading' && total > 0 && (
                  <span>
                    {formatSize(transferred)} / {formatSize(total)}
                  </span>
                )}
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 6,
                color: 'var(--accent-error, #ef4444)',
                fontSize: 13,
                whiteSpace: 'pre-wrap'
              }}
            >
              {message || 'Đã xảy ra lỗi khi cập nhật'}
            </div>
          )}
        </div>

        <div
          className="modal-footer"
          style={{
            justifyContent: 'flex-end',
            borderTop: 'none',
            padding: '12px 20px 20px',
            gap: 8
          }}
        >
          {phase === 'idle' && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Để sau</button>
              <button
                className="btn btn-primary"
                onClick={handleInstall}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} />
                Cập nhật ngay
              </button>
            </>
          )}
          {phase === 'error' && (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
              <button className="btn btn-primary" onClick={handleInstall}>Thử lại</button>
            </>
          )}
          {busy && (
            <button className="btn btn-ghost" disabled style={{ opacity: 0.6 }}>
              Đang xử lý…
            </button>
          )}
          {phase === 'done' && (
            <button className="btn btn-primary" disabled style={{ opacity: 0.7 }}>
              Đang thoát ứng dụng…
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
