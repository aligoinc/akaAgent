import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Plus, Save, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { AccountGroupSettings, AutoAccount, AutoAccountAction, AutoAccountGroup } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'

interface AccountGroupManagerModalProps {
  groups: AutoAccountGroup[]
  accounts: AutoAccount[]
  initialPlatform?: string
  onClose: () => void
  onCreateGroup: (data: Partial<AutoAccountGroup>) => Promise<AutoAccountGroup>
  onUpdateGroup: (id: number, updates: Partial<AutoAccountGroup>) => Promise<void>
  onDeleteGroup: (id: number) => Promise<void>
  onAssignAccounts: (accountIds: number[], accountGroupId: number | null) => Promise<void>
}

type ActionLimitDraft = {
  dailyLimit: string
  rateLimitCount: string
}

const PLATFORM_OPTIONS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'email', label: 'Email' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'other', label: 'Khác' }
]

const toInputValue = (value: unknown) => (
  value === null || value === undefined ? '' : String(value)
)

const parseOptionalNumber = (value: string): number | undefined => {
  if (value.trim() === '') return undefined
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const getErrorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'message' in err) {
    return String((err as { message?: unknown }).message || fallback)
  }
  return fallback
}

const sortAccountsByName = (items: AutoAccount[]) => (
  [...items].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
)

