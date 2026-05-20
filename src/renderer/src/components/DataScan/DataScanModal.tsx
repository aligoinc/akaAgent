import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Folder, Maximize2, Minimize2, Plus, RefreshCw, Search, Square, X } from 'lucide-react'
import { utils, writeFile } from 'xlsx'
import { AutoAccountContact, AutoAccountContactGroup, ContactType } from '../../../../shared/types'
import { useCampaignStore } from '../../stores/campaignStore'
import { useUiStore } from '../../stores/uiStore'
import DataScanGroupManagementModal from './DataScanGroupManagementModal'
import DataScanGroupSelectionModal from './DataScanGroupSelectionModal'

export type DataScanAction = 'facebook_friends' | 'facebook_groups' | 'facebook_pages'
type ContactStatusFilter = 'active' | 'inactive' | 'all'

interface DataScanActionDef {
  id: DataScanAction
  label: string
  contactType: ContactType
  emptyText: string
  loadingText: string
}

interface DataScanModalProps {
  initialAction?: DataScanAction
  initialAccountId?: number
  initialShowGroupPanel?: boolean
  initialStatusFilter?: ContactStatusFilter
  lockAction?: boolean
  onClose: () => void
  onSelect?: (contacts: AutoAccountContact[]) => void
}

const DATA_SCAN_ACTIONS: DataScanActionDef[] = [
  {
    id: 'facebook_friends',
    label: 'Facebook - Lấy danh sách bạn bè',
    contactType: 'person',
    emptyText: 'Chưa có dữ liệu bạn bè',
    loadingText: 'Đang tải danh sách bạn bè...'
  },
  {
    id: 'facebook_groups',
    label: 'Facebook - Lấy danh sách group',
    contactType: 'group',
    emptyText: 'Chưa có dữ liệu group',
    loadingText: 'Đang tải danh sách group...'
  },
  {
    id: 'facebook_pages',
    label: 'Facebook - Lấy danh sách page',
    contactType: 'page',
    emptyText: 'Chưa có dữ liệu page',
    loadingText: 'Đang tải danh sách page...'
  }
]

const EXPORT_HEADERS = ['Tên', 'Uid']

const formatExportTimestamp = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('')
}

const sanitizeFileSegment = (value: string) => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'data'
}

const getContactValue = (contact: AutoAccountContact) => contact.url || contact.uid || ''

const getContactInfo = (contact: AutoAccountContact) => {
  const extra = contact.extraData || {}
  const category = typeof extra.category === 'string' ? extra.category : ''
  const lastActivityText = typeof extra.lastActivityText === 'string' ? extra.lastActivityText : ''
  return category || lastActivityText || ''
}

const getGroupApprovalStatus = (contact: AutoAccountContact) => {
  if (contact.requiresPostApproval === true) return 'Chờ duyệt bài'
  if (contact.requiresPostApproval === false) return 'Không cần duyệt'
  return 'Chưa biết'
}

const getContactStatusLabel = (contact: AutoAccountContact) => {
  if (contact.contactType === 'person') return contact.isFriend ? 'Bạn bè' : 'Không còn bạn bè'
  if (contact.contactType === 'group') return contact.isJoined ? 'Đã tham gia' : 'Chưa tham gia'
  return ''
}

const getContactTypeLabel = (contactType: ContactType) => {
  if (contactType === 'person') return 'User Facebook'
  if (contactType === 'group') return 'Group Facebook'
  return 'Page Facebook'
}

const getStatusFilterOptions = (contactType: ContactType): Array<{ value: ContactStatusFilter; label: string }> => {
  if (contactType === 'person') {
    return [
      { value: 'active', label: 'Bạn bè' },
      { value: 'inactive', label: 'Không còn bạn bè' },
      { value: 'all', label: 'Tất cả' }
    ]
  }
  if (contactType === 'group') {
    return [
      { value: 'active', label: 'Đã tham gia' },
      { value: 'inactive', label: 'Chưa tham gia' },
      { value: 'all', label: 'Tất cả' }
    ]
  }
  return [{ value: 'all', label: 'Tất cả' }]
}

const getDedupeKey = (contact: AutoAccountContact) => {
  const value = getContactValue(contact) || contact.name || String(contact.id)
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./i, '').replace(/^web\./i, '').replace(/^m\./i, '').toLowerCase()
    if (url.pathname === '/profile.php' && url.searchParams.get('id')) {
      return `${host}/profile.php?id=${url.searchParams.get('id')}`
    }
    return `${host}${url.pathname.replace(/\/+$/g, '')}`.toLowerCase()
  } catch {
    return value.trim().replace(/\/+$/g, '').toLowerCase()
  }
}

const dedupeContacts = (contacts: AutoAccountContact[]) => {
  const seen = new Set<string>()
  const result: AutoAccountContact[] = []
  for (const contact of contacts) {
    const key = getDedupeKey(contact)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(contact)
  }
  return result
}

