import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Image as ImageIcon, Info, RefreshCw, Upload, Users, X } from 'lucide-react'
import jsQR from 'jsqr'
import { read, writeFile } from 'xlsx'
import { CampaignImportDataRow, CampaignImportPlatform, CampaignInputData, ContactDatasetImportSource, getCampaignInputDataRequirement } from '../../../../shared/types'
import {
  IMPORT_LIMIT_MESSAGE, IMPORT_MAX_ROWS, detectImportColumns, hasImportTextHeader, importLocationLabel,
  importTargetField, mapImportTable, normalizeImportGroupLink, templateImportSchema, textImportRows, verifyImportRows,
  type ImportColumnMap, type ImportField, type ImportPhonePolicy, type ImportResultGroup, type ImportSourceKind,
  type ImportSourceRow, type ImportTable, type ImportTableSource, type ImportVerificationResult,
  importExistingExportMatrix, splitExistingImportEntries, type ImportExistingEntry, type ImportVerificationEntry
} from '../../../../shared/campaignImportVerification'
import { createImportExportWorkbook, createImportMatrixWorkbook, importWorkbookTables, readImportWorkbook } from '../../../../shared/campaignImportWorkbook'
import {
  INPUT_DUPLICATES_DAY_PRESETS, INPUT_DUPLICATES_DEFAULT_DAYS, INPUT_DUPLICATES_MAX_DAYS, chunkInputDuplicatePhones, formatVietnamDate,
  formatVietnamTime, inputDuplicateScopeLabel, inputDuplicateStatusLabel, inputDuplicateWindowStart, inputDuplicatesVisible,
  mergeInputDuplicateResults, supportsInputDuplicateCheck, type InputDuplicateScope, type InputDuplicatesCheckResult, type InputDuplicatesSetting
} from '../../../../shared/campaignInputDuplicates'
import {
  chunkDataGroupMatchValues, mergeDataGroupMemberMatches,
  type DataGroupMatchContactType, type DataGroupMatchOtherGroups, type DataGroupMemberMatchesResult
} from '../../../../shared/dataGroupMemberMatches'
import { dataGroupMemberMatchesUnavailable } from '../../../../shared/dataGroupMemberMatchesIpc'
import {
  dataGroupMatchValue, dataGroupMemberExportMatrix, planDataGroupImport, splitDataGroupMemberEntries, type DataGroupImportMemberEntry
} from '../../../../shared/dataGroupImport'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useCampaignStore } from '../../stores/campaignStore'
import { getAccountPlatformLabel } from '../../utils/accountLabels'
import { createDefaultDataGroupName } from '../../utils/dataGroupNames'
import type { AgentDataSource } from '../../../../shared/campaignAgentData'
import { InputDuplicateAccountPicker, type InputDuplicateAccountOption } from './InputDuplicateAccountPicker'
import { DataGroupMatchPicker, type DataGroupMatchOptions } from './DataGroupMatchPicker'
import { inputDuplicateMemoryKey, readDuplicateMemory, writeDuplicateMemory } from '../../utils/inputDuplicateMemory'
import './CampaignImportDuplicates.css'

type ImportTab = ImportSourceKind
type TableTab = 'excel' | 'akabizTemplate' | 'sheet' | 'textbox'
type TemplateReadStatus = 'idle' | 'reading' | 'success' | 'error'
interface FieldDef { key: ImportField; label: string; required?: boolean }
interface TableConfig { index: number; mapping: ImportColumnMap; skipHeader: boolean }
const INFO_FIELDS: FieldDef[] = [1, 2, 3, 4, 5].map(index => ({ key: `info${index}` as ImportField, label: `Info ${index}` }))
const MAX_IMPORT_ROW_COUNT = IMPORT_MAX_ROWS
const IMPORT_ROW_LIMIT_MESSAGE = IMPORT_LIMIT_MESSAGE
const IMPORT_PREVIEW_PAGE_SIZE = 100
const isZaloJoinGroupLinkAction = (id: string) => id === 'zalo_join_group_link'
const isZaloAddGroupMemberAction = (id: string) => id === 'zalo_add_group_member'
const isFacebookJoinGroupAction = (id: string) => id === 'facebook_join_group'
const isFacebookFindDataSearchAction = (id: string) => id === 'facebook_find_data_search'
const isFacebookCommentSeedingPostAction = (id: string) => id === 'facebook_comment_seeding_post'
const isDataGroupZaloPersonUidAction = (id: string) => id === 'data_group_zalo_person_uid'
const getImportTargetField = importTargetField
const normalizeZaloGroupInviteLink = normalizeImportGroupLink
const waitForNextBrowserPaint = (): Promise<void> => new Promise(resolve => {
  window.requestAnimationFrame(() => window.setTimeout(resolve, 0))
})
const EMPTY_CONFIG = (): TableConfig => ({ index: 0, mapping: {}, skipHeader: false })
type ResultGroupKey = ImportResultGroup | 'existing' | 'inGroup' | 'otherGroups'
/** Nhóm kết quả do máy chủ đối chiếu (không phải lỗi hay trùng trong file): dòng hiện theo dữ liệu đã chuẩn hóa. */
const SERVER_RESULT_GROUPS: readonly ResultGroupKey[] = ['existing', 'inGroup', 'otherGroups']
const RESULT_GROUPS: { key: ResultGroupKey; label: string; shortLabel: string; file: string }[] = [
  { key: 'valid', label: 'Dữ liệu hợp lệ có thể sử dụng', shortLabel: 'Hợp lệ', file: 'du-lieu-hop-le' },
  { key: 'inGroup', label: 'Dữ liệu đã có trong nhóm này', shortLabel: 'Đã có trong nhóm này', file: 'du-lieu-da-co-trong-nhom-nay' },
  { key: 'otherGroups', label: 'Dữ liệu đã có ở nhóm data khác', shortLabel: 'Đã có ở nhóm khác', file: 'du-lieu-da-co-o-nhom-khac' },
  { key: 'existing', label: 'Dữ liệu đã có ở chiến dịch khác', shortLabel: 'Đã có ở chiến dịch khác', file: 'du-lieu-da-co-o-chien-dich-khac' },
  { key: 'rejected', label: 'Dữ liệu lỗi/bị loại', shortLabel: 'Lỗi/bị loại', file: 'du-lieu-bi-loai' },
  { key: 'duplicates', label: 'Dữ liệu trùng bị loại', shortLabel: 'Trùng', file: 'du-lieu-trung' }
]
const columnLabel = (index: number): string => {
  let result = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
  return result
}
export interface CampaignDataUploadSubmission {
  datasetName: string
  importSource: ContactDatasetImportSource
  sourceLink: string | null
  rows: Partial<CampaignInputData>[]
  /** Có khi khách chọn lọc trùng với chiến dịch khác (V491/V493): phạm vi đã đối chiếu và số đã bỏ qua. */
  duplicates?: ImportDuplicateSummary
  /** Có khi đã đối chiếu với thành viên Nhóm data (V519/V522): số mục hợp lệ đã bỏ ở từng nhóm kết quả. */
  members?: ImportMemberSummary
}

export interface ImportMemberSummary {
  checkedAt: string
  /** Số mục hợp lệ bị bỏ vì đã có trong nhóm đang nhập. */
  inGroup: number
  /** Số mục hợp lệ bị bỏ vì đã có ở nhóm data khác. */
  otherGroups: number
}

/**
 * Đối chiếu với thành viên Nhóm data (V519, Desktop gọi bằng token ở V522): máy chủ cho biết dòng nào đã có trong nhóm
 * đang nhập và ở các nhóm khác của nhân viên. Nơi gọi chỉ truyền khi nhóm thuộc quyền của nhân viên và loại data đối
 * chiếu được (SĐT, UID Zalo, link group Zalo); cửa sổ tự đọc trường `groupMatches` của công tắc.
 */
export interface CampaignImportMemberCheck {
  groupId: number
  contactType: DataGroupMatchContactType
  /** Tải các nhóm data khác của chính nhân viên (không gồm nhóm đang nhập và nhóm được chia sẻ); gọi khi mở hộp chọn nhóm. */
  loadOtherGroups: () => Promise<DataGroupMatchOptions>
}

/**
 * Lọc trùng với chiến dịch khác (V491, Desktop gọi bằng token ở V493). Nơi gọi truyền: form chiến dịch, Thêm data và
 * Nhóm data nhập loại SĐT; cửa sổ tự đọc công tắc `web.campaign_input_duplicates` và chỉ hiện khung khi loại dữ liệu
 * hỗ trợ và công tắc mở cho phiên này.
 */
export interface CampaignImportDuplicateCheck {
  /**
   * Tài khoản đang chọn: form tạo = mọi tài khoản đã tick; Thêm data = tài khoản của chiến dịch; Nhóm data = tài khoản
   * Zalo gắn với nhóm. Rỗng (nhóm không gắn tài khoản) thì ẩn lựa chọn "tài khoản đang chọn".
   */
  currentAccounts: { id: number; name: string }[]
  /** Chiến dịch đang nhận "Thêm data": không so với chính nó. */
  excludeCampaignId?: number
}

export interface ImportDuplicateSummary {
  scope: Exclude<InputDuplicateScope, 'file'>
  days: number
  accountIds: number[]
  checkedAt: string
  since: string
  /** Số mục hợp lệ bị bỏ vì đã có ở chiến dịch khác. */
  skipped: number
}

/**
 * Nơi nhận là một Nhóm data: chữ trên cửa sổ nói "thêm vào nhóm" thay cho "chèn", hộp xác nhận nêu tên nhóm và tên
 * danh sách sẽ lưu. Nơi gọi khác không truyền, chữ giữ như cũ.
 */
export interface CampaignImportDestination {
  kind: 'dataGroup'
  name: string
  /**
   * Nhóm gắn tài khoản Zalo: DB nhận ra data đã có trong nhóm (cùng tài khoản, loại và định danh) và không thêm lại.
   * Nhóm không gắn tài khoản: DB chỉ nhận ra trong cùng một danh sách, nên data đã có từ lần nhập khác vẫn thành dòng
   * mới (hàm `aka_agent_ingest_data_group`, nhánh "Accountless identity is intentionally NOT global").
   */
  skipsExistingMembers: boolean
  /** Dòng ghi chú đặt ở chỗ khung lọc trùng khi cửa sổ không có khung (loại data chưa đối chiếu được, công tắc tắt). */
  duplicateNote?: string
  /**
   * Có thì cửa sổ có hai ô "Bỏ data đã có trong nhóm này" (bật sẵn) và "Bỏ data đã có ở nhóm data khác". Không
   * truyền, công tắc tắt, DB chưa có hàm V519 hoặc token Desktop chưa được cấp quyền (V522) thì cửa sổ như trước.
   */
  memberCheck?: CampaignImportMemberCheck
}

interface MemberEntries { inGroup: DataGroupImportMemberEntry[]; otherGroups: DataGroupImportMemberEntry[] }
/** Phạm vi của lượt đối chiếu nhóm vừa chạy: có bỏ data trong nhóm này không, và đối chiếu bao nhiêu nhóm khác. */
interface MemberMeta { checkedAt: string; inGroup: boolean; other: 'none' | 'all' | number }
type DuplicateMeta = Omit<ImportDuplicateSummary, 'skipped'>
/** Kết quả một lượt kiểm tra đã xong: dùng ngay sau `await` (state của React chưa kịp cập nhật). */
interface CheckedImport {
  report: ImportVerificationResult
  existing: ImportExistingEntry[] | null
  dupMeta: DuplicateMeta | null
  members: MemberEntries | null
  memberMeta: MemberMeta | null
}

const checkedMessage = (next: ImportVerificationResult, found: ImportExistingEntry[] | null, members: MemberEntries | null = null): string =>
  `Đã kiểm tra: ${next.valid.length} hợp lệ · ${next.rejected.length} lỗi/bị loại · ${next.duplicates.length} trùng${
    members?.inGroup.length ? ` · ${members.inGroup.length} đã có trong nhóm này` : ''}${
    members?.otherGroups.length ? ` · ${members.otherGroups.length} đã có ở nhóm khác` : ''}${
    found ? ` · ${found.length} đã có ở chiến dịch khác` : ''}.`

const memberFilteredCount = (value: { members: MemberEntries | null }): number =>
  (value.members?.inGroup.length ?? 0) + (value.members?.otherGroups.length ?? 0)

