import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import FacebookRandomRunPanel from './FacebookRandomRunPanel'
import './facebookRandomRun.css'

export default function FacebookRandomRunPlanModal({ account, onClose }: {
  account: AutoAccount; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return <dialog ref={dialogRef} className="modal random-plan-modal" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="modal-header">
      <h3 id={titleId}>Tiến trình chạy ngẫu nhiên · {account.name}</h3>
      <button type="button" className="btn-icon" aria-label="Đóng" onClick={onClose}><X size={18}/></button>
    </header>
    <div className="modal-body"><FacebookRandomRunPanel account={account} active/></div>
    <footer className="modal-footer"><button type="button" className="btn btn-secondary" onClick={onClose}>Đóng</button></footer>
  </dialog>
}
