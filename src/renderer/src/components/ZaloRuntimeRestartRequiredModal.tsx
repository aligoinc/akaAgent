import { useEffect, useRef, useState } from 'react'
import { Power, ServerCog } from 'lucide-react'
import type { ZaloRuntimeRestartRequiredPayload } from '../../../shared/types'

interface Props {
  payload: ZaloRuntimeRestartRequiredPayload
}

export default function ZaloRuntimeRestartRequiredModal({ payload }: Props) {
  const quitButtonRef = useRef<HTMLButtonElement>(null)
  const [isQuitting, setIsQuitting] = useState(false)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    quitButtonRef.current?.focus()

    const keepModalFocused = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      quitButtonRef.current?.focus()
    }

    window.addEventListener('keydown', keepModalFocused, true)
    return () => {
      window.removeEventListener('keydown', keepModalFocused, true)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const handleQuit = () => {
    if (isQuitting) return
    setIsQuitting(true)
    window.electronAPI.quitApp()
  }

  const targetLabel = payload.databaseIsZaloServer ? 'máy chủ' : 'máy tính này'

  return (
    <div className="zalo-runtime-restart-overlay">
      <div
        className="zalo-runtime-restart-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="zalo-runtime-restart-title"
        aria-describedby="zalo-runtime-restart-message"
      >
        <div className="zalo-runtime-restart-icon" aria-hidden="true">
          <ServerCog size={30} />
        </div>
        <h2 id="zalo-runtime-restart-title">Chế độ chạy Zalo đã thay đổi</h2>
        <p id="zalo-runtime-restart-message">
          {payload.message || 'Quản trị viên đã thay đổi chế độ chạy Zalo của tài khoản này.'}
        </p>
        <p className="zalo-runtime-restart-detail">
          Vui lòng thoát và mở lại ứng dụng để Zalo chuyển sang chạy trên {targetLabel}.
        </p>
        <button
          ref={quitButtonRef}
          type="button"
          className="btn btn-primary zalo-runtime-restart-quit"
          onClick={handleQuit}
          disabled={isQuitting}
        >
          <Power size={17} />
          {isQuitting ? 'Đang thoát…' : 'Thoát ứng dụng'}
        </button>
      </div>
    </div>
  )
}
