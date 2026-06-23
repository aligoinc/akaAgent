import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { AutoAccountContact, AutoAccountContactGroup, ContactType } from '../../../../shared/types'

interface DataScanGroupManagementModalProps {
  activeContactType: ContactType
  platform?: string
  groupsLoading: boolean
  contactGroups: AutoAccountContactGroup[]
  activeGroupId: number | null
  groupContactsLoading: boolean
  filteredGroupContacts: AutoAccountContact[]
  groupContactsByStatusCount: number
  groupTableColSpan: number
  zaloTagNameById?: Map<string, string>
  akaBizTagNameById?: Map<number, string>
  onClose: () => void
  onActivateGroup: (groupId: number) => void
  onRenameGroup: (group: AutoAccountContactGroup, name: string) => void | Promise<void>
  onDeleteGroup: (group: AutoAccountContactGroup) => void
  onRemoveContacts: (contacts: AutoAccountContact[], onSuccess?: () => void) => void
}

const getContactStatusLabel = (contact: AutoAccountContact) => {
  if (contact.contactType === 'person') return contact.isFriend ? 'Bạn bè' : 'Không còn bạn bè'
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
  return 'Page Facebook'
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

const EMPTY_ZALO_TAG_NAME_BY_ID = new Map<string, string>()
const EMPTY_AKABIZ_TAG_NAME_BY_ID = new Map<number, string>()

const toRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const OLD_VN_MOBILE_PREFIX_MAP: Record<string, string> = {
  '0162': '032',
  '0163': '033',
  '0164': '034',
  '0165': '035',
  '0166': '036',
  '0167': '037',
  '0168': '038',
  '0169': '039',
  '0120': '070',
  '0121': '079',
  '0122': '077',
  '0126': '076',
  '0128': '078',
  '0123': '083',
  '0124': '084',
  '0125': '085',
  '0127': '081',
  '0129': '082',
  '0186': '056',
  '0188': '058',
  '0199': '059'
}

const phoneInputText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value).toString() : ''
  }
  const text = String(value).trim()
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? Math.trunc(parsed).toString() : text
  }
  return text
}

const normalizeVietnamMobilePhone = (value: unknown): string => {
  let digits = phoneInputText(value).replace(/\D+/g, '')
  if (!digits) return ''

  if (digits.startsWith('0084') && digits.length >= 13) {
    digits = `0${digits.slice(4)}`
  } else if (digits.startsWith('84') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`
  }
  if (digits.length === 9 && /^[35789]/.test(digits)) {
    digits = `0${digits}`
  }
  if (digits.length === 11) {
    const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[digits.slice(0, 4)]
    if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(4)}`
  }

  return /^0[35789]\d{8}$/.test(digits) ? digits : ''
}

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

export default function DataScanGroupManagementModal({
  activeContactType,
  platform = 'facebook',
  groupsLoading,
  contactGroups,
  activeGroupId,
  groupContactsLoading,
  filteredGroupContacts,
  groupContactsByStatusCount,
  groupTableColSpan,
  zaloTagNameById = EMPTY_ZALO_TAG_NAME_BY_ID,
  akaBizTagNameById = EMPTY_AKABIZ_TAG_NAME_BY_ID,
  onClose,
  onActivateGroup,
  onRenameGroup,
  onDeleteGroup,
  onRemoveContacts
}: DataScanGroupManagementModalProps) {
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<number | null>(null)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set())

  const visibleContactIds = useMemo(
    () => filteredGroupContacts.map(contact => contact.id),
    [filteredGroupContacts]
  )
  const allVisibleContactsSelected = visibleContactIds.length > 0 && visibleContactIds.every(id => selectedContactIds.has(id))
  const selectedContacts = useMemo(
    () => filteredGroupContacts.filter(contact => selectedContactIds.has(contact.id)),
    [filteredGroupContacts, selectedContactIds]
  )
  const showGroupApprovalColumn = activeContactType === 'group' && platform === 'facebook'
  const showAvatarColumn = platform === 'zalo'
  const showLinkColumn = platform === 'facebook' || (activeContactType === 'group' && platform === 'zalo')
  const showPhoneColumn = platform === 'zalo'
  const showZaloTagColumn = platform === 'zalo'
  const showAkaBizTagColumn = platform === 'zalo'

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
    if (!name || name === group.name) {
      cancelRenameGroup()
      return
    }
    setRenamingGroupId(group.id)
    try {
      await onRenameGroup(group, name)
      cancelRenameGroup()
    } catch {
      // Parent shows the user-facing error; keep the input open so the name can be adjusted.
    } finally {
      setRenamingGroupId(null)
    }
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

  const removeSelectedContacts = () => {
    if (selectedContacts.length === 0) return
    onRemoveContacts(selectedContacts, () => setSelectedContactIds(new Set()))
  }

  return (
    <div className="data-scan-group-modal-backdrop" onClick={onClose}>
      <div className="data-scan-groups-management-modal" onClick={event => event.stopPropagation()}>
        <div className="data-scan-group-modal-header">
          <div>
            <div className="data-scan-group-modal-title">Nhóm data</div>
            <div className="data-scan-group-modal-subtitle">Nhóm theo tài khoản và loại data đang chọn</div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>

        <div className="data-scan-groups-management-body">
          <div className="data-scan-groups-panel">
            <div className="data-scan-group-grid">
              <div className="data-scan-group-list">
                <div className="data-scan-group-list-title">Danh sách nhóm</div>
                {groupsLoading ? (
                  <div className="data-scan-group-empty">Đang tải nhóm data...</div>
                ) : contactGroups.length === 0 ? (
                  <div className="data-scan-group-empty">Chưa có nhóm data.</div>
                ) : (
                  contactGroups.map(group => {
                    return (
                    <div
                      key={group.id}
                      className={`data-scan-group-row ${activeGroupId === group.id ? 'is-active' : ''}`}
                      onClick={() => onActivateGroup(group.id)}
                    >
                      <div className="data-scan-group-row-main">
                        {editingGroupId === group.id ? (
                          <input
                            className="stepper-input data-scan-group-rename-input"
                            value={editingGroupName}
                            onChange={event => setEditingGroupName(event.target.value)}
                            onClick={event => event.stopPropagation()}
                            onKeyDown={event => {
                              if (event.key === 'Enter') submitRenameGroup(group)
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
                              submitRenameGroup(group)
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
                          onDeleteGroup(group)
                        }}
                        title="Xoá nhóm"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    )
                  })
                )}
              </div>

              <div className="data-scan-group-contact-list">
                <div className="data-scan-group-list-title">
                  <span>
                    Data trong nhóm
                    {activeGroupId && (
                      <span>
                        {' '}
                        ({filteredGroupContacts.length}/{groupContactsByStatusCount})
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
                                onClick={() => onRemoveContacts([contact])}
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
    </div>
  )
}
