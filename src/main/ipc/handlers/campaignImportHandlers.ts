import { ipcMain } from 'electron'
import { read, utils } from 'xlsx'
import {
  CampaignImportDataRow,
  CampaignImportImageRequest,
  CampaignImportPlatform,
  CampaignImportSheetRequest,
  IPC_EVENTS,
  isValidEmailInputDataValue
} from '../../../shared/types'
import { normalizeVietnamMobilePhone } from '../../../shared/phone'
import { requireCurrentUser } from '../../data/currentUser'
import { callAiUsing } from '../../services/aiRuntimeService'

const IMPORT_IMAGE_AI_CODE = 'app_campaign_import_image_to_data'
const SHEET_FETCH_TIMEOUT_MS = 30000
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'

function isZaloJoinGroupLinkAction(actionId?: string | null): boolean {
  return actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID
}

function isFacebookJoinGroupAction(actionId?: string | null): boolean {
  return actionId === FACEBOOK_JOIN_GROUP_ACTION_ID
}

function toText(value: unknown): string {
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

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return ''
}

function normalizeUid(value: unknown): string {
  const text = toText(value).replace(/\s+/g, '')
  if (!text) return ''
  const lower = text.toLowerCase()
  if (['uid', 'url', 'link', 'group', 'profile', 'facebook', 'facebookuid'].includes(lower)) return ''
  return text
}

