import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { AutoAccount, AutoAccountContact, AutoAccountContactGroup, ContactType } from '../../../../shared/types'
import { normalizeVietnamMobilePhone } from '../../../../shared/phone'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import { getAccountPlatformLabel } from '../../utils/accountLabels'

type DataGroupPlatform = 'facebook' | 'zalo'
type DataGroupContactType = Extract<ContactType, 'person' | 'group' | 'page'>

interface DataGroupManagerModalProps {
  initialAccountId?: number | null
  initialGroupId?: number | null
  initialPlatform?: DataGroupPlatform | string
  initialContactType?: DataGroupContactType | ContactType
  lockContext?: boolean
  zaloTagNameById?: Map<string, string>
  akaBizTagNameById?: Map<number, string>
  onGroupsChanged?: () => void | Promise<void>
  onClose: () => void
}

const EMPTY_ZALO_TAG_NAME_BY_ID = new Map<string, string>()
const EMPTY_AKABIZ_TAG_NAME_BY_ID = new Map<number, string>()

const CONTACT_TYPE_OPTIONS: Record<DataGroupPlatform, Array<{ value: DataGroupContactType; label: string }>> = {
  facebook: [
    { value: 'person', label: 'User Facebook' },
    { value: 'group', label: 'Group Facebook' },
    { value: 'page', label: 'Page Facebook' }
  ],
  zalo: [
    { value: 'person', label: 'User Zalo' },
    { value: 'group', label: 'Group Zalo' }
  ]
}

const isDataGroupPlatform = (value: unknown): value is DataGroupPlatform => value === 'facebook' || value === 'zalo'

const normalizePlatform = (value?: string | null): DataGroupPlatform => (
  isDataGroupPlatform(value) ? value : 'facebook'
)

const normalizeContactType = (
  value: unknown,
  platform: DataGroupPlatform
): DataGroupContactType => {
  const allowed = CONTACT_TYPE_OPTIONS[platform].map(option => option.value)
  return allowed.includes(value as DataGroupContactType)
    ? value as DataGroupContactType
    : allowed[0]
}

const getContactStatusLabel = (contact: AutoAccountContact) => {
  if (contact.contactType === 'person') {
    if (contact.isFriend === true) return 'Bạn bè'
    if (contact.isFriend === false) return 'Người lạ'
    return 'Chưa xác định'
  }
  if (contact.contactType === 'group') return contact.isJoined ? 'Đã tham gia' : 'Chưa tham gia'
  return ''
}

const getGroupApprovalStatus = (contact: AutoAccountContact) => {
  if (contact.requiresPostApproval === true) return 'Chờ duyệt bài'
  if (contact.requiresPostApproval === false) return 'Không cần duyệt'
  return 'Chưa biết'
}

const getContactTypeLabel = (contactType: ContactType, platform: string = 'facebook') => {
  const isZalo = platform === 'zalo'
  if (contactType === 'person') return isZalo ? 'User Zalo' : 'User Facebook'
  if (contactType === 'group') return isZalo ? 'Group Zalo' : 'Group Facebook'
  if (contactType === 'page') return 'Page Facebook'
  return 'Data'
}

const getContactAvatarUrl = (contact: AutoAccountContact) => {
  const extra = contact.extraData || {}
  return String(
    extra.avatarUrl ||
    extra.avatar ||
    extra.avatar_url ||
    extra.fullAvatar ||
    extra.full_avatar ||
    ''
  ).trim()
}

const getContactInitial = (contact: AutoAccountContact) => {
  return String(contact.name || contact.uid || '?').trim().charAt(0).toLocaleUpperCase('vi-VN') || '?'
}

const renderContactAvatar = (contact: AutoAccountContact) => {
  const avatarUrl = getContactAvatarUrl(contact)
  return (
    <div className="data-scan-avatar" title={contact.name || contact.uid || undefined}>
      {avatarUrl ? (
        <img src={avatarUrl} alt="" loading="lazy" />
      ) : (
        <span>{getContactInitial(contact)}</span>
      )}
    </div>
  )
}

const toRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const getContactPhoneText = (contact: AutoAccountContact) => {
  const extra = toRecord(contact.extraData)
  const rawPayload = toRecord(extra.rawPayload)
  const value = [
    extra.phone,
    extra.phoneNumber,
    extra.phone_number,
    extra.mobilePhone,
    extra.mobile_phone,
    rawPayload.phone,
    rawPayload.phoneNumber,
    rawPayload.phone_number,
    rawPayload.mobilePhone,
    rawPayload.mobile_phone
  ].find(item => String(item || '').trim())
  return normalizeVietnamMobilePhone(value)
}

const splitTagText = (value: string) => value
  .split(/[,\n;]/)
  .map(item => item.trim())
  .filter(Boolean)

const addZaloTagLabel = (labels: string[], seen: Set<string>, value: unknown) => {
  const text = String(value || '').trim()
  if (!text) return
  const key = text.toLocaleLowerCase('vi-VN')
  if (seen.has(key)) return
  seen.add(key)
  labels.push(text)
}

const collectZaloTagLabelsFromValue = (
  value: unknown,
  tagNameById: Map<string, string>,
  labels: string[],
  seen: Set<string>
) => {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectZaloTagLabelsFromValue(item, tagNameById, labels, seen)
    return
  }
  if (typeof value === 'object') {
    const item = toRecord(value)
    const id = String(item.id || item.labelId || item.label_id || item.tagId || item.tag_id || '').trim()
    const mapped = id ? tagNameById.get(id) : ''
    const name = String(item.text || item.name || item.labelName || item.label_name || item.tagName || item.tag_name || '').trim()
    addZaloTagLabel(labels, seen, mapped || name || (id ? `#${id}` : ''))
    return
  }

  const raw = String(value || '').trim()
  if (!raw) return
  const pieces = splitTagText(raw)
  for (const piece of pieces.length > 0 ? pieces : [raw]) {
    addZaloTagLabel(labels, seen, tagNameById.get(piece) || piece)
  }
}

const getContactZaloTagLabels = (
  contact: AutoAccountContact,
  tagNameById: Map<string, string>
) => {
  const extra = toRecord(contact.extraData)
  const sources = [
    extra.zaloTagIds,
    extra.zalo_tag_ids,
    extra.labelIds,
    extra.label_ids,
    extra.tagIds,
    extra.tag_ids,
    extra.zaloTags,
    extra.zalo_tags,
    extra.labels,
    extra.tagNames,
    extra.tag_names,
    extra.zaloTagNames,
    extra.zalo_tag_names,
    extra.labelNames,
    extra.label_names,
    toRecord(extra.rawPayload).labelIds,
    toRecord(extra.rawPayload).labels,
    toRecord(extra.rawPayload).tagIds,
    toRecord(extra.rawPayload).tags
  ]
  const labels: string[] = []
  const seen = new Set<string>()
  for (const source of sources) collectZaloTagLabelsFromValue(source, tagNameById, labels, seen)
  return labels
}

const formatContactZaloTags = (
  contact: AutoAccountContact,
  tagNameById: Map<string, string>
) => getContactZaloTagLabels(contact, tagNameById).join(', ')

const renderZaloTagCell = (
  contact: AutoAccountContact,
  tagNameById: Map<string, string>
) => {
  const labels = getContactZaloTagLabels(contact, tagNameById)
  if (labels.length === 0) return <span className="data-scan-tag-empty">-</span>
  const visibleLabels = labels.slice(0, 2)
  const hiddenCount = labels.length - visibleLabels.length
  return (
    <div className="data-scan-tag-list" title={labels.join(', ')}>
      {visibleLabels.map(label => (
        <span key={label} className="data-scan-tag-chip is-zalo">{label}</span>
      ))}
      {hiddenCount > 0 && <span className="data-scan-tag-chip is-more">+{hiddenCount}</span>}
    </div>
  )
}

const normalizeContactAkaBizTagIds = (contact: AutoAccountContact) => (
  Array.isArray(contact.akaBizTagIds)
    ? Array.from(new Set(
      contact.akaBizTagIds
        .map(id => Number(id))
        .filter(id => Number.isFinite(id) && id > 0)
    ))
    : []
)

