import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileSpreadsheet, Image as ImageIcon, RefreshCw, Upload, X } from 'lucide-react'
import jsQR from 'jsqr'
import { read, utils } from 'xlsx'
import {
  CampaignImportDataRow,
  CampaignImportPlatform,
  CampaignInputData,
  isValidEmailInputDataValue
} from '../../../../shared/types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone } from '../../../../shared/phone'
import { useUiStore } from '../../stores/uiStore'

type ImportTab = 'textbox' | 'image' | 'sheet' | 'akabizTemplate' | 'excel'
type TemplateReadStatus = 'idle' | 'reading' | 'success' | 'error'
type ImportField = keyof Pick<CampaignImportDataRow, 'name' | 'phone' | 'uid' | 'email' | 'info1' | 'info2' | 'info3' | 'info4' | 'info5'>
type ColumnMap = Partial<Record<ImportField, string>>

interface ColumnOption {
  value: string
  label: string
}

interface FieldDef {
  key: ImportField
  label: string
  required?: boolean
}

interface CampaignDataUploadModalProps {
  platform: CampaignImportPlatform
  actionId: string
  actionName?: string
  accountIds: number[]
  onClose: () => void
  onInsert: (rows: Partial<CampaignInputData>[]) => void
}

const INFO_FIELDS: FieldDef[] = [
  { key: 'info1', label: 'Info 1' },
  { key: 'info2', label: 'Info 2' },
  { key: 'info3', label: 'Info 3' },
  { key: 'info4', label: 'Info 4' },
  { key: 'info5', label: 'Info 5' }
]
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_ADD_GROUP_MEMBER_ACTION_ID = 'zalo_add_group_member'
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'
const FACEBOOK_FIND_DATA_SEARCH_ACTION_ID = 'facebook_find_data_search'
const FACEBOOK_COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const isZaloJoinGroupLinkAction = (actionId?: string | null): boolean => actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID
const isZaloAddGroupMemberAction = (actionId?: string | null): boolean => actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID
const isFacebookJoinGroupAction = (actionId?: string | null): boolean => actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
const isFacebookFindDataSearchAction = (actionId?: string | null): boolean => actionId === FACEBOOK_FIND_DATA_SEARCH_ACTION_ID
const isFacebookCommentSeedingPostAction = (actionId?: string | null): boolean => actionId === FACEBOOK_COMMENT_SEEDING_POST_ACTION_ID

const getCellText = (value: unknown): string => {
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

const normalizeUid = (value: unknown): string => {
  const text = getCellText(value).replace(/\s+/g, '').replace(/\/+$/g, '')
  const lower = text.toLowerCase()
  if (!text || ['uid', 'url', 'link', 'group', 'profile', 'facebook', 'facebookuid'].includes(lower)) return ''
  return text
}

const normalizeFindDataSearchKeyword = (value: unknown): string => {
  const text = getCellText(value).replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()
  if (!text || ['keyword', 'keywords', 'tu khoa', 'từ khóa', 'search', 'tìm kiếm'].includes(lower)) return ''
  return text
}

const normalizeZaloGroupInviteLink = (value: unknown): string => {
  const raw = getCellText(value)
  if (!raw) return ''
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withProtocol)
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    let groupCode = ''
    if (hostname === 'zalo.me' || hostname.endsWith('.zalo.me')) {
      if (parts[0]?.toLowerCase() !== 'g') return ''
      groupCode = parts[1] || ''
    } else if (hostname === 'zaloapp.com' || hostname.endsWith('.zaloapp.com')) {
      if (parts[0]?.toLowerCase() !== 'qr' || parts[1]?.toLowerCase() !== 'g') return ''
      groupCode = parts[2] || ''
    } else {
      return ''
    }
    return groupCode ? `https://zalo.me/g/${groupCode}` : ''
  } catch {
    return ''
  }
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

const numberToColumnLetter = (value: number): string => String.fromCharCode(64 + value)

const columnLetterToIndex = (value: string): number | null => {
  const text = value.trim().toUpperCase()
  if (!/^[A-Z]$/.test(text)) return null
  return text.charCodeAt(0) - 65
}

const splitTextItems = (value: string): string[] =>
  value.replace(/\r\n/g, '\n').split(/[,\n]+/).map(item => item.trim()).filter(Boolean)

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    const text = getCellText(value)
    if (text) return text
  }
  return ''
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
  if (platform === 'zalo' || platform === 'sms') {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'phone', label: platform === 'sms' ? 'Số điện thoại SMS' : 'Số điện thoại', required: true },
      ...INFO_FIELDS
    ]
  }
  if (platform === 'facebook') {
    return [
      { key: 'name', label: 'Tên' },
      { key: 'uid', label: 'Uid', required: true },
      ...INFO_FIELDS
    ]
  }
  return [
    { key: 'name', label: 'Tên' },
    { key: 'email', label: 'Email', required: true },
    ...INFO_FIELDS
  ]
}

const createEmptyColumnMap = (): ColumnMap => ({})

