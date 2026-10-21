import type { AutoAccount, CampaignListItem } from '../../../../shared/types'
import AccountInfoView from './AccountInfoView'

interface AccountInfoModalProps {
  account: AutoAccount
  campaign?: Pick<CampaignListItem, 'id' | 'name'>
  onClose: () => void
}

export default function AccountInfoModal({ account, campaign, onClose }: AccountInfoModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal account-info-modal" role="dialog" aria-modal="true" aria-label={campaign ? 'Hành động của tài khoản' : 'Thông tin tài khoản'}>
        <AccountInfoView key={`${account.id}:${campaign?.id ?? 'all'}`} account={account} campaign={campaign} mode="modal" onClose={onClose} />
      </div>
    </div>
  )
}