const getContactAkaBizTagLabels = (
  contact: AutoAccountContact,
  tagNameById: Map<number, string>
) => normalizeContactAkaBizTagIds(contact).map(id => tagNameById.get(id) || `#${id}`)

const formatContactAkaBizTags = (
  contact: AutoAccountContact,
  tagNameById: Map<number, string>
) => getContactAkaBizTagLabels(contact, tagNameById).join(', ')

const renderAkaBizTagCell = (
  contact: AutoAccountContact,
  tagNameById: Map<number, string>
) => {
  const labels = getContactAkaBizTagLabels(contact, tagNameById)
  if (labels.length === 0) return <span className="data-scan-tag-empty">-</span>
  const visibleLabels = labels.slice(0, 2)
  const hiddenCount = labels.length - visibleLabels.length
  return (
    <div className="data-scan-tag-list" title={labels.join(', ')}>
      {visibleLabels.map(label => (
        <span key={label} className="data-scan-tag-chip">{label}</span>
      ))}
      {hiddenCount > 0 && <span className="data-scan-tag-chip is-more">+{hiddenCount}</span>}
    </div>
  )
}

const getAccountPlatform = (account: AutoAccount | null | undefined): DataGroupPlatform => (
  normalizePlatform(account?.flatformType)
)

export default function DataGroupManagerModal({
  initialAccountId,
  initialGroupId,
  initialPlatform = 'facebook',
  initialContactType = 'person',
  lockContext = false,
  zaloTagNameById = EMPTY_ZALO_TAG_NAME_BY_ID,
  akaBizTagNameById = EMPTY_AKABIZ_TAG_NAME_BY_ID,
  onGroupsChanged,
  onClose
}: DataGroupManagerModalProps) {
  const { accounts, loadAccounts } = useCampaignStore()
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const groupsLoadSeqRef = useRef(0)
  const [accountId, setAccountId] = useState<number | ''>(initialAccountId || '')
  const [platform, setPlatform] = useState<DataGroupPlatform>(() => normalizePlatform(initialPlatform))
  const [contactType, setContactType] = useState<DataGroupContactType>(() => normalizeContactType(initialContactType, normalizePlatform(initialPlatform)))
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [contactGroups, setContactGroups] = useState<AutoAccountContactGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<number | null>(initialGroupId || null)
  const [groupContacts, setGroupContacts] = useState<AutoAccountContact[]>([])
  const [groupContactsLoading, setGroupContactsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<number | null>(null)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === accountId) || null,
    [accountId, accounts]
  )

  const availableAccounts = useMemo(
    () => accounts.filter(account => account.flatformType === 'facebook' || account.flatformType === 'zalo'),
    [accounts]
  )

  useEffect(() => {
    if (accountId || availableAccounts.length === 0) return
    const fallback = availableAccounts.find(account => getAccountPlatform(account) === platform) || availableAccounts[0]
    if (fallback) setAccountId(fallback.id)
  }, [accountId, availableAccounts, platform])

  useEffect(() => {
    if (!selectedAccount) {
      setPlatform(normalizePlatform(initialPlatform))
      setContactType(prev => normalizeContactType(prev, normalizePlatform(initialPlatform)))
      return
    }
    const nextPlatform = getAccountPlatform(selectedAccount)
    setPlatform(nextPlatform)
    setContactType(prev => normalizeContactType(prev, nextPlatform))
  }, [initialPlatform, selectedAccount])

  const notifyGroupsChanged = useCallback(async () => {
    await onGroupsChanged?.()
  }, [onGroupsChanged])

  const loadContactGroups = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      groupsLoadSeqRef.current += 1
      setContactGroups([])
      setActiveGroupId(null)
      setGroupsLoading(false)
      return
    }
    const loadSeq = ++groupsLoadSeqRef.current
    setGroupsLoading(true)
    try {
      const groups = await window.electronAPI.listContactGroups(accountId, contactType)
      if (loadSeq !== groupsLoadSeqRef.current) return
      setContactGroups(groups)
      setActiveGroupId(prev => prev && groups.some(group => group.id === prev) ? prev : groups[0]?.id || null)
    } catch (err: any) {
      console.error('Failed to load contact groups:', err)
      if (loadSeq === groupsLoadSeqRef.current) {
        showAlert(err?.message || 'Không thể tải danh sách nhóm data.', 'error')
      }
    } finally {
      if (loadSeq === groupsLoadSeqRef.current) {
        setGroupsLoading(false)
      }
    }
  }, [accountId, contactType, showAlert])

  useEffect(() => {
    if (!initialGroupId) return
    const initialPlatformValue = normalizePlatform(initialPlatform)
    const initialContactTypeValue = normalizeContactType(initialContactType, initialPlatformValue)
    if (initialAccountId && accountId !== initialAccountId) return
    if (contactType !== initialContactTypeValue) return

    setActiveGroupId(initialGroupId)
    void loadContactGroups()
  }, [accountId, contactType, initialAccountId, initialContactType, initialGroupId, initialPlatform, loadContactGroups])

  useEffect(() => {
    setGroupContacts([])
    setSelectedContactIds(new Set())
    setEditingGroupId(null)
    setEditingGroupName('')
    void loadContactGroups()
  }, [loadContactGroups])

  useEffect(() => {
    let cancelled = false
    const loadContacts = async () => {
      if (!window.electronAPI || !activeGroupId) {
        setGroupContacts([])
        return
      }
      setGroupContactsLoading(true)
      try {
        const data = await window.electronAPI.listContactGroupContacts(activeGroupId)
        if (!cancelled) setGroupContacts(data)
      } catch (err: any) {
        console.error('Failed to load contact group contacts:', err)
        if (!cancelled) showAlert(err?.message || 'Không thể tải data trong nhóm.', 'error')
      } finally {
        if (!cancelled) setGroupContactsLoading(false)
      }
    }
    void loadContacts()
    return () => {
      cancelled = true
    }
  }, [activeGroupId, showAlert])

  const activeContactType = useMemo(
    () => contactGroups.find(group => group.id === activeGroupId)?.contactType || contactType,
    [activeGroupId, contactGroups, contactType]
  )
  const showGroupApprovalColumn = activeContactType === 'group' && platform === 'facebook'
  const showAvatarColumn = platform === 'zalo'
  const showLinkColumn = platform === 'facebook' || (activeContactType === 'group' && platform === 'zalo')
  const showPhoneColumn = platform === 'zalo'
  const showZaloTagColumn = platform === 'zalo'
  const showAkaBizTagColumn = platform === 'zalo'

  const filteredGroupContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN')
    if (!query) return groupContacts
    return groupContacts.filter(contact => [
      contact.name,
      contact.uid,
      getContactPhoneText(contact),
      contact.url,
      getContactStatusLabel(contact),
      contact.contactType === 'group' && platform === 'facebook' ? getGroupApprovalStatus(contact) : '',
      showZaloTagColumn ? formatContactZaloTags(contact, zaloTagNameById) : '',
      showAkaBizTagColumn ? formatContactAkaBizTags(contact, akaBizTagNameById) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [akaBizTagNameById, groupContacts, platform, search, showAkaBizTagColumn, showZaloTagColumn, zaloTagNameById])

  const groupTableColSpan = 4
    + (showAvatarColumn ? 1 : 0)
    + (showPhoneColumn ? 1 : 0)
    + (activeContactType === 'person' ? 1 : 0)
    + (activeContactType === 'group' ? 1 : 0)
    + (showGroupApprovalColumn ? 1 : 0)
    + (showLinkColumn ? 1 : 0)
    + (showZaloTagColumn ? 1 : 0)
    + (showAkaBizTagColumn ? 1 : 0)

  const visibleContactIds = useMemo(
    () => filteredGroupContacts.map(contact => contact.id),
    [filteredGroupContacts]
  )
  const allVisibleContactsSelected = visibleContactIds.length > 0 && visibleContactIds.every(id => selectedContactIds.has(id))
  const selectedContacts = useMemo(
    () => filteredGroupContacts.filter(contact => selectedContactIds.has(contact.id)),
    [filteredGroupContacts, selectedContactIds]
  )

  useEffect(() => {
    setSelectedContactIds(new Set())
  }, [activeGroupId])

  useEffect(() => {
    const visibleIds = new Set(visibleContactIds)
    setSelectedContactIds(prev => {
      const next = new Set(Array.from(prev).filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleContactIds])

  const startRenameGroup = (group: AutoAccountContactGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  const cancelRenameGroup = () => {
    setEditingGroupId(null)
    setEditingGroupName('')
  }

  const submitRenameGroup = async (group: AutoAccountContactGroup) => {
    const name = editingGroupName.trim()
    if (!window.electronAPI || !name || name === group.name) {
      cancelRenameGroup()
      return
    }
    setRenamingGroupId(group.id)
    try {
      const updated = await window.electronAPI.updateContactGroup(group.id, name)
      setContactGroups(prev => prev.map(item => item.id === group.id ? { ...item, ...updated } : item))
      showAlert('Đã đổi tên nhóm data.', 'success')
      cancelRenameGroup()
      await notifyGroupsChanged()
    } catch (err: any) {
      console.error('Failed to rename contact group:', err)
      showAlert(err?.message || 'Không thể đổi tên nhóm data.', 'error')
    } finally {
      setRenamingGroupId(null)
    }
  }

  const handleDeleteGroup = (group: AutoAccountContactGroup) => {
    if (!window.electronAPI) return
    showConfirm(
      `Xoá nhóm "${group.name}"? Data gốc sẽ không bị xoá.`,
      async () => {
        try {
          await window.electronAPI.deleteContactGroup(group.id)
          setContactGroups(prev => prev.filter(item => item.id !== group.id))
          setActiveGroupId(prev => prev === group.id ? null : prev)
          if (activeGroupId === group.id) setGroupContacts([])
          showAlert('Đã xoá nhóm data.', 'success')
          await notifyGroupsChanged()
        } catch (err: any) {
          console.error('Failed to delete contact group:', err)
          showAlert(err?.message || 'Không thể xoá nhóm data.', 'error')
        }
      },
      { title: 'Xoá nhóm data', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const toggleContact = (contactId: number) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  const toggleAllVisibleContacts = () => {
    setSelectedContactIds(prev => {
      const next = new Set(prev)
      if (allVisibleContactsSelected) {
        for (const id of visibleContactIds) next.delete(id)
      } else {
        for (const id of visibleContactIds) next.add(id)
      }
      return next
    })
  }

  const handleRemoveContacts = (contactsToRemove: AutoAccountContact[], onSuccess?: () => void) => {
    if (!window.electronAPI || !activeGroupId) return
    const contactIds = Array.from(new Set(contactsToRemove.map(contact => contact.id)))
    if (contactIds.length === 0) return
    const label = contactIds.length === 1
      ? `"${contactsToRemove[0]?.name || contactsToRemove[0]?.uid || 'data'}"`
      : `${contactIds.length} data đã chọn`
    showConfirm(
      `Xoá ${label} khỏi nhóm? Data gốc sẽ không bị xoá.`,
      async () => {
        try {
          await window.electronAPI.removeContactsFromGroup(activeGroupId, contactIds)
          const contactIdSet = new Set(contactIds)
          setGroupContacts(prev => prev.filter(item => !contactIdSet.has(item.id)))
          await loadContactGroups()
          onSuccess?.()
          showAlert('Đã xoá data khỏi nhóm.', 'success')
          await notifyGroupsChanged()
        } catch (err: any) {
          console.error('Failed to remove contact from group:', err)
          showAlert(err?.message || 'Không thể xoá data khỏi nhóm.', 'error')
        }
      },
      { title: 'Xoá data khỏi nhóm', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const removeSelectedContacts = () => {
    if (selectedContacts.length === 0) return
    handleRemoveContacts(selectedContacts, () => setSelectedContactIds(new Set()))
  }

  const handleAccountChange = (nextAccountId: number | '') => {
    setAccountId(nextAccountId)
    setActiveGroupId(null)
    setGroupContacts([])
    const nextAccount = accounts.find(account => account.id === nextAccountId)
    if (nextAccount) {
      const nextPlatform = getAccountPlatform(nextAccount)
      setPlatform(nextPlatform)
      setContactType(prev => normalizeContactType(prev, nextPlatform))
    }
  }

  const handleContactTypeChange = (nextContactType: DataGroupContactType) => {
    setContactType(nextContactType)
    setActiveGroupId(null)
    setGroupContacts([])
  }

  return createPortal(
    <div className="data-scan-group-modal-backdrop data-group-manager-backdrop" onClick={onClose}>
      <div className="data-scan-groups-management-modal" onClick={event => event.stopPropagation()}>
        <div className="data-scan-group-modal-header">
          <div>
            <div className="data-scan-group-modal-title">Nhóm data</div>
            <div className="data-scan-group-modal-subtitle">
              {lockContext ? 'Mở từ quét data, có thể đổi tài khoản hoặc loại data' : 'Quản lý nhóm data theo từng tài khoản'}
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="data-group-manager-toolbar">
          <div className="data-group-manager-field">
            <label>Tài khoản</label>
            <select
              className="stepper-input"
              value={accountId}
              onChange={event => handleAccountChange(event.target.value ? Number(event.target.value) : '')}
            >
              <option value="">Chọn tài khoản</option>
              {availableAccounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.name} ({getAccountPlatformLabel(account)})
                </option>
              ))}
            </select>
          </div>
          <div className="data-group-manager-field">
            <label>Loại data</label>
            <select
              className="stepper-input"
              value={contactType}
              onChange={event => handleContactTypeChange(event.target.value as DataGroupContactType)}
              disabled={!accountId}
            >
              {CONTACT_TYPE_OPTIONS[platform].map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="data-group-manager-search">
            <Search size={15} />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Tìm data trong nhóm"
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void loadContactGroups()}
            disabled={!accountId || groupsLoading}
            title="Load lại nhóm data"
          >
            <RefreshCw size={13} className={groupsLoading ? 'animate-spin' : undefined} />
            Load lại
          </button>
        </div>

        <div className="data-scan-groups-management-body">
          <div className="data-scan-groups-panel">
            <div className="data-scan-group-grid">
              <div className="data-scan-group-list">
                <div className="data-scan-group-list-title">Danh sách nhóm</div>
                {!accountId ? (
                  <div className="data-scan-group-empty">Chọn tài khoản để xem nhóm data.</div>
                ) : groupsLoading ? (
                  <div className="data-scan-group-empty">Đang tải nhóm data...</div>
                ) : contactGroups.length === 0 ? (
                  <div className="data-scan-group-empty">Chưa có nhóm data.</div>
                ) : (
                  contactGroups.map(group => (
                    <div
                      key={group.id}
                      className={`data-scan-group-row ${activeGroupId === group.id ? 'is-active' : ''}`}
                      onClick={() => setActiveGroupId(group.id)}
                    >
                      <div className="data-scan-group-row-main">
                        {editingGroupId === group.id ? (
                          <input
                            className="stepper-input data-scan-group-rename-input"
                            value={editingGroupName}
                            onChange={event => setEditingGroupName(event.target.value)}
                            onClick={event => event.stopPropagation()}
                            onKeyDown={event => {
                              if (event.key === 'Enter') void submitRenameGroup(group)
                              if (event.key === 'Escape') cancelRenameGroup()
                            }}
                            disabled={renamingGroupId === group.id}
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="data-scan-group-name">{group.name}</div>
                            <div className="data-scan-group-count">
                              {group.contactCount || 0} data · {getContactTypeLabel(group.contactType, platform)}
                            </div>
                          </>
                        )}
                      </div>
                      {editingGroupId === group.id ? (
                        <>
                          <button
                            className="btn-icon"
                            onClick={event => {
                              event.stopPropagation()
                              void submitRenameGroup(group)
                            }}
                            disabled={renamingGroupId === group.id}
                            title="Lưu tên nhóm"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={event => {
                              event.stopPropagation()
                              cancelRenameGroup()
                            }}
                            disabled={renamingGroupId === group.id}
                            title="Huỷ đổi tên"
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-icon"
                          onClick={event => {
                            event.stopPropagation()
                            startRenameGroup(group)
                          }}
                          title="Đổi tên nhóm"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        className="btn-icon text-error"
                        onClick={event => {
                          event.stopPropagation()
                          handleDeleteGroup(group)
                        }}
                        title="Xoá nhóm"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="data-scan-group-contact-list">
                <div className="data-scan-group-list-title">
                  <span>
                    Data trong nhóm
                    {activeGroupId && (
                      <span>
                        {' '}
                        ({filteredGroupContacts.length}/{groupContacts.length})
                      </span>
                    )}
                  </span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={removeSelectedContacts}
                    disabled={selectedContacts.length === 0}
                  >
                    <Trash2 size={12} />
                    Xoá đã chọn
                  </button>
                </div>
                <div className="stepper-grid-container data-scan-group-table-wrap">
                  <table className="campaign-grid data-scan-table">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>
                          <input
                            type="checkbox"
                            checked={allVisibleContactsSelected}
                            onChange={toggleAllVisibleContacts}
                            disabled={!activeGroupId || filteredGroupContacts.length === 0}
                          />
                        </th>
                        {showAvatarColumn && <th style={{ width: 72 }}>Ảnh đại diện</th>}
                        <th>Tên</th>
                        {showPhoneColumn && <th>Số điện thoại</th>}
                        <th>UID</th>
                        {showZaloTagColumn && <th>Tag Zalo</th>}
                        {showAkaBizTagColumn && <th>Tag akaBiz</th>}
                        {showLinkColumn && <th>Link</th>}
                        {activeContactType === 'person' && <th>Bạn bè</th>}
                        {activeContactType === 'group' && <th>Tham gia</th>}
                        {showGroupApprovalColumn && <th>Duyệt bài</th>}
                        <th style={{ width: 44 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!activeGroupId ? (
                        <tr><td colSpan={groupTableColSpan} className="text-center text-muted">Chọn một nhóm để xem data.</td></tr>
                      ) : groupContactsLoading ? (
                        <tr><td colSpan={groupTableColSpan} className="text-center">Đang tải data trong nhóm...</td></tr>
                      ) : filteredGroupContacts.length === 0 ? (
                        <tr><td colSpan={groupTableColSpan} className="text-center text-muted">Không có data phù hợp với bộ lọc.</td></tr>
                      ) : (
                        filteredGroupContacts.map(contact => (
                          <tr key={contact.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedContactIds.has(contact.id)}
                                onChange={() => toggleContact(contact.id)}
                              />
                            </td>
                            {showAvatarColumn && <td>{renderContactAvatar(contact)}</td>}
                            <td className="data-scan-text-cell data-scan-name-cell" title={contact.name || undefined}>
                              {contact.name || '-'}
                            </td>
                            {showPhoneColumn && (
                              <td className="data-scan-text-cell data-scan-phone-cell" title={getContactPhoneText(contact) || undefined}>
                                {getContactPhoneText(contact) || '-'}
                              </td>
                            )}
                            <td className="data-scan-text-cell data-scan-uid-cell" title={contact.uid || undefined}>
                              {contact.uid || '-'}
                            </td>
                            {showZaloTagColumn && (
                              <td className="data-scan-tag-cell">
                                {renderZaloTagCell(contact, zaloTagNameById)}
                              </td>
                            )}
                            {showAkaBizTagColumn && (
                              <td className="data-scan-tag-cell">
                                {renderAkaBizTagCell(contact, akaBizTagNameById)}
                              </td>
                            )}
                            {showLinkColumn && (
                              <td className="data-scan-text-cell data-scan-link-cell" title={contact.url || undefined}>
                                {contact.url || '-'}
                              </td>
                            )}
                            {activeContactType === 'person' && (
                              <td>
                                <span className={`data-scan-status-badge ${contact.isFriend ? 'is-active' : 'is-muted'}`}>
                                  {getContactStatusLabel(contact)}
                                </span>
                              </td>
                            )}
                            {activeContactType === 'group' && (
                              <td>
                                <span className={`data-scan-status-badge ${contact.isJoined ? 'is-active' : 'is-muted'}`}>
                                  {getContactStatusLabel(contact)}
                                </span>
                              </td>
                            )}
                            {showGroupApprovalColumn && (
                              <td>
                                <span className="data-scan-status-badge">{getGroupApprovalStatus(contact)}</span>
                              </td>
                            )}
                            <td>
                              <button
                                className="btn-icon text-error"
                                onClick={() => handleRemoveContacts([contact])}
                                title="Xoá khỏi nhóm"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