const toggleSelectedId = (
  setter: Dispatch<SetStateAction<Set<number>>>,
  id: number
) => {
  setter(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}

export default function AccountGroupManagerModal({
  groups,
  accounts,
  initialPlatform = 'facebook',
  onClose,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAssignAccounts
}: AccountGroupManagerModalProps) {
  const canUseEmailFeature = useAuthStore(state => !!state.user?.entitlements?.email)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [flatformType, setFlatformType] = useState(initialPlatform)
  const [sleepBetweenActions, setSleepBetweenActions] = useState('')
  const [limits, setLimits] = useState<Record<string, ActionLimitDraft>>({})
  const [actions, setActions] = useState<AutoAccountAction[]>([])
  const [loadingActions, setLoadingActions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingMembers, setUpdatingMembers] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(new Set())
  const [selectedAddIds, setSelectedAddIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const platformOptions = useMemo(
    () => PLATFORM_OPTIONS.filter(option => option.value !== 'email' || canUseEmailFeature),
    [canUseEmailFeature]
  )

  const selectedGroup = useMemo(
    () => groups.find(group => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  )
  const isEditingGroup = Boolean(selectedGroup)

  const memberAccounts = useMemo(() => (
    selectedGroup
      ? sortAccountsByName(accounts.filter(account => (
        !account.isDelete && account.accountGroupId === selectedGroup.id
      )))
      : []
  ), [accounts, selectedGroup])

  const addableAccounts = useMemo(() => (
    sortAccountsByName(accounts.filter(account => (
      !account.isDelete &&
      account.flatformType === (selectedGroup?.flatformType || flatformType) &&
      account.accountGroupId !== selectedGroup?.id
    )))
  ), [accounts, flatformType, selectedGroup])

  const selectableAddAccounts = useMemo(
    () => addableAccounts.filter(account => !account.accountGroupId),
    [addableAccounts]
  )

  const selectableAddAccountIds = useMemo(
    () => selectableAddAccounts.map(account => account.id),
    [selectableAddAccounts]
  )

  const usageByGroupId = useMemo(() => {
    const map = new Map<number, number>()
    for (const account of accounts) {
      if (!account.accountGroupId) continue
      map.set(account.accountGroupId, (map.get(account.accountGroupId) || 0) + 1)
    }
    return map
  }, [accounts])

  const groupsForPlatform = useMemo(
    () => groups.filter(group => group.flatformType === flatformType),
    [groups, flatformType]
  )

  useEffect(() => {
    let cancelled = false
    const loadActions = async () => {
      if (!window.electronAPI?.listAccountActions) return
      setLoadingActions(true)
      try {
        const data = await window.electronAPI.listAccountActions(flatformType)
        if (!cancelled) setActions(data)
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, 'Không thể tải danh sách hành động'))
      } finally {
        if (!cancelled) setLoadingActions(false)
      }
    }
    loadActions()
    return () => { cancelled = true }
  }, [flatformType])

  useEffect(() => {
    if (!selectedGroup) return
    const settings = selectedGroup.settings || {}
    setName(selectedGroup.name)
    setFlatformType(selectedGroup.flatformType)
    setSleepBetweenActions(toInputValue(settings.sleepBetweenActions))
    const nextLimits: Record<string, ActionLimitDraft> = {}
    for (const [code, limit] of Object.entries(settings.byActionCode || {})) {
      nextLimits[code] = {
        dailyLimit: toInputValue(limit.dailyLimit),
        rateLimitCount: toInputValue(limit.rateLimitCount)
      }
    }
    setLimits(nextLimits)
  }, [selectedGroup])

  useEffect(() => {
    setSelectedMemberIds(new Set())
    setSelectedAddIds(new Set())
  }, [selectedGroupId])

  useEffect(() => {
    setSelectedAddIds(prev => {
      const allowedIds = new Set(selectableAddAccountIds)
      const next = new Set(Array.from(prev).filter(id => allowedIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableAddAccountIds])

  const startNew = () => {
    setSelectedGroupId(null)
    setName('')
    setSleepBetweenActions('')
    setLimits({})
    setSelectedMemberIds(new Set())
    setSelectedAddIds(new Set())
    setError(null)
  }

  useEffect(() => {
    if (canUseEmailFeature || flatformType !== 'email') return
    setFlatformType('facebook')
    startNew()
  }, [canUseEmailFeature, flatformType])

  const buildSettings = (): AccountGroupSettings => {
    const byActionCode: NonNullable<AccountGroupSettings['byActionCode']> = {}
    for (const [code, draft] of Object.entries(limits)) {
      const dailyLimit = parseOptionalNumber(draft.dailyLimit)
      const rateLimitCount = parseOptionalNumber(draft.rateLimitCount)
      if (dailyLimit !== undefined || rateLimitCount !== undefined) {
        byActionCode[code] = {
          ...(dailyLimit !== undefined ? { dailyLimit } : {}),
          ...(rateLimitCount !== undefined ? { rateLimitCount } : {})
        }
      }
    }

    const sleep = parseOptionalNumber(sleepBetweenActions)
    return {
      ...(sleep !== undefined ? { sleepBetweenActions: sleep } : {}),
      ...(Object.keys(byActionCode).length > 0 ? { byActionCode } : {})
    }
  }

  const updateLimit = (actionCode: string, key: keyof ActionLimitDraft, value: string) => {
    setLimits(prev => ({
      ...prev,
      [actionCode]: {
        dailyLimit: prev[actionCode]?.dailyLimit || '',
        rateLimitCount: prev[actionCode]?.rateLimitCount || '',
        [key]: value
      }
    }))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Tên nhóm không được để trống')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (flatformType === 'email' && !canUseEmailFeature) {
        setError('Tính năng Email chưa được kích hoạt hoặc đã hết hạn.')
        return
      }
      const payload = {
        name: name.trim(),
        flatformType,
        settings: buildSettings()
      }
      if (selectedGroup) {
        await onUpdateGroup(selectedGroup.id, payload)
      } else {
        const created = await onCreateGroup(payload)
        const selectedIds = Array.from(selectedAddIds)
        if (selectedIds.length > 0) {
          await onAssignAccounts(selectedIds, created.id)
          setSelectedAddIds(new Set())
        }
        setSelectedGroupId(created.id)
      }
      useUiStore.getState().showAlert(selectedGroup ? 'Đã cập nhật nhóm tài khoản' : 'Đã tạo nhóm tài khoản', 'success')
    } catch (err) {
      setError(getErrorMessage(err, 'Không thể lưu nhóm tài khoản'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (group: AutoAccountGroup) => {
    const usageCount = usageByGroupId.get(group.id) || 0
    if (usageCount > 0) {
      useUiStore.getState().showAlert('Không thể xoá nhóm đang có tài khoản', 'error')
      return
    }
    useUiStore.getState().showConfirm(
      `Xoá nhóm "${group.name}"?`,
      async () => {
        try {
          await onDeleteGroup(group.id)
          if (selectedGroupId === group.id) startNew()
        } catch (err) {
          useUiStore.getState().showAlert(getErrorMessage(err, 'Không thể xoá nhóm tài khoản'), 'error')
        }
      },
      { title: 'Xoá nhóm tài khoản', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleAddSelectedAccounts = async () => {
    if (!selectedGroup || selectedAddIds.size === 0) return
    const ids = Array.from(selectedAddIds)
    setUpdatingMembers(true)
    setError(null)
    try {
      await onAssignAccounts(ids, selectedGroup.id)
      setSelectedAddIds(new Set())
      useUiStore.getState().showAlert(`Đã thêm ${ids.length} tài khoản vào nhóm`, 'success')
    } catch (err) {
      setError(getErrorMessage(err, 'Không thể thêm tài khoản vào nhóm'))
    } finally {
      setUpdatingMembers(false)
    }
  }

  const handleRemoveSelectedAccounts = async () => {
    if (!selectedGroup || selectedMemberIds.size === 0) return
    const ids = Array.from(selectedMemberIds)
    setUpdatingMembers(true)
    setError(null)
    try {
      await onAssignAccounts(ids, null)
      setSelectedMemberIds(new Set())
      useUiStore.getState().showAlert(`Đã bỏ ${ids.length} tài khoản khỏi nhóm`, 'success')
    } catch (err) {
      setError(getErrorMessage(err, 'Không thể bỏ tài khoản khỏi nhóm'))
    } finally {
      setUpdatingMembers(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal account-group-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Nhóm tài khoản</div>
            <div className="account-info-subtitle">Cấu hình giới dùng chung theo nền tảng</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body account-group-modal-body">
          <div className="account-group-list-pane">
            <div className="account-group-toolbar">
              <select
                className="panel-input"
                value={flatformType}
                onChange={event => {
                  setFlatformType(event.target.value)
                  startNew()
                }}
                disabled={!!selectedGroup}
              >
                {platformOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button className="btn btn-secondary btn-icon" onClick={startNew} title="Tạo nhóm mới">
                <Plus size={14} />
              </button>
            </div>

            <div className="account-group-list">
              {groupsForPlatform.length === 0 ? (
                <div className="text-muted account-group-empty">Chưa có nhóm</div>
              ) : (
                groupsForPlatform.map(group => {
                  const usageCount = usageByGroupId.get(group.id) || 0
                  return (
                    <button
                      key={group.id}
                      className={`account-group-list-item ${selectedGroupId === group.id ? 'active' : ''}`}
                      onClick={() => setSelectedGroupId(group.id)}
                    >
                      <span>
                        <strong>{group.name}</strong>
                        <em>{usageCount} tài khoản</em>
                      </span>
                      <Trash2
                        size={14}
                        role="button"
                        tabIndex={0}
                        onClick={event => {
                          event.stopPropagation()
                          handleDelete(group)
                        }}
                      />
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div className="account-group-editor">
            <div className={`account-group-editor-heading ${isEditingGroup ? 'is-editing' : 'is-creating'}`}>
              <div>
                <strong>{isEditingGroup ? `Đang sửa nhóm: ${selectedGroup?.name}` : 'Đang tạo nhóm mới'}</strong>
                <span>
                  {isEditingGroup
                    ? 'Thay đổi cấu hình sẽ áp dụng cho các tài khoản đang thuộc nhóm này.'
                    : 'Chọn nền tảng và đặt tên nhóm mới.'}
                </span>
              </div>
              <em>{isEditingGroup ? 'Sửa nhóm' : 'Tạo mới'}</em>
            </div>

            <div className="account-group-basic-fields">
              <div className="stepper-form-group">
                <label>Tên nhóm</label>
                <input
                  className="stepper-input"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="Nhập tên nhóm"
                />
              </div>
            </div>

            <div className={`account-group-members-section ${selectedGroup ? '' : 'is-creating'}`}>
              {selectedGroup && (
                <div className="account-group-member-pane">
                  <div className="account-group-member-pane-header">
                    <div>
                      <strong>Tài khoản trong nhóm</strong>
                      <span>{memberAccounts.length} tài khoản</span>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={memberAccounts.length > 0 && selectedMemberIds.size === memberAccounts.length}
                        onChange={event => {
                          setSelectedMemberIds(event.target.checked
                            ? new Set(memberAccounts.map(account => account.id))
                            : new Set()
                          )
                        }}
                      />
                      Chọn tất cả
                    </label>
                  </div>

                  <div className="account-group-member-list">
                    {memberAccounts.length === 0 ? (
                      <div className="account-group-member-empty">Chưa có tài khoản trong nhóm</div>
                    ) : (
                      memberAccounts.map(account => (
                        <label key={account.id} className="account-group-member-option">
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.has(account.id)}
                            onChange={() => toggleSelectedId(setSelectedMemberIds, account.id)}
                          />
                          <span>
                            <strong>{account.name}</strong>
                            <em>{account.status} - {account.loginStatus}</em>
                          </span>
                        </label>
                      ))
                    )}
                  </div>

                  <button
                    className="btn btn-secondary"
                    onClick={handleRemoveSelectedAccounts}
                    disabled={updatingMembers || selectedMemberIds.size === 0}
                    type="button"
                  >
                    <UserMinus size={14} />
                    Bỏ khỏi nhóm
                  </button>
                </div>
              )}

              <div className="account-group-member-pane">
                <div className="account-group-member-pane-header">
                  <div>
                    <strong>Thêm tài khoản</strong>
                    <span>{selectableAddAccounts.length} có thể thêm</span>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectableAddAccountIds.length > 0 && selectedAddIds.size === selectableAddAccountIds.length}
                      disabled={selectableAddAccountIds.length === 0}
                      onChange={event => {
                        setSelectedAddIds(event.target.checked
                          ? new Set(selectableAddAccountIds)
                          : new Set()
                        )
                      }}
                    />
                    Chọn tất cả
                  </label>
                </div>

                <div className="account-group-member-list">
                  {addableAccounts.length === 0 ? (
                    <div className="account-group-member-empty">Không có tài khoản cùng nền tảng</div>
                  ) : (
                    addableAccounts.map(account => {
                      const isInAnotherGroup = Boolean(account.accountGroupId)
                      return (
                        <label
                          key={account.id}
                          className={`account-group-member-option ${isInAnotherGroup ? 'is-disabled' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAddIds.has(account.id)}
                            disabled={isInAnotherGroup}
                            onChange={() => toggleSelectedId(setSelectedAddIds, account.id)}
                          />
                          <span>
                            <strong>{account.name}</strong>
                            <em>{account.accountGroupName ? `Đang ở nhóm ${account.accountGroupName}` : 'Chưa thuộc nhóm'}</em>
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>

                {selectedGroup && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleAddSelectedAccounts}
                    disabled={updatingMembers || selectedAddIds.size === 0}
                    type="button"
                  >
                    <UserPlus size={14} />
                    Thêm vào nhóm
                  </button>
                )}
              </div>
            </div>

            <div className="account-group-limit-header">
              <strong>Cài đặt giới hạn</strong>
              {loadingActions && <span>Đang tải...</span>}
            </div>

            <div className="account-group-limit-panel">
              <div className="account-group-limit-sleep-row">
                <label>Thời gian nghỉ giữa 2 lần gửi (giây)</label>
                <input
                  type="number"
                  min={0}
                  className="stepper-input"
                  value={sleepBetweenActions}
                  onChange={event => setSleepBetweenActions(event.target.value)}
                  placeholder="Theo chiến dịch"
                />
              </div>

              <div className="account-group-limit-list">
                <div className="account-group-limit-table-header">
                  <span>Hành động</span>
                  <span>Giới hạn ngày</span>
                  <span>Giới hạn giờ</span>
                </div>
                {actions.map(action => {
                  const draft = limits[action.code] || { dailyLimit: '', rateLimitCount: '' }
                  return (
                    <div className="account-group-action-limit-row" key={action.code}>
                      <strong title={action.name}>{action.name}</strong>
                      <input
                        type="number"
                        min={1}
                        className="stepper-input"
                        value={draft.dailyLimit}
                        onChange={event => updateLimit(action.code, 'dailyLimit', event.target.value)}
                        placeholder="Theo chiến dịch"
                        aria-label={`Giới hạn ngày ${action.name}`}
                      />
                      <input
                        type="number"
                        min={1}
                        className="stepper-input"
                        value={draft.rateLimitCount}
                        onChange={event => updateLimit(action.code, 'rateLimitCount', event.target.value)}
                        placeholder="Theo chiến dịch"
                        aria-label={`Giới hạn giờ ${action.name}`}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {error && <div className="account-info-error">{error}</div>}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Đóng</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Đang lưu...' : (isEditingGroup ? 'Lưu thay đổi' : 'Tạo nhóm')}
          </button>
        </div>
      </div>
    </div>
  )
}