interface CampaignDataUploadModalProps {
  platform: CampaignImportPlatform
  actionId: string
  actionName?: string
  accountIds: number[]
  onClose: () => void
  onInsert: (rows: Partial<CampaignInputData>[], meta?: { duplicates?: ImportDuplicateSummary }) => void
  /** Hiện khung "Lọc trùng dữ liệu" (V491/V493). Kiểm tra SĐT, Nhóm data không phải loại SĐT và nơi gọi cũ không truyền: chỉ lọc trong file như trước. */
  duplicateCheck?: CampaignImportDuplicateCheck
  /** Nhóm data đang nhận danh sách. Không truyền thì chữ là "chèn" như trước. */
  destination?: CampaignImportDestination
  /** Optional external sink used by Data Group; skips legacy account-scoped dataset persistence. */
  onSubmitRows?: (submission: CampaignDataUploadSubmission) => void | Promise<void>
  contextSlot?: ReactNode
  title?: string
  datasetNameLabel?: string
  showDatasetName?: boolean
  layout?: 'default' | 'data-group'
  submitLabel?: string
  initialSource?: AgentDataSource
  readImageText?: (dataUrl: string, name: string) => Promise<string>
}

const loadImageFromDataUrl = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Không thể mở ảnh QR.'))
  image.src = dataUrl
})

const decodeQrDataFromImage = (image: HTMLImageElement): string => {
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (width <= 0 || height <= 0) return ''

  const minSide = Math.min(width, height)
  const attempts = [
    { sx: 0, sy: 0, sw: width, sh: height },
    ...[0.78, 0.68, 0.58, 0.48].map(ratio => {
      const side = Math.round(minSide * ratio)
      return {
        sx: Math.max(0, Math.round((width - side) / 2)),
        sy: Math.max(0, Math.round((height - side) / 2)),
        sw: side,
        sh: side
      }
    })
  ]

  for (const attempt of attempts) {
    const canvas = document.createElement('canvas')
    canvas.width = attempt.sw
    canvas.height = attempt.sh
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(
      image,
      attempt.sx,
      attempt.sy,
      attempt.sw,
      attempt.sh,
      0,
      0,
      attempt.sw,
      attempt.sh
    )
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const qr = jsQR(imageData.data, imageData.width, imageData.height)
    if (qr?.data) return qr.data
  }

  return ''
}

const decodeQrDataFromDataUrl = async (dataUrl: string): Promise<string> => {
  const image = await loadImageFromDataUrl(dataUrl)
  return decodeQrDataFromImage(image)
}

const getFieldsForPlatform = (platform: CampaignImportPlatform, actionId: string): FieldDef[] => {
  if (isZaloJoinGroupLinkAction(actionId)) {
    return [
      { key: 'name', label: 'Tên group' },
      { key: 'uid', label: 'Link group Zalo', required: true },
      ...INFO_FIELDS
    ]
  }
  if (isZaloAddGroupMemberAction(actionId)) {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'phone', label: 'Số điện thoại', required: true },
      ...INFO_FIELDS
    ]
  }
  if (isFacebookJoinGroupAction(actionId)) {
    return [
      { key: 'name', label: 'Tên group' },
      { key: 'uid', label: 'Group URL/UID', required: true },
      ...INFO_FIELDS
    ]
  }
  if (isFacebookFindDataSearchAction(actionId)) {
    return [
      { key: 'uid', label: 'Từ khóa', required: true },
      ...INFO_FIELDS
    ]
  }
  if (isFacebookCommentSeedingPostAction(actionId)) {
    return [
      { key: 'uid', label: 'Link bài post', required: true },
      ...INFO_FIELDS
    ]
  }
  const targetField = getImportTargetField(platform, actionId)
  if (targetField === 'phone') {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'phone', label: platform === 'sms' ? 'Số điện thoại SMS' : 'Số điện thoại', required: true },
      ...INFO_FIELDS
    ]
  }
  if (targetField === 'uid') {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'uid', label: isDataGroupZaloPersonUidAction(actionId) ? 'UID Zalo' : getCampaignInputDataRequirement(actionId)?.label || 'Uid', required: true },
      ...INFO_FIELDS
    ]
  }
  return [
    { key: 'name', label: 'Tên' },
    { key: 'email', label: 'Email', required: true },
    ...INFO_FIELDS
  ]
}


