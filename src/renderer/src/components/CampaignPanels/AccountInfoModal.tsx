import { AutoAccount } from '../../../../shared/types'
import AccountInfoView from './AccountInfoView'

interface AccountInfoModalProps {
  account: AutoAccount
  onClose: () => void
}

export default function AccountInfoModal({ account, onClose }: AccountInfoModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal account-info-modal">
        <AccountInfoView account={account} mode="modal" onClose={onClose} />
      </div>
    </div>
  )
}