const isLikelyHeaderValue = (value: string): boolean => {
  const lower = value.trim().toLowerCase()
  return [
    'ten',
    'tên',
    'ho ten',
    'họ tên',
    'fullname',
    'full name',
    'name',
    'uid',
    'url',
    'link',
    'group',
    'group url',
    'group uid',
    'group id',
    'facebook',
    'facebook group',
    'facebook group link',
    'keyword',
    'keywords',
    'tu khoa',
    'từ khóa',
    'search',
    'tìm kiếm',
    'phone',
    'mobile',
    'sdt',
    'sđt',
    'so dien thoai',
    'số điện thoại',
    'email',
    'e-mail',
    'info',
    'info1',
    'info 1',
    'info2',
    'info 2',
    'info3',
    'info 3',
    'info4',
    'info 4',
    'info5',
    'info 5'
  ].includes(lower)
}

const rowValueByColumn = (row: unknown[], column?: string): unknown => {
  if (!column) return ''
  const index = columnLetterToIndex(column)
  if (index === null) return ''
  return row[index] ?? ''
}

const normalizeRows = (rows: CampaignImportDataRow[], platform: CampaignImportPlatform, actionId: string): CampaignImportDataRow[] => {
  const seen = new Set<string>()
  const output: CampaignImportDataRow[] = []

  for (const row of rows) {
    if (isZaloJoinGroupLinkAction(actionId)) {
      const link = normalizeZaloGroupInviteLink(row.uid)
      if (!link || seen.has(link)) continue
      const rawName = getCellText(row.name)
      seen.add(link)
      output.push({
        ...row,
        name: normalizeZaloGroupInviteLink(rawName) === link ? '' : rawName,
        phone: '',
        uid: link,
        email: ''
      })
      continue
    }
    if (isFacebookJoinGroupAction(actionId)) {
      const uid = normalizeUid(firstText(row.uid, row.name))
      if (!uid || seen.has(uid)) continue
      const rawName = getCellText(row.name)
      seen.add(uid)
      output.push({
        ...row,
        name: normalizeUid(rawName) === uid ? '' : rawName,
        phone: '',
        uid,
        email: ''
      })
      continue
    }
    if (isFacebookFindDataSearchAction(actionId)) {
      const keyword = normalizeFindDataSearchKeyword(firstText(row.uid, row.name))
      const key = keyword.toLowerCase()
      if (!keyword || seen.has(key)) continue
      seen.add(key)
      output.push({
        ...row,
        name: '',
        phone: '',
        uid: keyword,
        email: ''
      })
      continue
    }
    if (isZaloAddGroupMemberAction(actionId)) {
      const phone = normalizeVietnamMobilePhone(row.phone)
      if (!phone || seen.has(phone)) continue
      seen.add(phone)
      output.push({
        ...row,
        name: getCellText(row.name),
        phone,
        phoneCarrier: getVietnamMobileCarrier(phone) || null,
        uid: '',
        email: ''
      })
      continue
    }

    const item: CampaignImportDataRow = {
      name: getCellText(row.name),
      info1: getCellText(row.info1),
      info2: getCellText(row.info2),
      info3: getCellText(row.info3),
      info4: getCellText(row.info4),
      info5: getCellText(row.info5)
    }
    let key = ''
    if (platform === 'zalo' || platform === 'sms') {
      item.phone = normalizeVietnamMobilePhone(row.phone)
      item.phoneCarrier = getVietnamMobileCarrier(item.phone) || null
      key = item.phone
    } else if (platform === 'facebook') {
      item.uid = normalizeUid(row.uid)
      key = item.uid
    } else {
      item.email = getCellText(row.email).toLowerCase()
      key = isValidEmailInputDataValue(item.email) ? item.email : ''
    }
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

const normalizeTemplateHeader = (value: unknown): string => getCellText(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/\s+/g, '')

const isAkabizTemplateHeaderRow = (row: unknown[]): boolean => {
  const headers = row.slice(0, 4).map(normalizeTemplateHeader)
  return (
    ['ten', 'name', 'fullname', 'hoten'].includes(headers[0] || '') &&
    ['uid', 'url', 'link'].includes(headers[1] || '') &&
    ['sdt', 'phone', 'mobile', 'sodienthoai'].includes(headers[2] || '') &&
    ['email', 'emailaddress'].includes(headers[3] || '')
  )
}

const buildAkabizTemplateRows = (
  rows: unknown[][],
  platform: CampaignImportPlatform,
  actionId: string
): CampaignImportDataRow[] => {
  const seen = new Set<string>()
  const output: CampaignImportDataRow[] = []

  const pushUnique = (row: CampaignImportDataRow, key: string): void => {
    const normalizedKey = key.trim().toLowerCase()
    if (!normalizedKey || seen.has(normalizedKey)) return
    seen.add(normalizedKey)
    output.push(row)
  }

  for (const sourceRow of rows) {
    if (!Array.isArray(sourceRow)) continue
    const row = sourceRow.slice(0, 9)
    if (row.every(cell => !getCellText(cell)) || isAkabizTemplateHeaderRow(row)) continue

    const rawName = getCellText(row[0])
    const rawUid = getCellText(row[1])
    const rawPhone = getCellText(row[2])
    const rawEmail = getCellText(row[3])
    const baseRow: CampaignImportDataRow = {
      name: rawName,
      uid: normalizeUid(rawUid),
      phone: rawPhone,
      email: rawEmail,
      info1: getCellText(row[4]),
      info2: getCellText(row[5]),
      info3: getCellText(row[6]),
      info4: getCellText(row[7]),
      info5: getCellText(row[8])
    }

    if (isZaloJoinGroupLinkAction(actionId)) {
      const link = normalizeZaloGroupInviteLink(rawUid) || normalizeZaloGroupInviteLink(rawName)
      if (!link) continue
      pushUnique({
        ...baseRow,
        name: rawName,
        phone: '',
        uid: link,
        email: ''
      }, link)
      continue
    }

    if (isFacebookJoinGroupAction(actionId)) {
      const uid = normalizeUid(rawUid) || normalizeUid(rawName)
      if (!uid) continue
      pushUnique({
        ...baseRow,
        name: rawName,
        phone: '',
        uid,
        email: ''
      }, uid)
      continue
    }

    if (isFacebookFindDataSearchAction(actionId)) {
      const keyword = normalizeFindDataSearchKeyword(rawUid) || normalizeFindDataSearchKeyword(rawName)
      if (!keyword) continue
      pushUnique({
        ...baseRow,
        name: '',
        phone: '',
        uid: keyword,
        email: ''
      }, keyword)
      continue
    }

    if (isFacebookCommentSeedingPostAction(actionId)) {
      const uid = normalizeUid(rawUid) || normalizeUid(rawName)
      if (!uid) continue
      pushUnique({
        ...baseRow,
        name: '',
        phone: '',
        uid,
        email: ''
      }, uid)
      continue
    }

    if (isZaloAddGroupMemberAction(actionId)) {
      const phone = normalizeVietnamMobilePhone(rawPhone) ||
        normalizeVietnamMobilePhone(rawUid) ||
        normalizeVietnamMobilePhone(rawName)
      if (!phone) continue
      pushUnique({
        ...baseRow,
        name: normalizeVietnamMobilePhone(rawName) === phone ? '' : rawName,
        phone,
        phoneCarrier: getVietnamMobileCarrier(phone) || null,
        uid: '',
        email: ''
      }, phone)
      continue
    }

    if (platform === 'zalo' || platform === 'sms') {
      const phone = normalizeVietnamMobilePhone(rawPhone)
      if (!phone) continue
      pushUnique({
        ...baseRow,
        phone,
        phoneCarrier: getVietnamMobileCarrier(phone) || null
      }, phone)
      continue
    }

    if (platform === 'email') {
      const email = rawEmail.toLowerCase()
      if (!isValidEmailInputDataValue(email)) continue
      pushUnique({ ...baseRow, email }, email)
      continue
    }

    const uid = normalizeUid(rawUid)
    if (!uid) continue
    pushUnique({ ...baseRow, uid }, uid)
  }

  return output
}

const formatTemplateFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`
  const kilobytes = size / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1).replace(/\.0$/, '')} KB`
  const megabytes = kilobytes / 1024
  return `${megabytes.toFixed(1).replace(/\.0$/, '')} MB`
}

const getTemplateFileType = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.trim()
  return extension ? extension.toUpperCase() : 'FILE'
}

