import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { AutoAccountContact, AutoAccountContactGroup, ContactType } from '../../../../shared/types'

interface DataScanGroupManagementModalProps {
  activeContactType: ContactType
  groupsLoading: boolean
  contactGroups: AutoAccountContactGroup[]
  activeGroupId: number | null
  groupContactsLoading: boolean
  filteredGroupContacts: AutoAccountContact[]
  groupContactsByStatusCount: number
  groupTableColSpan: number
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

const getContactTypeLabel = (contactType: ContactType) => {
  if (contactType === 'person') return 'User Facebook'
  if (contactType === 'group') return 'Group Facebook'
  return 'Page Facebook'
}

export default function DataScanGroupManagementModal({
  activeContactType,
  groupsLoading,
  contactGroups,
  activeGroupId,
  groupContactsLoading,
  filteredGroupContacts,
  groupContactsByStatusCount,
  groupTableColSpan,
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
                              {group.contactCount || 0} data · {getContactTypeLabel(group.contactType)}
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
                        <th>Tên</th>
                        <th>UID</th>
                        <th>Link</th>
                        {activeContactType === 'person' && <th>Bạn bè</th>}
                        {activeContactType === 'group' && <th>Tham gia</th>}
                        {activeContactType === 'group' && <th>Duyệt bài</th>}
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
                            <td className="data-scan-text-cell data-scan-name-cell" title={contact.name || undefined}>
                              {contact.name || '-'}
                            </td>
                            <td className="data-scan-text-cell data-scan-uid-cell" title={contact.uid || undefined}>
                              {contact.uid || '-'}
                            </td>
                            <td className="data-scan-text-cell data-scan-link-cell" title={contact.url || undefined}>
                              {contact.url || '-'}
                            </td>
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
                            {activeContactType === 'group' && (
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
