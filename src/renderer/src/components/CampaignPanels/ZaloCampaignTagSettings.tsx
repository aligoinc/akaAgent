import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { normalizeZaloAccountTagSettings, type ZaloAccountTagSettings, type ZaloTagSettingsByAccountId } from '../../../../shared/zaloAuxiliaryActions'
import type { ZaloLabelOption } from '../../../../shared/types'
import ZaloTagMultiSelector from './ZaloTagMultiSelector'

export interface ZaloTagAccountOption { id: number; name: string; secondary?: boolean }
interface Props {
  accounts: ZaloTagAccountOption[]
  settings: ZaloTagSettingsByAccountId
  skipIfFriend: boolean
  skipIfHasSelectedTags: boolean
  onSkipIfFriendChange: (value: boolean) => void
  onSkipIfHasSelectedTagsChange: (value: boolean) => void
  onChange: (accountId: number, settings: ZaloAccountTagSettings) => void
}

/** Only the visible account loads labels; account switches unmount the old request owner. */
function AccountTags({ account, accountField, value, skipIfFriend, skipIfHasSelectedTags, onSkipIfFriendChange, onSkipIfHasSelectedTagsChange, onChange }: {
  account: ZaloTagAccountOption
  accountField: ReactNode
  value: ZaloAccountTagSettings
  skipIfFriend: boolean
  skipIfHasSelectedTags: boolean
  onSkipIfFriendChange: (value: boolean) => void
  onSkipIfHasSelectedTagsChange: (value: boolean) => void
  onChange: (value: ZaloAccountTagSettings) => void
}) {
  const tagSelectId = useId()
  const [labels, setLabels] = useState<ZaloLabelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const requestRevision = useRef(0)
  const load = async (sync: boolean) => {
    const revision = ++requestRevision.current
    if (sync) setSyncing(true)
    else setLoading(true)
    setError('')
    try {
      const result = await (sync ? window.electronAPI.syncZaloLabels(account.id) : window.electronAPI.listZaloLabels(account.id))
      if (revision !== requestRevision.current) return
      setLabels(result)
    } catch (cause) {
      if (revision !== requestRevision.current) return
      setError(cause instanceof Error ? cause.message : 'Không tải được tag Zalo. Vui lòng thử lại.')
    } finally {
      if (revision === requestRevision.current) { setLoading(false); setSyncing(false) }
    }
  }
  useEffect(() => {
    void load(false)
    return () => { requestRevision.current += 1 }
  }, [account.id])

  // Keep saved selections visible and editable even when the catalog is empty/offline.
  const options = new Map(labels.map(item => [String(item.id), { id: String(item.id), text: item.text }]))
  if (value.zaloTagId && !options.has(value.zaloTagId)) {
    options.set(value.zaloTagId, { id: value.zaloTagId, text: value.zaloTagName || `Tag ${value.zaloTagId}` })
  }
  value.zaloTagSkipTagIds.forEach((id, index) => {
    if (!options.has(id)) options.set(id, { id, text: value.zaloTagSkipTagNames[index] || `Tag ${id}` })
  })
  const availableLabels = Array.from(options.values())
  const disabled = loading || syncing
  return <>
    <div className="zalo-tag-fields">
      {accountField}
      <div className="stepper-form-group">
        <label htmlFor={tagSelectId}>Tag cần gắn</label>
        <div className="zalo-tag-input-row">
          <select id={tagSelectId} className="stepper-input" value={value.zaloTagId} disabled={disabled}
            onChange={event => onChange({ ...value, zaloTagId: event.target.value, zaloTagName: options.get(event.target.value)?.text || '' })}>
            <option value="">{loading ? 'Đang tải tag...' : 'Chọn tag cần gắn'}</option>
            {availableLabels.map(item => <option key={item.id} value={item.id}>{item.text}</option>)}
          </select>
          <button type="button" className="btn btn-secondary zalo-tag-sync" disabled={disabled} onClick={() => void load(true)}>
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{syncing ? 'Đang tải' : 'Tải tag'}
          </button>
        </div>
      </div>
    </div>
    {error && <div className="zalo-auxiliary-error" role="alert">{error}</div>}
    {!loading && !error && labels.length === 0 && <p className="zalo-auxiliary-hint">Bấm “Tải tag” để lấy tag từ Zalo.</p>}
    <div className="zalo-auxiliary-rules">
      <div className="zalo-auxiliary-rule-heading">
        <span>Không gắn tag trong trường hợp</span>
        {skipIfFriend && skipIfHasSelectedTags && <span className="zalo-auxiliary-hint">Chỉ cần thỏa một điều kiện</span>}
      </div>
      <div className="zalo-auxiliary-rule-options">
        <label className="schedule-checkbox-label">
          <input type="checkbox" checked={skipIfFriend} onChange={event => onSkipIfFriendChange(event.target.checked)} />
          <span>Đã là bạn bè</span>
        </label>
        <label className="schedule-checkbox-label">
          <input type="checkbox" checked={skipIfHasSelectedTags} onChange={event => onSkipIfHasSelectedTagsChange(event.target.checked)} />
          <span>Đã có tag</span>
        </label>
      </div>
      {skipIfHasSelectedTags && <ZaloTagMultiSelector compact label="Tag cần bỏ qua"
        values={value.zaloTagSkipTagIds} labels={availableLabels} disabled={disabled} loading={loading}
        onChange={(ids, names) => onChange({ ...value, zaloTagSkipTagIds: ids, zaloTagSkipTagNames: names })} />}
    </div>
  </>
}

export default function ZaloCampaignTagSettings(props: Props) {
  const accountSelectId = useId()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const account = props.accounts.find(item => item.id === selectedId) ?? props.accounts[0]
  return <div className="zalo-tag-settings" role="group" aria-label="Không gắn tag trong trường hợp">
    {account ? <AccountTags key={account.id} account={account} value={normalizeZaloAccountTagSettings(props.settings[String(account.id)])}
      accountField={<div className="stepper-form-group">
        <label htmlFor={accountSelectId}>Tài khoản cấu hình tag</label>
        <select id={accountSelectId} className="stepper-input" value={account.id} onChange={event => setSelectedId(Number(event.target.value))}>
          {props.accounts.map(item => <option key={item.id} value={item.id}>{item.name}{item.secondary ? ' (tài khoản phụ)' : ''}</option>)}
        </select>
        {props.accounts.length > 1 && <p className="zalo-auxiliary-hint">Chọn tag riêng cho từng tài khoản.</p>}
      </div>}
      skipIfFriend={props.skipIfFriend} onSkipIfFriendChange={props.onSkipIfFriendChange}
      skipIfHasSelectedTags={props.skipIfHasSelectedTags} onSkipIfHasSelectedTagsChange={props.onSkipIfHasSelectedTagsChange}
      onChange={value => props.onChange(account.id, value)} />
      : <p className="zalo-auxiliary-hint">Vui lòng chọn tài khoản Zalo để cấu hình tag.</p>}
  </div>
}
