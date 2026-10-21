import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Image as ImageIcon, RefreshCw, Upload, X } from 'lucide-react'
import jsQR from 'jsqr'
import { read, writeFile } from 'xlsx'
import { CampaignImportDataRow, CampaignImportPlatform, CampaignInputData, ContactDatasetImportSource, getCampaignInputDataRequirement } from '../../../../shared/types'
import {
  IMPORT_LIMIT_MESSAGE, IMPORT_MAX_ROWS, detectImportColumns, hasImportTextHeader, importLocationLabel,
  importTargetField, mapImportTable, normalizeImportGroupLink, templateImportSchema, textImportRows, verifyImportRows,
  type ImportColumnMap, type ImportField, type ImportPhonePolicy, type ImportResultGroup, type ImportSourceKind,
  type ImportSourceRow, type ImportTable, type ImportTableSource, type ImportVerificationResult
} from '../../../../shared/campaignImportVerification'
import { createImportExportWorkbook, importWorkbookTables, readImportWorkbook } from '../../../../shared/campaignImportWorkbook'
import { useUiStore } from '../../stores/uiStore'
import { createDefaultDataGroupName } from '../../utils/dataGroupNames'

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
const RESULT_GROUPS: { key: ImportResultGroup; label: string; shortLabel: string; file: string }[] = [
  { key: 'valid', label: 'Dữ liệu hợp lệ có thể sử dụng', shortLabel: 'Hợp lệ', file: 'du-lieu-hop-le' },
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
}

