import type { AutoAccount } from '../../../../shared/types'
import type { CampaignActionDescriptor } from '../../../../shared/campaignActionDescriptors'
import { formatCampaignAccountActionState, type CampaignAccountActionDailyState } from '../../../../shared/campaignAccountActionSnapshot'
import { getAccountPlatformLabel } from '../../utils/accountLabels'
import './CampaignAccountPicker.css'

interface Props {
  groups: { key: string; name: string; accounts: AutoAccount[] }[]
  actions: CampaignActionDescriptor[]
  byAccount: Map<number, Map<string, CampaignAccountActionDailyState>>
  status: 'idle' | 'loading' | 'ready' | 'error'
  selectedIds: Set<number>
  singleSelection: boolean
  onSelect: (accountId: number, checked: boolean) => void
  onToggleGroup: (ids: number[]) => void
  getLoginStatusClass: (status: string) => string
  emptyMessage: string
}

export default function CampaignAccountPicker({ groups, actions, byAccount, status, selectedIds,
  singleSelection, onSelect, onToggleGroup, getLoginStatusClass, emptyMessage }: Props) {
  const visibleGroups = groups.filter(group => group.accounts.length > 0)
  if (visibleGroups.length === 0) return <div className="campaign-account-picker-empty">{emptyMessage}</div>
  return (
    <div className="campaign-account-picker-scroll">
      <table className="campaign-account-picker">
        {actions.length > 0 && <thead>
          <tr>
            <th rowSpan={2} scope="col">Tài khoản</th>
            <th colSpan={actions.length} className="campaign-account-picker-caption">Số lượt đã chạy hôm nay</th>
          </tr>
          <tr>{actions.map(action => <th key={action.code} scope="col">{action.name}</th>)}</tr>
        </thead>}
        {visibleGroups.map(group => <tbody key={group.key}>
          <tr className="campaign-account-picker-group">
            <td colSpan={actions.length + 1}>
              <label className="account-checkbox-option account-select-group-row">
                {!singleSelection && <input type="checkbox"
                  checked={group.accounts.every(account => selectedIds.has(account.id))}
                  onChange={() => onToggleGroup(group.accounts.map(account => account.id))} />}
                <span>{group.name} ({group.accounts.length})</span>
              </label>
            </td>
          </tr>
          {group.accounts.map(account => {
            const isSms = account.flatformType === 'sms'
            const identity = isSms ? account.name : `${account.name} — ${getAccountPlatformLabel(account)} (${account.loginStatus || '-'})`
            return <tr key={account.id} data-account-id={account.id} className="campaign-account-picker-row">
              <td>
                <label className="account-checkbox-option account-select-account-row">
                  <input type={singleSelection ? 'radio' : 'checkbox'}
                    name={singleSelection ? 'account-selection' : undefined}
                    aria-label={`Chọn tài khoản ${account.name}`}
                    checked={selectedIds.has(account.id)}
                    onChange={event => onSelect(account.id, event.target.checked)} />
                  <span className="account-select-account-label" title={identity}>
                    <span className="campaign-account-picker-identity">
                      <span className="account-select-account-name">{account.name}</span>
                      {account.flatformType === 'zalo' && <span className="account-select-login-status"> — {getAccountPlatformLabel(account)}</span>}
                    </span>
                    {!isSms && <span className={`account-select-login-status campaign-account-picker-login ${getLoginStatusClass(account.loginStatus || '')}`}>
                      ({account.loginStatus || '-'})
                    </span>}
                  </span>
                </label>
              </td>
              {actions.map(action => {
                const row = byAccount.get(account.id)?.get(action.code)
                const title = row ? `${action.name}: ${formatCampaignAccountActionState(row)}`
                  : status === 'loading' ? 'Đang tải số liệu' : status === 'error' ? 'Chưa tải được số liệu' : 'Không có số liệu cho hành động này'
                return <td key={action.code} className="campaign-account-picker-action" title={title}>
                  {row ? <>
                    <span>{row.dailyActionCount} - </span>
                    <span className={row.isDisable ? 'is-limited' : 'is-normal'}>
                      {row.isDisable ? 'Bị giới hạn' : 'Bình thường'}
                      {row.isDisable && row.remainingMinutes !== null ? ` - Còn ${row.remainingMinutes} phút` : ''}
                    </span>
                  </> : <span className="is-unavailable">—</span>}
                </td>
              })}
            </tr>
          })}
        </tbody>)}
      </table>
      {actions.length > 0 && <div className="campaign-account-picker-note" role="status">
        {status === 'loading' ? 'Đang tải số lượt hôm nay và trạng thái hành động…'
          : status === 'error' ? 'Chưa tải được số liệu. Đóng và mở lại form để thử lại.'
            : 'Số lượt và trạng thái được lấy lúc mở form.'}
      </div>}
    </div>
  )
}
