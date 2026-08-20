import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Image as ImageIcon, RefreshCw, Upload, X } from 'lucide-react'
import jsQR from 'jsqr'
import { read, utils } from 'xlsx'
import {
  CampaignImportDataRow,
  CampaignImportPlatform,
  CampaignInputData,
  ContactDatasetImportSource,
  getCampaignInputDataRequirement,
  isValidEmailInputDataValue
} from '../../../../shared/types'
import { getVietnamMobileCarrier, normalizeVietnamMobilePhone } from '../../../../shared/phone'
import { useUiStore } from '../../stores/uiStore'
import { createDefaultDataGroupName } from '../../utils/dataGroupNames'

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
const DATA_GROUP_ZALO_PERSON_UID_ACTION_ID = 'data_group_zalo_person_uid'
const MAX_IMPORT_ROW_COUNT = 10_000
const IMPORT_PREVIEW_PAGE_SIZE = 100
const IMPORT_ROW_LIMIT_MESSAGE = 'Mỗi lần chỉ được nhập tối đa 10.000 dòng dữ liệu. Vui lòng chia nhỏ dữ liệu rồi thử lại.'
const isZaloJoinGroupLinkAction = (actionId?: string | null): boolean => actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID
const isZaloAddGroupMemberAction = (actionId?: string | null): boolean => actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID
const isFacebookJoinGroupAction = (actionId?: string | null): boolean => actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
const isFacebookFindDataSearchAction = (actionId?: string | null): boolean => actionId === FACEBOOK_FIND_DATA_SEARCH_ACTION_ID
const isFacebookCommentSeedingPostAction = (actionId?: string | null): boolean => actionId === FACEBOOK_COMMENT_SEEDING_POST_ACTION_ID
const isDataGroupZaloPersonUidAction = (actionId?: string | null): boolean => actionId === DATA_GROUP_ZALO_PERSON_UID_ACTION_ID

const waitForNextBrowserPaint = (): Promise<void> => (
  new Promise(resolve => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0)
    })
  })
)

type ImportTargetField = 'phone' | 'uid' | 'email' | 'phone_or_uid'

const getImportTargetField = (platform: CampaignImportPlatform, actionId: string): ImportTargetField => {
  // Direct upload for add-group-member is intentionally phone-only. The
  // account-bound Zalo UID branch remains available through scans/Data Groups.
  if (isZaloAddGroupMemberAction(actionId)) return 'phone'
  if (isDataGroupZaloPersonUidAction(actionId)) return 'uid'
  const requiredField = getCampaignInputDataRequirement(actionId)?.field
  if (requiredField === 'phone' || requiredField === 'uid' || requiredField === 'email' || requiredField === 'phone_or_uid') {
    return requiredField
  }
  if (platform === 'zalo' || platform === 'sms') return 'phone'
  if (platform === 'email') return 'email'
  return 'uid'
}

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

const countNonEmptyImportRows = (rows: unknown[][]): number => rows.reduce(
  (count, row) => count + (row.some(cell => getCellText(cell)) ? 1 : 0),
  0
)

const assertImportRowLimit = (rowCount: number): void => {
  if (rowCount > MAX_IMPORT_ROW_COUNT) throw new Error(IMPORT_ROW_LIMIT_MESSAGE)
}

const normalizeUid = (value: unknown): string => {
  const text = getCellText(value).replace(/\s+/g, '').replace(/\/+$/g, '')
  const lower = text.toLowerCase()
  if (!text || ['uid', 'url', 'link', 'group', 'profile', 'facebook', 'facebookuid'].includes(lower)) return ''
  return text
}