export default function CampaignDataUploadModal({
  platform, actionId, actionName, accountIds, onClose, onInsert, onSubmitRows, contextSlot,
  title = 'Upload dữ liệu', datasetNameLabel = 'Tên nhóm dữ liệu', showDatasetName = true,
  layout = 'default', submitLabel = 'Chèn xuống chi tiết', initialSource, readImageText, duplicateCheck, destination
}: CampaignDataUploadModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  // Nhóm data: "thêm vào nhóm" thay cho "chèn"; lựa chọn 2 là tài khoản gắn với nhóm.
  const toGroup = destination?.kind === 'dataGroup'
  const hasCurrentAccounts = Boolean(duplicateCheck?.currentAccounts.length)
  const scopeLabel = (scope: Exclude<InputDuplicateScope, 'file'>, accountCount: number): string =>
    toGroup && scope === 'current' ? 'tài khoản gắn với nhóm' : inputDuplicateScopeLabel(scope, accountCount)
  const authUser = useAuthStore(state => state.user)
  const storeAccounts = useCampaignStore(state => state.accounts)
  const fields = useMemo(() => getFieldsForPlatform(platform, actionId), [platform, actionId])
  const [activeTab, setActiveTab] = useState<ImportTab>('textbox')
  const [datasetName, setDatasetName] = useState(createDefaultDataGroupName)
  const [textContent, setTextContent] = useState('')
  const [textSkipHeader, setTextSkipHeader] = useState(false)
  const [txtFileName, setTxtFileName] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [imageSourceName, setImageSourceName] = useState('')
  const [sheetLink, setSheetLink] = useState('')
  const [files, setFiles] = useState<Partial<Record<'excel' | 'akabizTemplate', File>>>({})
  const [sources, setSources] = useState<Partial<Record<TableTab, ImportTableSource>>>({})
  const [configs, setConfigs] = useState<Partial<Record<TableTab, TableConfig>>>({})
  const [phonePolicy, setPhonePolicy] = useState<ImportPhonePolicy>('first')
  const [templateStatus, setTemplateStatus] = useState<TemplateReadStatus>('idle')
  const [templateError, setTemplateError] = useState('')
  const [report, setReport] = useState<ImportVerificationResult | null>(null)
  const [resultGroup, setResultGroup] = useState<ResultGroupKey>('valid')
  const [previewPage, setPreviewPage] = useState(1)
  const [formattedImportSource, setFormattedImportSource] = useState<ImportTab | null>(null)
  const [formattedSourceLink, setFormattedSourceLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const sourceRevisionRef = useRef(0)
  const asyncOperationRef = useRef(0)
  const insertInFlightRef = useRef(false)
  const templateFileInputRef = useRef<HTMLInputElement>(null)
  // "Lọc trùng dữ liệu" (V491/V493). Mặc định "Chỉ trong file này"; số ngày và tài khoản đã chọn được nhớ trên máy.
  const dupSupported = Boolean(duplicateCheck) && supportsInputDuplicateCheck(actionId)
  const dupStorageKey = inputDuplicateMemoryKey(authUser?.organizationId, authUser?.staffId)
  const dupConfigKey = duplicateCheck ? JSON.stringify([duplicateCheck.currentAccounts.map(account => account.id), duplicateCheck.excludeCampaignId ?? null]) : ''
  const [dupSetting, setDupSetting] = useState<InputDuplicatesSetting | null>(null)
  const dupEnabled = dupSupported && Boolean(dupSetting) && inputDuplicatesVisible(dupSetting ?? undefined, authUser?.isAdminAkabiz)
  const dupMaxDays = dupSetting ? Math.max(1, Math.min(INPUT_DUPLICATES_MAX_DAYS, Math.floor(dupSetting.maxDays))) : INPUT_DUPLICATES_MAX_DAYS
  const dayPresets = INPUT_DUPLICATES_DAY_PRESETS.filter(days => days <= dupMaxDays)
  const [dupScope, setDupScope] = useState<InputDuplicateScope>('file')
  const [dupDays, setDupDays] = useState(INPUT_DUPLICATES_DEFAULT_DAYS)
  const [dupDaysText, setDupDaysText] = useState('')
  const [pickedIds, setPickedIds] = useState<number[] | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [existing, setExisting] = useState<ImportExistingEntry[] | null>(null)
  const [dupMeta, setDupMeta] = useState<DuplicateMeta | null>(null)
  const [dupProgress, setDupProgress] = useState<{ stage: 'members' | 'campaign'; done: number; total: number } | null>(null)
  const [dupFailure, setDupFailure] = useState<{ stage: 'members' | 'campaign'; message: string; report: ImportVerificationResult; kind: ImportTab } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // IPC không hủy được: "Hủy kiểm tra" dừng trước lượt kế tiếp và bỏ kết quả của lượt đang chạy (mỗi lượt ≤ 20 s ở DB).
  const dupRunRef = useRef<{ cancelled: boolean } | null>(null)
  const dedupActive = dupEnabled && dupScope !== 'file'
  // Đối chiếu với thành viên Nhóm data (V519/V522). "Trong nhóm này" bật sẵn, "nhóm khác" tắt sẵn; không nhớ giữa các lần mở.
  const memberCheck = toGroup ? destination?.memberCheck : undefined
  const memberConfigKey = memberCheck ? JSON.stringify([memberCheck.groupId, memberCheck.contactType]) : ''
  /** `null` = đang đọc công tắc `groupMatches` (mỗi lần mở cửa sổ); đọc lỗi hoặc tắt = false, cửa sổ nhập như trước. */
  const [memberEnabled, setMemberEnabled] = useState<boolean | null>(null)
  const [memberUnavailable, setMemberUnavailable] = useState(false)
  const [inGroupOn, setInGroupOn] = useState(true)
  const [otherOn, setOtherOn] = useState(false)
  /** `null` = tất cả nhóm data khác. */
  const [otherIds, setOtherIds] = useState<number[] | null>(null)
  const [otherNames, setOtherNames] = useState<string[]>([])
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [members, setMembers] = useState<MemberEntries | null>(null)
  /** Có = báo cáo đang hiện đã được đối chiếu với nhóm; `null` = chưa (file mẫu tự kiểm tra trong máy, không gọi máy chủ). */
  const [memberMeta, setMemberMeta] = useState<MemberMeta | null>(null)
  /** Người dùng chọn "Thêm không đối chiếu" sau một lượt đối chiếu nhóm hỏng: áp cho báo cáo đang hiện. */
  const [memberSkipped, setMemberSkipped] = useState(false)
  const memberSettingLoading = Boolean(memberCheck) && memberEnabled === null
  const memberUi = Boolean(memberCheck) && memberEnabled === true && !memberUnavailable
  const memberWanted = memberUi && (inGroupOn || otherOn)
  const memberPending = memberWanted && !memberMeta && !memberSkipped
  const dupDaysInvalid = dupDaysText !== '' && !(Number.isInteger(Number(dupDaysText)) && Number(dupDaysText) >= 1 && Number(dupDaysText) <= dupMaxDays)
  // Tài khoản Zalo của nhân viên (danh sách tài khoản của app đã theo nhân viên/tổ chức); DB kiểm lại từng tài khoản.
  const zaloAccounts = useMemo<InputDuplicateAccountOption[]>(() => {
    const currentIds = new Set(duplicateCheck?.currentAccounts.map(account => account.id) ?? [])
    return storeAccounts.filter(account => account.flatformType === 'zalo' && !account.isDelete).map(account => ({
      id: account.id, name: account.name || `Tài khoản ${account.id}`, groupName: account.accountGroupName?.trim() || '',
      typeLabel: getAccountPlatformLabel(account), current: currentIds.has(account.id)
    }))
  }, [storeAccounts, dupConfigKey])

  useEffect(() => {
    sourceRevisionRef.current++
    asyncOperationRef.current++
    setActiveTab('textbox'); setDatasetName(createDefaultDataGroupName()); setTextContent(''); setTextSkipHeader(false); setTxtFileName('')
    setImageDataUrl(''); setImageSourceName(''); setSheetLink(''); setFiles({}); setSources({}); setConfigs({})
    setPhonePolicy('first'); setTemplateStatus('idle'); setTemplateError(''); setReport(null); setResultGroup('valid'); setPreviewPage(1)
    setFormattedImportSource(null); setFormattedSourceLink(null); setLoading(false); setSaving(false)
    if (dupRunRef.current) dupRunRef.current.cancelled = true
    dupRunRef.current = null
    setDupScope('file'); setDupDaysText(''); setPickedIds(null); setPickerOpen(false)
    setExisting(null); setDupMeta(null); setDupProgress(null); setDupFailure(null); setConfirmOpen(false)
    setMemberUnavailable(false); setInGroupOn(true); setOtherOn(false); setOtherIds(null); setOtherNames([]); setGroupPickerOpen(false)
    setMembers(null); setMemberMeta(null); setMemberSkipped(false)
    insertInFlightRef.current = false
    return () => { sourceRevisionRef.current++; asyncOperationRef.current++; if (dupRunRef.current) dupRunRef.current.cancelled = true }
  }, [platform, actionId, dupConfigKey, dupStorageKey, memberConfigKey])
  // Công tắc `groupMatches` chung với Web, đọc mỗi lần mở cửa sổ (một dòng); đọc lỗi hoặc tắt thì cửa sổ nhập như trước.
  useEffect(() => {
    setMemberEnabled(null)
    if (!memberConfigKey) return
    let disposed = false
    void window.electronAPI.dataGroupMemberMatches({ kind: 'setting' }).then(result => {
      if (!disposed) setMemberEnabled(result.ok && result.data.enabled)
    }).catch(() => { if (!disposed) setMemberEnabled(false) })
    return () => { disposed = true }
  }, [memberConfigKey])
  // Công tắc chung với Web, đọc mỗi lần mở cửa sổ (một dòng); đọc lỗi thì ẩn khung như khi công tắc tắt.
  useEffect(() => {
    setDupSetting(null)
    if (!dupSupported) return
    let disposed = false
    void window.electronAPI.campaignInputDuplicates({ kind: 'setting' }).then(result => {
      if (disposed || !result.ok) return
      const memory = readDuplicateMemory(dupStorageKey)
      const maxDays = Math.max(1, Math.min(INPUT_DUPLICATES_MAX_DAYS, Math.floor(result.data.maxDays)))
      setDupSetting(result.data)
      setDupDays(memory.days && memory.days >= 1 && memory.days <= maxDays ? memory.days : Math.min(maxDays, result.data.defaultDays))
    }).catch(() => { /* Chỉ lọc trong file như trước. */ })
    return () => { disposed = true }
  }, [dupSupported, actionId, dupStorageKey])

  const invalidateFormattedPreview = (): void => {
    sourceRevisionRef.current++
    if (dupRunRef.current) dupRunRef.current.cancelled = true
    dupRunRef.current = null
    setReport(null); setPreviewPage(1); setResultGroup('valid'); setFormattedImportSource(null); setFormattedSourceLink(null)
    setExisting(null); setDupMeta(null); setDupProgress(null); setDupFailure(null); setConfirmOpen(false)
    setMembers(null); setMemberMeta(null); setMemberSkipped(false)
  }
  const acceptReport = (next: ImportVerificationResult, kind: ImportTab): void => {
    setReport(next); setPreviewPage(1); setResultGroup('valid'); setFormattedImportSource(kind)
    setFormattedSourceLink(kind === 'sheet' ? sheetLink.trim() : null)
  }
  const sourceName = (kind: ImportTab): string => kind === 'textbox' ? txtFileName || 'Nhập thủ công'
    : kind === 'sheet' ? sheetLink.trim() : kind === 'image' ? imageSourceName || 'Ảnh'
      : files[kind]?.name || (kind === 'excel' ? 'File Excel/CSV' : 'Template akaBiz')
  const selectedTable = (kind: TableTab): ImportTable | undefined => sources[kind]?.tables[configs[kind]?.index || 0]
  const verify = (rows: ImportSourceRow[], kind: ImportTab, policy = phonePolicy) => verifyImportRows(rows, { platform, actionId, kind, phonePolicy: policy })
  const verifyTemplate = (table: ImportTable, name: string, policy = phonePolicy, scope = dupScope): void => {
    try {
      const schema = templateImportSchema(table)
      if (!schema) throw new Error('File không đúng cấu trúc template akaBiz (Fullname, Uid, Mobile, Email, Info1…Info5). Hãy chuyển sang File Excel/CSV của khách hàng để chọn cột.')
      const next = verify(mapImportTable(table, schema.mapping, schema.headerIndex + 1, name), 'akabizTemplate', policy)
      // Đối chiếu chiến dịch khác cần gọi máy chủ: chờ người dùng bấm "Kiểm tra dữ liệu" như các nguồn khác.
      if (!dupEnabled || scope === 'file') acceptReport(next, 'akabizTemplate')
      setTemplateStatus('success'); setTemplateError('')
    } catch (error) {
      setTemplateStatus('error'); setTemplateError(error instanceof Error ? error.message : 'Không thể kiểm tra template.')
    }
  }
  const configureTable = (kind: TableTab, source: ImportTableSource, index: number, name: string): void => {
    const table = source.tables[index]
    if (!table) throw new Error('Nguồn nhập không có sheet dữ liệu.')
    const detected = detectImportColumns(table, platform, actionId)
    setConfigs(current => ({ ...current, [kind]: { index, mapping: detected.mapping, skipHeader: detected.hasHeader } }))
    if (kind === 'akabizTemplate') verifyTemplate(table, name)
  }

  const duplicateAccountIds = (scope: InputDuplicateScope): number[] => scope === 'current'
    ? duplicateCheck?.currentAccounts.map(account => account.id) ?? []
    : scope === 'picked' ? pickedIds ?? [] : []
  /**
   * Hoàn tất một lượt kiểm tra. Bước 1 (Nhóm data, V519/V522): bỏ dòng đã có trong nhóm này / ở nhóm khác. Bước 2
   * (lựa chọn 2/3 của "Với chiến dịch", V491/V493): bỏ số đã có ở chiến dịch khác. Mỗi bước gửi tuần tự lượt 1.000, hủy được.
   */
  const finishReport = async (next: ImportVerificationResult, kind: ImportTab, revision: number, operation: number,
    options: { scope?: InputDuplicateScope; skipMembers?: boolean } = {}): Promise<CheckedImport | null> => {
    const scope = options.scope ?? dupScope
    const wantMembers = memberWanted && !options.skipMembers && Boolean(memberCheck)
    const wantCampaign = dupEnabled && Boolean(duplicateCheck) && scope !== 'file'
    if (!wantMembers && !wantCampaign) {
      acceptReport(next, kind)
      return { report: next, existing: null, dupMeta: null, members: null, memberMeta: null }
    }
    const accountIds = wantCampaign ? duplicateAccountIds(scope) : []
    if (wantCampaign && !accountIds.length) throw new Error(scope === 'picked' ? 'Vui lòng chọn ít nhất 1 tài khoản Zalo để đối chiếu.' : 'Chưa có tài khoản đang chọn để đối chiếu.')
    const run = { cancelled: false }
    if (dupRunRef.current) dupRunRef.current.cancelled = true
    dupRunRef.current = run
    const stale = () => run.cancelled || revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current
    setDupFailure(null)
    let current = next
    let memberEntries: MemberEntries | null = null, memberInfo: MemberMeta | null = null
    let found: ImportExistingEntry[] | null = null, campaignMeta: DuplicateMeta | null = null
    let stage: 'members' | 'campaign' = 'members'
    try {
      if (wantMembers && memberCheck) {
        const values = current.valid.map(entry => dataGroupMatchValue(entry, memberCheck.contactType))
        const other: DataGroupMatchOtherGroups = !otherOn ? 'none' : otherIds === null ? 'all' : otherIds
        const results: DataGroupMemberMatchesResult[] = []
        let done = 0, unavailable = false
        setDupProgress({ stage, done: 0, total: values.length })
        for (const chunk of chunkDataGroupMatchValues(values)) {
          const result = await window.electronAPI.dataGroupMemberMatches({ kind: 'check', groupId: memberCheck.groupId,
            request: { contactType: memberCheck.contactType, values: chunk, otherGroups: other } })
          if (stale()) return null
          if (!result.ok) {
            // DB chưa có hàm, token Desktop chưa được cấp quyền hoặc công tắc vừa tắt: thêm như trước V522, không báo lỗi.
            if (!dataGroupMemberMatchesUnavailable(result.code)) throw new Error(result.message)
            unavailable = true
            break
          }
          results.push(result.data)
          done += chunk.length
          setDupProgress({ stage, done, total: values.length })
        }
        if (unavailable) setMemberUnavailable(true)
        else {
          const merged = mergeDataGroupMemberMatches(results)
          const split = splitDataGroupMemberEntries(current, merged?.items ?? [], { inGroup: inGroupOn, otherGroups: otherOn })
          current = split.report
          memberEntries = { inGroup: split.inGroup, otherGroups: split.otherGroups }
          memberInfo = { checkedAt: merged?.checkedAt ?? new Date().toISOString(), inGroup: inGroupOn,
            other: !otherOn ? 'none' : otherIds === null ? 'all' : otherIds.length }
        }
      }
      if (wantCampaign && duplicateCheck) {
        stage = 'campaign'
        const chunks = chunkInputDuplicatePhones(current.valid.map(entry => entry.row.phone || entry.normalizedValue))
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const results: InputDuplicatesCheckResult[] = []
        let done = 0
        setDupProgress({ stage, done: 0, total })
        for (const chunk of chunks) {
          const result = await window.electronAPI.campaignInputDuplicates({ kind: 'check', request: {
            actionId, accountIds, days: dupDays, phones: chunk, excludeCampaignId: duplicateCheck.excludeCampaignId ?? null
          } })
          if (stale()) return null
          if (!result.ok) throw new Error(result.message)
          results.push(result.data)
          done += chunk.length
          setDupProgress({ stage, done, total })
        }
        const merged = mergeInputDuplicateResults(results)
        const split = splitExistingImportEntries(current, merged?.items ?? [])
        current = split.report
        found = split.existing
        campaignMeta = { scope: scope as Exclude<InputDuplicateScope, 'file'>, days: dupDays, accountIds,
          checkedAt: merged?.checkedAt ?? new Date().toISOString(), since: merged?.since ?? '' }
      }
    } catch (error) {
      if (stale()) return null
      setDupFailure({ stage, kind, report: next, message: error instanceof Error ? error.message
        : stage === 'members' ? 'Chưa đối chiếu được với data đã có trong nhóm.' : 'Chưa đối chiếu được với dữ liệu đã tải lên.' })
      return null
    } finally {
      if (dupRunRef.current === run) dupRunRef.current = null
      if (!stale()) setDupProgress(null)
    }
    acceptReport(current, kind)
    setMembers(memberEntries); setMemberMeta(memberInfo); setExisting(found); setDupMeta(campaignMeta)
    const firstFiltered: ResultGroupKey | null = memberEntries?.inGroup.length ? 'inGroup'
      : memberEntries?.otherGroups.length ? 'otherGroups' : found?.length ? 'existing' : null
    if (firstFiltered) setResultGroup(firstFiltered)
    return { report: current, existing: found, dupMeta: campaignMeta, members: memberEntries, memberMeta: memberInfo }
  }
  const cancelDuplicateCheck = (): void => {
    asyncOperationRef.current++
    if (dupRunRef.current) dupRunRef.current.cancelled = true
    dupRunRef.current = null
    setDupProgress(null); setLoading(false)
  }
  /** Chạy lại lượt đối chiếu cho một báo cáo đã có (thử lại, hoặc bỏ một bước sau khi bước đó hỏng). */
  const recheck = async (next: ImportVerificationResult, kind: ImportTab, options: Parameters<typeof finishReport>[4] = {}): Promise<void> => {
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current
    setLoading(true)
    try {
      const done = await finishReport(next, kind, revision, operation, options)
      if (done) showAlert(checkedMessage(done.report, done.existing, done.members), 'success')
    } catch (error) {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) showAlert(error instanceof Error ? error.message : 'Chưa đối chiếu được với dữ liệu đã tải lên.', 'error')
    } finally { if (operation === asyncOperationRef.current) setLoading(false) }
  }
  const retryDuplicateCheck = async (): Promise<void> => {
    if (!dupFailure || loading || saving) return
    await recheck(dupFailure.report, dupFailure.kind)
  }
  const filterInFileOnlyAfterFailure = async (): Promise<void> => {
    if (!dupFailure || loading || saving) return
    const { report: next, kind } = dupFailure
    setDupFailure(null); setDupScope('file')
    await recheck(next, kind, { scope: 'file' })
  }
  /** Lượt đối chiếu nhóm hỏng: thêm như trước V522 (data đã có trong nhóm có thể thành dòng mới), vẫn chạy bước chiến dịch nếu đã chọn. */
  const skipMemberCheckAfterFailure = async (): Promise<void> => {
    if (!dupFailure || loading || saving) return
    const { report: next, kind } = dupFailure
    setDupFailure(null); setMemberSkipped(true)
    await recheck(next, kind, { skipMembers: true })
  }
  const changeDupScope = (scope: InputDuplicateScope): void => {
    if (scope === dupScope) return
    invalidateFormattedPreview(); setDupScope(scope)
    if (scope === 'picked' && pickedIds === null) {
      // Lần đầu chọn hết; lần sau dùng lại lựa chọn đã nhớ (bỏ tài khoản không còn).
      const available = new Set(zaloAccounts.map(account => account.id))
      const remembered = (readDuplicateMemory(dupStorageKey).pickedIds ?? []).filter(id => available.has(id))
      setPickedIds(remembered.length ? remembered : zaloAccounts.map(account => account.id))
    }
    const table = selectedTable('akabizTemplate')
    if (activeTab === 'akabizTemplate' && table) verifyTemplate(table, sourceName('akabizTemplate'), phonePolicy, scope)
  }
  const changeDupDays = (days: number, text = ''): void => {
    invalidateFormattedPreview(); setDupDays(days); setDupDaysText(text)
    writeDuplicateMemory(dupStorageKey, { days })
  }
  const changeDupDaysText = (text: string): void => {
    const days = Number(text)
    if (text !== '' && Number.isInteger(days) && days >= 1 && days <= dupMaxDays) changeDupDays(days, text)
    else { invalidateFormattedPreview(); setDupDaysText(text) }
  }
  const savePickedAccounts = (ids: number[]): void => {
    invalidateFormattedPreview(); setPickedIds(ids); setPickerOpen(false)
    writeDuplicateMemory(dupStorageKey, { pickedIds: ids })
  }
  // Đổi lựa chọn đối chiếu nhóm: kết quả đang hiện không còn đúng, kiểm tra lại (file mẫu tự kiểm tra lại trong máy).
  const reverifyTemplate = (): void => {
    const table = selectedTable('akabizTemplate')
    if (activeTab === 'akabizTemplate' && table) verifyTemplate(table, sourceName('akabizTemplate'))
  }
  const changeInGroupOn = (checked: boolean): void => { invalidateFormattedPreview(); setInGroupOn(checked); reverifyTemplate() }
  const changeOtherOn = (checked: boolean): void => { invalidateFormattedPreview(); setOtherOn(checked); reverifyTemplate() }
  const saveOtherGroups = (ids: number[] | null, names: string[]): void => {
    invalidateFormattedPreview(); setOtherIds(ids); setOtherNames(names); setGroupPickerOpen(false); reverifyTemplate()
  }

  const updateText = (content: string): void => {
    invalidateFormattedPreview()
    setTextContent(content)
    setTextSkipHeader(hasImportTextHeader(content, platform, actionId))
    if (content.includes('\t')) {
      const source = importWorkbookTables(read(content, { type: 'string', raw: true, FS: '\t' }))
      setSources(current => ({ ...current, textbox: source }))
      configureTable('textbox', source, 0, txtFileName || 'Dữ liệu dán')
    } else {
      setSources(current => ({ ...current, textbox: undefined }))
      setConfigs(current => ({ ...current, textbox: undefined }))
    }
  }
  const readTextFile = async (file?: File | null): Promise<void> => {
    if (!file) return
    invalidateFormattedPreview()
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current
    setLoading(true); setTxtFileName(file.name); setTextContent(''); setSources(current => ({ ...current, textbox: undefined }))
    try {
      const content = await file.text()
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      updateText(content)
    } catch (error) {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) showAlert(error instanceof Error ? error.message : 'Không thể đọc file TXT.', 'error')
    } finally { if (operation === asyncOperationRef.current) setLoading(false) }
  }
  const readImageFile = (file?: File | null): void => {
    if (!file) return
    invalidateFormattedPreview()
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current
    setLoading(true); setImageDataUrl(''); setImageSourceName(file.name || 'Ảnh dán')
    const reader = new FileReader()
    reader.onload = () => {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) setImageDataUrl(String(reader.result || ''))
      if (operation === asyncOperationRef.current) setLoading(false)
    }
    reader.onerror = () => {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) showAlert('Không thể đọc ảnh.', 'error')
      if (operation === asyncOperationRef.current) setLoading(false)
    }
    reader.readAsDataURL(file)
  }
  const readExcelFile = async (kind: 'excel' | 'akabizTemplate', file?: File | null): Promise<void> => {
    if (!file) return
    invalidateFormattedPreview()
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current
    setLoading(true); setFiles(current => ({ ...current, [kind]: file })); setSources(current => ({ ...current, [kind]: undefined }))
    if (kind === 'akabizTemplate') { setTemplateStatus('reading'); setTemplateError('') }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Vui lòng chọn file Excel .xlsx, .xls hoặc .csv.')
      if (/\.xlsx$/i.test(file.name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('Không thể đọc file Excel. Vui lòng kiểm tra lại định dạng file.')
      // XLS can be OLE, legacy BIFF or SpreadsheetML/XML; let the workbook reader detect it.
      const source = importWorkbookTables(readImportWorkbook(bytes, file.name))
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      setSources(current => ({ ...current, [kind]: source })); configureTable(kind, source, 0, file.name)
    } catch (error) {
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      const message = error instanceof Error ? error.message : 'Không thể đọc file Excel.'
      if (kind === 'akabizTemplate') { setTemplateStatus('error'); setTemplateError(message) }
      showAlert(message, 'error')
    } finally { if (operation === asyncOperationRef.current) setLoading(false) }
  }
  const loadSheet = async (): Promise<void> => {
    if (!sheetLink.trim() || loading || saving) return
    invalidateFormattedPreview()
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current
    setLoading(true); setSources(current => ({ ...current, sheet: undefined }))
    try {
      const source = await window.electronAPI.loadCampaignDataFromSheet({ linkSheet: sheetLink.trim(), platform, actionId, responseMode: 'source' })
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      setSources(current => ({ ...current, sheet: source })); configureTable('sheet', source, 0, sheetLink.trim())
    } catch (error) {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) showAlert(error instanceof Error ? error.message : 'Không thể đọc link sheet.', 'error')
    } finally { if (operation === asyncOperationRef.current) setLoading(false) }
  }

  useEffect(() => {
    if (!initialSource) return
    if (initialSource.kind === 'text') {
      setActiveTab('textbox'); setTxtFileName(initialSource.name); updateText(initialSource.text)
    } else {
      const bytes = Uint8Array.from(atob(initialSource.dataBase64), char => char.charCodeAt(0))
      const file = new File([bytes], initialSource.name, { type: initialSource.mimeType })
      if (/\.txt$/i.test(file.name)) { setActiveTab('textbox'); void readTextFile(file) }
      else { setActiveTab('excel'); void readExcelFile('excel', file) }
    }
  }, [initialSource, platform, actionId])
  const rowsFromTable = (kind: TableTab): ImportSourceRow[] => {
    const table = selectedTable(kind), config = configs[kind]
    if (!table || !config) throw new Error(kind === 'sheet' ? 'Vui lòng đọc dữ liệu từ link sheet trước.' : 'Vui lòng tải file hoặc dán bảng dữ liệu.')
    const required = fields.find(field => field.required)
    if (required && config.mapping[required.key] === undefined) throw new Error(`Vui lòng chọn cột ${required.label}.`)
    return mapImportTable(table, config.mapping, config.skipHeader ? 1 : 0, sourceName(kind))
  }
  const handleFormatData = async (): Promise<void> => {
    if (loading || saving || memberSettingLoading || (activeTab === 'akabizTemplate' && !dedupActive && !memberWanted)) return
    invalidateFormattedPreview()
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current, kind = activeTab
    setLoading(true)
    try {
      await waitForNextBrowserPaint()
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      let rows: ImportSourceRow[]
      if (kind === 'textbox') rows = sources.textbox ? rowsFromTable('textbox') : textImportRows(textContent, platform, actionId, sourceName(kind), textSkipHeader)
      else if (kind === 'excel' || kind === 'sheet') rows = rowsFromTable(kind)
      else if (kind === 'akabizTemplate') {
        const table = selectedTable('akabizTemplate'), schema = table && templateImportSchema(table)
        if (!table || !schema) throw new Error('Vui lòng tải file đúng template Excel akaBiz.')
        rows = mapImportTable(table, schema.mapping, schema.headerIndex + 1, sourceName(kind))
      }
      else {
        if (!imageDataUrl) throw new Error('Vui lòng tải hoặc dán ảnh.')
        const qr = isZaloJoinGroupLinkAction(actionId) ? normalizeZaloGroupInviteLink(await decodeQrDataFromDataUrl(imageDataUrl).catch(() => '')) : ''
        if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
        if (!qr && readImageText) {
          const text = await readImageText(imageDataUrl, sourceName(kind))
          if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
          // Keep every OCR column editable; the user maps columns in the same
          // textbox/table UI as pasted data before verifying and inserting.
          setActiveTab('textbox'); setTxtFileName(`${sourceName(kind)} (OCR)`); updateText(text)
          showAlert('Đã đọc chữ trên máy. Hãy kiểm tra nội dung và chọn cột trước khi chèn.', 'success')
          return
        }
        rows = qr ? [{ data: { uid: qr }, location: { source: sourceName(kind), sheet: '', row: 1, item: 1 } }]
          : (await window.electronAPI.extractCampaignDataFromImage({ imageDataUrl, platform, actionId, responseMode: 'source' })).rows
        rows = rows.map(row => ({ ...row, location: { ...row.location, source: `${sourceName(kind)} (${readImageText ? 'OCR local/QR' : 'AI/QR'})` } }))
      }
      const next = verify(rows, kind)
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      const done = await finishReport(next, kind, revision, operation)
      if (!done) return
      showAlert(checkedMessage(done.report, done.existing, done.members), 'success')
    } catch (error) {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) showAlert(error instanceof Error ? error.message : 'Không thể kiểm tra dữ liệu.', 'error')
    } finally { if (operation === asyncOperationRef.current) setLoading(false) }
  }
  /** Tên danh sách tự đặt theo nguồn đã kiểm tra (khi nơi gọi không cho nhập tên). */
  const automaticDatasetName = (importSource: ImportTab, sourceLink: string | null): string => {
    if (importSource === 'textbox') return txtFileName.trim() || 'Nhập thủ công'
    if (importSource === 'image') return imageSourceName.trim() || 'Ảnh dán'
    if (importSource === 'sheet') {
      const link = sourceLink?.trim() || sheetLink.trim()
      if (!link) return 'Link sheet'
      try {
        const url = new URL(link)
        const googleSheetId = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/i)?.[1]
        return googleSheetId ? `Google Sheet · ${googleSheetId}` : `Link sheet · ${url.hostname}`
      } catch {
        return 'Link sheet'
      }
    }
    if (importSource === 'akabizTemplate') return files.akabizTemplate?.name.trim() || 'Template Excel akaBiz'
    if (importSource === 'excel') return (files.excel?.name || '').trim() || 'File Excel/CSV'
    return 'Dữ liệu tải lên'
  }
  const submissionDatasetName = (importSource: ImportTab, sourceLink: string | null): string =>
    (showDatasetName ? datasetName.trim() : automaticDatasetName(importSource, sourceLink)).slice(0, 255)
  const insertFormattedRows = async (
    rows: CampaignImportDataRow[],
    importSource: ImportTab,
    sourceLink: string | null,
    duplicates?: ImportDuplicateSummary,
    memberSummary?: ImportMemberSummary
  ): Promise<void> => {
    if (rows.length > MAX_IMPORT_ROW_COUNT) {
      showAlert(IMPORT_ROW_LIMIT_MESSAGE, 'error')
      return
    }
    const submittedSource = importSource === 'akabizTemplate' ? 'excel' : importSource
    const baseName = submissionDatasetName(importSource, sourceLink)
    if (!baseName) {
      showAlert('Vui lòng nhập tên nhóm dữ liệu.', 'error')
      return
    }
    // Nhóm data: có dòng bị lọc thì phần còn lại lưu thành danh sách mới (planDataGroupImport), để DB không gỡ data của
    // lần nhập trước khi làm mới danh sách cùng tên.
    const normalizedName = toGroup
      ? planDataGroupImport(submittedSource, baseName, { duplicates, members: memberSummary }).datasetName
      : baseName
    if (onSubmitRows) {
      setSaving(true)
      try {
        await waitForNextBrowserPaint()
        const normalizedRows = rows.map(row => ({
          ...row,
          note: '',
          status: 'chờ xử lý' as const
        }))
        await onSubmitRows({
          datasetName: normalizedName,
          importSource: submittedSource,
          sourceLink,
          rows: normalizedRows,
          ...(duplicates ? { duplicates } : {}),
          ...(memberSummary ? { members: memberSummary } : {})
        })
        onClose()
      } catch (err) {
        showAlert(err instanceof Error ? err.message : 'Không thể thêm data.', 'error')
      } finally {
        setSaving(false)
      }
      return
    }

    const normalizedAccountIds = Array.from(new Set(accountIds))
      .filter(accountId => Number.isSafeInteger(accountId) && accountId > 0)
    if (normalizedAccountIds.length === 0) {
      showAlert('Vui lòng chọn ít nhất một tài khoản trước khi lưu dữ liệu.', 'error')
      return
    }

    setSaving(true)
    try {
      const result = await window.electronAPI.saveUploadDataset({
        accountIds: normalizedAccountIds,
        name: normalizedName,
        platform,
        actionId,
        actionName: actionName?.trim() || undefined,
        importSource: importSource === 'akabizTemplate' ? 'excel' : importSource,
        sourceLink,
        rows
      })
      if (!result.success) {
        throw new Error('Không thể lưu nhóm dữ liệu.')
      }
      onInsert(result.rows.map(row => ({
        ...row,
        note: '',
        status: 'chờ xử lý'
      })), duplicates ? { duplicates } : undefined)
      showAlert(
        `Đã lưu ${result.count} data vào ${result.datasets.length} nhóm dữ liệu.`,
        'success'
      )
      onClose()
    } catch (err) {
      showAlert(err instanceof Error ? err.message : 'Không thể lưu nhóm dữ liệu.', 'error')
    } finally {
      setSaving(false)
    }
  }


  const handleInsert = async (confirmed = false): Promise<void> => {
    if (insertInFlightRef.current || loading || saving || memberSettingLoading || !report || !formattedImportSource || report.limitExceeded || !report.valid.length || dupFailure) return
    const source = formattedImportSource, sourceLink = formattedSourceLink
    let checked: CheckedImport = { report, existing, dupMeta, members, memberMeta }
    // Báo cáo đang hiện chưa được đối chiếu với nhóm (file mẫu tự kiểm tra trong máy): đối chiếu ngay lúc bấm.
    // Không có data nào bị bỏ thì thêm luôn; có thì dừng ở hộp xác nhận để người dùng xem trước.
    if (memberPending) {
      const checkRevision = sourceRevisionRef.current, checkOperation = ++asyncOperationRef.current
      let done: CheckedImport | null = null
      setLoading(true)
      try {
        done = await finishReport(report, source, checkRevision, checkOperation)
      } catch (error) {
        if (checkRevision === sourceRevisionRef.current && checkOperation === asyncOperationRef.current) showAlert(error instanceof Error ? error.message : 'Không thể kiểm tra dữ liệu.', 'error')
      } finally { if (checkOperation === asyncOperationRef.current) setLoading(false) }
      if (!done || checkRevision !== sourceRevisionRef.current || checkOperation !== asyncOperationRef.current) return
      if (!done.report.valid.length) { showAlert(checkedMessage(done.report, done.existing, done.members), 'info'); return }
      if (memberFilteredCount(done) > 0) { setConfirmOpen(true); return }
      checked = done
    }
    // Đã đối chiếu chiến dịch khác, hoặc có dòng bị bỏ vì đã có trong nhóm: khách xác nhận lần cuối trước khi chèn.
    if (((checked.existing && checked.dupMeta) || memberFilteredCount(checked) > 0) && !confirmed) { setConfirmOpen(true); return }
    setConfirmOpen(false)
    insertInFlightRef.current = true
    const duplicates = checked.existing && checked.dupMeta ? { ...checked.dupMeta, skipped: checked.existing.length } : undefined
    const memberSummary = checked.members && checked.memberMeta
      ? { checkedAt: checked.memberMeta.checkedAt, inGroup: checked.members.inGroup.length, otherGroups: checked.members.otherGroups.length }
      : undefined
    try { await insertFormattedRows(checked.report.valid.map(entry => entry.row), source, sourceLink, duplicates, memberSummary) }
    finally { insertInFlightRef.current = false }
  }
  const groupEntries = (group: ResultGroupKey): ImportVerificationEntry[] => group === 'existing' ? existing ?? []
    : group === 'inGroup' ? members?.inGroup ?? [] : group === 'otherGroups' ? members?.otherGroups ?? [] : report?.[group] ?? []
  const exportGroup = (group: ResultGroupKey): void => {
    if (!report || !groupEntries(group).length || loading || saving) return
    try {
      const book = group === 'existing' ? createImportMatrixWorkbook(importExistingExportMatrix(existing ?? []), 'Đã có ở chiến dịch khác')
        : group === 'inGroup' ? createImportMatrixWorkbook(dataGroupMemberExportMatrix(members?.inGroup ?? [], group), 'Đã có trong nhóm này')
          : group === 'otherGroups' ? createImportMatrixWorkbook(dataGroupMemberExportMatrix(members?.otherGroups ?? [], group), 'Đã có ở nhóm khác')
            : createImportExportWorkbook(report, group)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
      writeFile(book, `${RESULT_GROUPS.find(item => item.key === group)!.file}-${timestamp}.xlsx`)
    } catch (error) { showAlert(error instanceof Error ? error.message : 'Không thể xuất Excel.', 'error') }
  }
  const changeTab = (tab: ImportTab): void => {
    if (loading || saving || tab === activeTab) return
    invalidateFormattedPreview(); setActiveTab(tab)
    if (tab === 'akabizTemplate') {
      const table = selectedTable(tab)
      if (table) verifyTemplate(table, sourceName(tab))
    }
  }
  const changePhonePolicy = (policy: ImportPhonePolicy): void => {
    invalidateFormattedPreview(); setPhonePolicy(policy)
    const table = selectedTable('akabizTemplate')
    if (activeTab === 'akabizTemplate' && table) verifyTemplate(table, sourceName('akabizTemplate'), policy)
  }
  const renderSheetSelect = (kind: TableTab) => {
    const source = sources[kind]
    if (!source?.tables.length) return null
    return <label className="campaign-import-sheet-picker"><span>Sheet</span>
      <select className="stepper-input" aria-label="Sheet đang đọc" disabled={loading || saving} value={configs[kind]?.index || 0} onChange={event => {
        invalidateFormattedPreview(); configureTable(kind, source, Number(event.target.value), sourceName(kind))
      }}>{source.tables.map((table, index) => <option key={`${index}-${table.name}`} value={index}>{table.name}</option>)}</select>
      {source.tables.length > 1 && <span className="text-muted">{source.tables.length} sheet</span>}
    </label>
  }
  const renderTableMapping = (kind: 'excel' | 'sheet' | 'textbox') => {
    const table = selectedTable(kind), config = configs[kind]
    if (!table || !config) return null
    const width = table.rows.reduce((max, row) => Math.max(max, row.length), 0)
    const columns = Array.from({ length: width }, (_, index) => index)
    return <div className="campaign-import-table-options">
      <div className="campaign-import-table-controls">
        {kind !== 'textbox' && renderSheetSelect(kind)}
        <label className="campaign-import-skip-header"><input type="checkbox" checked={config.skipHeader} disabled={loading || saving} onChange={event => {
          invalidateFormattedPreview(); setConfigs(current => ({ ...current, [kind]: { ...config, skipHeader: event.target.checked } }))
        }} />Bỏ qua dòng đầu (dòng tiêu đề)</label>
      </div>
      <div className="campaign-import-column-grid">{fields.map(field => <label key={field.key} className="campaign-import-column-field">
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <select className="stepper-input" aria-label={`Cột ${field.label}`} value={config.mapping[field.key] ?? ''} disabled={loading || saving} onChange={event => {
          invalidateFormattedPreview(); setConfigs(current => ({ ...current, [kind]: { ...config, mapping: { ...config.mapping, [field.key]: event.target.value === '' ? undefined : Number(event.target.value) } } }))
        }}><option value="">— Bỏ qua —</option>{columns.map(index => <option value={index} key={index}>{columnLabel(index)}{config.skipHeader && table.rows[0]?.[index]?.text ? ` · ${table.rows[0][index].text}` : ''}</option>)}</select>
      </label>)}</div>
      <div className="campaign-import-excel-preview"><div className="campaign-import-label">Dữ liệu nguồn (5 dòng đầu)</div>
        <div className="campaign-import-preview-scroll"><table className="campaign-grid"><thead><tr><th>Dòng</th>{columns.map(index => <th key={index}>{columnLabel(index)}</th>)}</tr></thead>
          <tbody>{table.rows.slice(0, 5).map((row, index) => <tr key={index}><td>{table.rowNumbers[index]}</td>{columns.map(col => <td key={col}>{row[col]?.text || ''}</td>)}</tr>)}</tbody>
        </table></div>
      </div>
    </div>
  }
  const entries: ImportVerificationEntry[] = report ? groupEntries(resultGroup) : []
  const visibleResultGroups = RESULT_GROUPS.filter(group => group.key === 'existing' ? existing !== null
    : group.key === 'inGroup' ? Boolean(memberMeta?.inGroup) : group.key === 'otherGroups' ? Boolean(memberMeta && memberMeta.other !== 'none') : true)
  const showExistingDetails = Boolean(report) && resultGroup === 'existing'
  const showOtherGroupDetails = Boolean(report) && resultGroup === 'otherGroups'
  const pageCount = Math.max(1, Math.ceil(entries.length / IMPORT_PREVIEW_PAGE_SIZE))
  const page = Math.min(previewPage, pageCount), start = (page - 1) * IMPORT_PREVIEW_PAGE_SIZE
  const visible = entries.slice(start, start + IMPORT_PREVIEW_PAGE_SIZE)
  const normalizedRows = resultGroup === 'valid' || SERVER_RESULT_GROUPS.includes(resultGroup)
  const showSourceDetails = Boolean(report) && !normalizedRows
  const previewColumnCount = fields.length + 1 + (showExistingDetails ? 4 : showOtherGroupDetails ? 2 : showSourceDetails ? (resultGroup === 'duplicates' ? 4 : 3) : 0)
  const layoutClass = layout === 'data-group' ? ' is-data-group' : ''
  const templateFile = files.akabizTemplate
  const busy = loading || saving
  const closeDisabled = saving || loading && !readImageText && !dupProgress
  const dupWindowText = (meta: Pick<ImportDuplicateSummary, 'since' | 'days'>) => meta.since ? formatVietnamDate(meta.since) : inputDuplicateWindowStart(meta.days)
  const pickedNames = zaloAccounts.filter(account => pickedIds?.includes(account.id)).map(account => account.name)
  const pickedSummary = pickedNames.length > 3 ? `${pickedNames.slice(0, 3).join(', ')} và ${pickedNames.length - 3} tài khoản khác` : pickedNames.join(', ')
  const checkBlocked = memberSettingLoading || (dedupActive && (dupDaysInvalid || (dupScope === 'picked' && !pickedIds?.length)))
  const showCampaignDedup = dupEnabled && Boolean(duplicateCheck)
  const memberSkippedCount = memberFilteredCount({ members })
  const skippedTotal = report ? (existing?.length ?? 0) + memberSkippedCount + report.duplicates.length + report.rejected.length : 0
  // Nhóm loại UID hoặc link group: một dòng không phải là một "số".
  const unit = toGroup && memberCheck && memberCheck.contactType !== 'phone' ? 'dòng' : 'số'
  const otherGroupSummary = otherIds === null ? 'Tất cả nhóm data khác của bạn'
    : otherNames.length > 3 ? `${otherNames.slice(0, 3).join(', ')} và ${otherNames.length - 3} nhóm khác` : otherNames.join(', ')
  const memberScopeText = (meta: MemberMeta): string => [
    ...(meta.inGroup ? ['trong nhóm này'] : []),
    ...(meta.other === 'all' ? ['ở tất cả nhóm khác của bạn'] : meta.other === 'none' ? [] : [`ở ${meta.other.toLocaleString('vi-VN')} nhóm khác đã chọn`])
  ].join(' và ')
  // Nhóm data: có dòng bị lọc thì phần còn lại lưu thành danh sách mới (xem planDataGroupImport); hộp xác nhận báo trước tên.
  const groupImportPlan = toGroup && formattedImportSource && ((existing?.length && dupMeta) || memberSkippedCount > 0)
    ? planDataGroupImport(formattedImportSource === 'akabizTemplate' ? 'excel' : formattedImportSource,
      submissionDatasetName(formattedImportSource, formattedSourceLink), {
        ...(existing && dupMeta ? { duplicates: { checkedAt: dupMeta.checkedAt, skipped: existing.length } } : {}),
        ...(members && memberMeta ? { members: { checkedAt: memberMeta.checkedAt, inGroup: members.inGroup.length, otherGroups: members.otherGroups.length } } : {})
      })
    : null
  const validCount = report?.valid.length ?? 0
  const skippedHintParts = [
    ...(members?.inGroup.length ? [`${members.inGroup.length.toLocaleString('vi-VN')} đã có trong nhóm này`] : []),
    ...(members?.otherGroups.length ? [`${members.otherGroups.length.toLocaleString('vi-VN')} đã có ở nhóm khác`] : []),
    ...(existing ? [`${existing.length.toLocaleString('vi-VN')}${toGroup ? ' số' : ''} đã có ở chiến dịch khác`] : [])
  ]
  const insertVerb = toGroup ? 'thêm' : 'chèn'
  const submitHint = dupFailure ? (dupFailure.stage === 'members'
    ? 'Chưa đối chiếu được với data đã có trong nhóm. Thử lại hoặc chọn “Thêm không đối chiếu”.'
    : 'Chưa đối chiếu được với chiến dịch khác. Thử lại hoặc chọn “Chỉ lọc trong file”.')
    : !report ? `Kiểm tra dữ liệu để xem kết quả trước khi ${insertVerb}.`
      : report.limitExceeded ? `Dữ liệu vượt giới hạn. Vui lòng chia nhỏ trước khi ${insertVerb}.`
        : !validCount ? (memberSkippedCount ? 'Mọi dòng hợp lệ đều đã có sẵn, không có data mới. Bạn vẫn có thể tải danh sách.'
          : existing?.length ? 'Mọi số hợp lệ đều đã có ở chiến dịch khác. Bạn vẫn có thể tải danh sách.'
            : `Không có dữ liệu hợp lệ để ${insertVerb}. Bạn vẫn có thể tải kết quả bị loại.`)
          : skippedHintParts.length ? (toGroup
            ? `Sẽ thêm ${validCount.toLocaleString('vi-VN')} ${unit} mới vào nhóm · bỏ qua ${skippedHintParts.join(', ')}.`
            : `Sẽ chèn ${validCount.toLocaleString('vi-VN')} dữ liệu mới · bỏ qua ${skippedHintParts.join(', ')}.`)
            : memberPending ? `Bấm “${submitLabel}” để đối chiếu ${validCount.toLocaleString('vi-VN')} dữ liệu hợp lệ với data đã có trong nhóm rồi thêm.`
              : toGroup ? `Sẽ thêm ${validCount.toLocaleString('vi-VN')} dữ liệu hợp lệ vào nhóm.`
                : `Sẽ chèn ${validCount.toLocaleString('vi-VN')} dữ liệu hợp lệ.`
  const savingLabel = toGroup ? 'Đang thêm...' : 'Đang chèn...'

  return <>{createPortal(<div className={`modal-overlay campaign-import-modal-overlay${layoutClass}`} onMouseDown={event => {
    if (event.target === event.currentTarget && !closeDisabled) onClose()
  }}><div className={`modal campaign-import-modal${layoutClass}`} onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div className="modal-title">{title}</div><button className="btn-icon" onClick={onClose} title="Đóng" disabled={closeDisabled}><X size={18} /></button></div>
    <div className="modal-body campaign-import-body">
      {showDatasetName && <div className="stepper-form-group campaign-import-dataset-name"><label htmlFor="campaign-import-dataset-name">{datasetNameLabel}<span className="required">*</span></label>
        <input id="campaign-import-dataset-name" className="stepper-input" value={datasetName} onChange={event => setDatasetName(event.target.value)} maxLength={255} disabled={saving} required autoFocus />
      </div>}
      {contextSlot}
      <div className="campaign-import-tabs" role="tablist" aria-label="Nguồn nhập dữ liệu">{([
        ['textbox', 'Form txt'], ['image', 'Ảnh'], ['sheet', 'Link sheet'], ['akabizTemplate', 'Từ template Excel akaBiz'], ['excel', 'File Excel/CSV của khách hàng']
      ] as [ImportTab, string][]).map(([tab, label]) => <button type="button" id={`campaign-import-tab-${tab}`} role="tab" aria-selected={activeTab === tab} aria-controls="campaign-import-tab-panel"
        key={tab} className={`campaign-import-tab${activeTab === tab ? ' active' : ''}`} disabled={busy} onClick={() => changeTab(tab)}>{label}</button>)}</div>
      <div id="campaign-import-tab-panel" className="campaign-import-tab-panel" role="tabpanel" aria-labelledby={`campaign-import-tab-${activeTab}`}>
        {activeTab === 'textbox' && <>
          <label className="campaign-import-label" htmlFor="campaign-import-textbox">Form: Copy vào hoặc tải từ file txt</label>
          <textarea id="campaign-import-textbox" className="campaign-import-textarea" value={textContent} disabled={busy} autoFocus={!showDatasetName} onChange={event => { setTxtFileName(''); updateText(event.target.value) }} />
          <div className="campaign-import-hint">{importTargetField(platform, actionId) === 'phone' ? 'Mỗi SĐT cách nhau bằng xuống dòng, dấu phẩy hoặc dấu chấm phẩy. Form txt lấy tất cả SĐT hợp lệ.' : 'Mỗi dữ liệu cách nhau bằng xuống dòng hoặc dấu phẩy.'} Dán nhiều cột từ Excel để chọn cột bên dưới.</div>
          <label className="btn btn-secondary campaign-import-file-button"><Upload size={14} /> Tải file txt<input type="file" accept=".txt" hidden disabled={busy} onChange={event => { void readTextFile(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
          {txtFileName && <div className="text-muted campaign-import-file-name">{txtFileName}</div>}
          {textContent.trim() && !sources.textbox && <label className="campaign-import-skip-header"><input type="checkbox" checked={textSkipHeader} disabled={busy} onChange={event => {
            invalidateFormattedPreview(); setTextSkipHeader(event.target.checked)
          }} />Bỏ qua dòng đầu (dòng tiêu đề)</label>}
          {renderTableMapping('textbox')}
        </>}
        {activeTab === 'image' && <>
          <label className="campaign-import-label">Ảnh: Tải lên hoặc dán vào</label>
          <div className="campaign-import-image-drop" tabIndex={0} onPaste={event => {
            if (busy) return
            const item = Array.from(event.clipboardData.items).find(item => item.type.startsWith('image/'))
            if (item) { event.preventDefault(); readImageFile(item.getAsFile()) }
          }}>{imageDataUrl ? <img src={imageDataUrl} alt="Ảnh nguồn nhập" /> : <div className="campaign-import-empty-media"><ImageIcon size={24} /><span>Dán ảnh ở đây (Ctrl+V)</span></div>}</div>
          <label className="btn btn-secondary campaign-import-file-button"><Upload size={14} /> Tải ảnh<input type="file" accept="image/*" hidden disabled={busy} onChange={event => { readImageFile(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
          <div className="campaign-import-hint">{readImageText ? 'Ảnh được đọc trên máy. Bạn có thể sửa chữ và chọn cột sau khi đọc.' : 'Kết quả kiểm tra chỉ bao gồm dữ liệu AI/QR đọc được từ ảnh.'} Hãy đối chiếu lại với ảnh gốc.</div>
        </>}
        {activeTab === 'sheet' && <>
          <label className="campaign-import-label" htmlFor="campaign-import-sheet-link">Link sheet</label>
          <input id="campaign-import-sheet-link" className="stepper-input" placeholder="Nhập link sheet" value={sheetLink} disabled={busy} onChange={event => {
            invalidateFormattedPreview(); setSheetLink(event.target.value); setSources(current => ({ ...current, sheet: undefined })); setConfigs(current => ({ ...current, sheet: undefined }))
          }} />
          <button className="btn btn-secondary campaign-import-file-button" disabled={busy || !sheetLink.trim()} onClick={() => void loadSheet()}><RefreshCw size={14} className={loading ? 'spin' : ''} />Đọc dữ liệu</button>
          {renderTableMapping('sheet')}
        </>}
        {activeTab === 'akabizTemplate' && <>
          <label className="campaign-import-label" htmlFor="campaign-import-akabiz-template-file">Tải file theo template Excel akaBiz</label>
          <div className={`campaign-import-template-file${templateFile ? ' has-file' : ''}`}>
            <input ref={templateFileInputRef} id="campaign-import-akabiz-template-file" className="campaign-import-template-file-input" type="file" accept=".xlsx,.xls,.csv" tabIndex={-1} disabled={busy} onChange={event => {
              void readExcelFile('akabizTemplate', event.currentTarget.files?.[0]); event.currentTarget.value = ''
            }} />
            <button type="button" className="campaign-import-template-file-picker" disabled={busy} onClick={() => templateFileInputRef.current?.click()} aria-label={templateFile ? `Chọn file khác thay cho ${templateFile.name}` : 'Chọn file Excel/CSV theo template akaBiz'}>
              <span className="campaign-import-template-file-icon"><Upload size={20} /></span><span className="campaign-import-template-file-copy"><span className="campaign-import-template-file-title">{templateFile?.name || 'Chọn file Excel/CSV'}</span><span className="campaign-import-template-file-meta">Hỗ trợ .xlsx, .xls và .csv</span></span>
            </button>
            {templateFile && <button className="campaign-import-template-file-remove" disabled={busy} title="Xóa file đã chọn" aria-label="Xóa file Excel template đã chọn" onClick={() => {
              invalidateFormattedPreview(); setFiles(current => ({ ...current, akabizTemplate: undefined })); setSources(current => ({ ...current, akabizTemplate: undefined })); setTemplateStatus('idle'); setTemplateError('')
            }}><X size={16} /></button>}
          </div>
          <div className="campaign-import-template-meta">
            {renderSheetSelect('akabizTemplate')}
            <span className="campaign-import-hint" title="Fullname, Uid, Mobile, Email, Info1…Info5">Tự kiểm tra theo mẫu</span>
            {templateStatus !== 'idle' && <div className={`campaign-import-template-status ${templateStatus}`} role={templateStatus === 'error' ? 'alert' : 'status'} aria-live="polite">
              {templateStatus === 'reading' ? <RefreshCw size={14} className="spin" /> : templateStatus === 'success' ? <CheckCircle2 size={15} /> : <X size={15} />}
              <span>{templateStatus === 'reading' ? 'Đang đọc dữ liệu...' : templateStatus === 'success' ? 'Đã kiểm tra' : templateError}</span>
            </div>}
          </div>
          {templateStatus === 'error' && sources.akabizTemplate && <button className="btn btn-secondary" disabled={busy} onClick={() => {
            const source = sources.akabizTemplate!
            invalidateFormattedPreview(); setActiveTab('excel'); setSources(current => ({ ...current, excel: source })); setFiles(current => ({ ...current, excel: templateFile }))
            configureTable('excel', source, configs.akabizTemplate?.index || 0, templateFile?.name || 'File Excel/CSV')
          }}>Chuyển sang File Excel/CSV của khách hàng</button>}
        </>}
        {activeTab === 'excel' && <>
          <label className="btn btn-secondary campaign-import-file-button"><FileSpreadsheet size={14} /> Tải file Excel/CSV<input type="file" accept=".xlsx,.xls,.csv" hidden disabled={busy} onChange={event => {
            void readExcelFile('excel', event.target.files?.[0]); event.currentTarget.value = ''
          }} /></label>
          {files.excel && <div className="text-muted campaign-import-file-name">{files.excel.name}</div>}
          {renderTableMapping('excel')}
        </>}
      </div>
      {['excel', 'akabizTemplate', 'sheet'].includes(activeTab) && importTargetField(platform, actionId) === 'phone' && <fieldset className="campaign-import-phone-policy" disabled={busy}>
        <legend>Nếu một ô chứa nhiều SĐT cách nhau bằng dấu phẩy hoặc dấu chấm phẩy</legend>
        <div className="campaign-import-phone-policy-options">{([
          ['first', 'Lấy SĐT hợp lệ đầu tiên'],
          ['discard', 'Bỏ dòng có nhiều SĐT'],
          ['all', 'Lấy tất cả SĐT hợp lệ (sao chép các cột thông tin khác)']
        ] as [ImportPhonePolicy, string][]).map(([value, label]) => <label key={value}>
          <input type="radio" name="campaign-import-phone-policy" aria-label={label} value={value} checked={phonePolicy === value} onChange={() => changePhonePolicy(value)} /><span>{label}</span>
        </label>)}</div>
      </fieldset>}
      {(showCampaignDedup || (memberUi && memberCheck)) && <fieldset className="campaign-import-dedup" disabled={busy}>
        <legend>Lọc trùng dữ liệu</legend>
        {memberUi && memberCheck && <div className="campaign-import-dedup-options" role="group" aria-label="Đối chiếu với nhóm data">
          {showCampaignDedup && <span className="campaign-import-dedup-section">Với nhóm data</span>}
          <div className={`campaign-import-dedup-option${inGroupOn ? ' active' : ''}`}>
            <label><input type="checkbox" checked={inGroupOn} onChange={event => changeInGroupOn(event.target.checked)} />
              <span className="campaign-import-dedup-option-text">
                <span className="campaign-import-dedup-option-title">Bỏ data đã có trong nhóm này<span className="campaign-import-dedup-badge">Mặc định</span></span>
                <span className="campaign-import-dedup-option-desc">Data đã có trong nhóm “{destination?.name}” không được thêm lần nữa. Bỏ chọn khi bạn nhập lại cùng một file để cập nhật thông tin của data đã có.</span>
              </span></label>
          </div>
          <div className={`campaign-import-dedup-option${otherOn ? ' active' : ''}`}>
            <label><input type="checkbox" checked={otherOn} onChange={event => changeOtherOn(event.target.checked)} />
              <span className="campaign-import-dedup-option-text">
                <span className="campaign-import-dedup-option-title">Bỏ data đã có ở nhóm data khác</span>
                <span className="campaign-import-dedup-option-desc">Dùng khi mỗi data chỉ nên nằm trong một nhóm. Chỉ đối chiếu với nhóm data của chính bạn.</span>
              </span></label>
            {otherOn && <div className="campaign-import-dedup-extra">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setGroupPickerOpen(true)}><Users size={14} /> Chọn nhóm · {otherIds === null
                ? 'tất cả' : `${otherIds.length.toLocaleString('vi-VN')} nhóm`}</button>
              <span>{otherGroupSummary}</span>
            </div>}
          </div>
        </div>}
        {showCampaignDedup && memberUi && <span className="campaign-import-dedup-section">Với chiến dịch nhắn tin</span>}
        {showCampaignDedup && duplicateCheck && <div className="campaign-import-dedup-options">
          <div className={`campaign-import-dedup-option${dupScope === 'file' ? ' active' : ''}`}>
            <label><input type="radio" name="campaign-import-dedup-scope" checked={dupScope === 'file'} onChange={() => changeDupScope('file')} />
              <span className="campaign-import-dedup-option-text">
                <span className="campaign-import-dedup-option-title">Chỉ trong file này<span className="campaign-import-dedup-badge">Mặc định</span></span>
                <span className="campaign-import-dedup-option-desc">{toGroup
                  ? 'Bỏ số lặp lại trong lần tải này. Không đối chiếu với chiến dịch nào.'
                  : 'Bỏ số lặp lại trong lần tải này. Không đối chiếu với dữ liệu đã tải lên trước đó.'}</span>
              </span></label>
          </div>
          {/* Nhóm không gắn tài khoản Zalo thì không có "tài khoản đang chọn": chỉ còn lựa chọn 1 và 3. */}
          {hasCurrentAccounts && <div className={`campaign-import-dedup-option${dupScope === 'current' ? ' active' : ''}`}>
            <label><input type="radio" name="campaign-import-dedup-scope" checked={dupScope === 'current'} onChange={() => changeDupScope('current')} />
              <span className="campaign-import-dedup-option-text">
                <span className="campaign-import-dedup-option-title">{toGroup ? 'Với tài khoản gắn với nhóm' : 'Với tài khoản đang chọn'}</span>
                {/* Thêm data: chỉ một tài khoản, nên nói rõ và chỉ sang lựa chọn 3 cho danh sách đã chia nhiều tài khoản. */}
                <span className="campaign-import-dedup-option-desc">{toGroup
                  ? `Bỏ số đã có trong chiến dịch nhắn tin đến SĐT của tài khoản ${duplicateCheck.currentAccounts.map(account => account.name).join(', ')}.`
                  : duplicateCheck.excludeCampaignId
                    ? `Chỉ so với chiến dịch khác của tài khoản ${duplicateCheck.currentAccounts.map(account => account.name).join(', ')}. Nếu danh sách gốc đã chia cho nhiều tài khoản, hãy chọn “Với các tài khoản Zalo bạn chọn”.`
                    : 'Bỏ số đã có trong chiến dịch khác của tài khoản đang chọn cho chiến dịch này.'}</span>
              </span></label>
            {dupScope === 'current' && !toGroup && <div className="campaign-import-dedup-extra">{duplicateCheck.currentAccounts.map(account =>
              <span key={account.id} className="campaign-import-dedup-chip">{account.name}</span>)}</div>}
          </div>}
          <div className={`campaign-import-dedup-option${dupScope === 'picked' ? ' active' : ''}`}>
            <label><input type="radio" name="campaign-import-dedup-scope" checked={dupScope === 'picked'} onChange={() => changeDupScope('picked')} />
              <span className="campaign-import-dedup-option-text">
                <span className="campaign-import-dedup-option-title">Với các tài khoản Zalo bạn chọn</span>
                <span className="campaign-import-dedup-option-desc">{toGroup
                  ? 'Bỏ số đã có trong chiến dịch nhắn tin đến SĐT của các tài khoản bạn chọn. Chỉ gồm tài khoản Zalo của bạn trong tổ chức này.'
                  : 'Bỏ số đã có trong chiến dịch của các tài khoản bạn chọn. Chỉ gồm tài khoản Zalo của bạn trong tổ chức này.'}</span>
              </span></label>
            {dupScope === 'picked' && <div className="campaign-import-dedup-extra">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}><Users size={14} /> Chọn tài khoản · {(pickedIds?.length ?? 0).toLocaleString('vi-VN')}/{zaloAccounts.length.toLocaleString('vi-VN')}</button>
              {pickedSummary && <span>{pickedSummary}</span>}
            </div>}
          </div>
        </div>}
        {showCampaignDedup && duplicateCheck && dupScope !== 'file' && <div className="campaign-import-dedup-window">
          <div className="campaign-import-dedup-window-row" role="group" aria-label="Khoảng thời gian kiểm tra trùng">
            <span className="campaign-import-dedup-window-label">Khoảng thời gian</span>
            {dayPresets.map(days => <button key={days} type="button" className="campaign-import-dedup-preset" aria-pressed={dupDaysText === '' && dupDays === days}
              onClick={() => changeDupDays(days)}>{days} ngày</button>)}
            <label className="campaign-import-dedup-days">Khác
              <input className="stepper-input" type="number" inputMode="numeric" min={1} max={dupMaxDays} step={1} aria-label="Số ngày kiểm tra trùng"
                aria-invalid={dupDaysInvalid} value={dupDaysText !== '' ? dupDaysText : dayPresets.includes(dupDays) ? '' : String(dupDays)}
                onChange={event => changeDupDaysText(event.target.value)} />ngày</label>
          </div>
          {dupDaysInvalid
            ? <span className="campaign-import-dedup-field-error" role="alert">Số ngày phải từ 1 đến {dupMaxDays}.</span>
            : <span>Đối chiếu dữ liệu tải lên từ <strong>{inputDuplicateWindowStart(dupDays)}</strong> đến hôm nay.</span>}
          <span className="campaign-import-dedup-note">{toGroup
            ? 'Chỉ đối chiếu với chiến dịch “Zalo - Nhắn tin, kết bạn đến SĐT”.'
            : 'Chỉ đối chiếu chiến dịch cùng loại.'} Chiến dịch đã xóa chỉ tính các số đã chạy.{duplicateCheck.excludeCampaignId ? ' Không tính chính chiến dịch này.' : ''}</span>
        </div>}
        {/* Chưa có đối chiếu nhóm (công tắc tắt, DB chưa sẵn sàng): nói đúng điều hàm nạp của DB làm với data đã có trong nhóm. */}
        {toGroup && memberCheck && !memberUi && !memberSettingLoading && <span className="campaign-import-dedup-note">{destination?.skipsExistingMembers
          ? 'Data đã có trong nhóm luôn được bỏ qua khi thêm, không cần chọn.'
          : 'Nhóm không gắn tài khoản Zalo: số đã có trong nhóm từ lần nhập khác vẫn được thêm thành dòng mới.'}</span>}
        {memberUi && !showCampaignDedup && memberCheck?.contactType !== 'phone' && <span className="campaign-import-dedup-note">Loại data này chưa đối chiếu được với chiến dịch.</span>}
      </fieldset>}
      {!showCampaignDedup && !(memberUi && memberCheck) && !memberSettingLoading && destination?.duplicateNote && <div className="campaign-import-dedup-info" role="note">
        <Info size={16} aria-hidden="true" /><span><strong>Lọc trùng:</strong> {destination.duplicateNote}</span>
      </div>}
      {dupProgress && <div className="campaign-import-dedup-progress" role="status">
        <div className="campaign-import-dedup-progress-head">
          <span>{dupProgress.stage === 'members' ? 'Đang đối chiếu với data đã có trong nhóm' : 'Đang đối chiếu với dữ liệu đã tải lên'} <strong>{dupProgress.done.toLocaleString('vi-VN')}/{dupProgress.total.toLocaleString('vi-VN')}</strong> {dupProgress.stage === 'members' ? unit : 'số'}…</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={cancelDuplicateCheck}>Hủy kiểm tra</button>
        </div>
        <div className="campaign-import-dedup-progress-bar" role="progressbar" aria-label="Tiến độ đối chiếu" aria-valuemin={0} aria-valuemax={dupProgress.total} aria-valuenow={dupProgress.done}>
          <span style={{ width: `${dupProgress.total ? Math.round(100 * dupProgress.done / dupProgress.total) : 0}%` }} />
        </div>
      </div>}
      {dupFailure && !busy && (dupFailure.stage === 'members' ? <div className="campaign-import-dedup-error" role="alert">
        <strong>Chưa đối chiếu được với data đã có trong nhóm</strong>
        <span>{dupFailure.message} Chưa có data nào được thêm vào nhóm.</span>
        <div className="campaign-import-dedup-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void retryDuplicateCheck()}>Thử lại</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void skipMemberCheckAfterFailure()}>Thêm không đối chiếu</button>
        </div>
        <span className="campaign-import-dedup-note">Chọn “Thêm không đối chiếu” thì data đã có trong nhóm có thể được thêm thành dòng mới.</span>
      </div> : <div className="campaign-import-dedup-error" role="alert">
        <strong>Chưa đối chiếu được với dữ liệu đã tải lên</strong>
        <span>{dupFailure.message} {toGroup ? 'Chưa có data nào được thêm vào nhóm.' : 'Chưa có dữ liệu nào được chèn.'}</span>
        <div className="campaign-import-dedup-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void retryDuplicateCheck()}>Thử lại</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void filterInFileOnlyAfterFailure()}>Chỉ lọc trong file</button>
        </div>
        <span className="campaign-import-dedup-note">Chọn “Chỉ lọc trong file” thì các số có thể đã có ở chiến dịch khác vẫn được {toGroup ? 'thêm vào nhóm' : 'chèn'}.</span>
      </div>)}
      {(activeTab !== 'akabizTemplate' || dedupActive || memberWanted) && <div className="campaign-import-format-row"><button className="btn btn-secondary" onClick={() => void handleFormatData()} disabled={busy || checkBlocked}>
        <RefreshCw size={14} className={loading ? 'spin' : ''} />Kiểm tra dữ liệu
      </button></div>}
      {report && <section className="campaign-import-results" aria-label="Kết quả kiểm tra dữ liệu">
        <div className="campaign-import-preview-summary" role="status">Đã kiểm tra {report.sourceRowCount.toLocaleString('vi-VN')} dòng nguồn · {report.itemCount.toLocaleString('vi-VN')} mục sau tách. {memberMeta
          ? `Đã đối chiếu với data ${memberScopeText(memberMeta)} lúc ${formatVietnamTime(memberMeta.checkedAt)}. ` : ''}{existing && dupMeta
          ? `Đã đối chiếu với dữ liệu tải lên từ ${dupWindowText(dupMeta)} đến hôm nay của ${scopeLabel(dupMeta.scope, dupMeta.accountIds.length)} lúc ${formatVietnamTime(dupMeta.checkedAt)}.`
          : memberMeta ? '' : 'Trùng chỉ tính trong lần upload này.'}{memberPending ? ' Chưa đối chiếu với data đã có trong nhóm.' : ''}</div>
        <div className={`campaign-import-result-groups${visibleResultGroups.length > 4 ? ' has-many' : visibleResultGroups.length > 3 ? ' has-existing' : ''}`}>{visibleResultGroups.map(group => <div key={group.key} className={`campaign-import-result-group${SERVER_RESULT_GROUPS.includes(group.key) ? ' existing' : ''}${resultGroup === group.key ? ' active' : ''}`}>
          <button type="button" aria-label={`${group.label}: ${groupEntries(group.key).length}`} title={group.label} aria-pressed={resultGroup === group.key} onClick={() => { setResultGroup(group.key); setPreviewPage(1) }}><span>{group.shortLabel}</span><strong>{groupEntries(group.key).length.toLocaleString('vi-VN')}</strong></button>
          <button className="btn btn-secondary" disabled={busy || groupEntries(group.key).length === 0} onClick={() => exportGroup(group.key)} aria-label={`Tải Excel ${group.label}`} title={`Tải Excel ${group.label}`}><Download size={14} />Excel</button>
        </div>)}</div>
        <div className="campaign-import-hint">{toGroup
          ? 'Hợp lệ để nhập theo loại data; chưa xác minh SĐT có Zalo hoặc email tồn tại, và chưa phải số data đã lưu vào nhóm.'
          : 'Hợp lệ để nhập theo hành động; chưa xác minh SĐT có Zalo hoặc email tồn tại, và chưa phải số dữ liệu đã lưu.'}</div>
        {report.limitExceeded && <div className="campaign-import-template-status error" role="alert">{IMPORT_ROW_LIMIT_MESSAGE}</div>}
      </section>}
      <div className="campaign-import-preview-table"><table className="campaign-grid"><thead><tr><th>STT</th>{fields.map(field => <th key={field.key}>{field.label}</th>)}{showSourceDetails && <><th>Nguồn / dòng gốc</th><th>Giá trị chuẩn hóa</th><th>Lý do</th>{resultGroup === 'duplicates' && <th>Trùng với dòng</th>}</>}{showExistingDetails && <><th>Đã có ở chiến dịch</th><th>Tài khoản</th><th>Ngày tải lên</th><th>Trạng thái</th></>}{showOtherGroupDetails && <><th>Đã có ở nhóm</th><th>Ngày vào nhóm</th></>}</tr></thead>
        <tbody>{visible.length === 0 ? <tr><td colSpan={previewColumnCount} className="text-center text-muted">{report ? 'Không có dữ liệu trong nhóm này' : 'Chưa có dữ liệu đã kiểm tra'}</td></tr> : visible.map((entry, index) => <tr key={entry.id}>
          <td>{start + index + 1}</td>{fields.map(field => <td key={field.key}>{String((normalizedRows ? entry.row : entry.original)[field.key] ?? '')}</td>)}
          {showSourceDetails && <><td>{importLocationLabel(entry.location)}</td><td>{entry.normalizedValue}</td><td>{entry.reason}</td>{resultGroup === 'duplicates' && <td>{entry.duplicateOf ? importLocationLabel(entry.duplicateOf) : ''}</td>}</>}
          {showExistingDetails && (() => {
            const item = (entry as ImportExistingEntry).existing, latest = item.latest
            return <>
              <td>{latest.campaignDeleted ? `${latest.campaignName} (đã xóa)` : latest.campaignName}{item.campaignCount > 1 ? ` · +${item.campaignCount - 1} chiến dịch` : ''}</td>
              <td>{latest.accountName}</td>
              <td>{formatVietnamDate(latest.uploadedAt)}</td>
              <td><span className="campaign-import-status-pill">{inputDuplicateStatusLabel(latest)}</span></td>
            </>
          })()}
          {showOtherGroupDetails && (() => {
            const match = (entry as DataGroupImportMemberEntry).match
            return <>
              <td>{match.otherGroup?.name ?? ''}{match.otherGroupCount > 1 ? ` · +${match.otherGroupCount - 1} nhóm` : ''}</td>
              <td>{match.otherGroup?.addedAt ? formatVietnamDate(match.otherGroup.addedAt) : ''}</td>
            </>
          })()}
        </tr>)}</tbody>
      </table></div>
      {entries.length > IMPORT_PREVIEW_PAGE_SIZE && <div className="campaign-local-data-pager"><span>Hiển thị {start + 1}–{Math.min(start + IMPORT_PREVIEW_PAGE_SIZE, entries.length)} / {entries.length}. Tải Excel và {toGroup ? 'thêm vào nhóm' : 'chèn'} sử dụng toàn bộ kết quả.</span><div>
        <button className="btn-icon" title="Trang trước" disabled={page <= 1 || busy} onClick={() => setPreviewPage(page - 1)}><ChevronLeft size={14} /></button><span>Trang {page}/{pageCount}</span>
        <button className="btn-icon" title="Trang sau" disabled={page >= pageCount || busy} onClick={() => setPreviewPage(page + 1)}><ChevronRight size={14} /></button>
      </div></div>}
    </div>
    <div className="modal-footer"><span className="campaign-import-submit-hint">{submitHint}</span>
      <button className="btn btn-ghost" onClick={onClose} disabled={closeDisabled}>Hủy</button><button className="btn btn-primary" onClick={() => void handleInsert()} disabled={busy || memberSettingLoading || !report?.valid.length || report.limitExceeded || !formattedImportSource || Boolean(dupFailure)}>
        {saving ? <><RefreshCw size={14} className="spin" /> {savingLabel}</> : submitLabel}
      </button></div>
  </div></div>, document.body)}
  {confirmOpen && report && ((existing && dupMeta) || memberSkippedCount > 0) && createPortal(<div className="modal-overlay campaign-import-modal-overlay" style={{ zIndex: 5200 }} onMouseDown={event => {
    if (event.target === event.currentTarget && !saving) setConfirmOpen(false)
  }}><div className="modal campaign-import-confirm" role="alertdialog" aria-modal="true" aria-labelledby="campaign-import-confirm-title" aria-describedby="campaign-import-confirm-desc" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div className="modal-title" id="campaign-import-confirm-title">{toGroup ? 'Xác nhận thêm vào nhóm' : 'Xác nhận nhập dữ liệu'}</div>
      <button type="button" className="btn-icon" onClick={() => setConfirmOpen(false)} title="Đóng" aria-label="Đóng" disabled={saving}><X size={18} /></button></div>
    <div className="modal-body campaign-import-confirm-body">
      <div id="campaign-import-confirm-desc" className="campaign-import-confirm-total"><strong>{report.valid.length.toLocaleString('vi-VN')}</strong><span>{toGroup
        ? `${unit} mới sẽ được thêm vào nhóm “${destination?.name ?? ''}”.`
        : 'số mới sẽ được chèn vào danh sách.'}</span></div>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sẽ bỏ qua {skippedTotal.toLocaleString('vi-VN')} {unit}</div>
        <ul className="campaign-import-confirm-list">
          {members && members.inGroup.length > 0 && <li><strong>{members.inGroup.length.toLocaleString('vi-VN')} {unit} đã có trong nhóm này</strong></li>}
          {members && memberMeta && members.otherGroups.length > 0 && <li><strong>{members.otherGroups.length.toLocaleString('vi-VN')} {unit} đã có ở nhóm data khác</strong>
            <span>{memberMeta.other === 'all' ? 'Tất cả nhóm data khác của bạn' : `${memberMeta.other.toLocaleString('vi-VN')} nhóm đã chọn`}</span></li>}
          {existing && dupMeta && <li><strong>{existing.length.toLocaleString('vi-VN')} số đã có ở chiến dịch khác</strong><span>Trong {dupMeta.days} ngày ({dupWindowText(dupMeta)} – hôm nay) · {scopeLabel(dupMeta.scope, dupMeta.accountIds.length)}</span></li>}
          {report.duplicates.length > 0 && <li><strong>{report.duplicates.length.toLocaleString('vi-VN')} {unit} trùng trong file</strong></li>}
          {report.rejected.length > 0 && <li><strong>{report.rejected.length.toLocaleString('vi-VN')} dòng lỗi/bị loại</strong></li>}
        </ul>
      </div>
      {/* Nhóm data: phần còn lại sau khi lọc không còn là cả file nên lưu thành danh sách mới, không làm mới danh sách cùng tên. */}
      {groupImportPlan && <div className="campaign-import-confirm-keep" role="note">
        <Info size={18} aria-hidden="true" />
        <div>
          {groupImportPlan.filtered && <strong>Lưu thành danh sách mới</strong>}
          {groupImportPlan.filtered && <span className="campaign-import-confirm-keep-name">{groupImportPlan.datasetName}</span>}
          <span>Data đã có trong nhóm từ các lần nhập trước được giữ nguyên, không bị gỡ.</span>
        </div>
      </div>}
      {existing && existing.length > 0 && <button type="button" className="btn btn-secondary" style={{ justifySelf: 'start' }} disabled={saving} onClick={() => exportGroup('existing')}><Download size={14} /> Tải Excel số đã có ở chiến dịch khác</button>}
      <p className="text-muted" style={{ margin: 0 }}>{dupMeta
        ? `Kết quả đối chiếu lúc ${formatVietnamTime(dupMeta.checkedAt)}. Số được tải lên ở chiến dịch khác sau thời điểm này chưa được tính.`
        : memberMeta ? `Kết quả đối chiếu với nhóm data lúc ${formatVietnamTime(memberMeta.checkedAt)}.` : ''}{!toGroup || !memberCheck || memberMeta?.inGroup ? '' : destination?.skipsExistingMembers
        ? ' Số data đã có sẵn trong nhóm sẽ được báo sau khi thêm.'
        : ' Số đã có trong nhóm từ lần nhập khác vẫn được thêm thành dòng mới.'}</p>
    </div>
    <div className="modal-footer">
      <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>Quay lại</button>
      <button type="button" className="btn btn-primary" onClick={() => void handleInsert(true)} disabled={saving}>{saving ? <><RefreshCw size={14} className="spin" /> {savingLabel}</> : `${toGroup ? 'Thêm' : 'Nhập'} ${report.valid.length.toLocaleString('vi-VN')} ${unit}`}</button>
    </div>
  </div></div>, document.body)}
  {pickerOpen && <InputDuplicateAccountPicker accounts={zaloAccounts} selectedIds={pickedIds ?? []} onClose={() => setPickerOpen(false)} onSave={savePickedAccounts} />}
  {groupPickerOpen && memberCheck && <DataGroupMatchPicker load={memberCheck.loadOtherGroups} selectedIds={otherIds}
    onClose={() => setGroupPickerOpen(false)} onSave={saveOtherGroups} />}
  </>
}
