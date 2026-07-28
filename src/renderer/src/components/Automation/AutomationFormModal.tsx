import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  Route,
  X
} from 'lucide-react'
import type { DataGroup } from '../../../../shared/types'
import type {
  Automation,
  AutomationCampaignOption,
  AutomationDataType,
  AutomationDelayUnit,
  AutomationMutation,
  AutomationOptions,
  AutomationScheduleMode,
  AutomationTriggerCondition,
  AutomationTriggerOption
} from './automationTypes'
import { getAutomationApi } from './automationTypes'
import AutomationCampaignCombobox from './AutomationCampaignCombobox'
import DataGroupPickerModal from '../DataGroups/DataGroupPickerModal'
import {
  formatAutomationScheduleLabel,
  formatAutomationTriggerLabel,
  getAutomationTriggerIdentityKey,
  getAutomationTriggerSemanticKey,
  isAutomationTriggerWildcard
} from './automationDisplay'

interface AutomationFormModalProps {
  mode: 'create' | 'edit'
  automation?: Automation | null
  options: AutomationOptions
  onClose: () => void
  onSaved: (automation: Automation) => void
}

interface AutomationFormState {
  name: string
  note: string
  sourceCampaignId: string
  triggerKeys: string[]
  /** Legacy transport/extraction type consumed by the existing runtime. */
  dataType: AutomationDataType | ''
  /** Semantic category snapshot; empty means a legacy unclassified rule. */
  dataTypeCategoryItemId: string
  dataTypeCode: string
  dataTypeName: string
  targetCampaignId: string
  targetContactGroupId: string
  targetDataGroupId: string
  scheduleMode: AutomationScheduleMode
  delayValue: string
  delayUnit: AutomationDelayUnit
  delayExactTimeEnabled: boolean
  delayExactTime: string
  dailyTime: string
  fixedAt: string
  isActive: boolean
}

const DATA_TYPE_LABELS: Record<AutomationDataType, string> = {
  phone: 'Số điện thoại',
  email: 'Email',
  zalo_uid: 'UID Zalo',
  facebook_uid: 'UID Facebook'
}

interface SemanticAutomationDataTypeOption {
  categoryItemId: number | null
  categoryCode: string | null
  name: string
  transportType: AutomationDataType
  sortOrder: number
  isLegacy: boolean
}

interface SemanticAutomationMutationFields {
  dataTypeCategoryItemId?: number | null
  dataTypeCode?: string | null
  dataTypeName?: string | null
}

const AUTOMATION_DATA_TYPES = new Set<AutomationDataType>([
  'phone',
  'email',
  'zalo_uid',
  'facebook_uid'
])

const toAutomationDataType = (value: unknown): AutomationDataType | null => {
  const normalized = String(value || '').trim() as AutomationDataType
  return AUTOMATION_DATA_TYPES.has(normalized) ? normalized : null
}

const toPositiveInteger = (value: unknown): number | null => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const getRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' ? value as Record<string, unknown> : null
)

const getSemanticContractAvailable = (options: AutomationOptions): boolean => {
  const optionsRecord = options as unknown as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(optionsRecord, 'dataTypeCategories')) return true
  return options.campaigns.some(campaign => (
    Object.prototype.hasOwnProperty.call(
      campaign as unknown as Record<string, unknown>,
      'semanticDataTypes'
    )
  ))
}

const getCategoryCatalog = (options: AutomationOptions): Map<number, {
  code: string | null
  name: string | null
  sortOrder: number
}> => {
  const rawCategories = (options as unknown as Record<string, unknown>).dataTypeCategories
  const result = new Map<number, { code: string | null; name: string | null; sortOrder: number }>()
  if (!Array.isArray(rawCategories)) return result
  rawCategories.forEach((item, index) => {
    const record = getRecord(item)
    const id = toPositiveInteger(record?.id)
    if (!record || !id) return
    result.set(id, {
      code: String(record.code || '').trim() || null,
      name: String(record.name || '').trim() || null,
      sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : index
    })
  })
  return result
}

const getCampaignSemanticDataTypes = (
  campaign: AutomationCampaignOption | undefined,
  direction: 'source' | 'target',
  categoryCatalog: Map<number, { code: string | null; name: string | null; sortOrder: number }>
): SemanticAutomationDataTypeOption[] => {
  if (!campaign) return []
  // Direct comment-seeding input intentionally accepts User/Group/Page in the
  // same upload and therefore carries no trustworthy per-row semantic type.
  // Expose the transport-compatible wildcard instead of typed choices that
  // could never match those NULL input snapshots.
  if (direction === 'source' && campaign.actionId === 'facebook_comment_seeding') {
    return [{
      categoryItemId: null,
      categoryCode: null,
      name: 'Mọi loại dữ liệu',
      transportType: 'facebook_uid',
      sortOrder: 0,
      isLegacy: true
    }]
  }
  const campaignRecord = campaign as unknown as Record<string, unknown>
  const rawSemanticTypes = campaignRecord.semanticDataTypes
  const semanticOptions: SemanticAutomationDataTypeOption[] = []

  if (Array.isArray(rawSemanticTypes)) {
    rawSemanticTypes.forEach((item, index) => {
      const record = getRecord(item)
      if (!record) return
      if (direction === 'source' && record.canSource === false) return
      if (direction === 'target' && record.canTarget === false) return
      const categoryItemId = toPositiveInteger(record.dataTypeCategoryItemId)
      const transportType = toAutomationDataType(record.automationDataType)
      if (!categoryItemId || !transportType) return
      const catalogItem = categoryCatalog.get(categoryItemId)
      semanticOptions.push({
        categoryItemId,
        categoryCode: String(record.dataTypeCode || catalogItem?.code || '').trim() || null,
        name: String(record.dataTypeName || catalogItem?.name || '').trim() || DATA_TYPE_LABELS[transportType],
        transportType,
        sortOrder: catalogItem?.sortOrder ?? index,
        isLegacy: false
      })
    })
  }

  if (semanticOptions.length > 0) {
    const unique = new Map<number, SemanticAutomationDataTypeOption>()
    semanticOptions.forEach(option => {
      if (!unique.has(option.categoryItemId as number)) {
        unique.set(option.categoryItemId as number, option)
      }
    })
    return Array.from(unique.values()).sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.name.localeCompare(right.name, 'vi')
      || (left.categoryItemId || 0) - (right.categoryItemId || 0)
    ))
  }
  if (Array.isArray(rawSemanticTypes) && rawSemanticTypes.length > 0) return []

  // Older main-process builds only expose transport codes. Keep that contract
  // usable, but do not pretend those values are semantic categories.
  const legacyTypes = Array.isArray(campaign.dataTypes) ? campaign.dataTypes : []
  return Array.from(new Set(legacyTypes
    .map(toAutomationDataType)
    .filter((item): item is AutomationDataType => item !== null)))
    .map((transportType, index) => ({
      categoryItemId: null,
      categoryCode: null,
      name: DATA_TYPE_LABELS[transportType],
      transportType,
      sortOrder: index,
      isLegacy: true
    }))
}

const semanticDataTypeKey = (option: SemanticAutomationDataTypeOption): string => (
  option.categoryItemId
    ? `category:${option.categoryItemId}`
    : `legacy:${option.transportType}`
)

const isSameSemanticDataType = (
  left: SemanticAutomationDataTypeOption,
  right: SemanticAutomationDataTypeOption
): boolean => (
  left.categoryItemId && right.categoryItemId
    ? left.categoryItemId === right.categoryItemId
    : !left.categoryItemId
      && !right.categoryItemId
      && left.transportType === right.transportType
)