const normalizeZaloUserUid = (value: unknown): string => {
  const uid = getCellText(value).replace(/\s+/g, '')
  if (!/^\d{5,30}$/.test(uid)) return ''
  return uid
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
    if (isDataGroupZaloPersonUidAction(actionId)) {
      const uid = normalizeZaloUserUid(firstText(row.uid, row.name))
      if (!uid || seen.has(uid)) continue
      const rawName = getCellText(row.name)
      seen.add(uid)
      output.push({
        ...row,
        name: normalizeZaloUserUid(rawName) === uid ? '' : rawName,
        phone: '',
        uid,
        email: ''
      })
      continue
    }
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
    const targetField = getImportTargetField(platform, actionId)
    if (targetField === 'phone') {
      item.phone = normalizeVietnamMobilePhone(row.phone)
      item.phoneCarrier = getVietnamMobileCarrier(item.phone) || null
      key = item.phone
    } else if (targetField === 'uid') {
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
  .replace(/[^a-z0-9]/g, '')

interface AkabizTemplateSchema {
  headerIndex: number
  columns: Record<'name' | 'uid' | 'phone' | 'email' | 'info1' | 'info2' | 'info3' | 'info4' | 'info5', number>
}

const AKABIZ_TEMPLATE_HEADER_ALIASES: Record<keyof AkabizTemplateSchema['columns'], string[]> = {
  name: ['ten', 'name', 'fullname', 'hoten'],
  uid: ['uid', 'url', 'link'],
  phone: ['sdt', 'phone', 'mobile', 'sodienthoai'],
  email: ['email', 'emailaddress'],
  info1: ['info1'],
  info2: ['info2'],
  info3: ['info3'],
  info4: ['info4'],
  info5: ['info5']
}

const findAkabizTemplateSchema = (rows: unknown[][]): AkabizTemplateSchema | null => {
  const orderedFields = Object.keys(AKABIZ_TEMPLATE_HEADER_ALIASES) as Array<keyof AkabizTemplateSchema['columns']>
  for (let headerIndex = 0; headerIndex < Math.min(rows.length, 20); headerIndex += 1) {
    const normalizedHeaders = (rows[headerIndex] || []).map(normalizeTemplateHeader)
    const isCurrentTemplate = orderedFields.every((field, index) => (
      AKABIZ_TEMPLATE_HEADER_ALIASES[field].includes(normalizedHeaders[index] || '')
    ))
    if (!isCurrentTemplate) continue
    const columns = Object.fromEntries(orderedFields.map((field, index) => [field, index])) as AkabizTemplateSchema['columns']
    return { headerIndex, columns }
  }
  return null
}

const buildAkabizTemplateRows = (
  rows: unknown[][],
  platform: CampaignImportPlatform,
  actionId: string,
  schema: AkabizTemplateSchema
): CampaignImportDataRow[] => {
  const seen = new Set<string>()
  const output: CampaignImportDataRow[] = []

  const pushUnique = (row: CampaignImportDataRow, key: string): void => {
    const normalizedKey = key.trim().toLowerCase()
    if (!normalizedKey || seen.has(normalizedKey)) return
    seen.add(normalizedKey)
    output.push(row)
  }

  const valueAt = (row: unknown[], field: keyof AkabizTemplateSchema['columns']): string => {
    const index = schema.columns[field]
    return index >= 0 ? getCellText(row[index]) : ''
  }

  for (const sourceRow of rows.slice(schema.headerIndex + 1)) {
    if (!Array.isArray(sourceRow)) continue
    if (sourceRow.every(cell => !getCellText(cell))) continue

    const rawName = valueAt(sourceRow, 'name')
    const rawUid = valueAt(sourceRow, 'uid')
    const rawPhone = valueAt(sourceRow, 'phone')
    const rawEmail = valueAt(sourceRow, 'email')
    const baseRow: CampaignImportDataRow = {
      name: rawName,
      uid: normalizeUid(rawUid),
      phone: rawPhone,
      email: rawEmail,
      info1: valueAt(sourceRow, 'info1'),
      info2: valueAt(sourceRow, 'info2'),
      info3: valueAt(sourceRow, 'info3'),
      info4: valueAt(sourceRow, 'info4'),
      info5: valueAt(sourceRow, 'info5')
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
        normalizeVietnamMobilePhone(rawName)
      if (!phone) continue
      pushUnique({
        ...baseRow,
        name: phone && normalizeVietnamMobilePhone(rawName) === phone ? '' : rawName,
        phone,
        phoneCarrier: getVietnamMobileCarrier(phone) || null,
        uid: '',
        email: ''
      }, phone)
      continue
    }

    const targetField = getImportTargetField(platform, actionId)
    if (targetField === 'phone') {
      const phone = normalizeVietnamMobilePhone(rawPhone)
      if (!phone) continue
      pushUnique({
        ...baseRow,
        phone,
        phoneCarrier: getVietnamMobileCarrier(phone) || null
      }, phone)
      continue
    }

    if (targetField === 'email') {
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

const readUploadedWorkbook = (bytes: Uint8Array, fileName: string) => {
  if (/\.csv$/i.test(fileName)) {
    const csvText = new TextDecoder('utf-8').decode(bytes)
    return read(csvText, { type: 'string', raw: true, codepage: 65001 })
  }
  return read(bytes, { type: 'array' })
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
  const targetField = getImportTargetField(platform, actionId)
  if (targetField === 'phone') {
    return { phone: detectPhoneColumn(rows) }
  }
  if (targetField === 'uid') {
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
  onInsert,
  onSubmitRows,
  contextSlot,
  title = 'Upload dữ liệu',
  datasetNameLabel = 'Tên nhóm dữ liệu',
  showDatasetName = true,
  layout = 'default',
  submitLabel = 'Chèn xuống chi tiết'
}: CampaignDataUploadModalProps) {
  const showAlert = useUiStore(state => state.showAlert)
  const isDataGroupLayout = layout === 'data-group'
  const fields = useMemo(() => getFieldsForPlatform(platform, actionId), [platform, actionId])
  const [activeTab, setActiveTab] = useState<ImportTab>('textbox')
  const [datasetName, setDatasetName] = useState(() => createDefaultDataGroupName())
  const [textContent, setTextContent] = useState('')
  const [txtFileName, setTxtFileName] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [imageSourceName, setImageSourceName] = useState('')
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
    sourceRevisionRef.current += 1
    asyncOperationRef.current += 1
    setActiveTab('textbox')
    setDatasetName(createDefaultDataGroupName())
    setTextContent('')
    setTxtFileName('')
    setImageDataUrl('')
    setImageSourceName('')
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
    setPreviewPage(1)
    setFormattedImportSource(null)
    setFormattedSourceLink(null)
    setLoading(false)
    setSaving(false)
    insertInFlightRef.current = false
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
  const textInputCount = useMemo(() => splitTextItems(textContent).length, [textContent])
  const previewPageCount = Math.max(1, Math.ceil(previewRows.length / IMPORT_PREVIEW_PAGE_SIZE))
  const visiblePreviewPage = Math.min(previewPage, previewPageCount)
  const previewStartIndex = (visiblePreviewPage - 1) * IMPORT_PREVIEW_PAGE_SIZE
  const previewEndIndex = Math.min(previewRows.length, previewStartIndex + IMPORT_PREVIEW_PAGE_SIZE)
  const visiblePreviewRows = useMemo(
    () => previewRows.slice(previewStartIndex, previewEndIndex),
    [previewEndIndex, previewRows, previewStartIndex]
  )

  useEffect(() => {
    setPreviewPage(current => Math.min(current, previewPageCount))
  }, [previewPageCount])

  const invalidateFormattedPreview = (): void => {
    sourceRevisionRef.current += 1
    setPreviewRows([])
    setPreviewPage(1)
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
        const content = String(event.target?.result || '')
        if (splitTextItems(content).length > MAX_IMPORT_ROW_COUNT) {
          setTxtFileName('')
          setTextContent('')
          showAlert(IMPORT_ROW_LIMIT_MESSAGE, 'error')
          if (asyncOperationRef.current === operation) setLoading(false)
          return
        }
        invalidateFormattedPreview()
        setTextContent(content)
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
    const imageTimestamp = Number.isFinite(file.lastModified) && file.lastModified > 0
      ? new Date(file.lastModified).toLocaleString('vi-VN')
      : ''
    setImageSourceName(
      imageTimestamp
        ? `${file.name || 'Ảnh tải lên'} · ${imageTimestamp}`
        : file.name || 'Ảnh tải lên'
    )
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
      const fileBytes = new Uint8Array(await file.arrayBuffer())
      const workbook = readUploadedWorkbook(fileBytes, file.name)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      const importRows = skipExcelHeader ? rows.slice(1) : rows
      if (countNonEmptyImportRows(importRows) > MAX_IMPORT_ROW_COUNT) {
        setExcelFile(null)
        setExcelFileName('')
        setExcelRows([])
        setColumnMap(createEmptyColumnMap())
        showAlert(IMPORT_ROW_LIMIT_MESSAGE, 'error')
        return
      }
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

      const workbook = readUploadedWorkbook(fileBytes, file.name)
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) {
        failRead('File Excel trống hoặc không đọc được sheet đầu tiên.')
        return
      }

      const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
      const schema = findAkabizTemplateSchema(rows)
      if (!schema) {
        failRead('File không đúng cấu trúc template akaBiz (Fullname, Uid, Mobile, Email, Info1…Info5).')
        return
      }
      if (countNonEmptyImportRows(rows.slice(schema.headerIndex + 1)) > MAX_IMPORT_ROW_COUNT) {
        failRead(IMPORT_ROW_LIMIT_MESSAGE)
        return
      }
      const normalized = buildAkabizTemplateRows(rows, platform, actionId, schema)
      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      if (normalized.length === 0) {
        const targetField = getImportTargetField(platform, actionId)
        const targetHint = targetField === 'phone'
          ? 'Số điện thoại trong cột Mobile'
          : targetField === 'email'
            ? 'Email trong cột Email'
            : targetField === 'phone_or_uid'
              ? 'Số điện thoại trong cột Mobile hoặc UID trong cột Uid'
              : `${getCampaignInputDataRequirement(actionId)?.label || 'UID'} trong cột Uid`
        failRead(`File đúng template nhưng không có ${targetHint} hợp lệ cho chiến dịch này.`)
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
        return { phone, uid: '' }
      }
      const targetField = getImportTargetField(platform, actionId)
      if (targetField === 'phone') return { phone: value }
      if (targetField === 'email') return { email: value }
      return { uid: value }
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

  const collectCurrentImport = async (): Promise<{
    rows: CampaignImportDataRow[]
    importSource: ImportTab
    sourceLink: string | null
  }> => {
    const importSource = activeTab
    const sourceLink = sheetLink.trim()
    const sourceImage = imageDataUrl
    let rows: CampaignImportDataRow[] = []
    if (importSource === 'akabizTemplate') {
      if (templateStatus === 'reading') throw new Error('File template đang được đọc. Vui lòng chờ trong giây lát.')
      if (templateStatus !== 'success' || templateRows.length === 0) {
        throw new Error('Vui lòng chọn file Excel theo template akaBiz.')
      }
      rows = templateRows
    } else if (importSource === 'textbox') {
      rows = buildRowsFromText()
    } else if (importSource === 'excel') {
      if (!excelFile) throw new Error('Vui lòng tải file Excel.')
      const invalidColumn = fields.find(field => columnMap[field.key] && columnLetterToIndex(columnMap[field.key] || '') === null)
      if (invalidColumn) throw new Error(`Cột ${invalidColumn.label} không hợp lệ. Vui lòng chọn lại cột.`)
      rows = buildRowsFromExcel()
    } else if (importSource === 'sheet') {
      if (!sourceLink) throw new Error('Vui lòng nhập link sheet.')
      rows = await window.electronAPI.loadCampaignDataFromSheet({
        linkSheet: sourceLink,
        platform,
        actionId
      })
    } else {
      if (!sourceImage) throw new Error('Vui lòng tải hoặc dán ảnh.')
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

    assertImportRowLimit(rows.length)
    const normalized = importSource === 'akabizTemplate'
      ? rows
      : normalizeRows(rows, platform, actionId)
    assertImportRowLimit(normalized.length)
    if (normalized.length === 0) throw new Error('Không có data hợp lệ.')
    return {
      rows: normalized,
      importSource,
      sourceLink: importSource === 'sheet' ? sourceLink : null
    }
  }

  const handleFormatData = async (): Promise<void> => {
    if (loading || saving || activeTab === 'akabizTemplate') return
    invalidateFormattedPreview()
    const sourceRevision = sourceRevisionRef.current
    const operation = ++asyncOperationRef.current
    setLoading(true)
    try {
      const result = await collectCurrentImport()
      if (sourceRevisionRef.current !== sourceRevision || asyncOperationRef.current !== operation) return
      setPreviewRows(result.rows)
      setFormattedImportSource(result.importSource)
      setFormattedSourceLink(result.sourceLink)
      showAlert(`Đã format ${result.rows.length} data hợp lệ.`, 'success')
    } catch (err) {
      if (sourceRevisionRef.current === sourceRevision && asyncOperationRef.current === operation) {
        showAlert(err instanceof Error ? err.message : 'Không thể format dữ liệu.', 'error')
      }
    } finally {
      if (asyncOperationRef.current === operation) setLoading(false)
    }
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
        return templateFile?.name.trim() || 'Template Excel akaBiz'
      }
      if (importSource === 'excel') return excelFileName.trim() || 'File Excel/CSV'
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
    if (insertInFlightRef.current || loading || saving) return
    if (previewRows.length === 0) {
      showAlert('Vui lòng format dữ liệu trước khi chèn.', 'error')
      return
    }
    if (!formattedImportSource) {
      showAlert('Vui lòng format lại dữ liệu trước khi chèn.', 'error')
      return
    }
    insertInFlightRef.current = true
    try {
      await insertFormattedRows(previewRows, formattedImportSource, formattedSourceLink)
    } finally {
      insertInFlightRef.current = false
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

  const layoutClass = isDataGroupLayout ? ' is-data-group' : ''
  const modalContent = (
    <div
      className={`modal-overlay campaign-import-modal-overlay${layoutClass}`}
      onMouseDown={event => {
        if (event.target === event.currentTarget && !loading && !saving) onClose()
      }}
    >
      <div className={`modal campaign-import-modal${layoutClass}`} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="btn-icon" onClick={onClose} title="Đóng" disabled={loading || saving}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body campaign-import-body">
          {showDatasetName && (
            <div className="stepper-form-group campaign-import-dataset-name">
              <label htmlFor="campaign-import-dataset-name">
                {datasetNameLabel}<span className="required">*</span>
              </label>
              <input
                id="campaign-import-dataset-name"
                className="stepper-input"
                value={datasetName}
                onChange={event => setDatasetName(event.target.value)}
                maxLength={255}
                disabled={saving}
                required
                aria-required="true"
                autoFocus
              />
            </div>
          )}

          {contextSlot}

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
                autoFocus={!showDatasetName}
                disabled={loading || saving}
                onChange={event => {
                  invalidateFormattedPreview()
                  setTextContent(event.target.value)
                }}
              />
              {isDataGroupLayout ? (
                <div className="campaign-import-hint">
                  Mỗi dữ liệu cách nhau bởi ký tự xuống dòng hoặc dấu phẩy. Hệ thống sẽ verify đúng chuẩn input.
                </div>
              ) : (
                <>
                  <div className="campaign-import-hint">Mỗi dữ liệu cách nhau bởi ký tự xuống dòng hoặc dấu phẩy</div>
                  <div className="campaign-import-hint">Hệ thống sẽ loại bỏ ký tự đặc biệt sau đó verify dữ liệu đúng chuẩn input</div>
                </>
              )}
              <div className={isDataGroupLayout ? 'campaign-import-file-meta-row' : undefined}>
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
                {isDataGroupLayout ? (
                  <span className="text-muted campaign-import-file-name">
                    {txtFileName || (textInputCount > 0 ? `${textInputCount.toLocaleString('vi-VN')} dòng dữ liệu` : 'Chưa có dữ liệu')}
                  </span>
                ) : txtFileName ? (
                  <div className="text-muted campaign-import-file-name">{txtFileName}</div>
                ) : null}
              </div>
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

          {previewRows.length > 0 && (
            <div className="campaign-import-preview-summary">
              Hiển thị {previewStartIndex + 1}–{previewEndIndex} / {previewRows.length.toLocaleString('vi-VN')} data
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
                  visiblePreviewRows.map((row, index) => {
                    const absoluteIndex = previewStartIndex + index
                    return (
                      <tr key={`${absoluteIndex}-${row.phone || row.uid || row.email || row.name || 'row'}`}>
                        <td className="text-center">{absoluteIndex + 1}</td>
                        {fields.map(field => <td key={field.key}>{getCellText(row[field.key])}</td>)}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {previewRows.length > IMPORT_PREVIEW_PAGE_SIZE && (
            <div className="campaign-local-data-pager">
              <span>Chỉ phân trang phần hiển thị; toàn bộ data vẫn được chèn.</span>
              <div>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setPreviewPage(page => Math.max(1, page - 1))}
                  disabled={visiblePreviewPage <= 1 || loading || saving}
                  title="Trang trước"
                >
                  <ChevronLeft size={14} />
                </button>
                <span>Trang {visiblePreviewPage}/{previewPageCount}</span>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => setPreviewPage(page => Math.min(previewPageCount, page + 1))}
                  disabled={visiblePreviewPage >= previewPageCount || loading || saving}
                  title="Trang sau"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={loading || saving}>Huỷ</button>
          <button
            className="btn btn-primary"
            onClick={() => void handleInsert()}
            disabled={loading || saving || previewRows.length === 0 || (showDatasetName && !datasetName.trim())}
          >
            {saving ? <RefreshCw size={14} className="spin" /> : null}
            {saving ? 'Đang lưu...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
