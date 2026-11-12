import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Info, ListChecks, Plus, RefreshCw, Trash2, Upload, Users, X } from 'lucide-react'
import { writeFile } from 'xlsx'
import {
  actionSupportsDataGroup,
  getCampaignInputDataRequirement,
  type AddCampaignInputDataRowsResult,
  type AutoAccount,
  type AutoAccountContact,
  type CampaignAction,
  type CampaignConfig,
  type CampaignImportPlatform,
  type CampaignInputData,
  type CampaignInputStatus,
  type CampaignListItem,
  type DataGroup,
  type SnapshotDataGroupToCampaignRequest,
  type SnapshotDataGroupToCampaignResult
} from '../../../../shared/types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone } from '../../../../shared/phone'
import {
  appendInputRowKeys, isAppendInputRowValid, isAppendPreviewGone, APPEND_PREVIEW_MAX_ITEMS
} from '../../../../shared/campaignAppendData'
import {
  formatVietnamTime, inputDuplicatesVisible, supportsInputDuplicateCheck, type InputDuplicatesSetting
} from '../../../../shared/campaignInputDuplicates'
import { pendingRowsExportMatrix } from '../../../../shared/campaignImportVerification'
import { createImportMatrixWorkbook } from '../../../../shared/campaignImportWorkbook'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import DataScanModal, { type DataScanAction } from '../DataScan/DataScanModal'
import { createDataGroupRequestId } from '../DataGroups/dataGroupApi'
import DataGroupPickerModal from '../DataGroups/DataGroupPickerModal'
import CampaignDataUploadModal, { type CampaignImportDuplicateCheck, type ImportDuplicateSummary } from './CampaignDataUploadModal'
import { CampaignAddDataDuplicateDialog, type AddDataDuplicateOutcome, type AddDataDuplicateScope } from './CampaignAddDataDuplicateDialog'
import './CampaignAddData.css'

// Tách khỏi CampaignPanel (11/2026) để thêm khối kiểm tra trùng và chạy được smoke giao diện riêng.
const FIND_DATA_GROUP_ACTION_ID = 'facebook_find_data_group'
const EMAIL_SEND_ACTION_ID = 'email_send'
const SMS_SEND_ACTION_ID = 'sms_send'
const VOICE_CALL_ACTION_ID = 'voice_call'
const FACEBOOK_GROUP_POST_ACTION_ID = 'facebook_group_post'
const FACEBOOK_PAGE_POST_ACTION_ID = 'facebook_page_post'
const FACEBOOK_MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const FACEBOOK_MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'
const FACEBOOK_GROUP_INVITE_ACTION_ID = 'facebook_group_invite'
const FACEBOOK_PAGE_INBOX_MESSAGE_ACTION_ID = 'facebook_page_to_message'
const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_ADD_GROUP_MEMBER_ACTION_ID = 'zalo_add_group_member'
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const ADD_DATA_UNSUPPORTED_ACTION_IDS = new Set([
  ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID,
  ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
])

type InputDataBatchStatus = Extract<CampaignInputStatus, 'chờ xử lý' | 'tạm dừng'>

const formatIpcErrorMessage = (err: unknown, fallback: string): string => {
  const message = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : ''

  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || fallback
}

const formatDateTimeLocal = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const toIsoDateTimeValue = (value?: string | null): string | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

type AddCampaignDataScanMode = 'friends' | 'users' | 'groups' | 'pages' | 'pageInboxCustomers' | 'pageInboxPhones' | 'zaloRemarketingCustomers'

interface AddCampaignDataScanSource {
  key: string
  label: string
  action: DataScanAction
  mode: AddCampaignDataScanMode
  initialStatusFilter?: 'active' | 'inactive' | 'all'
  initialPageInboxPageUid?: string
  initialPageInboxPageName?: string
  allowedActions?: DataScanAction[]
  lockAccount?: boolean
  lockPageInboxPage?: boolean
}

interface AddDataToCurrentCampaignModalProps {
  campaign: CampaignConfig
  campaignAction?: CampaignAction
  account?: AutoAccount | null
  onSubmit: (request: {
    campaignId: number
    rows: Partial<CampaignInputData>[]
    campaignSchedule: string
    campaignStatus: InputDataBatchStatus
    skipExistingInCampaign: boolean
  }) => Promise<AddCampaignInputDataRowsResult>
  onSnapshotDataGroup: (
    request: SnapshotDataGroupToCampaignRequest
  ) => Promise<SnapshotDataGroupToCampaignResult>
  onRefresh: (campaignId: number) => Promise<void>
  onClose: () => void
}

export const isAddDataSupportedForCampaign = (campaign?: Pick<CampaignListItem, 'actionId'> | null): boolean => (
  !!campaign &&
  !!getCampaignInputDataRequirement(campaign.actionId) &&
  !ADD_DATA_UNSUPPORTED_ACTION_IDS.has(campaign.actionId)
)

const getAddDataImportPlatform = (campaign: CampaignConfig, action?: CampaignAction): CampaignImportPlatform => {
  if (campaign.actionId === SMS_SEND_ACTION_ID || campaign.actionId === VOICE_CALL_ACTION_ID) return 'sms'
  if (campaign.actionId === EMAIL_SEND_ACTION_ID) return 'email'
  if (action?.flatformType === 'zalo') return 'zalo'
  return 'facebook'
}

const canImportDataForCampaign = (campaign: CampaignConfig, action?: CampaignAction): boolean => {
  if (!isAddDataSupportedForCampaign(campaign)) return false
  if (campaign.actionId === FACEBOOK_PAGE_INBOX_MESSAGE_ACTION_ID) return false
  if ([
    FACEBOOK_GROUP_INVITE_ACTION_ID,
    ZALO_MESSAGE_FRIEND_ACTION_ID,
    ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID,
    ZALO_MESSAGE_GROUP_ACTION_ID
  ].includes(campaign.actionId)) return false
  if (campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID || campaign.actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID || campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID) return true
  return action?.flatformType !== 'zalo' || campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
}

