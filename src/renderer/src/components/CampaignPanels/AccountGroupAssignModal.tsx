import { useMemo, useState } from 'react'
import { FolderCog, X } from 'lucide-react'
import { AutoAccount, AutoAccountGroup } from '../../../../shared/types'

interface AccountGroupAssignModalProps {
  account: AutoAccount
  groups: AutoAccountGroup[]
  onClose: () => void
  onManageGroups: (platform: string) => void
  onSave: (accountId: number, accountGroupId: number | null) => Promise<void>
}

const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message?: unknown }).message || fallback)
  }
  return fallback
}

export default function AccountGroupAssignModal({
  account,
  groups,
  onClose,
  onManageGroups,
  onSave
}: AccountGroupAssignModalProps) {
  const [accountGroupId, setAccountGroupId] = useState<number | null>(account.accountGroupId ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const platformGroups = useMemo(
    () => groups.filter(group => group.flatformType === account.flatformType && group.isActive),
    [groups, account.flatformType]
  )

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(account.id, accountGroupId)
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, 'Không thể đổi nhóm tài khoản'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal account-group-assign-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{account.accountGroupId ? 'Đổi nhóm tài khoản' : 'Thêm vào nhóm tài khoản'}</div>
            <div className="account-info-subtitle">{account.name}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body account-group-assign-body">
          <div className="stepper-form-group">
            <label>Nhóm tài khoản</label>
            <select
              className="stepper-input"
              value={accountGroupId ?? ''}
              onChange={event => setAccountGroupId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Không thuộc nhóm</option>
              {platformGroups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>

          {platformGroups.length === 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => onManageGroups(account.flatformType)}
              type="button"
            >
              <FolderCog size={14} />
              Tạo nhóm tài khoản
            </button>
          )}

          {error && <div className="account-info-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}