const hasAkabizTemplateFileSignature = (bytes: Uint8Array, fileName: string): boolean => {
  const extension = fileName.split('.').pop()?.trim().toLowerCase()
  if (extension === 'csv') return true
  if (extension === 'xlsx') return bytes[0] === 0x50 && bytes[1] === 0x4b
  if (extension === 'xls') {
    const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    return oleSignature.every((value, index) => bytes[index] === value)
  }
  return false
}

const detectColumnFromHeader = (rows: unknown[][], labels: string[]): string => {
  const header = rows[0] || []
  const normalizedLabels = labels.map(label => label.toLowerCase())
  const index = header.findIndex(cell => {
    const text = getCellText(cell).toLowerCase()
    return normalizedLabels.some(label => text.includes(label))
  })
  return index >= 0 && index < 26 ? numberToColumnLetter(index + 1) : ''
}

const detectPhoneColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const validCount = dataRows.reduce((count, row) => (
      normalizeVietnamMobilePhone(row[colIndex]) ? count + 1 : count
    ), 0)
    if (validCount > bestCount) {
      bestCount = validCount
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectEmailColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const validCount = dataRows.reduce((count, row) => (
      isValidEmailInputDataValue(getCellText(row[colIndex]).toLowerCase()) ? count + 1 : count
    ), 0)
    if (validCount > bestCount) {
      bestCount = validCount
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectNonWhitespaceColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const count = dataRows.reduce((total, row) => {
      const text = getCellText(row[colIndex])
      return text && !/\s/.test(text) ? total + 1 : total
    }, 0)
    if (count > bestCount) {
      bestCount = count
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectTextColumn = (rows: unknown[][]): string => {
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const dataRows = rows.slice(1, 11)
  let bestIndex = -1
  let bestCount = 0

  for (let colIndex = 0; colIndex < Math.min(maxCols, 26); colIndex += 1) {
    const count = dataRows.reduce((total, row) => (
      getCellText(row[colIndex]) ? total + 1 : total
    ), 0)
    if (count > bestCount) {
      bestCount = count
      bestIndex = colIndex
    }
  }

  return bestIndex >= 0 ? numberToColumnLetter(bestIndex + 1) : ''
}

const detectRequiredColumnMap = (rows: unknown[][], platform: CampaignImportPlatform, actionId: string): ColumnMap => {
  if (isZaloJoinGroupLinkAction(actionId)) {
    return {
      uid: detectColumnFromHeader(rows, ['link', 'url', 'group', 'zalo']) || detectNonWhitespaceColumn(rows)
    }
  }
  if (isFacebookJoinGroupAction(actionId)) {
    return {
      uid: detectColumnFromHeader(rows, ['uid', 'url', 'link', 'group', 'facebook']) || detectNonWhitespaceColumn(rows)
    }
  }
  if (isFacebookFindDataSearchAction(actionId)) {
    return {
      uid: detectColumnFromHeader(rows, ['keyword', 'keywords', 'từ khóa', 'tu khoa', 'search', 'tìm kiếm']) || detectTextColumn(rows)
    }
  }
  if (isZaloAddGroupMemberAction(actionId)) {
    return {
      phone: detectPhoneColumn(rows)
    }
  }
  if (platform === 'zalo' || platform === 'sms') {
    return { phone: detectPhoneColumn(rows) }
  }
  if (platform === 'facebook') {
    return {
      uid: detectColumnFromHeader(rows, ['uid', 'url', 'link', 'profile', 'facebook']) || detectNonWhitespaceColumn(rows)
    }
  }
  return { email: detectEmailColumn(rows) }
}

export default function CampaignDataUploadModal({
  platform,
  actionId,
  actionName,
  accountIds,
  onClose,
  onInsert
}: CampaignDataUploadModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const fields = useMemo(() => getFieldsForPlatform(platform, actionId), [platform, actionId])
  const [activeTab, setActiveTab] = useState<ImportTab>('textbox')
  const [datasetName, setDatasetName] = useState('')
  const [textContent, setTextContent] = useState('')
  const [txtFileName, setTxtFileName] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [sheetLink, setSheetLink] = useState('')
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templateRows, setTemplateRows] = useState<CampaignImportDataRow[]>([])
  const [templateStatus, setTemplateStatus] = useState<TemplateReadStatus>('idle')
  const [templateError, setTemplateError] = useState('')
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [excelFileName, setExcelFileName] = useState('')
  const [excelRows, setExcelRows] = useState<unknown[][]>([])
  const [columnMap, setColumnMap] = useState<ColumnMap>(() => createEmptyColumnMap())
  const [skipExcelHeader, setSkipExcelHeader] = useState(true)
  const [previewRows, setPreviewRows] = useState<CampaignImportDataRow[]>([])
  const [formattedImportSource, setFormattedImportSource] = useState<ImportTab | null>(null)
  const [formattedSourceLink, setFormattedSourceLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const sourceRevisionRef = useRef(0)
  const asyncOperationRef = useRef(0)
  const templateFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    sourceRevisionRef.current += 1
    asyncOperationRef.current += 1
    setActiveTab('textbox')
    setDatasetName('')
    setTextContent('')
    setTxtFileName('')
    setImageDataUrl('')
    setSheetLink('')
    setTemplateFile(null)
    setTemplateRows([])
    setTemplateStatus('idle')
    setTemplateError('')
    setExcelFile(null)
    setExcelFileName('')
    setExcelRows([])
    setColumnMap(createEmptyColumnMap())
    setSkipExcelHeader(true)
    setPreviewRows([])
    setFormattedImportSource(null)
    setFormattedSourceLink(null)
    setLoading(false)
    setSaving(false)
    if (templateFileInputRef.current) templateFileInputRef.current.value = ''
  }, [platform, actionId])

  const excelHeaders = useMemo(() => {
    const maxCols = excelRows.reduce((max, row) => Math.max(max, row.length), 0)
    return Array.from({ length: Math.min(maxCols, 26) }, (_, index) => numberToColumnLetter(index + 1))
  }, [excelRows])

  const excelColumnOptions = useMemo<ColumnOption[]>(() => {
    const headerRow = excelRows[0] || []
    return [
      { value: '', label: '— Bỏ qua —' },
      ...excelHeaders.map((letter, index) => ({
        value: letter,
        label: skipExcelHeader ? getCellText(headerRow[index]) || letter : letter
      }))
    ]
  }, [excelHeaders, excelRows, skipExcelHeader])

  const invalidateFormattedPreview = (): void => {
    sourceRevisionRef.current += 1
    setPreviewRows([])
    setFormattedImportSource(null)
    setFormattedSourceLink(null)
  }

  const readTextFile = (file?: File | null): void => {
    if (!file) return
    invalidateFormattedPreview()
    const sourceRevision = sourceRevisionRef.current
    const operation = ++asyncOperationRef.current
    setLoading(true)
    setTxtFileName(file.name)
    const reader = new FileReader()
    reader.onload = event => {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        invalidateFormattedPreview()
        setTextContent(String(event.target?.result || ''))
      }
      if (asyncOperationRef.current === operation) setLoading(false)
    }
    reader.onerror = () => {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        showAlert('Không thể đọc file TXT.', 'error')
      }
      if (asyncOperationRef.current === operation) setLoading(false)
    }
    reader.readAsText(file)
  }

  const readImageFile = (file?: File | null): void => {
    if (!file) return
    invalidateFormattedPreview()
    const sourceRevision = sourceRevisionRef.current
    const operation = ++asyncOperationRef.current
    setLoading(true)
    const reader = new FileReader()
    reader.onload = event => {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        invalidateFormattedPreview()
        setImageDataUrl(String(event.target?.result || ''))
      }
      if (asyncOperationRef.current === operation) setLoading(false)
    }
    reader.onerror = () => {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        showAlert('Không thể đọc ảnh.', 'error')
      }
      if (asyncOperationRef.current === operation) setLoading(false)
    }
    reader.readAsDataURL(file)
  }

  const handleImagePaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    if (loading || saving) return
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        readImageFile(item.getAsFile())
        event.preventDefault()
        return
      }
    }
  }

  const readExcelFile = async (file?: File | null): Promise<void> => {
    if (!file) return
    invalidateFormattedPreview()
    const sourceRevision = sourceRevisionRef.current
    const operation = ++asyncOperationRef.current
    setExcelFile(file)
    setExcelFileName(file.name)
    setLoading(true)
    try {
      const workbook = read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      invalidateFormattedPreview()
      setExcelRows(rows)
      setColumnMap(detectRequiredColumnMap(rows, platform, actionId))
    } catch (err) {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        showAlert(err instanceof Error ? err.message : 'Không thể đọc file Excel.', 'error')
      }
    } finally {
      if (asyncOperationRef.current === operation) setLoading(false)
    }
  }

  const readAkabizTemplateFile = async (file?: File | null): Promise<void> => {
    if (!file) return
    invalidateFormattedPreview()
    const sourceRevision = sourceRevisionRef.current
    const operation = ++asyncOperationRef.current
    setTemplateFile(file)
    setTemplateRows([])
    setTemplateStatus('reading')
    setTemplateError('')
    setLoading(true)

    const failRead = (message: string): void => {
      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      setTemplateRows([])
      setTemplateStatus('error')
      setTemplateError(message)
      setPreviewRows([])
      setFormattedImportSource(null)
      setFormattedSourceLink(null)
      showAlert(message, 'error')
    }

    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
        failRead('Vui lòng chọn file Excel .xlsx, .xls hoặc .csv.')
        return
      }

      const fileBytes = new Uint8Array(await file.arrayBuffer())
      if (!hasAkabizTemplateFileSignature(fileBytes, file.name)) {
        failRead('Có lỗi xảy ra khi đọc file Excel. Vui lòng kiểm tra lại định dạng file.')
        return
      }

      const workbook = read(fileBytes, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) {
        failRead('File Excel trống hoặc không đọc được sheet đầu tiên.')
        return
      }

      const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
      const normalized = buildAkabizTemplateRows(rows, platform, actionId)
      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      if (normalized.length === 0) {
        failRead('File Excel trống hoặc không có data hợp lệ.')
        return
      }

      setTemplateRows(normalized)
      setTemplateStatus('success')
      setTemplateError('')
      setPreviewRows(normalized)
      setFormattedImportSource('akabizTemplate')
      setFormattedSourceLink(null)
    } catch (err) {
      console.error('Lỗi khi đọc file Excel template akaBiz:', err)
      failRead('Có lỗi xảy ra khi đọc file Excel. Vui lòng kiểm tra lại định dạng file.')
    } finally {
      if (asyncOperationRef.current === operation) setLoading(false)
    }
  }

  const clearAkabizTemplateFile = (): void => {
    if (loading || saving) return
    invalidateFormattedPreview()
    asyncOperationRef.current += 1
    setTemplateFile(null)
    setTemplateRows([])
    setTemplateStatus('idle')
    setTemplateError('')
    if (templateFileInputRef.current) templateFileInputRef.current.value = ''
  }

  const buildRowsFromText = (): CampaignImportDataRow[] => {
    return splitTextItems(textContent).map(value => {
      if (isZaloJoinGroupLinkAction(actionId)) return { uid: value }
      if (isZaloAddGroupMemberAction(actionId)) {
        const phone = normalizeVietnamMobilePhone(value)
        return phone ? { phone } : {}
      }
      if (platform === 'zalo' || platform === 'sms') return { phone: value }
      if (platform === 'facebook') return { uid: value }
      return { email: value }
    })
  }

  const buildRowsFromExcel = (): CampaignImportDataRow[] => {
    const rows = skipExcelHeader ? excelRows.slice(1) : excelRows
    return rows
      .map(row => {
        const item: CampaignImportDataRow = {}
        for (const field of fields) {
          item[field.key] = getCellText(rowValueByColumn(row, columnMap[field.key]))
        }
        return item
      })
      .filter(row => {
        const values = Object.values(row).map(value => getCellText(value)).filter(Boolean)
        return values.length > 0 && !values.every(isLikelyHeaderValue)
      })
  }

  const handleFormatData = async (): Promise<void> => {
    if (loading || saving) return
    if (activeTab === 'akabizTemplate') return
    invalidateFormattedPreview()
    const sourceRevision = sourceRevisionRef.current
    const operation = ++asyncOperationRef.current
    const importSource = activeTab
    const sourceLink = sheetLink.trim()
    const sourceImage = imageDataUrl
    setLoading(true)
    try {
      let rows: CampaignImportDataRow[] = []
      if (importSource === 'textbox') {
        rows = buildRowsFromText()
      } else if (importSource === 'excel') {
        if (!excelFile) {
          showAlert('Vui lòng tải file Excel.', 'error')
          return
        }
        const invalidColumn = fields.find(field => columnMap[field.key] && columnLetterToIndex(columnMap[field.key] || '') === null)
        if (invalidColumn) {
          showAlert(`Cột ${invalidColumn.label} không hợp lệ. Vui lòng chọn lại cột.`, 'error')
          return
        }
        rows = buildRowsFromExcel()
      } else if (importSource === 'sheet') {
        if (!sourceLink) {
          showAlert('Vui lòng nhập link sheet.', 'error')
          return
        }
        rows = await window.electronAPI.loadCampaignDataFromSheet({
          linkSheet: sourceLink,
          platform,
          actionId
        })
      } else {
        if (!sourceImage) {
          showAlert('Vui lòng tải hoặc dán ảnh.', 'error')
          return
        }
        if (isZaloJoinGroupLinkAction(actionId)) {
          const qrData = await decodeQrDataFromDataUrl(sourceImage).catch(() => '')
          const qrLink = normalizeZaloGroupInviteLink(qrData)
          rows = qrLink
            ? [{ uid: qrLink }]
            : await window.electronAPI.extractCampaignDataFromImage({
              imageDataUrl: sourceImage,
              platform,
              actionId
            })
        } else {
          rows = await window.electronAPI.extractCampaignDataFromImage({
            imageDataUrl: sourceImage,
            platform,
            actionId
          })
        }
      }

      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      const normalized = normalizeRows(rows, platform, actionId)
      if (normalized.length === 0) {
        showAlert('Không có data hợp lệ.', 'error')
        return
      }
      setPreviewRows(normalized)
      setFormattedImportSource(importSource)
      setFormattedSourceLink(importSource === 'sheet' ? sourceLink : null)
      showAlert(`Đã format ${normalized.length} data hợp lệ.`, 'success')
    } catch (err) {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        showAlert(err instanceof Error ? err.message : 'Không thể format dữ liệu.', 'error')
      }
    } finally {
      if (asyncOperationRef.current === operation) setLoading(false)
    }
  }

  const handleInsert = async (): Promise<void> => {
    if (previewRows.length === 0) {
      showAlert('Vui lòng format dữ liệu trước khi chèn.', 'error')
      return
    }
    if (!formattedImportSource) {
      showAlert('Vui lòng format lại dữ liệu trước khi chèn.', 'error')
      return
    }
    const normalizedName = datasetName.trim()
    if (!normalizedName) {
      showAlert('Vui lòng nhập tên nhóm dữ liệu.', 'error')
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
        importSource: formattedImportSource === 'akabizTemplate' ? 'excel' : formattedImportSource,
        sourceLink: formattedSourceLink,
        rows: previewRows
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

  const updateColumn = (field: ImportField, value: string): void => {
    invalidateFormattedPreview()
    setColumnMap(prev => ({ ...prev, [field]: value.toUpperCase().trim() }))
  }

  const renderTabButton = (tab: ImportTab, label: string) => (
    <button
      type="button"
      id={`campaign-import-tab-${tab}`}
      role="tab"
      aria-selected={activeTab === tab}
      aria-controls="campaign-import-tab-panel"
      className={`campaign-import-tab${activeTab === tab ? ' active' : ''}`}
      onClick={() => {
        if (tab === activeTab) return
        setActiveTab(tab)
        invalidateFormattedPreview()
        if (tab === 'akabizTemplate' && templateStatus === 'success' && templateRows.length > 0) {
          setPreviewRows(templateRows)
          setFormattedImportSource('akabizTemplate')
          setFormattedSourceLink(null)
        }
      }}
      disabled={loading || saving}
    >
      {label}
    </button>
  )

  return (
    <div className="modal-overlay campaign-import-modal-overlay">
      <div className="modal campaign-import-modal" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Upload dữ liệu</div>
          <button className="btn-icon" onClick={onClose} title="Đóng" disabled={loading || saving}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body campaign-import-body">
          <div className="stepper-form-group campaign-import-dataset-name">
            <label htmlFor="campaign-import-dataset-name">Tên nhóm dữ liệu</label>
            <input
              id="campaign-import-dataset-name"
              className="stepper-input"
              value={datasetName}
              onChange={event => setDatasetName(event.target.value)}
              placeholder="Ví dụ: Khách hàng quan tâm tháng 7"
              maxLength={255}
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="campaign-import-tabs" role="tablist" aria-label="Nguồn nhập dữ liệu">
            {renderTabButton('textbox', 'Form txt')}
            {renderTabButton('image', 'Ảnh')}
            {renderTabButton('sheet', 'Link sheet')}
            {renderTabButton('akabizTemplate', 'Từ template Excel akaBiz')}
            {renderTabButton('excel', 'File Excel/CSV của khách hàng')}
          </div>

          {activeTab === 'textbox' && (
            <div
              id="campaign-import-tab-panel"
              className="campaign-import-tab-panel"
              role="tabpanel"
              aria-labelledby="campaign-import-tab-textbox"
            >
              <label className="campaign-import-label" htmlFor="campaign-import-textbox">
                Form: Copy vào hoặc tải từ file txt
              </label>
              <textarea
                id="campaign-import-textbox"
                className="campaign-import-textarea"
                value={textContent}
                disabled={loading || saving}
                onChange={event => {
                  invalidateFormattedPreview()
                  setTextContent(event.target.value)
                }}
              />
              <div className="campaign-import-hint">Mỗi dữ liệu cách nhau bởi ký tự xuống dòng hoặc dấu phẩy</div>
              <div className="campaign-import-hint">Hệ thống sẽ loại bỏ ký tự đặc biệt sau đó verify dữ liệu đúng chuẩn input</div>
              <label className="btn btn-secondary campaign-import-file-button">
                <Upload size={14} /> Tải file txt
                <input
                  type="file"
                  accept=".txt"
                  hidden
                  disabled={loading || saving}
                  onChange={event => readTextFile(event.target.files?.[0])}
                />
              </label>
              {txtFileName && <div className="text-muted campaign-import-file-name">{txtFileName}</div>}
            </div>
          )}

          {activeTab === 'image' && (
            <div
              id="campaign-import-tab-panel"
              className="campaign-import-tab-panel"
              role="tabpanel"
              aria-labelledby="campaign-import-tab-image"
            >
              <label className="campaign-import-label">Ảnh: Tải lên hoặc dán vào</label>
              <div className="campaign-import-image-drop" onPaste={handleImagePaste} tabIndex={0}>
                {imageDataUrl ? (
                  <img src={imageDataUrl} alt="Preview" />
                ) : (
                  <div className="campaign-import-empty-media">
                    <ImageIcon size={24} />
                    <span>Dán ảnh ở đây (Ctrl+V)</span>
                  </div>
                )}
              </div>
              <label className="btn btn-secondary campaign-import-file-button">
                <Upload size={14} /> Tải ảnh
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={loading || saving}
                  onChange={event => readImageFile(event.target.files?.[0])}
                />
              </label>
            </div>
          )}

          {activeTab === 'sheet' && (
            <div
              id="campaign-import-tab-panel"
              className="campaign-import-tab-panel"
              role="tabpanel"
              aria-labelledby="campaign-import-tab-sheet"
            >
              <label className="campaign-import-label" htmlFor="campaign-import-sheet-link">
                Link sheet (đúng format akaBiz)
              </label>
              <input
                id="campaign-import-sheet-link"
                className="stepper-input"
                type="text"
                placeholder="Nhập link sheet"
                value={sheetLink}
                disabled={loading || saving}
                onChange={event => {
                  invalidateFormattedPreview()
                  setSheetLink(event.target.value)
                }}
              />
            </div>
          )}

          {activeTab === 'akabizTemplate' && (
            <div
              id="campaign-import-tab-panel"
              className="campaign-import-tab-panel"
              role="tabpanel"
              aria-labelledby="campaign-import-tab-akabizTemplate"
            >
              <label className="campaign-import-label" htmlFor="campaign-import-akabiz-template-file">
                Tải file theo template Excel akaBiz
              </label>
              <div
                className={`campaign-import-template-file${templateFile ? ' has-file' : ''}`}
                aria-disabled={loading || saving}
              >
                <input
                  ref={templateFileInputRef}
                  id="campaign-import-akabiz-template-file"
                  className="campaign-import-template-file-input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  tabIndex={-1}
                  disabled={loading || saving}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    void readAkabizTemplateFile(file)
                  }}
                />
                <button
                  type="button"
                  className="campaign-import-template-file-picker"
                  onClick={() => templateFileInputRef.current?.click()}
                  disabled={loading || saving}
                  aria-label={templateFile ? `Chọn file khác thay cho ${templateFile.name}` : 'Chọn file Excel/CSV theo template akaBiz'}
                >
                  <span className="campaign-import-template-file-icon" aria-hidden="true">
                    <Upload size={20} />
                  </span>
                  <span className="campaign-import-template-file-copy">
                    <span className="campaign-import-template-file-title">
                      {templateFile?.name || 'Chọn file Excel/CSV'}
                    </span>
                    <span className="campaign-import-template-file-meta">
                      {templateFile
                        ? `${formatTemplateFileSize(templateFile.size)} • ${getTemplateFileType(templateFile.name)}`
                        : 'Hỗ trợ .xlsx, .xls và .csv'}
                    </span>
                  </span>
                </button>
                {templateFile && (
                  <button
                    type="button"
                    className="campaign-import-template-file-remove"
                    onClick={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      clearAkabizTemplateFile()
                    }}
                    disabled={loading || saving}
                    title="Xóa file đã chọn"
                    aria-label="Xóa file Excel template đã chọn"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="campaign-import-hint">Dữ liệu sẽ được tự động đọc theo cấu trúc chuẩn.</div>
              {templateStatus !== 'idle' && (
                <div
                  className={`campaign-import-template-status ${templateStatus}`}
                  role={templateStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {templateStatus === 'reading' && <RefreshCw size={14} className="spin" />}
                  {templateStatus === 'success' && <CheckCircle2 size={15} />}
                  {templateStatus === 'error' && <X size={15} />}
                  <span>
                    {templateStatus === 'reading' && 'Đang đọc dữ liệu...'}
                    {templateStatus === 'success' && `Đã đọc ${templateRows.length} data hợp lệ`}
                    {templateStatus === 'error' && templateError}
                  </span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'excel' && (
            <div
              id="campaign-import-tab-panel"
              className="campaign-import-tab-panel"
              role="tabpanel"
              aria-labelledby="campaign-import-tab-excel"
            >
              <label className="campaign-import-skip-header">
                <input
                  type="checkbox"
                  checked={skipExcelHeader}
                  disabled={loading || saving}
                  onChange={event => {
                    invalidateFormattedPreview()
                    setSkipExcelHeader(event.target.checked)
                  }}
                />
                <span>Bỏ qua dòng đầu (dòng tiêu đề)</span>
              </label>
              <div className="campaign-import-column-grid">
                {fields.map(field => (
                  <label key={field.key} className="campaign-import-column-field">
                    <span>{field.label}</span>
                    <select
                      className="stepper-input"
                      value={columnMap[field.key] || ''}
                      disabled={loading || saving}
                      onChange={event => updateColumn(field.key, event.target.value)}
                    >
                      {excelColumnOptions.map(option => (
                        <option key={`${field.key}-${option.value || 'skip'}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="btn btn-secondary campaign-import-file-button">
                <FileSpreadsheet size={14} /> Tải file Excel/CSV
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  disabled={loading || saving}
                  onChange={event => void readExcelFile(event.target.files?.[0])}
                />
              </label>
              {excelFileName && <div className="text-muted campaign-import-file-name">{excelFileName}</div>}
              {excelRows.length > 0 && (
                <div className="campaign-import-excel-preview">
                  <div className="campaign-import-label">Preview dữ liệu Excel (5 dòng đầu)</div>
                  <div className="campaign-import-preview-scroll">
                    <table className="campaign-grid">
                      <thead>
                        <tr>{excelHeaders.map(header => <th key={header}>{header}</th>)}</tr>
                      </thead>
                      <tbody>
                        {excelRows.slice(0, 5).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {excelHeaders.map((_, colIndex) => (
                              <td key={colIndex} title={getCellText(row[colIndex])}>{getCellText(row[colIndex])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab !== 'akabizTemplate' && (
            <div className="campaign-import-format-row">
              <button className="btn btn-secondary" onClick={() => void handleFormatData()} disabled={loading || saving}>
                {loading ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                Format chuẩn dữ liệu
              </button>
            </div>
          )}

          <div className="campaign-import-preview-table">
            <table className="campaign-grid">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>STT</th>
                  {fields.map(field => <th key={field.key}>{field.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.length === 0 ? (
                  <tr>
                    <td colSpan={fields.length + 1} className="text-center text-muted">Chưa có dữ liệu</td>
                  </tr>
                ) : (
                  previewRows.map((row, index) => (
                    <tr key={`${index}-${row.phone || row.uid || row.email || row.name || 'row'}`}>
                      <td className="text-center">{index + 1}</td>
                      {fields.map(field => <td key={field.key}>{getCellText(row[field.key])}</td>)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading || saving}>Huỷ</button>
          <button
            className="btn btn-primary"
            onClick={() => void handleInsert()}
            disabled={loading || saving || previewRows.length === 0 || !datasetName.trim()}
          >
            {saving ? <RefreshCw size={14} className="spin" /> : null}
            {saving ? 'Đang lưu...' : 'Chèn xuống chi tiết'}
          </button>
        </div>
      </div>
    </div>
  )
}