export default function DataScanModal({
  initialAction = 'facebook_friends',
  initialAccountId,
  initialShowGroupPanel = false,
  initialStatusFilter,
  lockAction = false,
  onClose,
  onSelect
}: DataScanModalProps) {
  const { accounts, loadAccounts } = useCampaignStore()
  const showAlert = useUiStore(state => state.showAlert)
  const showConfirm = useUiStore(state => state.showConfirm)
  const mountedRef = useRef(true)
  const scanRunIdRef = useRef(0)
  const stoppedScanIdsRef = useRef<Set<number>>(new Set())
  const completedScanIdsRef = useRef<Set<number>>(new Set())
  const [action, setAction] = useState<DataScanAction>(initialAction)
  const [accountId, setAccountId] = useState<number | ''>(initialAccountId || '')
  const [contacts, setContacts] = useState<AutoAccountContact[]>([])
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [statusFilter, setStatusFilter] = useState<ContactStatusFilter>(initialStatusFilter || 'active')
  const [dedupeOnOutput, setDedupeOnOutput] = useState(true)
  const [rangeStart, setRangeStart] = useState(1)
  const [rangeEnd, setRangeEnd] = useState(100)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const [minimized, setMinimized] = useState(false)
  const [contactGroups, setContactGroups] = useState<AutoAccountContactGroup[]>([])
  const [allContactGroups, setAllContactGroups] = useState<AutoAccountContactGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [showAddGroupModal, setShowAddGroupModal] = useState(false)
  const [showNewGroupInput, setShowNewGroupInput] = useState(false)
  const [modalSelectedGroupIds, setModalSelectedGroupIds] = useState<Set<number>>(new Set())
  const [savingGroupMembers, setSavingGroupMembers] = useState(false)
  const [showGroupPanel, setShowGroupPanel] = useState(initialShowGroupPanel)
  const [showGroupSelectionModal, setShowGroupSelectionModal] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null)
  const [groupContacts, setGroupContacts] = useState<AutoAccountContact[]>([])
  const [groupContactsLoading, setGroupContactsLoading] = useState(false)
  const [groupContactCache, setGroupContactCache] = useState<Record<number, AutoAccountContact[]>>({})

  const actionDef = useMemo(
    () => DATA_SCAN_ACTIONS.find(item => item.id === action) || DATA_SCAN_ACTIONS[0],
    [action]
  )
  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === accountId),
    [accounts, accountId]
  )
  const statusFilterOptions = useMemo(
    () => getStatusFilterOptions(actionDef.contactType),
    [actionDef.contactType]
  )
  const hasStatusFilter = actionDef.contactType === 'person' || actionDef.contactType === 'group'

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (accountId !== '') return
    const preferred = initialAccountId
      ? accounts.find(account => account.id === initialAccountId)
      : accounts.find(account => account.flatformType === 'facebook') || accounts[0]
    if (preferred) setAccountId(preferred.id)
  }, [accountId, accounts, initialAccountId])

  const loadCachedContacts = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      setContacts([])
      return
    }
    setLoading(true)
    try {
      const data = await window.electronAPI.listContacts(accountId, actionDef.contactType)
      setContacts(data)
      setGroupContactCache({})
    } catch (err: any) {
      console.error('Failed to load scan contacts:', err)
      showAlert(err?.message || 'Không thể tải danh sách data.', 'error')
    } finally {
      setLoading(false)
    }
  }, [accountId, actionDef.contactType, showAlert])

  const loadContactGroups = useCallback(async () => {
    if (!window.electronAPI || !accountId) {
      setContactGroups([])
      setAllContactGroups([])
      setActiveGroupId(null)
      return
    }
    setGroupsLoading(true)
    try {
      const [groups, allGroups] = await Promise.all([
        window.electronAPI.listContactGroups(accountId, actionDef.contactType),
        window.electronAPI.listContactGroups(accountId)
      ])
      setContactGroups(groups)
      setAllContactGroups(allGroups)
      setActiveGroupId(prev => prev && allGroups.some(group => group.id === prev) ? prev : allGroups[0]?.id || null)
    } catch (err: any) {
      console.error('Failed to load contact groups:', err)
      showAlert(err?.message || 'Không thể tải danh sách nhóm data.', 'error')
    } finally {
      setGroupsLoading(false)
    }
  }, [accountId, actionDef.contactType, showAlert])

  const loadContactsForGroup = useCallback(async (groupId: number, force = false): Promise<AutoAccountContact[]> => {
    if (!window.electronAPI) return []
    if (!force && groupContactCache[groupId]) return groupContactCache[groupId]
    const data = await window.electronAPI.listContactGroupContacts(groupId)
    setGroupContactCache(prev => ({ ...prev, [groupId]: data }))
    return data
  }, [groupContactCache])

  useEffect(() => {
    setSelectedIds(new Set())
    setSelectedGroupIds(new Set())
    setModalSelectedGroupIds(new Set())
    setStatusFilter(hasStatusFilter ? (initialStatusFilter || 'active') : 'all')
    setNewGroupName('')
    setShowNewGroupInput(false)
    setShowAddGroupModal(false)
    setShowGroupPanel(initialShowGroupPanel)
    setShowGroupSelectionModal(false)
    setActiveGroupId(null)
    setGroupContacts([])
    setGroupContactCache({})
    setAllContactGroups([])
    loadCachedContacts()
    loadContactGroups()
  }, [hasStatusFilter, initialShowGroupPanel, initialStatusFilter, loadCachedContacts, loadContactGroups])

  useEffect(() => {
    let cancelled = false
    async function loadActiveGroupContacts() {
      if (!activeGroupId) {
        setGroupContacts([])
        return
      }
      setGroupContactsLoading(true)
      try {
        const data = await loadContactsForGroup(activeGroupId)
        if (!cancelled) setGroupContacts(data)
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load contacts in group:', err)
          showAlert(err?.message || 'Không thể tải data trong nhóm.', 'error')
        }
      } finally {
        if (!cancelled) setGroupContactsLoading(false)
      }
    }
    loadActiveGroupContacts()
    return () => {
      cancelled = true
    }
  }, [activeGroupId, loadContactsForGroup, showAlert])

  useEffect(() => {
    if (!window.electronAPI?.onContactsProgress) return
    const unsubscribe = window.electronAPI.onContactsProgress(({ accountId: progressAccountId, contactType, message }) => {
      if (progressAccountId !== undefined && accountId !== '' && progressAccountId !== accountId) return
      if (contactType !== undefined && contactType !== actionDef.contactType) return
      setProgressMessages(prev => [...prev.slice(-4), message])
    })
    return unsubscribe
  }, [accountId, actionDef.contactType])

  useEffect(() => {
    if (!window.electronAPI?.onContactsCompleted || accountId === '') return
    const unsubscribe = window.electronAPI.onContactsCompleted(({ accountId: completedAccountId, contactType, result }) => {
      if (completedAccountId !== accountId || contactType !== actionDef.contactType) return

      const scanId = scanRunIdRef.current
      if (scanId === 0) return
      if (completedScanIdsRef.current.has(scanId)) return
      completedScanIdsRef.current.add(scanId)

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      setScanLoading(false)
      setMinimized(false)
      loadCachedContacts()
      loadContactGroups()

      if (!result.success) {
        if (!wasStopped) showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      if (!wasStopped) showAlert(`Đã tải ${result.count} data.`, 'success')
    })
    return unsubscribe
  }, [accountId, actionDef.contactType, loadCachedContacts, loadContactGroups, showAlert])

  const matchesStatusFilter = useCallback((contact: AutoAccountContact) => {
    if (statusFilter === 'all') return true
    if (actionDef.contactType === 'person') {
      return statusFilter === 'active' ? contact.isFriend === true : contact.isFriend !== true
    }
    if (actionDef.contactType === 'group') {
      return statusFilter === 'active' ? contact.isJoined === true : contact.isJoined !== true
    }
    return true
  }, [actionDef.contactType, statusFilter])

  const visibleContacts = useMemo(() => {
    return contacts.filter(matchesStatusFilter)
  }, [contacts, matchesStatusFilter])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN')
    if (!query) return visibleContacts
    return visibleContacts.filter(contact => [
      contact.name,
      contact.uid,
      contact.url,
      getContactInfo(contact),
      getContactStatusLabel(contact),
      actionDef.contactType === 'group' ? getGroupApprovalStatus(contact) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [actionDef.contactType, search, visibleContacts])

  const allVisibleSelected = filteredContacts.length > 0 && filteredContacts.every(contact => selectedIds.has(contact.id))
  const selectedContacts = useMemo(
    () => visibleContacts.filter(contact => selectedIds.has(contact.id)),
    [selectedIds, visibleContacts]
  )
  const selectedGroupContacts = useMemo(() => {
    const rows: AutoAccountContact[] = []
    selectedGroupIds.forEach(groupId => {
      rows.push(...(groupContactCache[groupId] || []).filter(matchesStatusFilter))
    })
    return rows
  }, [groupContactCache, matchesStatusFilter, selectedGroupIds])
  const rawOutputContacts = useMemo(
    () => [...selectedContacts, ...selectedGroupContacts],
    [selectedContacts, selectedGroupContacts]
  )
  const outputContacts = useMemo(
    () => dedupeOnOutput ? dedupeContacts(rawOutputContacts) : rawOutputContacts,
    [dedupeOnOutput, rawOutputContacts]
  )
  const activeContactGroup = useMemo(
    () => allContactGroups.find(group => group.id === activeGroupId) || null,
    [activeGroupId, allContactGroups]
  )
  const activeGroupContactType = activeContactGroup?.contactType || actionDef.contactType
  const groupContactsByStatus = useMemo(
    () => activeGroupContactType === actionDef.contactType ? groupContacts.filter(matchesStatusFilter) : groupContacts,
    [activeGroupContactType, actionDef.contactType, groupContacts, matchesStatusFilter]
  )
  const filteredGroupContacts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN')
    if (!query) return groupContactsByStatus
    return groupContactsByStatus.filter(contact => [
      contact.name,
      contact.uid,
      contact.url,
      getContactInfo(contact),
      getContactStatusLabel(contact),
      contact.contactType === 'group' ? getGroupApprovalStatus(contact) : ''
    ].some(value => String(value || '').toLocaleLowerCase('vi-VN').includes(query)))
  }, [groupContactsByStatus, search])
  const tableColSpan = actionDef.contactType === 'group' ? 7 : actionDef.contactType === 'person' ? 6 : 5
  const groupTableColSpan = activeGroupContactType === 'group' ? 7 : activeGroupContactType === 'person' ? 6 : 5
  const emptyTableText = contacts.length === 0
    ? actionDef.emptyText
    : visibleContacts.length === 0 && search.trim().length === 0
      ? 'Không có data phù hợp với bộ lọc.'
      : 'Không tìm thấy data phù hợp.'
  const canSaveGroupModal = modalSelectedGroupIds.size > 0 || (showNewGroupInput && newGroupName.trim().length > 0)

  const toggleContact = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const contact of filteredContacts) next.delete(contact.id)
      } else {
        for (const contact of filteredContacts) next.add(contact.id)
      }
      return next
    })
  }

  const selectRange = () => {
    if (filteredContacts.length === 0) return
    const start = Math.max(1, Math.min(rangeStart, rangeEnd))
    const end = Math.min(filteredContacts.length, Math.max(rangeStart, rangeEnd))
    const contactsInRange = filteredContacts.slice(start - 1, end)
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const contact of contactsInRange) next.add(contact.id)
      return next
    })
  }

  const handleRenameContactGroup = async (group: AutoAccountContactGroup, name: string) => {
    if (!window.electronAPI) return
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName === group.name) return
    try {
      const updated = await window.electronAPI.updateContactGroup(group.id, normalizedName)
      setContactGroups(prev => prev.map(item => item.id === group.id ? { ...item, ...updated } : item))
      setAllContactGroups(prev => prev.map(item => item.id === group.id ? { ...item, ...updated } : item))
      showAlert('Đã đổi tên nhóm data.', 'success')
    } catch (err: any) {
      console.error('Failed to rename contact group:', err)
      showAlert(err?.message || 'Không thể đổi tên nhóm data.', 'error')
      throw err
    }
  }

  const handleDeleteContactGroup = (group: AutoAccountContactGroup) => {
    if (!window.electronAPI) return
    showConfirm(
      `Xoá nhóm "${group.name}"? Data gốc sẽ không bị xoá.`,
      async () => {
        try {
          await window.electronAPI.deleteContactGroup(group.id)
          setContactGroups(prev => prev.filter(item => item.id !== group.id))
          setAllContactGroups(prev => prev.filter(item => item.id !== group.id))
          setSelectedGroupIds(prev => {
            const next = new Set(prev)
            next.delete(group.id)
            return next
          })
          setGroupContactCache(prev => {
            const next = { ...prev }
            delete next[group.id]
            return next
          })
          setActiveGroupId(prev => prev === group.id ? null : prev)
          setModalSelectedGroupIds(prev => {
            const next = new Set(prev)
            next.delete(group.id)
            return next
          })
          showAlert('Đã xoá nhóm data.', 'success')
        } catch (err: any) {
          console.error('Failed to delete contact group:', err)
          showAlert(err?.message || 'Không thể xoá nhóm data.', 'error')
        }
      },
      { title: 'Xoá nhóm data', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleToggleGroupOutput = async (groupId: number) => {
    if (selectedGroupIds.has(groupId)) {
      setSelectedGroupIds(prev => {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
      return
    }

    const group = allContactGroups.find(item => item.id === groupId)
    if (!group || group.contactType !== actionDef.contactType) {
      showAlert('Nhóm này không đúng loại data hiện tại nên không thể đưa vào danh sách chọn.', 'error')
      return
    }

    try {
      await loadContactsForGroup(groupId)
      setSelectedGroupIds(prev => {
        const next = new Set(prev)
        next.add(groupId)
        return next
      })
    } catch (err: any) {
      console.error('Failed to select contact group:', err)
      showAlert(err?.message || 'Không thể chọn nhóm data.', 'error')
    }
  }

  const handleActivateGroup = (groupId: number) => {
    setActiveGroupId(groupId)
  }

  const handleOpenAddGroupModal = () => {
    if (selectedContacts.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi thêm vào nhóm.', 'error')
      return
    }
    setModalSelectedGroupIds(new Set())
    setNewGroupName('')
    setShowNewGroupInput(false)
    setShowAddGroupModal(true)
  }

  const handleToggleModalGroup = (group: AutoAccountContactGroup) => {
    if (group.contactType !== actionDef.contactType) return
    setModalSelectedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(group.id)) next.delete(group.id)
      else next.add(group.id)
      return next
    })
  }

  const closeAddGroupModal = () => {
    setShowAddGroupModal(false)
    setNewGroupName('')
    setShowNewGroupInput(false)
    setModalSelectedGroupIds(new Set())
  }

  const handleSaveSelectedToGroups = async () => {
    if (!window.electronAPI || !accountId) return
    const contactIds = selectedContacts.map(contact => contact.id)
    if (contactIds.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi thêm vào nhóm.', 'error')
      return
    }

    const newName = newGroupName.trim()
    const shouldCreateGroup = showNewGroupInput && newName.length > 0
    if (modalSelectedGroupIds.size === 0 && !shouldCreateGroup) {
      showAlert('Vui lòng chọn nhóm hoặc nhập tên nhóm mới.', 'error')
      return
    }

    setSavingGroupMembers(true)
    try {
      const groupIds = Array.from(modalSelectedGroupIds).filter(groupId => {
        const group = allContactGroups.find(item => item.id === groupId)
        return group?.contactType === actionDef.contactType
      })
      let createdGroup: AutoAccountContactGroup | null = null
      if (shouldCreateGroup) {
        createdGroup = await window.electronAPI.createContactGroup(accountId, actionDef.contactType, newName)
        groupIds.push(createdGroup.id)
      }

      let addedCount = 0
      for (const groupId of groupIds) {
        const result = await window.electronAPI.addContactsToGroup(groupId, contactIds)
        addedCount += result.count
      }

      setGroupContactCache(prev => {
        const next = { ...prev }
        for (const groupId of groupIds) delete next[groupId]
        return next
      })
      await loadContactGroups()
      if (createdGroup) {
        setActiveGroupId(createdGroup.id)
        setShowGroupPanel(true)
        const data = await loadContactsForGroup(createdGroup.id, true)
        setGroupContacts(data)
      }
      if (!createdGroup && activeGroupId && groupIds.includes(activeGroupId)) {
        const data = await loadContactsForGroup(activeGroupId, true)
        setGroupContacts(data)
      }
      showAlert(
        addedCount > 0
          ? `Đã thêm ${addedCount} data mới vào nhóm.`
          : 'Các data đã chọn đã có trong nhóm.',
        'success'
      )
      closeAddGroupModal()
    } catch (err: any) {
      console.error('Failed to add contacts to group:', err)
      showAlert(err?.message || 'Không thể thêm data vào nhóm.', 'error')
    } finally {
      setSavingGroupMembers(false)
    }
  }

  const handleRemoveFromActiveGroup = (contactsToRemove: AutoAccountContact | AutoAccountContact[], onSuccess?: () => void) => {
    if (!window.electronAPI || !activeGroupId) return
    const contacts = Array.isArray(contactsToRemove) ? contactsToRemove : [contactsToRemove]
    const contactIds = Array.from(new Set(contacts.map(contact => contact.id)))
    if (contactIds.length === 0) return
    const label = contactIds.length === 1
      ? `"${contacts[0]?.name || contacts[0]?.uid || 'data'}"`
      : `${contactIds.length} data đã chọn`
    showConfirm(
      `Xoá ${label} khỏi nhóm? Data gốc sẽ không bị xoá.`,
      async () => {
        try {
          await window.electronAPI.removeContactsFromGroup(activeGroupId, contactIds)
          const contactIdSet = new Set(contactIds)
          setGroupContacts(prev => prev.filter(item => !contactIdSet.has(item.id)))
          setGroupContactCache(prev => ({
            ...prev,
            [activeGroupId]: (prev[activeGroupId] || []).filter(item => !contactIdSet.has(item.id))
          }))
          await loadContactGroups()
          onSuccess?.()
          showAlert('Đã xoá data khỏi nhóm.', 'success')
        } catch (err: any) {
          console.error('Failed to remove contact from group:', err)
          showAlert(err?.message || 'Không thể xoá data khỏi nhóm.', 'error')
        }
      },
      { title: 'Xoá data khỏi nhóm', confirmText: 'Xoá', variant: 'danger' }
    )
  }

  const handleLoadData = async () => {
    if (!window.electronAPI || !accountId) {
      showAlert('Vui lòng chọn tài khoản trước.', 'error')
      return
    }
    if (selectedAccount?.flatformType !== 'facebook') {
      showAlert('Hành động này chỉ hỗ trợ tài khoản Facebook.', 'error')
      return
    }

    setScanLoading(true)
    setProgressMessages([])
    const scanId = scanRunIdRef.current + 1
    scanRunIdRef.current = scanId
    stoppedScanIdsRef.current.delete(scanId)
    completedScanIdsRef.current.delete(scanId)
    try {
      const loader = actionDef.contactType === 'person'
        ? window.electronAPI.loadFriends
        : actionDef.contactType === 'group'
          ? window.electronAPI.loadGroups
          : window.electronAPI.loadPages
      const result = await loader(accountId)
      if (!mountedRef.current) return
      if (scanRunIdRef.current !== scanId) return
      if (completedScanIdsRef.current.has(scanId)) return

      const wasStopped = stoppedScanIdsRef.current.has(scanId) || result.stopped
      setScanLoading(false)
      setMinimized(false)

      if (!result.success) {
        if (wasStopped) return
        showAlert(result.error || 'Tải data thất bại.', 'error')
        return
      }
      await loadCachedContacts()
      await loadContactGroups()
      if (wasStopped) return

      showAlert(`Đã tải ${result.count} data.`, 'success')
    } catch (err: any) {
      if (!mountedRef.current) return
      if (scanRunIdRef.current !== scanId || stoppedScanIdsRef.current.has(scanId)) return
      console.error('Failed to scan data:', err)
      showAlert(err?.message || 'Tải data thất bại.', 'error')
    } finally {
      const wasStopped = stoppedScanIdsRef.current.has(scanId)
      stoppedScanIdsRef.current.delete(scanId)
      if (mountedRef.current && scanRunIdRef.current === scanId && !wasStopped) {
        setScanLoading(false)
        setMinimized(false)
      }
    }
  }

  const cancelScan = async () => {
    if (!accountId || !window.electronAPI?.cancelContactLoad) return
    setProgressMessages(prev => [...prev.slice(-4), 'Đã dừng quét data.'])
    try {
      await window.electronAPI.cancelContactLoad(accountId)
    } catch (err) {
      console.warn('Failed to cancel contact load:', err)
    }
  }

  const handleStopScan = () => {
    stoppedScanIdsRef.current.add(scanRunIdRef.current)
    setScanLoading(false)
    setMinimized(false)
    cancelScan()
  }

  const handleClose = () => {
    if (!scanLoading) {
      onClose()
      return
    }

    showConfirm(
      'Tắt form sẽ dừng quá trình quét data đang chạy. Bạn có chắc muốn tắt form không?',
      async () => {
        await cancelScan()
        onClose()
      },
      { title: 'Dừng quét data', confirmText: 'Dừng và tắt', variant: 'danger' }
    )
  }

  const handleExport = () => {
    if (outputContacts.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi xuất Excel.', 'error')
      return
    }

    try {
      const rows = [
        EXPORT_HEADERS,
        ...outputContacts.map(contact => [
          contact.name || '',
          contact.uid || contact.url || ''
        ])
      ]
      const sheet = utils.aoa_to_sheet(rows)
      sheet['!cols'] = [
        { wch: 24 },
        { wch: 48 }
      ]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      const accountName = sanitizeFileSegment(selectedAccount?.name || 'account')
      const actionName = sanitizeFileSegment(actionDef.label)
      writeFile(workbook, `scan-data-${accountName}-${actionName}-${formatExportTimestamp()}.xlsx`)
      showAlert('Đã xuất data ra Excel.', 'success')
    } catch (err) {
      console.error('Failed to export scan data:', err)
      showAlert('Không thể xuất file Excel.', 'error')
    }
  }

  const handleSelect = () => {
    if (!onSelect) return
    if (outputContacts.length === 0) {
      showAlert('Vui lòng tích chọn data trước khi chọn.', 'error')
      return
    }
    onSelect(outputContacts)
    onClose()
  }

  return (
    <div className={`modal-overlay data-scan-overlay ${minimized ? 'minimized' : ''}`}>
      <div className={`campaign-full-modal data-scan-modal ${minimized ? 'minimized' : ''}`}>
        <div className="modal-header data-scan-header">
          <div>
            <div className="modal-title">Quét data</div>
            <div className="data-scan-subtitle">{outputContacts.length}/{rawOutputContacts.length || 0} data sẵn sàng</div>
          </div>
          <div className="data-scan-header-actions">
            {scanLoading && (
              <button
                className="btn-icon"
                onClick={() => setMinimized(prev => !prev)}
                title={minimized ? 'Mở rộng form' : 'Thu nhỏ form'}
              >
                {minimized ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
              </button>
            )}
            <button className="btn-icon" onClick={handleClose} title="Đóng">
              <X size={18} />
            </button>
          </div>
        </div>

        {minimized ? (
          <div className="data-scan-minimized-body">
            <div className="data-scan-minimized-title">
              <RefreshCw size={14} className="spin" />
              Đang tải data
            </div>
            <div className="data-scan-minimized-message">
              {progressMessages[progressMessages.length - 1] || actionDef.loadingText}
            </div>
            <div className="data-scan-minimized-actions">
              <button
                className="btn btn-danger btn-sm"
                onClick={handleStopScan}
              >
                <Square size={13} />
                Dừng
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="data-scan-body">
          <div className="data-scan-controls">
            <div className="stepper-form-group">
              <label>Hành động</label>
              <select
                className="stepper-input"
                value={action}
                onChange={event => setAction(event.target.value as DataScanAction)}
                disabled={scanLoading || lockAction}
              >
                {DATA_SCAN_ACTIONS.map(item => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </div>

            <div className="stepper-form-group">
              <label>Tài khoản</label>
              <select
                className="stepper-input"
                value={accountId}
                onChange={event => setAccountId(event.target.value ? Number(event.target.value) : '')}
                disabled={scanLoading}
              >
                <option value="">Chọn tài khoản</option>
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </div>

            <div className="stepper-form-group">
              <label>Loại tài khoản</label>
              <input className="stepper-input" value={selectedAccount?.flatformType || ''} disabled />
            </div>

            {hasStatusFilter && (
              <div className="stepper-form-group">
                <label>Hiển thị</label>
                <select
                  className="stepper-input"
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value as ContactStatusFilter)}
                >
                  {statusFilterOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="data-scan-toolbar">
            <div className="data-scan-range">
              <span>Chọn từ STT</span>
              <input
                type="number"
                min={1}
                value={rangeStart}
                onChange={event => setRangeStart(Number(event.target.value) || 1)}
                className="stepper-input"
              />
              <span>đến</span>
              <input
                type="number"
                min={1}
                value={rangeEnd}
                onChange={event => setRangeEnd(Number(event.target.value) || 1)}
                className="stepper-input"
              />
              <button className="btn btn-secondary" onClick={selectRange}>Tích chọn</button>
            </div>

            <div className="data-scan-toolbar-right">
              <label className="data-scan-search">
                <Search size={14} />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Tìm theo tên, UID hoặc link..."
                />
              </label>
              {scanLoading ? (
                <button
                  className="btn btn-danger data-scan-load-button"
                  onClick={handleStopScan}
                >
                  <Square size={14} />
                  Dừng
                </button>
              ) : (
                <button className="btn btn-primary data-scan-load-button" onClick={handleLoadData} disabled={!accountId}>
                  <RefreshCw size={14} />
                  Tải data
                </button>
              )}
            </div>
          </div>

          <div className="data-scan-options">
            <label className="schedule-checkbox-label">
              <input
                type="checkbox"
                checked={dedupeOnOutput}
                onChange={event => setDedupeOnOutput(event.target.checked)}
              />
              <span>Lọc trùng dữ liệu khi chọn, xuất excel</span>
            </label>
            <span>{selectedIds.size} đã tích chọn</span>
            {selectedGroupIds.size > 0 && <span>{selectedGroupIds.size} nhóm đã chọn</span>}
          </div>

          {progressMessages.length > 0 && (
            <div className="data-scan-progress">
              {progressMessages.map((message, index) => (
                <div key={`${message}-${index}`}>{message}</div>
              ))}
            </div>
          )}

          <div className="stepper-grid-container data-scan-table-wrap">
            <table className="campaign-grid data-scan-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={filteredContacts.length === 0}
                    />
                  </th>
                  <th style={{ width: 64 }}>STT</th>
                  <th>Tên</th>
                  <th>UID</th>
                  <th>Link</th>
                  {actionDef.contactType === 'person' && <th>Bạn bè</th>}
                  {actionDef.contactType === 'group' && <th>Tham gia</th>}
                  {actionDef.contactType === 'group' && <th>Duyệt bài</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={tableColSpan} className="text-center">{actionDef.loadingText}</td></tr>
                ) : filteredContacts.length === 0 ? (
                  <tr><td colSpan={tableColSpan} className="text-center text-muted">{emptyTableText}</td></tr>
                ) : (
                  filteredContacts.map((contact, index) => (
                    <tr
                      key={contact.id}
                      className={selectedIds.has(contact.id) ? 'data-scan-selected-row' : undefined}
                      onClick={() => toggleContact(contact.id)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleContact(contact.id)}
                          onClick={event => event.stopPropagation()}
                        />
                      </td>
                      <td>{index + 1}</td>
                      <td className="data-scan-text-cell data-scan-name-cell" title={contact.name || undefined}>
                        {contact.name || '-'}
                      </td>
                      <td className="data-scan-text-cell data-scan-uid-cell" title={contact.uid || undefined}>
                        {contact.uid || '-'}
                      </td>
                      <td className="data-scan-text-cell data-scan-link-cell" title={contact.url || undefined}>
                        {contact.url || '-'}
                      </td>
                      {actionDef.contactType === 'person' && (
                        <td>
                          <span className={`data-scan-status-badge ${contact.isFriend ? 'is-active' : 'is-muted'}`}>
                            {getContactStatusLabel(contact)}
                          </span>
                        </td>
                      )}
                      {actionDef.contactType === 'group' && (
                        <td>
                          <span className={`data-scan-status-badge ${contact.isJoined ? 'is-active' : 'is-muted'}`}>
                            {getContactStatusLabel(contact)}
                          </span>
                        </td>
                      )}
                      {actionDef.contactType === 'group' && (
                        <td>
                          <span className="data-scan-status-badge">{getGroupApprovalStatus(contact)}</span>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="data-scan-below-actions">
            <button
              className="btn btn-secondary data-scan-group-action-button"
              onClick={() => setShowGroupPanel(true)}
            >
              <Folder size={14} />
              Xem nhóm data
            </button>
            <button
              className="btn btn-secondary data-scan-group-action-button"
              onClick={handleOpenAddGroupModal}
              disabled={scanLoading}
            >
              <Folder size={14} />
              Thêm vào nhóm
            </button>
          </div>

        </div>

        {showGroupPanel && (
          <DataScanGroupManagementModal
            activeContactType={activeGroupContactType}
            groupsLoading={groupsLoading}
            contactGroups={allContactGroups}
            activeGroupId={activeGroupId}
            groupContactsLoading={groupContactsLoading}
            filteredGroupContacts={filteredGroupContacts}
            groupContactsByStatusCount={groupContactsByStatus.length}
            groupTableColSpan={groupTableColSpan}
            onClose={() => setShowGroupPanel(false)}
            onActivateGroup={handleActivateGroup}
            onRenameGroup={handleRenameContactGroup}
            onDeleteGroup={handleDeleteContactGroup}
            onRemoveContacts={handleRemoveFromActiveGroup}
          />
        )}

        {showGroupSelectionModal && (
          <DataScanGroupSelectionModal
            contactType={actionDef.contactType}
            groupsLoading={groupsLoading}
            contactGroups={allContactGroups}
            selectedGroupIds={selectedGroupIds}
            onClose={() => setShowGroupSelectionModal(false)}
            onToggleGroup={handleToggleGroupOutput}
            onConfirm={handleSelect}
          />
        )}

        {showAddGroupModal && (
          <div
            className="data-scan-group-modal-backdrop"
            onClick={() => {
              if (!savingGroupMembers) closeAddGroupModal()
            }}
          >
            <div className="data-scan-group-modal" onClick={event => event.stopPropagation()}>
              <div className="data-scan-group-modal-header">
                <div>
                  <div className="data-scan-group-modal-title">Chọn nhóm</div>
                  <div className="data-scan-group-modal-subtitle">{selectedContacts.length} data đã chọn</div>
                </div>
                <button
                  className="btn-icon"
                  onClick={closeAddGroupModal}
                  disabled={savingGroupMembers}
                  title="Đóng"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="data-scan-group-modal-body">
                <div className="data-scan-group-modal-label">Chọn nhóm</div>
                <div className="data-scan-group-modal-list">
                  {groupsLoading ? (
                    <div className="data-scan-group-empty">Đang tải nhóm data...</div>
                  ) : allContactGroups.length === 0 ? (
                    <div className="data-scan-group-empty">Chưa có nhóm data.</div>
                  ) : (
                    allContactGroups.map(group => {
                      const isCompatible = group.contactType === actionDef.contactType
                      return (
                      <label
                        key={group.id}
                        className={`data-scan-group-modal-option ${isCompatible ? '' : 'is-disabled'}`}
                      >
                        <input
                          type="checkbox"
                          checked={modalSelectedGroupIds.has(group.id)}
                          onChange={() => handleToggleModalGroup(group)}
                          disabled={savingGroupMembers || !isCompatible}
                        />
                        <span className="data-scan-group-modal-option-main">
                          <span className="data-scan-group-modal-option-name">{group.name}</span>
                          <span className="data-scan-contact-type-badge">{getContactTypeLabel(group.contactType)}</span>
                        </span>
                        <span className="data-scan-group-count">
                          {isCompatible ? `${group.contactCount || 0} data` : 'Không đúng loại'}
                        </span>
                      </label>
                      )
                    })
                  )}
                </div>

                {!showNewGroupInput ? (
                  <button
                    className="btn btn-secondary data-scan-new-group-toggle"
                    onClick={() => setShowNewGroupInput(true)}
                    disabled={savingGroupMembers}
                  >
                    <Plus size={14} />
                    Hoặc thêm mới nhóm
                  </button>
                ) : (
                  <div className="data-scan-new-group-row">
                    <input
                      className="stepper-input"
                      value={newGroupName}
                      onChange={event => setNewGroupName(event.target.value)}
                      placeholder="Tên nhóm mới..."
                      disabled={savingGroupMembers}
                      autoFocus
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setShowNewGroupInput(false)
                        setNewGroupName('')
                      }}
                      disabled={savingGroupMembers}
                    >
                      Chọn nhóm có sẵn
                    </button>
                  </div>
                )}
              </div>

              <div className="data-scan-group-modal-footer">
                <button className="btn btn-ghost" onClick={closeAddGroupModal} disabled={savingGroupMembers}>
                  Huỷ
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveSelectedToGroups}
                  disabled={!canSaveGroupModal || savingGroupMembers}
                >
                  <Folder size={14} />
                  {savingGroupMembers ? 'Đang lưu...' : 'Thêm vào nhóm và lưu'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer data-scan-footer">
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download size={14} />
            Xuất Excel
          </button>
          <div className="data-scan-footer-right">
            <button className="btn btn-ghost" onClick={handleClose}>{onSelect ? 'Huỷ' : 'Đóng'}</button>
            {onSelect && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowGroupSelectionModal(true)}
              >
                <Folder size={14} />
                Chọn nhóm data
              </button>
            )}
            {onSelect && (
              <button className="btn btn-primary" onClick={handleSelect}>
                <Check size={14} />
                Chọn
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