const campaignSupportsSemanticDataType = (
  campaign: AutomationCampaignOption | undefined,
  selectedType: SemanticAutomationDataTypeOption | null,
  direction: 'source' | 'target',
  categoryCatalog: Map<number, { code: string | null; name: string | null; sortOrder: number }>
): boolean => {
  if (!campaign || !selectedType) return false
  const options = getCampaignSemanticDataTypes(campaign, direction, categoryCatalog)
  if (selectedType.categoryItemId) {
    const semanticOptions = options.filter(option => option.categoryItemId)
    return semanticOptions.length > 0
      ? semanticOptions.some(option => option.categoryItemId === selectedType.categoryItemId)
      : options.some(option => option.transportType === selectedType.transportType)
  }
  return options.some(option => option.transportType === selectedType.transportType)
}

const getDataGroupSemanticTypeId = (group?: DataGroup | null): number | null => {
  const record = getRecord(group)
  const directId = toPositiveInteger(record?.dataTypeCategoryItemId)
  if (directId) return directId
  const nested = getRecord(record?.dataType)
  return toPositiveInteger(nested?.id)
}

const isDataGroupCompatibleWithSemanticType = (
  group: DataGroup,
  categoryItemId: number | null,
  semanticContractAvailable: boolean
): boolean => {
  if (!semanticContractAvailable) return true
  const groupCategoryItemId = getDataGroupSemanticTypeId(group)
  if (!groupCategoryItemId) return true
  return !!categoryItemId && groupCategoryItemId === categoryItemId
}

const DELAY_UNIT_LABELS: Record<AutomationDelayUnit, string> = {
  minute: 'phút',
  hour: 'giờ',
  day: 'ngày'
}

const DELAY_UNIT_OPTIONS: Array<{ value: AutomationDelayUnit; label: string }> = [
  { value: 'minute', label: 'Phút' },
  { value: 'hour', label: 'Giờ' },
  { value: 'day', label: 'Ngày' }
]

const DELAY_MAX_BY_UNIT: Record<AutomationDelayUnit, number> = {
  minute: 3_650 * 24 * 60,
  hour: 3_650 * 24,
  day: 3_650
}

const SCHEDULE_OPTIONS: Array<{
  mode: Exclude<AutomationScheduleMode, 'fixed_at'>
  label: string
  description: string
}> = [
  {
    mode: 'immediate',
    label: 'Chạy ngay',
    description: 'Dữ liệu đủ điều kiện được chuyển ngay đến các đích đã chọn.'
  },
  {
    mode: 'after_delay',
    label: 'Chạy sau một khoảng thời gian',
    description: 'Chờ theo số phút, giờ hoặc ngày; có thể căn đến một giờ cụ thể.'
  },
  {
    mode: 'daily_time',
    label: 'Chạy tại giờ gần nhất',
    description: 'Dùng giờ hôm nay nếu chưa tới, nếu đã qua thì chuyển sang ngày mai.'
  }
]

const STEPS = [
  { id: 1, label: 'Điều kiện chiến dịch A', icon: GitBranch },
  { id: 2, label: 'Dữ liệu & đích nhận', icon: Database },
  { id: 3, label: 'Thông tin & hoàn tất', icon: Check }
] as const

const triggerKey = (trigger: AutomationTriggerCondition | AutomationTriggerOption): string => (
  getAutomationTriggerIdentityKey(trigger)
)

const canonicalizeInitialTriggerKeys = (
  conditions: AutomationTriggerCondition[]
): string[] => {
  const conditionsBySemanticStatus = new Map<string, AutomationTriggerCondition[]>()
  conditions.forEach(condition => {
    const semanticKey = getAutomationTriggerSemanticKey(condition)
    const current = conditionsBySemanticStatus.get(semanticKey) || []
    current.push(condition)
    conditionsBySemanticStatus.set(semanticKey, current)
  })

  const keys = new Set<string>()
  conditionsBySemanticStatus.forEach(group => {
    const wildcard = group.find(isAutomationTriggerWildcard)
    if (wildcard) {
      keys.add(triggerKey(wildcard))
      return
    }
    group.forEach(condition => keys.add(triggerKey(condition)))
  })
  return Array.from(keys)
}

const toLocalDateTimeInput = (value?: string | null): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const toTimeInput = (value?: string | null): string => {
  const match = /^(\d{2}):(\d{2})/.exec(value || '')
  return match ? `${match[1]}:${match[2]}` : ''
}

const getLegacyDelay = (automation?: Automation | null): {
  delayValue: string
  delayUnit: AutomationDelayUnit
} => {
  if (automation?.delayValue && automation.delayValue > 0 && automation.delayUnit) {
    return {
      delayValue: String(automation.delayValue),
      delayUnit: automation.delayUnit
    }
  }

  const legacyHours = Math.max(0, automation?.delayDays || 0) * 24
    + Math.max(0, automation?.delayHours || 0)
  if (legacyHours > 0) {
    return legacyHours % 24 === 0
      ? { delayValue: String(legacyHours / 24), delayUnit: 'day' }
      : { delayValue: String(legacyHours), delayUnit: 'hour' }
  }

  return { delayValue: '15', delayUnit: 'minute' }
}

const getInitialState = (automation?: Automation | null): AutomationFormState => {
  const legacyDelay = getLegacyDelay(automation)
  const delayExactTime = toTimeInput(automation?.delayExactTime)
  const automationRecord = getRecord(automation)
  const dataTypeCategoryItemId = toPositiveInteger(automationRecord?.dataTypeCategoryItemId)
  return {
    name: automation?.name || '',
    note: automation?.note || '',
    sourceCampaignId: automation?.sourceCampaignId ? String(automation.sourceCampaignId) : '',
    triggerKeys: canonicalizeInitialTriggerKeys(automation?.triggerConditions || []),
    dataType: automation?.dataType || '',
    dataTypeCategoryItemId: dataTypeCategoryItemId ? String(dataTypeCategoryItemId) : '',
    dataTypeCode: dataTypeCategoryItemId ? String(automationRecord?.dataTypeCode || '').trim() : '',
    dataTypeName: dataTypeCategoryItemId ? String(automationRecord?.dataTypeName || '').trim() : '',
    targetCampaignId: automation?.targetCampaignId ? String(automation.targetCampaignId) : '',
    targetContactGroupId: automation?.targetContactGroupId ? String(automation.targetContactGroupId) : '',
    targetDataGroupId: automation?.targetDataGroupId ? String(automation.targetDataGroupId) : '',
    scheduleMode: automation?.scheduleMode || 'immediate',
    delayValue: legacyDelay.delayValue,
    delayUnit: legacyDelay.delayUnit,
    delayExactTimeEnabled: automation?.scheduleMode === 'after_delay' && !!delayExactTime,
    delayExactTime: delayExactTime || '08:00',
    dailyTime: toTimeInput(automation?.dailyTime) || '08:00',
    fixedAt: toLocalDateTimeInput(automation?.fixedAt),
    isActive: automation?.isActive ?? true
  }
}

const formatError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || '')
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || 'Không thể lưu tự động hóa. Vui lòng thử lại.'
}

const campaignMeta = (campaign?: AutomationCampaignOption): string => {
  if (!campaign) return ''
  return [campaign.actionName, campaign.accountName].filter(Boolean).join(' · ')
}

const isCompletedCampaign = (campaign?: AutomationCampaignOption): boolean => (
  campaign?.status.trim().toLocaleLowerCase('vi-VN') === 'hoàn thành'
)