function normalizeZaloGroupInviteLink(value: unknown): string {
  const raw = toText(value)
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

function normalizePlatform(value: unknown): CampaignImportPlatform {
  const platform = toText(value).toLowerCase()
  if (platform === 'zalo' || platform === 'facebook' || platform === 'email' || platform === 'sms') return platform
  throw new Error('Nền tảng import không hợp lệ.')
}

function isLikelyHeaderValue(value: string): boolean {
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

function hasOnlyHeaderValues(row: CampaignImportDataRow): boolean {
  const values = Object.values(row)
    .map(value => toText(value))
    .filter(Boolean)
  return values.length > 0 && values.every(isLikelyHeaderValue)
}

function googleSheetExportUrl(url: URL): string | null {
  if (!url.hostname.includes('docs.google.com')) return null
  const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)
  if (!match) return null

  const gidFromHash = url.hash.match(/gid=(\d+)/)?.[1]
  const gid = url.searchParams.get('gid') || gidFromHash || ''
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`)
  exportUrl.searchParams.set('format', 'csv')
  if (gid) exportUrl.searchParams.set('gid', gid)
  return exportUrl.toString()
}

function resolveSheetDownloadUrl(linkSheet: unknown): string {
  const raw = toText(linkSheet)
  if (!raw) throw new Error('Vui lòng nhập link sheet.')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Link sheet không hợp lệ.')
  }

  return googleSheetExportUrl(parsed) || parsed.toString()
}

function looksLikeHtml(buffer: Buffer, contentType: string): boolean {
  if (contentType.toLowerCase().includes('text/html')) return true
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase()
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<html')
}

async function fetchSheetWorkbookRows(linkSheet: unknown): Promise<unknown[][]> {
  const url = resolveSheetDownloadUrl(linkSheet)
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(SHEET_FETCH_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`Không thể tải link sheet. HTTP ${response.status}.`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (looksLikeHtml(buffer, response.headers.get('content-type') || '')) {
    throw new Error('Không thể đọc link sheet. Vui lòng bật chia sẻ "Anyone with link" hoặc dùng link CSV/XLS/XLSX export hợp lệ.')
  }

  const workbook = read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  return utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
}

function mapSheetRows(rows: unknown[][]): CampaignImportDataRow[] {
  return rows
    .map(row => {
      return {
        name: toText(row[0]),
        uid: toText(row[1]),
        phone: toText(row[2]),
        email: toText(row[3]),
        info1: toText(row[4]),
        info2: toText(row[5]),
        info3: toText(row[6]),
        info4: toText(row[7]),
        info5: toText(row[8])
      }
    })
    .filter(row => {
      const values = Object.values(row).map(value => toText(value)).filter(Boolean)
      return values.length > 0 && !hasOnlyHeaderValues(row)
    })
}

function rawRowsFromAiContent(content: string): unknown[] {
  const trimmed = content.trim()
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  ]
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/)
  if (jsonMatch) candidates.push(jsonMatch[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        if (Array.isArray(record.data)) return record.data
        if (Array.isArray(record.rows)) return record.rows
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('AI không trả về JSON array hợp lệ.')
}

function normalizeImportedRows(rows: unknown[], platform: CampaignImportPlatform, actionId?: string | null): CampaignImportDataRow[] {
  const seen = new Set<string>()
  const output: CampaignImportDataRow[] = []

  for (const row of rows) {
    const record = row && typeof row === 'object' ? row as Record<string, unknown> : { value: row }
    const item: CampaignImportDataRow = {
      name: firstText(record.name, record.fullname, record.fullName, record.ten, record.contactName),
      info1: firstText(record.info1, record.Info1),
      info2: firstText(record.info2, record.Info2),
      info3: firstText(record.info3, record.Info3),
      info4: firstText(record.info4, record.Info4),
      info5: firstText(record.info5, record.Info5)
    }

    let key = ''
    if (isZaloJoinGroupLinkAction(actionId)) {
      item.uid = normalizeZaloGroupInviteLink(firstText(
        record.uid,
        record.url,
        record.link,
        record.groupLink,
        record.zaloGroupLink,
        record.zalo_group_link,
        record.value,
        record.name
      ))
      if (normalizeZaloGroupInviteLink(item.name) === item.uid) item.name = ''
      item.phone = ''
      item.email = ''
      key = item.uid
    } else if (isFacebookJoinGroupAction(actionId)) {
      item.uid = normalizeUid(firstText(
        record.uid,
        record.url,
        record.link,
        record.group,
        record.groupLink,
        record.facebookGroupLink,
        record.facebook_group_link,
        record.group_id,
        record.groupId,
        record.value,
        record.name
      ))
      if (normalizeUid(item.name) === item.uid) item.name = ''
      item.phone = ''
      item.email = ''
      key = item.uid
    } else if (platform === 'zalo' || platform === 'sms') {
      item.phone = normalizeVietnamMobilePhone(firstText(record.phone, record.mobile, record.sdt, record.soDienThoai, record.value))
      key = item.phone
    } else if (platform === 'facebook') {
      item.uid = normalizeUid(firstText(record.uid, record.url, record.link, record.profileUrl, record.facebookUrl, record.value))
      key = item.uid
    } else {
      item.email = firstText(record.email, record.mail, record.value).toLowerCase()
      key = isValidEmailInputDataValue(item.email) ? item.email : ''
    }

    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

export function registerCampaignImportHandlers(): void {
  ipcMain.handle(IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET, async (_, request: CampaignImportSheetRequest): Promise<CampaignImportDataRow[]> => {
    requireCurrentUser()
    const platform = normalizePlatform(request?.platform)
    const rows = await fetchSheetWorkbookRows(request?.linkSheet)
    return normalizeImportedRows(mapSheetRows(rows), platform, request?.actionId || '')
  })

  ipcMain.handle(IPC_EVENTS.CAMPAIGN_IMPORT_EXTRACT_IMAGE, async (_, request: CampaignImportImageRequest): Promise<CampaignImportDataRow[]> => {
    requireCurrentUser()
    const platform = normalizePlatform(request?.platform)
    const imageDataUrl = toText(request?.imageDataUrl)
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl)) {
      throw new Error('Ảnh import không hợp lệ.')
    }

    const result = await callAiUsing(IMPORT_IMAGE_AI_CODE, {
      platform,
      actionId: request?.actionId || '',
      imageDataUrl
    })
    if (!result.ok) throw new Error(result.error || 'AI không thể đọc dữ liệu từ ảnh.')

    return normalizeImportedRows(rawRowsFromAiContent(result.content), platform, request?.actionId || '')
  })
}