const getAddDataScanSources = (campaign: CampaignConfig): AddCampaignDataScanSource[] => {
  switch (campaign.actionId) {
    case FACEBOOK_GROUP_INVITE_ACTION_ID:
      return [{
        key: 'facebook_group_invite_friends',
        label: 'Chọn bạn bè cần mời',
        action: 'facebook_friends',
        mode: 'friends',
        initialStatusFilter: 'active',
        allowedActions: ['facebook_friends'],
        lockAccount: true
      }]
    case FACEBOOK_MESSAGE_FRIEND_ACTION_ID:
      return [{
        key: 'facebook_friends',
        label: 'Chọn bạn bè',
        action: 'facebook_friends',
        mode: 'friends',
        allowedActions: ['facebook_friends']
      }]
    case ZALO_MESSAGE_FRIEND_ACTION_ID:
      return [{
        key: 'zalo_friends',
        label: 'Chọn bạn bè Zalo',
        action: 'zalo_friends',
        mode: 'friends',
        initialStatusFilter: 'active',
        allowedActions: ['zalo_friends'],
        lockAccount: true
      }]
    case FACEBOOK_MESSAGE_UID_ACTION_ID:
      return [{
        key: 'facebook_users',
        label: 'Chọn data',
        action: 'facebook_friends',
        mode: 'users',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_friends', 'facebook_post_commenters', 'facebook_post_likes', 'facebook_profile_friends', 'facebook_group_members']
      }]
    case FACEBOOK_PAGE_INBOX_MESSAGE_ACTION_ID:
      return [{
        key: 'page_inbox_customers',
        label: 'Chọn khách inbox Page',
        action: 'facebook_page_inbox_customers',
        mode: 'pageInboxCustomers',
        initialStatusFilter: 'all',
        initialPageInboxPageUid: String(campaign.extraSettings?.pageInboxPageUid || ''),
        initialPageInboxPageName: String(campaign.extraSettings?.pageInboxPageName || ''),
        allowedActions: ['facebook_page_inbox_customers'],
        lockAccount: true,
        lockPageInboxPage: true
      }]
    case ZALO_ADD_GROUP_MEMBER_ACTION_ID:
      return [{
        key: 'zalo_group_members',
        label: 'Chọn thành viên group Zalo',
        action: 'zalo_group_members',
        mode: 'users',
        initialStatusFilter: 'all',
        allowedActions: ['zalo_group_members'],
        lockAccount: true
      }, {
        key: 'zalo_friends',
        label: 'Chọn bạn bè Zalo',
        action: 'zalo_friends',
        mode: 'friends',
        initialStatusFilter: 'active',
        allowedActions: ['zalo_friends'],
        lockAccount: true
      }]
    case ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID:
      return [{
        key: 'zalo_group_members',
        label: 'Chọn thành viên group Zalo',
        action: 'zalo_group_members',
        mode: 'users',
        initialStatusFilter: 'all',
        allowedActions: ['zalo_group_members'],
        lockAccount: true
      }]
    case ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID:
      return [{
        key: 'zalo_remarketing_customers',
        label: 'Chọn khách hàng cũ Zalo',
        action: 'zalo_remarketing_customers',
        mode: 'zaloRemarketingCustomers',
        initialStatusFilter: 'all',
        allowedActions: ['zalo_remarketing_customers'],
        lockAccount: true
      }]
    case ZALO_MESSAGE_GROUP_ACTION_ID:
      return [{
        key: 'zalo_groups',
        label: 'Chọn group Zalo',
        action: 'zalo_groups',
        mode: 'groups',
        initialStatusFilter: 'active',
        allowedActions: ['zalo_groups'],
        lockAccount: true
      }]
    case FACEBOOK_GROUP_POST_ACTION_ID:
    case FACEBOOK_JOIN_GROUP_ACTION_ID:
    case FIND_DATA_GROUP_ACTION_ID:
    case COMMENT_SEEDING_FEED_ACTION_ID:
      return [{
        key: 'facebook_groups',
        label: 'Chọn nhóm',
        action: 'facebook_groups',
        mode: 'groups',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_groups']
      }]
    case FACEBOOK_PAGE_POST_ACTION_ID:
      return [{
        key: 'facebook_pages',
        label: 'Chọn page',
        action: 'facebook_pages',
        mode: 'pages',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_pages']
      }]
    case ZALO_MESSAGE_PHONE_ACTION_ID:
    case SMS_SEND_ACTION_ID:
    case VOICE_CALL_ACTION_ID:
      return [{
        key: 'page_inbox_phones',
        label: 'Từ người inbox fanpage',
        action: 'facebook_page_inbox_customers',
        mode: 'pageInboxPhones',
        initialStatusFilter: 'all',
        allowedActions: ['facebook_page_inbox_customers']
      }]
    default:
      return []
  }
}

type ListFilter = 'all' | 'new' | 'existing'
type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
/** Lượt đối chiếu với chiến dịch khác gần nhất của danh sách chờ thêm (chỉ trong phiên form). */
interface OtherCampaignCheck {
  scope: AddDataDuplicateScope
  days: number
  accountCount: number
  checkedAt: string
  /** Tổng số đã bỏ vì có ở chiến dịch khác (cộng dồn các lượt). */
  removed: number
  /** Số có ở chiến dịch khác mà khách chọn giữ lại ở lượt gần nhất. */
  kept: number
}
const count = (value: number) => value.toLocaleString('vi-VN')