interface CampaignDataUploadModalProps {
  platform: CampaignImportPlatform
  actionId: string
  actionName?: string
  accountIds: number[]
  onClose: () => void
  onInsert: (rows: Partial<CampaignInputData>[]) => void
  /** Optional external sink used by Data Group; skips legacy account-scoped dataset persistence. */
  onSubmitRows?: (submission: CampaignDataUploadSubmission) => void | Promise<void>
  contextSlot?: ReactNode
  title?: string
  datasetNameLabel?: string
  showDatasetName?: boolean
  layout?: 'default' | 'data-group'
  submitLabel?: string
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
  layout = 'default', submitLabel = 'Chèn xuống chi tiết'
}: CampaignDataUploadModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
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
  const [resultGroup, setResultGroup] = useState<ImportResultGroup>('valid')
  const [previewPage, setPreviewPage] = useState(1)
  const [formattedImportSource, setFormattedImportSource] = useState<ImportTab | null>(null)
  const [formattedSourceLink, setFormattedSourceLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const sourceRevisionRef = useRef(0)
  const asyncOperationRef = useRef(0)
  const insertInFlightRef = useRef(false)
  const templateFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    sourceRevisionRef.current++
    asyncOperationRef.current++
    setActiveTab('textbox'); setDatasetName(createDefaultDataGroupName()); setTextContent(''); setTextSkipHeader(false); setTxtFileName('')
    setImageDataUrl(''); setImageSourceName(''); setSheetLink(''); setFiles({}); setSources({}); setConfigs({})
    setPhonePolicy('first'); setTemplateStatus('idle'); setTemplateError(''); setReport(null); setResultGroup('valid'); setPreviewPage(1)
    setFormattedImportSource(null); setFormattedSourceLink(null); setLoading(false); setSaving(false)
    insertInFlightRef.current = false
    return () => { sourceRevisionRef.current++; asyncOperationRef.current++ }
  }, [platform, actionId])

  const invalidateFormattedPreview = (): void => {
    sourceRevisionRef.current++
    setReport(null); setPreviewPage(1); setResultGroup('valid'); setFormattedImportSource(null); setFormattedSourceLink(null)
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
  const verifyTemplate = (table: ImportTable, name: string, policy = phonePolicy): void => {
    try {
      const schema = templateImportSchema(table)
      if (!schema) throw new Error('File không đúng cấu trúc template akaBiz (Fullname, Uid, Mobile, Email, Info1…Info5). Hãy chuyển sang File Excel/CSV của khách hàng để chọn cột.')
      acceptReport(verify(mapImportTable(table, schema.mapping, schema.headerIndex + 1, name), 'akabizTemplate', policy), 'akabizTemplate')
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
  const rowsFromTable = (kind: TableTab): ImportSourceRow[] => {
    const table = selectedTable(kind), config = configs[kind]
    if (!table || !config) throw new Error(kind === 'sheet' ? 'Vui lòng đọc dữ liệu từ link sheet trước.' : 'Vui lòng tải file hoặc dán bảng dữ liệu.')
    const required = fields.find(field => field.required)
    if (required && config.mapping[required.key] === undefined) throw new Error(`Vui lòng chọn cột ${required.label}.`)
    return mapImportTable(table, config.mapping, config.skipHeader ? 1 : 0, sourceName(kind))
  }
  const handleFormatData = async (): Promise<void> => {
    if (loading || saving || activeTab === 'akabizTemplate') return
    invalidateFormattedPreview()
    const revision = sourceRevisionRef.current, operation = ++asyncOperationRef.current, kind = activeTab
    setLoading(true)
    try {
      await waitForNextBrowserPaint()
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      let rows: ImportSourceRow[]
      if (kind === 'textbox') rows = sources.textbox ? rowsFromTable('textbox') : textImportRows(textContent, platform, actionId, sourceName(kind), textSkipHeader)
      else if (kind === 'excel' || kind === 'sheet') rows = rowsFromTable(kind)
      else {
        if (!imageDataUrl) throw new Error('Vui lòng tải hoặc dán ảnh.')
        const qr = isZaloJoinGroupLinkAction(actionId) ? normalizeZaloGroupInviteLink(await decodeQrDataFromDataUrl(imageDataUrl).catch(() => '')) : ''
        if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
        rows = qr ? [{ data: { uid: qr }, location: { source: sourceName(kind), sheet: '', row: 1, item: 1 } }]
          : (await window.electronAPI.extractCampaignDataFromImage({ imageDataUrl, platform, actionId, responseMode: 'source' })).rows
        rows = rows.map(row => ({ ...row, location: { ...row.location, source: `${sourceName(kind)} (AI/QR)` } }))
      }
      const next = verify(rows, kind)
      if (revision !== sourceRevisionRef.current || operation !== asyncOperationRef.current) return
      acceptReport(next, kind)
      showAlert(`Đã kiểm tra: ${next.valid.length} hợp lệ · ${next.rejected.length} lỗi/bị loại · ${next.duplicates.length} trùng.`, 'success')
    } catch (error) {
      if (revision === sourceRevisionRef.current && operation === asyncOperationRef.current) showAlert(error instanceof Error ? error.message : 'Không thể kiểm tra dữ liệu.', 'error')
    } finally { if (operation === asyncOperationRef.current) setLoading(false) }
  }
  const insertFormattedRows = async (
    rows: CampaignImportDataRow[],
    importSource: ImportTab,
    sourceLink: string | null
  ): Promise<void> => {
    if (rows.length > MAX_IMPORT_ROW_COUNT) {
      showAlert(IMPORT_ROW_LIMIT_MESSAGE, 'error')
      return
    }
    const automaticDatasetName = (() => {
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
      if (importSource === 'akabizTemplate') {
        return files.akabizTemplate?.name.trim() || 'Template Excel akaBiz'
      }
      if (importSource === 'excel') return (files.excel?.name || '').trim() || 'File Excel/CSV'
      return 'Dữ liệu tải lên'
    })()
    const normalizedName = (showDatasetName ? datasetName.trim() : automaticDatasetName).slice(0, 255)
    if (!normalizedName) {
      showAlert('Vui lòng nhập tên nhóm dữ liệu.', 'error')
      return
    }
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
          importSource: importSource === 'akabizTemplate' ? 'excel' : importSource,
          sourceLink,
          rows: normalizedRows
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
      })))
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


  const handleInsert = async (): Promise<void> => {
    if (insertInFlightRef.current || loading || saving || !report || !formattedImportSource || report.limitExceeded || !report.valid.length) return
    insertInFlightRef.current = true
    try { await insertFormattedRows(report.valid.map(entry => entry.row), formattedImportSource, formattedSourceLink) }
    finally { insertInFlightRef.current = false }
  }
  const exportGroup = (group: ImportResultGroup): void => {
    if (!report || !report[group].length || loading || saving) return
    try {
      const book = createImportExportWorkbook(report, group)
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
  const entries = report?.[resultGroup] || []
  const pageCount = Math.max(1, Math.ceil(entries.length / IMPORT_PREVIEW_PAGE_SIZE))
  const page = Math.min(previewPage, pageCount), start = (page - 1) * IMPORT_PREVIEW_PAGE_SIZE
  const visible = entries.slice(start, start + IMPORT_PREVIEW_PAGE_SIZE)
  const showSourceDetails = Boolean(report) && resultGroup !== 'valid'
  const previewColumnCount = fields.length + 1 + (showSourceDetails ? (resultGroup === 'duplicates' ? 4 : 3) : 0)
  const layoutClass = layout === 'data-group' ? ' is-data-group' : ''
  const templateFile = files.akabizTemplate
  const busy = loading || saving

  return createPortal(<div className={`modal-overlay campaign-import-modal-overlay${layoutClass}`} onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose()
  }}><div className={`modal campaign-import-modal${layoutClass}`} onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div className="modal-title">{title}</div><button className="btn-icon" onClick={onClose} title="Đóng" disabled={busy}><X size={18} /></button></div>
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
          <div className="campaign-import-hint">Kết quả kiểm tra chỉ bao gồm dữ liệu AI/QR đọc được từ ảnh. Hãy đối chiếu lại với ảnh gốc.</div>
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
      {activeTab !== 'akabizTemplate' && <div className="campaign-import-format-row"><button className="btn btn-secondary" onClick={() => void handleFormatData()} disabled={busy}>
        <RefreshCw size={14} className={loading ? 'spin' : ''} />Kiểm tra dữ liệu
      </button></div>}
      {report && <section className="campaign-import-results" aria-label="Kết quả kiểm tra dữ liệu">
        <div className="campaign-import-preview-summary" role="status">Đã kiểm tra {report.sourceRowCount.toLocaleString('vi-VN')} dòng nguồn · {report.itemCount.toLocaleString('vi-VN')} mục sau tách. Trùng chỉ tính trong lần upload này.</div>
        <div className="campaign-import-result-groups">{RESULT_GROUPS.map(group => <div key={group.key} className={`campaign-import-result-group${resultGroup === group.key ? ' active' : ''}`}>
          <button type="button" aria-label={`${group.label}: ${report[group.key].length}`} title={group.label} aria-pressed={resultGroup === group.key} onClick={() => { setResultGroup(group.key); setPreviewPage(1) }}><span>{group.shortLabel}</span><strong>{report[group.key].length.toLocaleString('vi-VN')}</strong></button>
          <button className="btn btn-secondary" disabled={busy || report[group.key].length === 0} onClick={() => exportGroup(group.key)} aria-label={`Tải Excel ${group.label}`} title={`Tải Excel ${group.label}`}><Download size={14} />Excel</button>
        </div>)}</div>
        <div className="campaign-import-hint">Hợp lệ để nhập theo hành động; chưa xác minh SĐT có Zalo hoặc email tồn tại, và chưa phải số dữ liệu đã lưu.</div>
        {report.limitExceeded && <div className="campaign-import-template-status error" role="alert">{IMPORT_ROW_LIMIT_MESSAGE}</div>}
      </section>}
      <div className="campaign-import-preview-table"><table className="campaign-grid"><thead><tr><th>STT</th>{fields.map(field => <th key={field.key}>{field.label}</th>)}{showSourceDetails && <><th>Nguồn / dòng gốc</th><th>Giá trị chuẩn hóa</th><th>Lý do</th>{resultGroup === 'duplicates' && <th>Trùng với dòng</th>}</>}</tr></thead>
        <tbody>{visible.length === 0 ? <tr><td colSpan={previewColumnCount} className="text-center text-muted">{report ? 'Không có dữ liệu trong nhóm này' : 'Chưa có dữ liệu đã kiểm tra'}</td></tr> : visible.map((entry, index) => <tr key={entry.id}>
          <td>{start + index + 1}</td>{fields.map(field => <td key={field.key}>{String((resultGroup === 'valid' ? entry.row : entry.original)[field.key] ?? '')}</td>)}
          {showSourceDetails && <><td>{importLocationLabel(entry.location)}</td><td>{entry.normalizedValue}</td><td>{entry.reason}</td>{resultGroup === 'duplicates' && <td>{entry.duplicateOf ? importLocationLabel(entry.duplicateOf) : ''}</td>}</>}
        </tr>)}</tbody>
      </table></div>
      {entries.length > IMPORT_PREVIEW_PAGE_SIZE && <div className="campaign-local-data-pager"><span>Hiển thị {start + 1}–{Math.min(start + IMPORT_PREVIEW_PAGE_SIZE, entries.length)} / {entries.length}. Tải Excel và chèn sử dụng toàn bộ kết quả.</span><div>
        <button className="btn-icon" title="Trang trước" disabled={page <= 1 || busy} onClick={() => setPreviewPage(page - 1)}><ChevronLeft size={14} /></button><span>Trang {page}/{pageCount}</span>
        <button className="btn-icon" title="Trang sau" disabled={page >= pageCount || busy} onClick={() => setPreviewPage(page + 1)}><ChevronRight size={14} /></button>
      </div></div>}
    </div>
    <div className="modal-footer"><span className="campaign-import-submit-hint">{!report ? 'Kiểm tra dữ liệu để xem kết quả trước khi chèn.' : report.limitExceeded ? 'Dữ liệu vượt giới hạn. Vui lòng chia nhỏ trước khi chèn.' : !report.valid.length ? 'Không có dữ liệu hợp lệ để chèn. Bạn vẫn có thể tải kết quả bị loại.' : `Sẽ chèn ${report.valid.length.toLocaleString('vi-VN')} dữ liệu hợp lệ.`}</span>
      <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Hủy</button><button className="btn btn-primary" onClick={() => void handleInsert()} disabled={busy || !report?.valid.length || report.limitExceeded || !formattedImportSource}>
        {saving ? <><RefreshCw size={14} className="spin" /> Đang chèn...</> : submitLabel}
      </button></div>
  </div></div>, document.body)
}