const dataGroupCountLabel = (group: DataGroup): string => (
  group.activeMembershipCount >= 0
    ? `${group.activeMembershipCount.toLocaleString('vi-VN')} data`
    : 'Số data chưa tải'
)

const dataGroupMetaLabel = (group: DataGroup): string => (
  `${dataGroupCountLabel(group)} · ${group.dataTypeName?.trim() || 'Mọi loại dữ liệu'}`
)

export default function AutomationFormModal({
  mode,
  automation,
  options,
  onClose,
  onSaved
}: AutomationFormModalProps) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<AutomationFormState>(() => getInitialState(automation))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dataGroupMenuOpen, setDataGroupMenuOpen] = useState(false)
  const [dataGroupActiveIndex, setDataGroupActiveIndex] = useState(0)
  const [dataGroupPickerOpen, setDataGroupPickerOpen] = useState(false)
  const [pickedDataGroup, setPickedDataGroup] = useState<DataGroup | null>(() => (
    automation?.targetDataGroupId && automation.targetDataGroupName
      ? {
          id: automation.targetDataGroupId,
          name: automation.targetDataGroupName,
          color: '#6366f1',
          sortOrder: Number.MAX_SAFE_INTEGER,
          revision: 0,
          activeMembershipCount: -1,
          isDelete: false
        }
      : null
  ))
  const dialogRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const dataGroupComboboxRef = useRef<HTMLDivElement>(null)
  const delayExactTimeFieldId = useId()
  const delayExactTimeHelpId = useId()
  const destinationHelpId = useId()
  const dataGroupListboxId = useId()
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )
  const onCloseRef = useRef(onClose)
  const savingRef = useRef(saving)
  const dataGroupMenuOpenRef = useRef(dataGroupMenuOpen)
  const dataGroupPickerOpenRef = useRef(dataGroupPickerOpen)
  onCloseRef.current = onClose
  savingRef.current = saving
  dataGroupMenuOpenRef.current = dataGroupMenuOpen
  dataGroupPickerOpenRef.current = dataGroupPickerOpen
  const showLegacyFixedAt = mode === 'edit' && automation?.scheduleMode === 'fixed_at'

  useEffect(() => {
    if (!error) return
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    const frame = window.requestAnimationFrame(() => errorRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [error])

  const sourceCampaign = useMemo(
    () => options.campaigns.find(item => item.id === Number(form.sourceCampaignId)),
    [form.sourceCampaignId, options.campaigns]
  )
  const targetCampaign = useMemo(
    () => options.campaigns.find(item => item.id === Number(form.targetCampaignId)),
    [form.targetCampaignId, options.campaigns]
  )
  const sourceCampaigns = useMemo(
    () => options.campaigns.filter(item => !isCompletedCampaign(item)),
    [options.campaigns]
  )
  const semanticContractAvailable = useMemo(
    () => getSemanticContractAvailable(options),
    [options]
  )
  const categoryCatalog = useMemo(
    () => getCategoryCatalog(options),
    [options]
  )

  const triggerOptions = useMemo(() => {
    if (!sourceCampaign) return []
    const scoped = options.triggerOptions.filter(item => item.campaignActionId === sourceCampaign.actionId)
    const unique = new Map<string, AutomationTriggerOption>()
    scoped.forEach(item => {
      const key = triggerKey(item)
      if (!unique.has(key)) unique.set(key, item)
    })
    return Array.from(unique.values())
  }, [options.triggerOptions, sourceCampaign])

  const triggerOptionByKey = useMemo(() => new Map(
    triggerOptions.map(item => [triggerKey(item), item])
  ), [triggerOptions])

  const sourceDataTypeOptions = useMemo(
    () => getCampaignSemanticDataTypes(sourceCampaign, 'source', categoryCatalog),
    [categoryCatalog, sourceCampaign]
  )
  const currentFormDataType = useMemo<SemanticAutomationDataTypeOption | null>(() => {
    const transportType = toAutomationDataType(form.dataType)
    if (!transportType) return null
    const categoryItemId = toPositiveInteger(form.dataTypeCategoryItemId)
    const catalogItem = categoryItemId ? categoryCatalog.get(categoryItemId) : undefined
    return {
      categoryItemId,
      categoryCode: form.dataTypeCode || catalogItem?.code || null,
      name: form.dataTypeName || catalogItem?.name || DATA_TYPE_LABELS[transportType],
      transportType,
      sortOrder: catalogItem?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      isLegacy: !categoryItemId
    }
  }, [
    categoryCatalog,
    form.dataType,
    form.dataTypeCategoryItemId,
    form.dataTypeCode,
    form.dataTypeName
  ])
  const dataTypeChoices = useMemo(() => {
    const choices = [...sourceDataTypeOptions]
    const isOriginalSource = mode === 'edit'
      && !!automation
      && sourceCampaign?.id === automation.sourceCampaignId
    if (
      currentFormDataType &&
      isOriginalSource &&
      !choices.some(option => isSameSemanticDataType(option, currentFormDataType)) &&
      (!currentFormDataType.categoryItemId || !semanticContractAvailable)
    ) {
      choices.push({
        ...currentFormDataType,
        name: currentFormDataType.categoryItemId
          ? currentFormDataType.name
          : `${currentFormDataType.name} (quy tắc cũ)`
      })
    }
    return choices
  }, [
    automation,
    currentFormDataType,
    mode,
    semanticContractAvailable,
    sourceCampaign,
    sourceDataTypeOptions
  ])
  const selectedDataTypeOption = useMemo(() => (
    currentFormDataType
      ? dataTypeChoices.find(option => isSameSemanticDataType(option, currentFormDataType)) || null
      : null
  ), [currentFormDataType, dataTypeChoices])
  const selectedDataTypeCategoryItemId = selectedDataTypeOption?.categoryItemId || null

  const targetCampaigns = useMemo(() => options.campaigns.filter(item => {
    if (!selectedDataTypeOption) return false
    if (item.id === sourceCampaign?.id) return false
    if (!campaignSupportsSemanticDataType(item, selectedDataTypeOption, 'target', categoryCatalog)) return false
    if (selectedDataTypeOption.transportType === 'zalo_uid' && sourceCampaign && item.accountId !== sourceCampaign.accountId) return false
    return true
  }), [categoryCatalog, options.campaigns, selectedDataTypeOption, sourceCampaign])

  const dataGroupOptions = useMemo(() => {
    const groups = options.dataGroups.filter(group => (
      isDataGroupCompatibleWithSemanticType(
        group,
        selectedDataTypeCategoryItemId,
        semanticContractAvailable
      )
    ))
    if (
      pickedDataGroup &&
      isDataGroupCompatibleWithSemanticType(
        pickedDataGroup,
        selectedDataTypeCategoryItemId,
        semanticContractAvailable
      ) &&
      !groups.some(group => group.id === pickedDataGroup.id)
    ) {
      groups.push(pickedDataGroup)
    }
    return [...groups].sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.name.localeCompare(right.name, 'vi')
      || left.id - right.id
    ))
  }, [
    options.dataGroups,
    pickedDataGroup,
    selectedDataTypeCategoryItemId,
    semanticContractAvailable
  ])

  const selectedDataGroup = useMemo(() => {
    const selectedId = Number(form.targetDataGroupId)
    if (!Number.isFinite(selectedId) || selectedId <= 0) return null
    return dataGroupOptions.find(group => group.id === selectedId)
      || (pickedDataGroup?.id === selectedId ? pickedDataGroup : null)
  }, [dataGroupOptions, form.targetDataGroupId, pickedDataGroup])
  const selectedDestinationNames = useMemo(() => [
    targetCampaign?.name,
    selectedDataGroup?.name
  ].filter((name): name is string => Boolean(name)), [selectedDataGroup, targetCampaign])

  useEffect(() => {
    const selectedId = Number(form.targetDataGroupId)
    if (!Number.isSafeInteger(selectedId) || selectedId <= 0) return
    const candidate = options.dataGroups.find(group => group.id === selectedId)
      || (pickedDataGroup?.id === selectedId ? pickedDataGroup : null)
    if (
      !candidate ||
      isDataGroupCompatibleWithSemanticType(
        candidate,
        selectedDataTypeCategoryItemId,
        semanticContractAvailable
      )
    ) {
      return
    }
    setForm(previous => previous.targetDataGroupId === String(selectedId)
      ? { ...previous, targetDataGroupId: '' }
      : previous)
    setPickedDataGroup(previous => previous?.id === selectedId ? null : previous)
    setDataGroupMenuOpen(false)
    setError(`Nhóm “${candidate.name}” không đúng loại dữ liệu đã chọn và đã được bỏ khỏi đích nhận.`)
  }, [
    form.targetDataGroupId,
    options.dataGroups,
    pickedDataGroup,
    selectedDataTypeCategoryItemId,
    semanticContractAvailable
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dataGroupPickerOpenRef.current) return
        if (dataGroupMenuOpenRef.current) {
          event.preventDefault()
          setDataGroupMenuOpen(false)
          return
        }
        if (!savingRef.current) onCloseRef.current()
        return
      }
      if (dataGroupPickerOpenRef.current) return
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(element => element.offsetParent !== null)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      contentRef.current?.querySelector<HTMLElement>('.automation-form-section')?.focus()
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocusedRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    setError('')
    setDataGroupMenuOpen(false)
    const focusTimer = window.setTimeout(() => {
      contentRef.current?.querySelector<HTMLElement>('.automation-form-section')?.focus()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [step])

  useEffect(() => {
    if (!dataGroupMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!dataGroupComboboxRef.current?.contains(event.target as Node)) {
        setDataGroupMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [dataGroupMenuOpen])

  const setField = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) => {
    setForm(previous => ({ ...previous, [key]: value }))
    if (error) setError('')
  }

  const selectDataGroup = (group: DataGroup | null) => {
    if (
      group &&
      !isDataGroupCompatibleWithSemanticType(
        group,
        selectedDataTypeCategoryItemId,
        semanticContractAvailable
      )
    ) {
      setDataGroupMenuOpen(false)
      setError('Nhóm data này không đúng loại dữ liệu semantic đã chọn.')
      return
    }
    setForm(previous => ({ ...previous, targetDataGroupId: group ? String(group.id) : '' }))
    if (group) setPickedDataGroup(group)
    setDataGroupMenuOpen(false)
    setError('')
  }

  const openDataGroupMenu = () => {
    const selectedIndex = selectedDataGroup
      ? dataGroupOptions.findIndex(group => group.id === selectedDataGroup.id) + 1
      : 0
    setDataGroupActiveIndex(Math.max(0, selectedIndex))
    setDataGroupMenuOpen(previous => !previous)
  }

  const handleDataGroupKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const optionCount = dataGroupOptions.length + 1
    if (event.key === 'Escape' && dataGroupMenuOpen) {
      event.preventDefault()
      event.stopPropagation()
      setDataGroupMenuOpen(false)
      return
    }
    if (event.key === 'Tab') {
      setDataGroupMenuOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!dataGroupMenuOpen) {
        openDataGroupMenu()
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setDataGroupActiveIndex(previous => (previous + direction + optionCount) % optionCount)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setDataGroupMenuOpen(true)
      setDataGroupActiveIndex(event.key === 'Home' ? 0 : optionCount - 1)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && dataGroupMenuOpen) {
      event.preventDefault()
      selectDataGroup(dataGroupActiveIndex === 0 ? null : dataGroupOptions[dataGroupActiveIndex - 1])
    }
  }

  const handleSourceChange = (value: string) => {
    const nextSource = options.campaigns.find(item => item.id === Number(value))
    const nextSourceTypes = getCampaignSemanticDataTypes(nextSource, 'source', categoryCatalog)
    const nextDataType = selectedDataTypeOption
      && (
        !!selectedDataTypeOption.categoryItemId
        || nextSourceTypes.every(option => !option.categoryItemId)
      )
      && campaignSupportsSemanticDataType(nextSource, selectedDataTypeOption, 'source', categoryCatalog)
      ? selectedDataTypeOption
      : nextSourceTypes[0] || null
    const currentTarget = options.campaigns.find(item => item.id === Number(form.targetCampaignId))
    const keepTarget = !!currentTarget
      && !!nextDataType
      && currentTarget.id !== nextSource?.id
      && campaignSupportsSemanticDataType(currentTarget, nextDataType, 'target', categoryCatalog)
      && (
        nextDataType.transportType !== 'zalo_uid'
        || currentTarget.accountId === nextSource?.accountId
      )
    const currentGroup = options.dataGroups.find(item => item.id === Number(form.targetDataGroupId))
      || (pickedDataGroup?.id === Number(form.targetDataGroupId) ? pickedDataGroup : null)
    const keepDataGroup = !!currentGroup
      && !!nextDataType
      && isDataGroupCompatibleWithSemanticType(
        currentGroup,
        nextDataType.categoryItemId,
        semanticContractAvailable
      )

    setForm(previous => {
      return {
        ...previous,
        sourceCampaignId: value,
        triggerKeys: [],
        dataType: nextDataType?.transportType || '',
        dataTypeCategoryItemId: nextDataType?.categoryItemId ? String(nextDataType.categoryItemId) : '',
        dataTypeCode: nextDataType?.categoryCode || '',
        dataTypeName: nextDataType?.name || '',
        targetCampaignId: keepTarget ? previous.targetCampaignId : '',
        targetContactGroupId: keepTarget ? previous.targetContactGroupId : '',
        targetDataGroupId: keepDataGroup ? previous.targetDataGroupId : ''
      }
    })
    if (!keepDataGroup) setPickedDataGroup(null)
    setError('')
  }

  const handleDataTypeChange = (value: SemanticAutomationDataTypeOption) => {
    const currentTarget = options.campaigns.find(item => item.id === Number(form.targetCampaignId))
    const keepTarget = !!currentTarget
      && currentTarget.id !== sourceCampaign?.id
      && campaignSupportsSemanticDataType(currentTarget, value, 'target', categoryCatalog)
      && (
        value.transportType !== 'zalo_uid'
        || currentTarget.accountId === sourceCampaign?.accountId
      )
    const currentGroup = options.dataGroups.find(item => item.id === Number(form.targetDataGroupId))
      || (pickedDataGroup?.id === Number(form.targetDataGroupId) ? pickedDataGroup : null)
    const keepDataGroup = !!currentGroup
      && isDataGroupCompatibleWithSemanticType(
        currentGroup,
        value.categoryItemId,
        semanticContractAvailable
      )

    setForm(previous => {
      return {
        ...previous,
        dataType: value.transportType,
        dataTypeCategoryItemId: value.categoryItemId ? String(value.categoryItemId) : '',
        dataTypeCode: value.categoryCode || '',
        dataTypeName: value.name,
        targetCampaignId: keepTarget ? previous.targetCampaignId : '',
        targetContactGroupId: keepTarget ? previous.targetContactGroupId : '',
        targetDataGroupId: keepDataGroup ? previous.targetDataGroupId : ''
      }
    })
    if (!keepDataGroup) setPickedDataGroup(null)
    setError('')
  }

  const toggleTrigger = (option: AutomationTriggerOption) => {
    const key = triggerKey(option)
    setForm(previous => {
      if (previous.triggerKeys.includes(key)) {
        return {
          ...previous,
          triggerKeys: previous.triggerKeys.filter(item => item !== key)
        }
      }

      const semanticKey = getAutomationTriggerSemanticKey(option)
      const isWildcard = isAutomationTriggerWildcard(option)
      const compatibleKeys = previous.triggerKeys.filter(existingKey => {
        const existingOption = triggerOptionByKey.get(existingKey)
        if (!existingOption) return false
        if (getAutomationTriggerSemanticKey(existingOption) !== semanticKey) return true
        if (isWildcard) return false
        return !isAutomationTriggerWildcard(existingOption)
      })

      return {
        ...previous,
        triggerKeys: [...compatibleKeys, key]
      }
    })
    setError('')
  }

  const validateStep = (targetStep: number): string => {
    if (targetStep === 1) {
      if (!sourceCampaign) return 'Vui lòng chọn chiến dịch A.'
      if (!form.triggerKeys.some(key => triggerOptionByKey.has(key))) {
        return 'Chọn ít nhất một trạng thái kết quả còn khả dụng của chiến dịch A.'
      }
      if (!selectedDataTypeOption) return 'Vui lòng chọn loại dữ liệu dùng để chuyển.'
      if (
        sourceDataTypeOptions.some(option => option.categoryItemId) &&
        !selectedDataTypeOption.categoryItemId &&
        !(mode === 'edit' && selectedDataTypeOption.isLegacy)
      ) {
        return 'Vui lòng chọn loại dữ liệu semantic thay cho loại vận chuyển legacy.'
      }
      if (
        !campaignSupportsSemanticDataType(
          sourceCampaign,
          selectedDataTypeOption,
          'source',
          categoryCatalog
        ) &&
        !(mode === 'edit' && selectedDataTypeOption.isLegacy)
      ) {
        return 'Chiến dịch A không hỗ trợ loại dữ liệu đã chọn.'
      }
    }
    if (targetStep === 2) {
      if (form.targetDataGroupId && !selectedDataGroup) {
        return 'Nhóm data đã chọn không còn tồn tại hoặc không đúng loại dữ liệu.'
      }
      if (!targetCampaign && !selectedDataGroup) {
        return 'Vui lòng chọn ít nhất một đích: Chiến dịch đích hoặc Nhóm data.'
      }
      if (targetCampaign) {
        if (targetCampaign.id === sourceCampaign?.id) return 'Chiến dịch A và B phải là hai chiến dịch khác nhau.'
        if (
          !campaignSupportsSemanticDataType(
            targetCampaign,
            selectedDataTypeOption,
            'target',
            categoryCatalog
          )
        ) {
          return 'Chiến dịch A và B phải dùng cùng một loại dữ liệu.'
        }
        if (form.dataType === 'zalo_uid' && sourceCampaign?.accountId !== targetCampaign.accountId) {
          return 'Dữ liệu UID Zalo chỉ được chuyển giữa hai chiến dịch cùng tài khoản Zalo.'
        }
      }
      if (form.scheduleMode === 'after_delay') {
        const delayValue = Number(form.delayValue)
        const maximum = DELAY_MAX_BY_UNIT[form.delayUnit]
        if (!Number.isInteger(delayValue) || delayValue <= 0) {
          return 'Thời gian chờ phải là số nguyên dương.'
        }
        if (delayValue > maximum) {
          return `Thời gian chờ không được vượt quá ${maximum.toLocaleString('vi-VN')} ${DELAY_UNIT_LABELS[form.delayUnit]} (tương đương 3.650 ngày).`
        }
        if (
          form.delayExactTimeEnabled
          && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.delayExactTime)
        ) {
          return 'Giờ chạy chính xác phải đúng định dạng HH:mm.'
        }
      }
      if (form.scheduleMode === 'daily_time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.dailyTime)) {
        return 'Giờ chạy phải đúng định dạng HH:mm.'
      }
      if (form.scheduleMode === 'fixed_at') {
        if (!showLegacyFixedAt) return 'Lịch ngày giờ cụ thể chỉ dùng cho quy tắc cũ.'
        if (!form.fixedAt) return 'Vui lòng chọn ngày giờ kích hoạt.'
        const fixedAt = new Date(form.fixedAt)
        if (Number.isNaN(fixedAt.getTime()) || (form.isActive && fixedAt.getTime() <= Date.now())) {
          return 'Ngày giờ kích hoạt phải ở tương lai.'
        }
      }
    }
    if (targetStep === 3 && !form.name.trim()) return 'Vui lòng nhập tên tự động hóa.'
    return ''
  }

  const moveToStep = (nextStep: number) => {
    if (nextStep > step) {
      for (let current = step; current < nextStep; current += 1) {
        const validationError = validateStep(current)
        if (validationError) {
          setError(validationError)
          return
        }
      }
    }
    setStep(nextStep)
  }

  const selectedTriggers = useMemo<AutomationTriggerCondition[]>(() => form.triggerKeys
    .map(key => triggerOptionByKey.get(key))
    .filter((item): item is AutomationTriggerOption => !!item)
    .map(item => ({
      statusMappingId: item.statusMappingId ?? null,
      semanticStatusId: item.semanticStatusId ?? null,
      actionCode: item.actionCode || null,
      actionName: item.actionName || null,
      isWildcard: isAutomationTriggerWildcard(item),
      status: item.status,
      statusLabel: item.statusLabel || item.status
    })), [form.triggerKeys, triggerOptionByKey])

  const handleSubmit = async () => {
    const validationError = validateStep(1) || validateStep(2) || validateStep(3)
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload: AutomationMutation & SemanticAutomationMutationFields = {
        name: form.name.trim(),
        actionType: 'campaign_detail_route',
        isActive: form.isActive,
        sourceCampaignId: Number(form.sourceCampaignId),
        triggerConditions: selectedTriggers,
        dataType: form.dataType as AutomationDataType,
        dataTypeCategoryItemId: selectedDataTypeOption?.categoryItemId ?? null,
        dataTypeCode: selectedDataTypeOption?.categoryCode ?? null,
        dataTypeName: selectedDataTypeOption?.name ?? null,
        targetCampaignId: targetCampaign?.id ?? null,
        targetContactGroupId: form.targetContactGroupId ? Number(form.targetContactGroupId) : null,
        targetDataGroupId: selectedDataGroup?.id ?? null,
        scheduleMode: form.scheduleMode,
        delayValue: form.scheduleMode === 'after_delay' ? Number(form.delayValue) : null,
        delayUnit: form.scheduleMode === 'after_delay' ? form.delayUnit : null,
        delayExactTime: form.scheduleMode === 'after_delay' && form.delayExactTimeEnabled
          ? form.delayExactTime
          : null,
        dailyTime: form.scheduleMode === 'daily_time' ? form.dailyTime : null,
        ...(form.scheduleMode === 'fixed_at' ? { fixedAt: new Date(form.fixedAt).toISOString() } : {}),
        note: form.note.trim() || null
      }
      const api = getAutomationApi()
      const saved = mode === 'edit' && automation
        ? await api.updateAutomation(automation.id, payload)
        : await api.createAutomation(payload)
      onSaved(saved)
    } catch (submitError) {
      setError(formatError(submitError))
    } finally {
      setSaving(false)
    }
  }

  const scheduleSummary = formatAutomationScheduleLabel({
    scheduleMode: form.scheduleMode,
    delayValue: Number(form.delayValue) || 0,
    delayUnit: form.delayUnit,
    delayExactTime: form.delayExactTimeEnabled ? form.delayExactTime : null,
    dailyTime: form.dailyTime,
    fixedAt: form.fixedAt || null
  })

  return createPortal(
    <div
      className="automation-modal-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="automation-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-form-title"
      >
        <header className="automation-form-header">
          <div>
            <span className="automation-form-eyebrow">Theo trạng thái kết quả chiến dịch</span>
            <h2 id="automation-form-title">{mode === 'edit' ? 'Chỉnh sửa tự động hóa' : 'Thêm tự động hóa'}</h2>
          </div>
          <button type="button" className="automation-icon-button" onClick={onClose} disabled={saving} aria-label="Đóng">
            <X size={18} />
          </button>
        </header>

        <div className="automation-form-layout">
          <aside className="automation-form-steps" aria-label="Các bước cấu hình">
            {STEPS.map(item => {
              const StepIcon = item.icon
              const complete = item.id < step
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`automation-form-step ${item.id === step ? 'active' : ''} ${complete ? 'complete' : ''}`}
                  onClick={() => moveToStep(item.id)}
                  aria-current={item.id === step ? 'step' : undefined}
                >
                  <span className="automation-form-step-number">
                    {complete ? <Check size={14} /> : <StepIcon size={15} />}
                  </span>
                  <span>
                    <small>Bước {item.id}</small>
                    <strong>{item.label}</strong>
                  </span>
                </button>
              )
            })}
          </aside>

          <div ref={contentRef} className="automation-form-content">
            {error && <div ref={errorRef} className="automation-form-error" role="alert" tabIndex={-1}>{error}</div>}

            {step === 1 && (
              <section className="automation-form-section" aria-labelledby="automation-step-one-title" tabIndex={-1}>
                <div className="automation-section-heading">
                  <span className="automation-section-icon"><GitBranch size={18} /></span>
                  <div>
                    <h3 id="automation-step-one-title">Khi chiến dịch A có kết quả</h3>
                    <p>Chọn chiến dịch nguồn và các trạng thái kết quả sẽ kích hoạt tự động hóa.</p>
                  </div>
                </div>

                <div className="automation-field">
                  <span>Chiến dịch A <b>*</b></span>
                  <AutomationCampaignCombobox
                    campaigns={sourceCampaigns}
                    value={form.sourceCampaignId}
                    selectedCampaign={sourceCampaign}
                    onChange={handleSourceChange}
                    ariaLabel="Tìm và chọn chiến dịch A"
                    placeholder="Chọn hoặc tìm chiến dịch nguồn"
                    emptyText="Không có chiến dịch A chưa hoàn thành."
                    noResultsText="Không tìm thấy chiến dịch A phù hợp."
                    required
                  />
                  {mode === 'edit' && isCompletedCampaign(sourceCampaign) && (
                    <small className="automation-field-note is-warning">
                      Chiến dịch A hiện đã hoàn thành. Quy tắc cũ vẫn được giữ, nhưng chiến dịch này sẽ không xuất hiện lại sau khi bạn chọn A khác.
                    </small>
                  )}
                </div>

                <div className="automation-field">
                  <span>Trạng thái kết quả là <b>*</b> <small>(có thể chọn nhiều)</small></span>
                  {!sourceCampaign ? (
                    <div className="automation-inline-empty">Chọn chiến dịch A để xem trạng thái kết quả.</div>
                  ) : triggerOptions.length === 0 ? (
                    <div className="automation-inline-empty is-warning">Loại chiến dịch này chưa có trạng thái kết quả khả dụng.</div>
                  ) : (
                    <div className="automation-status-options">
                      {triggerOptions.map(item => {
                        const key = triggerKey(item)
                        const checked = form.triggerKeys.includes(key)
                        return (
                          <label key={key} className={`automation-status-option ${checked ? 'selected' : ''}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleTrigger(item)} />
                            <span className="automation-status-check"><Check size={13} /></span>
                            <span>
                              <strong title={formatAutomationTriggerLabel(item)}>
                                {formatAutomationTriggerLabel(item)}
                              </strong>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="automation-field">
                  <span>Loại dữ liệu đồng nhất <b>*</b></span>
                  <div className="automation-choice-grid">
                    {dataTypeChoices.map(dataType => {
                      const selected = !!selectedDataTypeOption
                        && isSameSemanticDataType(dataType, selectedDataTypeOption)
                      return (
                        <label key={semanticDataTypeKey(dataType)} className={`automation-choice-card ${selected ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="automation-data-type"
                            checked={selected}
                            onChange={() => handleDataTypeChange(dataType)}
                          />
                          <Database size={17} />
                          <span>{dataType.name}</span>
                        </label>
                      )
                    })}
                  </div>
                  {sourceCampaign && dataTypeChoices.length === 0 && (
                    <div className="automation-inline-empty is-warning">
                      Loại chiến dịch này chưa có loại dữ liệu semantic khả dụng.
                    </div>
                  )}
                </div>
              </section>
            )}

            {step === 2 && (
              <section
                className="automation-form-section"
                aria-labelledby="automation-step-two-title"
                aria-describedby={destinationHelpId}
                tabIndex={-1}
              >
                <div className="automation-section-heading">
                  <span className="automation-section-icon"><Route size={18} /></span>
                  <div>
                    <h3 id="automation-step-two-title">Thì chuyển dữ liệu đến đích</h3>
                    <p>Chọn chiến dịch đích, Nhóm data, hoặc chọn cả hai.</p>
                  </div>
                </div>

                <div className="automation-route-summary" aria-label="Luồng dữ liệu">
                  <div>
                    <small>Chiến dịch A</small>
                    <strong>{sourceCampaign?.name || 'Chưa chọn'}</strong>
                    <span>{sourceCampaign ? campaignMeta(sourceCampaign) : ''}</span>
                  </div>
                  <ChevronRight size={19} />
                  <span className="automation-route-data">{selectedDataTypeOption?.name || 'Dữ liệu'}</span>
                  <ChevronRight size={19} />
                  <div>
                    <small>Đích nhận</small>
                    <strong>{selectedDestinationNames.join(' + ') || 'Chưa chọn'}</strong>
                    <span>
                      {targetCampaign ? campaignMeta(targetCampaign) : ''}
                      {targetCampaign && selectedDataGroup ? ' · ' : ''}
                      {selectedDataGroup ? dataGroupCountLabel(selectedDataGroup) : ''}
                    </span>
                  </div>
                </div>

                <div className="automation-field">
                  <span>Chiến dịch đích <small>(không bắt buộc)</small></span>
                  <AutomationCampaignCombobox
                    campaigns={targetCampaigns}
                    value={form.targetCampaignId}
                    selectedCampaign={targetCampaign}
                    onChange={campaignId => {
                      setForm(previous => ({ ...previous, targetCampaignId: campaignId, targetContactGroupId: '' }))
                      setError('')
                    }}
                    ariaLabel="Tìm và chọn chiến dịch đích"
                    placeholder="Chọn hoặc tìm chiến dịch nhận dữ liệu"
                    emptyText="Không có chiến dịch đích tương thích."
                    noResultsText="Không tìm thấy chiến dịch đích phù hợp."
                  />
                  {targetCampaigns.length === 0 && (
                    <small className="automation-field-note">Không có chiến dịch đích tương thích; bạn vẫn có thể chỉ chọn Nhóm data.</small>
                  )}
                </div>

                <div className="automation-field automation-data-group-field">
                  <div className="automation-data-group-field-heading">
                    <span>Nhóm data đích <small>(không bắt buộc)</small></span>
                    <button
                      type="button"
                      className="automation-data-group-manage-button"
                      onClick={() => {
                        setDataGroupMenuOpen(false)
                        setDataGroupPickerOpen(true)
                      }}
                    >
                      <Plus size={14} /> Thêm nhóm
                    </button>
                  </div>

                  <div ref={dataGroupComboboxRef} className="automation-data-group-combobox">
                    <div className={`automation-data-group-control ${dataGroupMenuOpen ? 'is-open' : ''}`}>
                      <button
                        type="button"
                        className={`automation-data-group-trigger ${selectedDataGroup ? 'has-value' : ''}`}
                        role="combobox"
                        aria-label="Chọn Nhóm data nhận thêm dữ liệu"
                        aria-haspopup="listbox"
                        aria-expanded={dataGroupMenuOpen}
                        aria-controls={dataGroupMenuOpen ? dataGroupListboxId : undefined}
                        aria-activedescendant={dataGroupMenuOpen ? `${dataGroupListboxId}-option-${dataGroupActiveIndex}` : undefined}
                        onClick={openDataGroupMenu}
                        onKeyDown={handleDataGroupKeyDown}
                      >
                        {selectedDataGroup ? (
                          <>
                            <span
                              className="automation-data-group-color"
                              style={{ backgroundColor: selectedDataGroup.color || 'var(--accent-primary)' }}
                              aria-hidden="true"
                            />
                            <span className="automation-data-group-value-copy">
                              <strong>{selectedDataGroup.name}</strong>
                              <small>{dataGroupMetaLabel(selectedDataGroup)}</small>
                            </span>
                          </>
                        ) : (
                          <>
                            <FolderOpen size={17} className="automation-data-group-empty-icon" aria-hidden="true" />
                            <span className="automation-data-group-placeholder">Không thêm vào nhóm</span>
                          </>
                        )}
                        <ChevronDown size={18} className="automation-data-group-chevron" aria-hidden="true" />
                      </button>
                      {selectedDataGroup && (
                        <button
                          type="button"
                          className="automation-data-group-clear"
                          title="Bỏ chọn nhóm"
                          aria-label={`Bỏ chọn nhóm ${selectedDataGroup.name}`}
                          onClick={event => {
                            event.stopPropagation()
                            selectDataGroup(null)
                          }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {dataGroupMenuOpen && (
                      <div id={dataGroupListboxId} className="automation-data-group-menu" role="listbox" aria-label="Nhóm data">
                        <button
                          id={`${dataGroupListboxId}-option-0`}
                          type="button"
                          role="option"
                          aria-selected={!selectedDataGroup}
                          className={`automation-data-group-option is-none ${dataGroupActiveIndex === 0 ? 'is-active' : ''} ${!selectedDataGroup ? 'is-selected' : ''}`}
                          onMouseEnter={() => setDataGroupActiveIndex(0)}
                          onClick={() => selectDataGroup(null)}
                        >
                          <X size={15} aria-hidden="true" />
                          <span>Không thêm vào nhóm</span>
                          {!selectedDataGroup && <Check size={16} className="automation-data-group-option-check" aria-hidden="true" />}
                        </button>
                        <div className="automation-data-group-menu-divider" />
                        <div className="automation-data-group-menu-label">Chọn nhóm data</div>
                        {dataGroupOptions.length > 0 ? dataGroupOptions.map((group, index) => {
                          const optionIndex = index + 1
                          const isSelected = selectedDataGroup?.id === group.id
                          return (
                            <button
                              id={`${dataGroupListboxId}-option-${optionIndex}`}
                              key={group.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              className={`automation-data-group-option ${dataGroupActiveIndex === optionIndex ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
                              onMouseEnter={() => setDataGroupActiveIndex(optionIndex)}
                              onClick={() => selectDataGroup(group)}
                            >
                              <span
                                className="automation-data-group-color"
                                style={{ backgroundColor: group.color || 'var(--accent-primary)' }}
                                aria-hidden="true"
                              />
                              <span className="automation-data-group-option-copy">
                                <strong>{group.name}</strong>
                                <small>{dataGroupMetaLabel(group)}</small>
                              </span>
                              {isSelected && <Check size={16} className="automation-data-group-option-check" aria-hidden="true" />}
                            </button>
                          )
                        }) : (
                          <div className="automation-data-group-empty">Chưa có Nhóm data.</div>
                        )}
                      </div>
                    )}
                  </div>
                  {dataGroupOptions.length === 0 && (
                    <small className="automation-field-note">
                      Chưa có nhóm Mọi loại dữ liệu hoặc nhóm đúng loại dữ liệu đã chọn.
                    </small>
                  )}
                </div>
                <small id={destinationHelpId} className="automation-field-note">
                  Chọn ít nhất một đích. Có thể chọn đồng thời chiến dịch đích và Nhóm data.
                </small>

                <div className="automation-schedule-block" aria-labelledby="automation-schedule-title">
                  <div className="automation-schedule-heading">
                    <span className="automation-schedule-heading-icon"><Clock3 size={16} /></span>
                    <div>
                      <h4 id="automation-schedule-title">Thời gian chuyển dữ liệu</h4>
                      <p>Chiến dịch đích xử lý data theo lịch; quy tắc chỉ có Nhóm data sẽ thêm vào nhóm theo lịch.</p>
                    </div>
                  </div>

                  <fieldset className="automation-schedule-fieldset">
                    <legend className="automation-visually-hidden">Chọn lịch chuyển dữ liệu</legend>
                    <div className="automation-schedule-options">
                      {SCHEDULE_OPTIONS.map(option => (
                        <label
                          key={option.mode}
                          className={`automation-schedule-option ${form.scheduleMode === option.mode ? 'selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="automation-schedule-mode"
                            checked={form.scheduleMode === option.mode}
                            onChange={() => setField('scheduleMode', option.mode)}
                          />
                          <span className="automation-radio-dot" />
                          <span className="automation-schedule-copy">
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </label>
                      ))}
                      {showLegacyFixedAt && (
                        <label className={`automation-schedule-option is-legacy ${form.scheduleMode === 'fixed_at' ? 'selected' : ''}`}>
                          <input
                            type="radio"
                            name="automation-schedule-mode"
                            checked={form.scheduleMode === 'fixed_at'}
                            onChange={() => setField('scheduleMode', 'fixed_at')}
                          />
                          <span className="automation-radio-dot" />
                          <span className="automation-schedule-copy">
                            <strong>Ngày giờ cụ thể (quy tắc cũ)</strong>
                            <small>Giữ cấu hình legacy khi chỉnh sửa quy tắc đã tạo trước đây.</small>
                          </span>
                        </label>
                      )}
                    </div>
                  </fieldset>

                  {form.scheduleMode === 'after_delay' && (
                    <div className="automation-schedule-config">
                      <div className="automation-field automation-delay-field">
                        <span>Khoảng thời gian chờ <b>*</b></span>
                        <div className="automation-delay-control">
                          <input
                            type="number"
                            min="1"
                            max={DELAY_MAX_BY_UNIT[form.delayUnit]}
                            step="1"
                            inputMode="numeric"
                            value={form.delayValue}
                            onChange={event => setField('delayValue', event.target.value)}
                            aria-label="Số phút, giờ hoặc ngày cần chờ"
                          />
                          <select
                            value={form.delayUnit}
                            onChange={event => setField('delayUnit', event.target.value as AutomationDelayUnit)}
                            aria-label="Đơn vị thời gian chờ"
                          >
                            {DELAY_UNIT_OPTIONS.map(unit => (
                              <option key={unit.value} value={unit.value}>{unit.label}</option>
                            ))}
                          </select>
                        </div>
                        <small className="automation-field-note">
                          Số nguyên dương, tối đa {DELAY_MAX_BY_UNIT[form.delayUnit].toLocaleString('vi-VN')} {DELAY_UNIT_LABELS[form.delayUnit]}.
                        </small>
                      </div>

                      <div className="automation-delay-exact-section">
                        <label className={`automation-delay-exact-toggle ${form.delayExactTimeEnabled ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={form.delayExactTimeEnabled}
                            onChange={event => {
                              const enabled = event.target.checked
                              setForm(previous => ({
                                ...previous,
                                delayExactTimeEnabled: enabled,
                                delayExactTime: previous.delayExactTime || '08:00'
                              }))
                              setError('')
                            }}
                            aria-controls={form.delayExactTimeEnabled ? delayExactTimeFieldId : undefined}
                          />
                          <span className="automation-delay-exact-check" aria-hidden="true"><Check size={13} /></span>
                          <span className="automation-delay-exact-copy">
                            <strong>Chọn giờ chạy chính xác</strong>
                            <small>Sau thời gian chờ, căn dữ liệu đến một giờ chạy cố định trong ngày.</small>
                          </span>
                        </label>

                        {form.delayExactTimeEnabled && (
                          <label id={delayExactTimeFieldId} className="automation-delay-exact-time-field">
                            <span>Giờ chuyển dữ liệu <b>*</b></span>
                            <input
                              type="time"
                              step="60"
                              value={form.delayExactTime}
                              onChange={event => setField('delayExactTime', event.target.value)}
                              aria-describedby={delayExactTimeHelpId}
                              aria-invalid={!!error && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.delayExactTime)}
                              required
                            />
                            <small id={delayExactTimeHelpId} className="automation-field-note">
                              Sau khi đủ thời gian chờ, hệ thống chọn mốc giờ này đầu tiên không sớm hơn thời điểm đó theo Asia/Ho_Chi_Minh.
                            </small>
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  {form.scheduleMode === 'daily_time' && (
                    <label className="automation-field automation-schedule-config automation-time-field">
                      <span>Giờ chạy gần nhất <b>*</b></span>
                      <input
                        type="time"
                        step="60"
                        value={form.dailyTime}
                        onChange={event => setField('dailyTime', event.target.value)}
                      />
                      <small className="automation-field-note">
                        Theo múi giờ Asia/Ho_Chi_Minh. Nếu giờ hôm nay đã qua, dữ liệu sẽ chạy vào ngày mai.
                      </small>
                    </label>
                  )}

                  {form.scheduleMode === 'fixed_at' && showLegacyFixedAt && (
                    <label className="automation-field automation-schedule-config automation-fixed-time-field">
                      <span>Ngày giờ cụ thể <b>*</b></span>
                      <input
                        type="datetime-local"
                        min={toLocalDateTimeInput(new Date(Date.now() + 60_000).toISOString())}
                        value={form.fixedAt}
                        onChange={event => setField('fixedAt', event.target.value)}
                      />
                      <small className="automation-field-note">Đây là lịch legacy; quy tắc tạo mới không còn lựa chọn này.</small>
                    </label>
                  )}
                </div>

                {form.dataType === 'zalo_uid' && (
                  <div className="automation-rule-note">
                    UID Zalo là dữ liệu theo tài khoản. Nếu chọn chiến dịch đích, hệ thống chỉ cho chọn chiến dịch cùng tài khoản với chiến dịch A.
                  </div>
                )}
              </section>
            )}

            {step === 3 && (
              <section className="automation-form-section" aria-labelledby="automation-step-three-title" tabIndex={-1}>
                <div className="automation-section-heading">
                  <span className="automation-section-icon"><Check size={18} /></span>
                  <div>
                    <h3 id="automation-step-three-title">Thông tin & hoàn tất</h3>
                    <p>Đặt tên dễ nhận biết, thêm ghi chú vận hành và kiểm tra lại quy tắc trước khi lưu.</p>
                  </div>
                </div>

                <div className="automation-form-two-columns">
                  <label className="automation-field">
                    <span>Tên tự động hóa <b>*</b></span>
                    <input
                      type="text"
                      maxLength={200}
                      value={form.name}
                      onChange={event => setField('name', event.target.value)}
                      placeholder="Ví dụ: Lead mới → Chăm sóc Zalo"
                    />
                  </label>
                  <label className="automation-active-toggle">
                    <input type="checkbox" checked={form.isActive} onChange={event => setField('isActive', event.target.checked)} />
                    <span className="automation-toggle-track"><span /></span>
                    <span>
                      <strong>Kích hoạt sau khi lưu</strong>
                      <small>Có thể dừng bất cứ lúc nào ở danh sách.</small>
                    </span>
                  </label>
                </div>

                <label className="automation-field">
                  <span>Ghi chú</span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={form.note}
                    onChange={event => setField('note', event.target.value)}
                    placeholder="Mô tả mục đích hoặc điều kiện vận hành..."
                  />
                </label>

                <div className="automation-final-summary">
                  <h4>Tóm tắt quy tắc</h4>
                  <div className="automation-final-summary-grid">
                    <span>Điều kiện</span>
                    <strong>{sourceCampaign?.name || '—'} · {selectedTriggers.map(formatAutomationTriggerLabel).join(', ') || '—'}</strong>
                    <span>Dữ liệu</span>
                    <strong>{selectedDataTypeOption?.name || '—'}</strong>
                    <span>Chiến dịch đích</span>
                    <strong>{targetCampaign?.name || 'Không chọn'}</strong>
                    <span>Nhóm data</span>
                    <strong>{selectedDataGroup ? `${selectedDataGroup.name} (${dataGroupCountLabel(selectedDataGroup)})` : 'Không thêm vào nhóm'}</strong>
                    <span>Lịch chuyển dữ liệu</span>
                    <strong className="automation-schedule-summary-value" title={scheduleSummary}>{scheduleSummary}</strong>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="automation-form-footer">
          <button type="button" className="automation-button" onClick={onClose} disabled={saving}>Hủy</button>
          <div>
            {step > 1 && (
              <button type="button" className="automation-button" onClick={() => moveToStep(step - 1)} disabled={saving}>
                <ChevronLeft size={16} /> Quay lại
              </button>
            )}
            {step < 3 ? (
              <button type="button" className="automation-button is-primary" onClick={() => moveToStep(step + 1)}>
                Tiếp tục <ChevronRight size={16} />
              </button>
            ) : (
              <button type="button" className="automation-button is-primary" onClick={() => void handleSubmit()} disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {saving ? 'Đang lưu...' : mode === 'edit' ? 'Lưu thay đổi' : 'Thêm tự động hóa'}
              </button>
            )}
          </div>
        </footer>
      </div>
      {dataGroupPickerOpen && (
        <DataGroupPickerModal
          selectedGroupId={form.targetDataGroupId ? Number(form.targetDataGroupId) : null}
          compatibleDataTypeCategoryItemId={selectedDataTypeCategoryItemId}
          unrestrictedOnly={
            semanticContractAvailable
            && selectedDataTypeOption !== null
            && selectedDataTypeCategoryItemId === null
          }
          onSelect={group => {
            selectDataGroup(group)
            setDataGroupPickerOpen(false)
          }}
          onClose={() => setDataGroupPickerOpen(false)}
        />
      )}
    </div>,
    document.body
  )
}