/**
 * "Thêm data" vào chiến dịch đã tạo. Khối kiểm tra trùng (11/2026, theo Web #209): dòng "Trong chiến dịch này" xem trước data
 * đã có bằng IPC chỉ đọc `campaign:add-data-preview` (cùng luật với lúc ghi, src/shared/campaignAppendData.ts); dòng "Với
 * chiến dịch khác" (chỉ nhắn tin đến SĐT Zalo, khi công tắc lọc trùng mở) đối chiếu cả danh sách chờ thêm qua V491/V493.
 */
export default function AddDataToCurrentCampaignModal({
  campaign,
  campaignAction,
  account,
  onSubmit,
  onSnapshotDataGroup,
  onRefresh,
  onClose
}: AddDataToCurrentCampaignModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const authUser = useAuthStore(state => state.user)
  const [rows, setRows] = useState<Partial<CampaignInputData>[]>([])
  const [showDataUploadModal, setShowDataUploadModal] = useState(false)
  const [dataScanPicker, setDataScanPicker] = useState<AddCampaignDataScanSource | null>(null)
  const [showDataGroupPicker, setShowDataGroupPicker] = useState(false)
  const [selectedDataGroup, setSelectedDataGroup] = useState<DataGroup | null>(null)
  const [campaignSchedule, setCampaignSchedule] = useState(() => {
    const date = new Date(campaign.schedule || campaign.originalSchedule || Date.now())
    return formatDateTimeLocal(Number.isNaN(date.getTime()) ? new Date() : date)
  })
  const [campaignStatus, setCampaignStatus] = useState<InputDataBatchStatus>(
    campaign.status === 'tạm dừng' ? 'tạm dừng' : 'chờ xử lý'
  )
  const [skipExistingInCampaign, setSkipExistingInCampaign] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const snapshotRequestIdentitiesRef = useRef<Map<string, string>>(new Map())

  const importPlatform = useMemo(() => getAddDataImportPlatform(campaign, campaignAction), [campaign, campaignAction])
  const canImportData = useMemo(() => canImportDataForCampaign(campaign, campaignAction), [campaign, campaignAction])
  const scanSources = useMemo(() => getAddDataScanSources(campaign), [campaign])
  const canSnapshotDataGroup = campaign.dataTargetSourceMode !== 'data_group'
    && actionSupportsDataGroup(campaign.actionId)

  // Lọc trùng với chiến dịch khác (V491/V493): "tài khoản đang chọn" = tài khoản của chiến dịch; không so với chính chiến dịch này.
  const duplicateCheck = useMemo<CampaignImportDuplicateCheck | undefined>(() => account?.id && supportsInputDuplicateCheck(campaign.actionId)
    ? { currentAccounts: [{ id: account.id, name: account.name || `Tài khoản ${account.id}` }], excludeCampaignId: campaign.id }
    : undefined, [account?.id, account?.name, campaign.id, campaign.actionId])
  // Công tắc chung với Web, đọc một lần khi mở form (một dòng); đọc lỗi thì ẩn dòng "Với chiến dịch khác" như khi công tắc tắt.
  const [dupSetting, setDupSetting] = useState<InputDuplicatesSetting | null>(null)
  useEffect(() => {
    setDupSetting(null)
    if (!duplicateCheck) return
    let disposed = false
    void window.electronAPI.campaignInputDuplicates({ kind: 'setting' }).then(result => {
      if (!disposed && result.ok) setDupSetting(result.data)
    }).catch(() => { /* Chỉ lọc trong chiến dịch này như trước. */ })
    return () => { disposed = true }
  }, [duplicateCheck])
  const otherCheckEnabled = Boolean(duplicateCheck) && Boolean(dupSetting) && inputDuplicatesVisible(dupSetting ?? undefined, authUser?.isAdminAkabiz)

  // Khóa so trùng dùng đúng luật của đường ghi (campaignAppendData): SĐT, UID, email hoặc link tùy loại chiến dịch.
  const actionId = campaign.actionId
  const requirement = getCampaignInputDataRequirement(actionId)
  const rowKeys = (row: Partial<CampaignInputData>): string[] => appendInputRowKeys(row, actionId)
  const rowPhone = (row: Partial<CampaignInputData>): string => normalizeVietnamMobilePhone(row.phone)

  // Dòng 1 "Trong chiến dịch này": xem trước data đã có (chỉ đọc). Kết quả nhớ theo khóa trong phiên form, xóa dòng không gọi lại.
  const previewEnabled = Boolean(requirement)
  const previewKeysRef = useRef({ previewed: new Set<string>(), existing: new Set<string>() })
  const previewFailedRowsRef = useRef<Partial<CampaignInputData>[] | null>(null)
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle')
  const [previewRevision, setPreviewRevision] = useState(0)
  const [previewRetry, setPreviewRetry] = useState(0)
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  useEffect(() => {
    if (!previewEnabled || selectedDataGroup || previewStatus === 'unavailable') return
    const { previewed, existing } = previewKeysRef.current
    const pending = rows.filter(row => {
      const keys = rowKeys(row)
      return keys.length > 0 && !keys.every(key => previewed.has(key))
    })
    // Không còn dòng nào chưa xem trước (vd vừa xóa dòng đang chờ): kết quả hiện có là đủ.
    if (!pending.length) { setPreviewStatus(current => current === 'unavailable' ? current : 'ready'); return }
    if (previewFailedRowsRef.current === rows) return
    // IPC không hủy được: đổi danh sách giữa chừng thì bỏ kết quả lượt cũ, lượt mới tự chạy theo danh sách mới.
    const run = { cancelled: false }
    setPreviewStatus('loading')
    void (async () => {
      try {
        for (let offset = 0; offset < pending.length; offset += APPEND_PREVIEW_MAX_ITEMS) {
          const chunk = pending.slice(offset, offset + APPEND_PREVIEW_MAX_ITEMS)
          const result = await window.electronAPI.campaignAddDataPreview({
            campaignId: campaign.id,
            items: chunk.map(row => ({ phone: row.phone || '', uid: row.uid || '', email: row.email || '' }))
          })
          if (run.cancelled) return
          if (!result.ok) {
            // Công tắc tắt hoặc loại chiến dịch không hỗ trợ: thôi gọi trong phiên này; lỗi khác chờ khách bấm Thử lại.
            if (isAppendPreviewGone(result.code)) { setPreviewStatus('unavailable'); return }
            throw new Error(result.message)
          }
          chunk.forEach(row => rowKeys(row).forEach(key => previewed.add(key)))
          result.data.existingIndexes.forEach(index => rowKeys(chunk[index]).forEach(key => existing.add(key)))
        }
        setPreviewStatus('ready'); setPreviewRevision(current => current + 1)
      } catch {
        if (run.cancelled) return
        previewFailedRowsRef.current = rows
        setPreviewStatus('error')
      }
    })()
    return () => { run.cancelled = true }
    // previewStatus cố ý không nằm trong dependency: đổi trạng thái không được khởi động lại lượt đang chạy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, previewEnabled, actionId, selectedDataGroup, campaign.id, previewRetry])
  const invalidFlags = useMemo(() => rows.map(row => !isAppendInputRowValid(row, actionId)), [rows, actionId])
  const existingFlags = useMemo(() => {
    const { existing } = previewKeysRef.current
    return rows.map((row, index) => !invalidFlags[index] && rowKeys(row).some(key => existing.has(key)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, invalidFlags, actionId, previewRevision])
  const existingCount = existingFlags.filter(Boolean).length
  const invalidCount = invalidFlags.filter(Boolean).length
  const previewReady = previewEnabled && previewStatus === 'ready'
  const willAddCount = rows.length - invalidCount - (skipExistingInCampaign ? existingCount : 0)
  useEffect(() => { if (!existingCount && listFilter !== 'all') setListFilter('all') }, [existingCount, listFilter])

  // Dòng 2 "Với chiến dịch khác": SĐT nào của danh sách đã qua một lượt đối chiếu (cửa sổ Upload với lựa chọn 2/3, hoặc nút Kiểm tra trùng).
  const [checkedPhones, setCheckedPhones] = useState<Set<string>>(() => new Set())
  const [otherCheck, setOtherCheck] = useState<OtherCampaignCheck | null>(null)
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false)
  const phoneRows = useMemo(() => rows.map(row => normalizeVietnamMobilePhone(row.phone)).filter(Boolean), [rows])
  const uncheckedCount = phoneRows.filter(phone => !checkedPhones.has(phone)).length
  const checkedCount = phoneRows.length - uncheckedCount

  const appendRows = (nextRows: Partial<CampaignInputData>[], duplicates?: ImportDuplicateSummary) => {
    if (nextRows.length === 0) {
      showAlert(duplicates?.skipped ? `Mọi số hợp lệ đều đã có ở chiến dịch khác (${duplicates.skipped.toLocaleString('vi-VN')} số).` : 'Không có data hợp lệ để thêm.', 'error')
      return
    }
    setSelectedDataGroup(null)
    const prepared = nextRows.map(row => ({
      ...row,
      phoneCarrier: row.phoneCarrier || getVietnamMobileCarrier(row.phone) || null,
      status: 'chờ xử lý' as CampaignInputStatus,
      note: ''
    }))
    // Khử trùng với danh sách chờ thêm như form tạo: cùng khóa (SĐT/UID/email/link) chỉ giữ một dòng.
    const seen = new Set(rows.flatMap(rowKeys))
    const unique = prepared.filter(row => {
      const keys = rowKeys(row)
      if (!keys.length) return true
      if (keys.some(key => seen.has(key))) return false
      keys.forEach(key => seen.add(key))
      return true
    })
    const repeated = prepared.length - unique.length
    if (duplicates) {
      setCheckedPhones(current => new Set([...Array.from(current), ...prepared.map(rowPhone).filter(Boolean)]))
      setOtherCheck(current => ({ scope: duplicates.scope, days: duplicates.days, accountCount: duplicates.accountIds.length,
        checkedAt: duplicates.checkedAt, removed: (current?.removed ?? 0) + duplicates.skipped, kept: 0 }))
    }
    if (!unique.length) { showAlert('Các data này đã có trong danh sách chờ thêm.', 'error'); return }
    setRows(current => [...current, ...unique])
    const repeatedNote = repeated ? ` Bỏ ${count(repeated)} data đã có trong danh sách.` : ''
    const skipped = duplicates?.skipped ? ` Bỏ qua ${count(duplicates.skipped)} số đã có ở chiến dịch khác.` : ''
    showAlert(`Đã thêm ${count(unique.length)} data vào danh sách chờ thêm.${repeatedNote}${skipped}`, 'success')
  }

  const selectDataGroup = (group: DataGroup) => {
    setRows([])
    setCheckedPhones(new Set())
    setOtherCheck(null)
    setSelectedDataGroup(group)
    setShowDataGroupPicker(false)
  }

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, rowIndex) => rowIndex !== index))
  }

  const clearRows = () => {
    if (rows.length === 0 && !selectedDataGroup) return
    setRows([])
    setSelectedDataGroup(null)
    setCheckedPhones(new Set())
    setOtherCheck(null)
    showAlert('Đã xoá tất cả data chờ thêm.', 'success')
  }

  const finishDuplicateCheck = (outcome: AddDataDuplicateOutcome) => {
    setShowDuplicateDialog(false)
    const found = new Set(outcome.found.map(item => item.phone))
    const removedCount = outcome.removed ? rows.filter(row => found.has(rowPhone(row))).length : 0
    if (removedCount) setRows(current => current.filter(row => !found.has(rowPhone(row))))
    setCheckedPhones(current => new Set([...Array.from(current), ...outcome.checkedPhones]))
    setOtherCheck(current => ({ scope: outcome.scope, days: outcome.days, accountCount: outcome.accountIds.length, checkedAt: outcome.checkedAt,
      removed: (current?.removed ?? 0) + removedCount, kept: outcome.removed ? 0 : found.size }))
    if (removedCount) showAlert(`Đã bỏ ${count(removedCount)} số đã có ở chiến dịch khác.`, 'success')
  }

  const exportExisting = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      writeFile(createImportMatrixWorkbook(pendingRowsExportMatrix(rows.filter((_, index) => existingFlags[index])), 'Đã có trong chiến dịch'),
        `data-da-co-trong-chien-dich-${timestamp}.xlsx`)
    } catch (error) { showAlert(error instanceof Error ? error.message : 'Không thể xuất Excel.', 'error') }
  }

  const validatePageInboxContacts = (contacts: AutoAccountContact[]): boolean => {
    const campaignPageUid = String(campaign.extraSettings?.pageInboxPageUid || '').trim()
    if (!campaignPageUid) {
      showAlert('Chiến dịch này chưa có Page nhận inbox. Vui lòng kiểm tra lại cấu hình chiến dịch.', 'error')
      return false
    }
    const pageUids = new Set(
      contacts
        .filter(contact => contact.contactType === 'page_inbox_customer')
        .map(contact => String(contact.extraData?.pageUid || '').trim())
        .filter(Boolean)
    )
    if (pageUids.size !== 1 || !pageUids.has(campaignPageUid)) {
      showAlert('Vui lòng chỉ chọn khách inbox đúng Page của chiến dịch hiện tại.', 'error')
      return false
    }
    return true
  }

  const handleScanSelected = (contacts: AutoAccountContact[]) => {
    if (!dataScanPicker) return
    if (dataScanPicker.mode === 'pageInboxCustomers' && !validatePageInboxContacts(contacts)) return

    let nextRows: Partial<CampaignInputData>[] = []
    if (dataScanPicker.mode === 'friends' || dataScanPicker.mode === 'users') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'person')
        .map(contact => ({
          name: contact.name,
          uid: dataScanPicker.action.startsWith('zalo_') ? (contact.uid || contact.url || '') : (contact.url || contact.uid || ''),
          phone: String(contact.extraData?.phone || ''),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'groups') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'group')
        .map(contact => ({
          name: contact.name,
          uid: dataScanPicker.action.startsWith('zalo_')
            ? (contact.uid || contact.url || '')
            : (contact.url || (contact.uid ? `https://www.facebook.com/groups/${contact.uid}` : '')),
          phone: '',
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'pages') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'page')
        .map(contact => ({
          name: contact.name,
          uid: contact.uid || '',
          phone: '',
          email: contact.url || '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'pageInboxCustomers') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'page_inbox_customer')
        .map(contact => ({
          name: contact.name,
          uid: contact.uid || '',
          phone: String(contact.extraData?.phone || ''),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    } else if (dataScanPicker.mode === 'pageInboxPhones') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'page_inbox_customer')
        .map(contact => ({
          name: contact.name,
          uid: '',
          phone: normalizeVietnamMobilePhone(contact.extraData?.phone),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
        .filter(row => !!row.phone)
    } else if (dataScanPicker.mode === 'zaloRemarketingCustomers') {
      nextRows = contacts
        .filter(contact => contact.contactType === 'person')
        .map(contact => ({
          name: contact.name,
          uid: contact.uid || contact.url || '',
          phone: String(contact.extraData?.phone || '').trim(),
          email: '',
          note: '',
          status: 'chờ xử lý' as CampaignInputStatus
        }))
    }

    appendRows(nextRows)
  }

  const handleSubmit = async () => {
    const scheduleIso = toIsoDateTimeValue(campaignSchedule)
    if (!scheduleIso) {
      showAlert('Lịch chạy không hợp lệ.', 'error')
      return
    }
    if (rows.length === 0 && !selectedDataGroup) {
      showAlert('Vui lòng thêm ít nhất một data.', 'error')
      return
    }
    let attemptedGroupSnapshot = false
    setSubmitting(true)
    try {
      if (selectedDataGroup) {
        const fingerprint = [
          campaign.id,
          selectedDataGroup.id,
          scheduleIso,
          campaignStatus
        ].join('|')
        let requestId = snapshotRequestIdentitiesRef.current.get(fingerprint)
        if (!requestId) {
          requestId = `campaign-group-snapshot:${campaign.id}:${createDataGroupRequestId()}`
          snapshotRequestIdentitiesRef.current.set(fingerprint, requestId)
        }
        attemptedGroupSnapshot = true
        const result = await onSnapshotDataGroup({
          requestId,
          campaignId: campaign.id,
          groupId: selectedDataGroup.id,
          campaignSchedule: scheduleIso,
          campaignStatus
        })
        await onRefresh(campaign.id)
        snapshotRequestIdentitiesRef.current.delete(fingerprint)
        const skippedParts = [
          result.alreadySeenCount > 0 ? `${result.alreadySeenCount} đã có trong chiến dịch` : '',
          result.incompatibleCount > 0 ? `${result.incompatibleCount} không tương thích hoặc không hợp lệ` : '',
          result.conflictCount > 0 ? `${result.conflictCount} xung đột định danh` : ''
        ].filter(Boolean)
        const skippedText = skippedParts.length > 0 ? ` Bỏ qua ${skippedParts.join(', ')}.` : ''
        if (result.insertedCount === 0 && result.alreadySeenCount === 0) {
          showAlert(`Không có data nào được thêm.${skippedText}`, 'error')
          return
        }
        showAlert(
          result.insertedCount > 0
            ? `Đã thêm ${result.insertedCount} data từ nhóm “${selectedDataGroup.name}” vào chiến dịch.${skippedText}`
            : `Không có data mới để thêm. ${result.alreadySeenCount} data đã có trong chiến dịch.${skippedText}`,
          'success'
        )
        onClose()
        return
      }

      const result = await onSubmit({
        campaignId: campaign.id,
        rows,
        campaignSchedule: scheduleIso,
        campaignStatus,
        skipExistingInCampaign
      })
      const skippedParts = [
        result.skippedBatchDuplicateCount > 0 ? `${result.skippedBatchDuplicateCount} trùng trong danh sách vừa chọn` : '',
        result.skippedExistingCount > 0 ? `${result.skippedExistingCount} đã có trong chiến dịch` : '',
        result.skippedInvalidCount > 0 ? `${result.skippedInvalidCount} không hợp lệ` : ''
      ].filter(Boolean)
      const skippedText = skippedParts.length > 0 ? ` Bỏ qua ${skippedParts.join(', ')}.` : ''
      if (result.insertedCount === 0) {
        showAlert(`Không có data nào được thêm.${skippedText}`, 'error')
        return
      }
      showAlert(`Đã thêm ${result.insertedCount} data vào chiến dịch.${skippedText}`, 'success')
      onClose()
    } catch (err) {
      if (attemptedGroupSnapshot) {
        try {
          await onRefresh(campaign.id)
        } catch (refreshError) {
          console.error('Failed to refresh campaign input data after partial group snapshot:', refreshError)
        }
      }
      const fallback = attemptedGroupSnapshot
        ? 'Kết nối bị gián đoạn khi thêm data nhóm. Danh sách chiến dịch đã được tải lại; bạn có thể bấm Thêm lại an toàn.'
        : 'Không thể thêm data vào chiến dịch.'
      showAlert(formatIpcErrorMessage(err, fallback), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const hasRows = rows.length > 0 && !selectedDataGroup
  const showPhone = requirement?.field === 'phone' || requirement?.field === 'phone_or_uid' || rows.some(row => !!row.phone)
  const showUid = requirement?.field === 'uid' || requirement?.field === 'phone_or_uid' || rows.some(row => !!row.uid)
  const showEmail = requirement?.field === 'email' || rows.some(row => !!row.email)
  const showCheckColumn = previewReady && existingCount > 0
  const visibleRows = rows.map((row, index) => ({ row, index, existing: existingFlags[index] }))
    .filter(entry => listFilter === 'all' || (listFilter === 'existing') === entry.existing)
  const columnCount = 3 + Number(showPhone) + Number(showUid) + Number(showEmail) + Number(showCheckColumn)

  // Dòng 1: câu trạng thái theo kết quả xem trước và ô "Bỏ qua khi thêm".
  const existingOutcome = skipExistingInCampaign ? 'sẽ bỏ qua khi thêm.' : 'sẽ được thêm lại.'
  const inCampaign = !previewEnabled || previewStatus === 'unavailable'
    ? { tone: 'info' as const, text: skipExistingInCampaign
        ? 'Khi bấm Thêm, hệ thống bỏ qua data đã có trong chiến dịch này.'
        : 'Data đã có trong chiến dịch này sẽ được thêm lại; chỉ lọc trùng trong danh sách vừa chọn.' }
    : previewStatus === 'error'
      ? { tone: 'warn' as const, text: skipExistingInCampaign
          ? 'Chưa xem trước được. Khi bấm Thêm, hệ thống vẫn bỏ qua data đã có trong chiến dịch.'
          : 'Chưa xem trước được. Data đã có trong chiến dịch này sẽ được thêm lại.' }
      : !previewReady
        ? { tone: 'loading' as const, text: 'Đang kiểm tra data đã có trong chiến dịch này…' }
        : existingCount
          ? { tone: skipExistingInCampaign ? 'info' as const : 'warn' as const, text: '' }
          : { tone: 'ok' as const, text: 'Không có data nào đã có trong chiến dịch này.' }

  // Dòng 2: chỉ loại nhắn tin đến SĐT khi công tắc lọc trùng mở và danh sách có SĐT hợp lệ.
  const showOtherRow = otherCheckEnabled && phoneRows.length > 0
  const otherScopeText = otherCheck?.scope === 'current'
    ? `tài khoản ${account?.name || ''}`.trim()
    : `${count(otherCheck?.accountCount ?? 0)} tài khoản Zalo`
  const otherWhen = otherCheck ? formatVietnamTime(otherCheck.checkedAt) : ''
  const other = !otherCheck
    ? { done: false, text: <><strong>{count(uncheckedCount)}</strong> số chưa đối chiếu với chiến dịch khác.</> }
    : uncheckedCount > 0
      ? { done: false, text: <>Đã lọc {count(checkedCount)} số lúc {otherWhen} · còn <strong>{count(uncheckedCount)}</strong> số chưa đối chiếu.</> }
      : otherCheck.kept > 0
        ? { done: true, text: <>Đã đối chiếu với dữ liệu {otherCheck.days} ngày của {otherScopeText} lúc {otherWhen} · giữ lại <strong>{count(otherCheck.kept)}</strong> số đã có ở chiến dịch khác.</> }
        : otherCheck.removed > 0
          ? { done: true, text: <>Đã lọc trùng với dữ liệu {otherCheck.days} ngày của {otherScopeText} lúc {otherWhen} · đã bỏ <strong>{count(otherCheck.removed)}</strong> số đã có ở chiến dịch khác.</> }
          : { done: true, text: <>Không có số nào đã có ở chiến dịch khác trong {otherCheck.days} ngày của {otherScopeText} (lúc {otherWhen}).</> }

  const invalidNote = invalidCount ? ` · bỏ ${count(invalidCount)} data không hợp lệ` : ''
  const summary = !hasRows || !previewReady ? ''
    : willAddCount <= 0
      ? invalidCount === rows.length ? 'Không có data hợp lệ để thêm.'
        : invalidCount ? 'Mọi data hợp lệ chờ thêm đã có trong chiến dịch.' : 'Mọi data chờ thêm đã có trong chiến dịch.'
      : !existingCount ? `Sẽ thêm ${count(willAddCount)} data${invalidNote}.`
        : skipExistingInCampaign ? `Sẽ thêm ${count(willAddCount)} data · bỏ qua ${count(existingCount)} data đã có trong chiến dịch${invalidNote}.`
          : `Sẽ thêm ${count(willAddCount)} data, gồm ${count(existingCount)} data đã có trong chiến dịch${invalidNote}.`
  const submitLabel = hasRows && previewReady && willAddCount > 0 ? `Thêm ${count(willAddCount)} data` : 'Thêm'

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 2200 }}
      onMouseDown={submitting ? undefined : onClose}
    >
      <div className="modal add-current-data-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Thêm data</div>
          <button className="btn-icon" onClick={onClose} title="Đóng" disabled={submitting}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body add-current-data-modal-body">
          <div className="add-current-data-meta">
            <span className="add-current-data-campaign-name" title={campaign.name}>Chiến dịch: <strong>{campaign.name}</strong></span>
            {account?.name && <span className="add-current-data-campaign-name" title={account.name}>Tài khoản: <strong>{account.name}</strong></span>}
          </div>

          <div className="add-current-data-source-row">
            {canImportData && (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={submitting}
                onClick={() => {
                  if (!account?.id) {
                    showAlert('Chiến dịch chưa có tài khoản hợp lệ để import data.', 'error')
                    return
                  }
                  setShowDataUploadModal(true)
                }}
              >
                <Upload size={14} /> Nhập/import data
              </button>
            )}
            {canSnapshotDataGroup && (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={submitting}
                onClick={() => setShowDataGroupPicker(true)}
              >
                <Users size={14} /> Thêm bằng nhóm
              </button>
            )}
            {scanSources.map(source => (
              <button
                key={source.key}
                className="btn btn-secondary"
                type="button"
                disabled={submitting}
                onClick={() => {
                  if (!account?.id && source.mode !== 'pageInboxPhones') {
                    showAlert('Chiến dịch chưa có tài khoản hợp lệ để chọn data.', 'error')
                    return
                  }
                  setDataScanPicker(source)
                }}
              >
                <Users size={14} /> {source.label}
              </button>
            ))}
          </div>

          <div className="add-current-data-list">
            <div className="add-current-data-preview-header">
              <span>Data chờ thêm{hasRows && <span className="add-current-data-count"> · {count(rows.length)}</span>}</span>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={clearRows}
                disabled={submitting || (rows.length === 0 && !selectedDataGroup)}
                title="Xoá tất cả data chờ thêm"
              >
                <Trash2 size={13} /> Xoá tất cả
              </button>
            </div>

            {hasRows && <div className="add-data-check" role="group" aria-label="Kiểm tra trùng">
              <div className="add-data-check-row">
                {inCampaign.tone === 'loading' ? <RefreshCw size={18} className="add-data-check-icon spin" aria-hidden="true" />
                  : inCampaign.tone === 'warn' ? <AlertTriangle size={18} className="add-data-check-icon is-warn" aria-hidden="true" />
                    : inCampaign.tone === 'ok' ? <CheckCircle2 size={18} className="add-data-check-icon is-ok" aria-hidden="true" />
                      : <Info size={18} className="add-data-check-icon" aria-hidden="true" />}
                <div className="add-data-check-text">
                  <span className="add-data-check-label">Trong chiến dịch này</span>
                  <span role="status">{inCampaign.text || <><strong>{count(existingCount)}</strong>/{count(rows.length)} data đã có trong chiến dịch này · {existingOutcome}</>}</span>
                </div>
                <div className="add-data-check-actions">
                  <label className="add-data-check-skip">
                    <input type="checkbox" aria-label="Bỏ qua data đã có trong chiến dịch" checked={skipExistingInCampaign} disabled={submitting}
                      onChange={event => setSkipExistingInCampaign(event.target.checked)} />
                    <span>Bỏ qua khi thêm</span>
                  </label>
                  {previewEnabled && previewStatus === 'error' && <button type="button" className="btn btn-secondary btn-sm" disabled={submitting}
                    onClick={() => { previewFailedRowsRef.current = null; setPreviewRetry(current => current + 1) }}>Thử lại</button>}
                  {showCheckColumn && <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setListFilter('existing')}>Xem</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={exportExisting} aria-label="Tải Excel data đã có trong chiến dịch này"><Download size={13} /> Excel</button>
                  </>}
                </div>
              </div>
              {showOtherRow && <div className="add-data-check-row">
                {other.done ? <CheckCircle2 size={18} className="add-data-check-icon is-ok" aria-hidden="true" /> : <AlertTriangle size={18} className="add-data-check-icon is-warn" aria-hidden="true" />}
                <div className="add-data-check-text">
                  <span className="add-data-check-label">Với chiến dịch khác</span>
                  <span role="status">{other.text}</span>
                </div>
                <div className="add-data-check-actions">
                  {other.done
                    ? <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={() => setShowDuplicateDialog(true)}><RefreshCw size={13} /> Kiểm tra lại</button>
                    : <button type="button" className="btn add-data-check-primary" disabled={submitting} onClick={() => setShowDuplicateDialog(true)}><ListChecks size={14} /> Kiểm tra trùng</button>}
                </div>
              </div>}
            </div>}

            {hasRows && showCheckColumn && <div className="add-data-filter" role="group" aria-label="Lọc danh sách chờ thêm">
              <button type="button" aria-pressed={listFilter === 'all'} onClick={() => setListFilter('all')}>Tất cả · {count(rows.length)}</button>
              <button type="button" aria-pressed={listFilter === 'new'} onClick={() => setListFilter('new')}>Chưa có · {count(rows.length - existingCount)}</button>
              <button type="button" aria-pressed={listFilter === 'existing'} onClick={() => setListFilter('existing')}>Đã có trong chiến dịch · {count(existingCount)}</button>
            </div>}

            <div className="add-current-data-preview">
              {selectedDataGroup ? (
                <div className="add-current-data-group-snapshot">
                  <div>
                    <strong>{selectedDataGroup.name}</strong>
                    <span>{selectedDataGroup.activeMembershipCount.toLocaleString('vi-VN')} thành viên hiện tại</span>
                    <small>Chỉ thêm dữ liệu hiện tại một lần; chiến dịch không nhận data mới phát sinh trong nhóm.</small>
                  </div>
                  <button
                    className="btn-icon text-error"
                    type="button"
                    onClick={() => setSelectedDataGroup(null)}
                    title="Bỏ nhóm"
                    disabled={submitting}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <div className="text-muted add-input-data-empty">Chưa có data nào. Hãy nhập/import, chọn data hoặc thêm bằng nhóm.</div>
              ) : (
                <table className="campaign-grid">
                  <thead>
                    <tr>
                      <th className="campaign-grid-index-col">STT</th>
                      <th>Tên</th>
                      {showPhone && <th>Số điện thoại</th>}
                      {showUid && <th>UID/link</th>}
                      {showEmail && <th>Email</th>}
                      {showCheckColumn && <th>Kiểm tra trùng</th>}
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr><td colSpan={columnCount} className="text-center text-muted">Không có data trong nhóm này</td></tr>
                    ) : visibleRows.map(({ row, index, existing }) => (
                      <tr key={`${index}-${row.uid || row.phone || row.email || row.name || 'row'}`}>
                        <td className="campaign-grid-index-col">{index + 1}</td>
                        <td title={row.name || ''}>{row.name || '-'}</td>
                        {showPhone && <td title={row.phone || ''}>{row.phone || '-'}</td>}
                        {showUid && <td title={row.uid || ''}>{row.uid || '-'}</td>}
                        {showEmail && <td title={row.email || ''}>{row.email || '-'}</td>}
                        {showCheckColumn && <td>{existing && <span className="campaign-import-status-pill" title="Đã có trong chiến dịch">Đã có<span className="add-data-pill-long"> trong chiến dịch</span></span>}</td>}
                        <td>
                          <button className="btn-icon text-error" onClick={() => removeRow(index)} title="Xoá data" disabled={submitting}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="add-input-data-grid">
            <label className="stepper-form-group">
              <span>Lịch chạy</span>
              <input className="stepper-input" type="datetime-local" value={campaignSchedule} onChange={event => setCampaignSchedule(event.target.value)} disabled={submitting} />
            </label>

            <label className="stepper-form-group">
              <span>Trạng thái chiến dịch</span>
              <select className="stepper-input" value={campaignStatus} onChange={event => setCampaignStatus(event.target.value as InputDataBatchStatus)} disabled={submitting}>
                <option value="chờ xử lý">chờ xử lý</option>
                <option value="tạm dừng">tạm dừng</option>
              </select>
            </label>
          </div>
        </div>

        <div className="modal-footer add-current-data-footer">
          <span className="add-current-data-summary" role="status">{summary}</span>
          <div className="add-current-data-footer-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Huỷ</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || (rows.length === 0 && !selectedDataGroup)}>
              {submitting ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
      {showDataUploadModal && account?.id && (
        <div onMouseDown={event => event.stopPropagation()}>
          <CampaignDataUploadModal
            platform={importPlatform}
            actionId={campaign.actionId}
            actionName={campaignAction?.name}
            accountIds={[account.id]}
            showDatasetName={false}
            duplicateCheck={duplicateCheck}
            onClose={() => setShowDataUploadModal(false)}
            onInsert={(importedRows, meta) => appendRows(importedRows, meta?.duplicates)}
            onSubmitRows={({ rows: importedRows, duplicates }) => appendRows(importedRows, duplicates)}
          />
        </div>
      )}
      {showDuplicateDialog && otherCheckEnabled && dupSetting && account?.id && (
        <div onMouseDown={event => event.stopPropagation()}>
          <CampaignAddDataDuplicateDialog
            actionId={campaign.actionId}
            campaignId={campaign.id}
            account={{ id: account.id, name: account.name || `Tài khoản ${account.id}` }}
            rows={rows}
            defaultDays={dupSetting.defaultDays}
            maxDays={dupSetting.maxDays}
            onClose={() => setShowDuplicateDialog(false)}
            onDone={finishDuplicateCheck}
          />
        </div>
      )}
      {dataScanPicker && (account?.id || dataScanPicker.mode === 'pageInboxPhones') && (
        <div onMouseDown={event => event.stopPropagation()}>
          <DataScanModal
            initialAction={dataScanPicker.action}
            initialAccountId={dataScanPicker.mode === 'pageInboxPhones' ? undefined : account?.id}
            initialStatusFilter={dataScanPicker.initialStatusFilter}
            initialPageInboxPageUid={dataScanPicker.initialPageInboxPageUid}
            initialPageInboxPageName={dataScanPicker.initialPageInboxPageName}
            allowedActions={dataScanPicker.allowedActions}
            lockAccount={dataScanPicker.lockAccount}
            lockPageInboxPage={dataScanPicker.lockPageInboxPage}
            onClose={() => setDataScanPicker(null)}
            onSelect={handleScanSelected}
          />
        </div>
      )}
      {showDataGroupPicker && (
        <div onMouseDown={event => event.stopPropagation()}>
          <DataGroupPickerModal
            actionId={campaign.actionId}
            onClose={() => setShowDataGroupPicker(false)}
            onSelect={selectDataGroup}
          />
        </div>
      )}
    </div>
  )
}
