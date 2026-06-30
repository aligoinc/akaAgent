export interface CampaignLogContext {
  accountName?: string | null
  campaignName?: string | null
}

export interface ParsedCampaignLogLine {
  timestamp?: string
  message: string
}

const SCREENSHOT_EVENT_MARKER_RE = /\s*<!--\s*screenshotEventId:\d+\s*-->\s*$/i
const LEGACY_LOG_LINE_RE = /^\[([^\]]+)\]\s*(.*)$/
const STRUCTURED_LOG_LINE_RE = /^(\d{1,2}:\d{2}:\d{2}\s+\d{1,2}\/\d{1,2}\/\d{4})\s+-\s*(.*)$/

function normalizePart(value: unknown): string {
  return String(value ?? '').trim()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitScreenshotMarker(value: string): { body: string; marker: string } {
  const text = String(value || '')
  const match = text.match(SCREENSHOT_EVENT_MARKER_RE)
  if (!match) return { body: text, marker: '' }
  return {
    body: text.slice(0, match.index).trimEnd(),
    marker: match[0]
  }
}

function replaceCurrentCampaignText(text: string, campaignName: string, accountName: string): string {
  let next = text
  const campaign = escapeRegex(campaignName)
  const account = escapeRegex(accountName)

  if (campaignName && accountName) {
    next = next.replace(
      new RegExp(`Bắt đầu chiến dịch\\s+"${campaign}"\\s+trên tài khoản\\s+"${account}"`, 'g'),
      'Bắt đầu chiến dịch'
    )
  }

  if (!campaignName) return next

  next = next
    .replace(new RegExp(`Xử lý\\s+"([^"]+)"\\s+trong chiến dịch\\s+"${campaign}"`, 'g'), 'Xử lý - $1')
    .replace(new RegExp(`Hoàn thành chiến dịch\\s+"${campaign}"`, 'g'), 'Hoàn thành chiến dịch')
    .replace(new RegExp(`Chiến dịch\\s+"${campaign}"\\s+đã được tạm dừng\\.?`, 'g'), 'Chiến dịch đã được tạm dừng')
    .replace(new RegExp(`Chiến dịch\\s+"${campaign}"\\s+tiếp tục`, 'g'), 'Tiếp tục')
    .replace(new RegExp(`Chiến dịch\\s+"${campaign}"\\s+đang`, 'g'), 'Đang')
    .replace(new RegExp(`Tạm dừng chiến dịch\\s+"${campaign}"\\s*:`, 'g'), 'Tạm dừng chiến dịch:')
    .replace(new RegExp(`Tạm dừng\\s+"${campaign}"\\s*:`, 'g'), 'Tạm dừng:')
    .replace(new RegExp(`Dừng chiến dịch\\s+"${campaign}"\\s*:`, 'g'), 'Dừng chiến dịch:')
    .replace(new RegExp(`Lỗi chiến dịch\\s+"${campaign}"\\s*:`, 'g'), 'Lỗi chiến dịch:')
    .replace(new RegExp(`Lỗi engine v2\\s+"${campaign}"\\s*:`, 'g'), 'Lỗi engine v2:')
    .replace(new RegExp(`Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch\\s+"${campaign}"`, 'g'), 'Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch')
    .replace(new RegExp(`\\s+vào chiến dịch\\s+"${campaign}"`, 'g'), '')
    .replace(new RegExp(`\\s+trong chiến dịch\\s+"${campaign}"`, 'g'), '')

  return next
}

function normalizeActionDataText(text: string): string {
  return text
    .replace(/Link nguồn (#\d+\/\d+)\s+cho\s+"([^"]+)"\s*:/g, 'Link nguồn $1 - $2:')
    .replace(/Bỏ qua đăng bài vào\s+"([^"]+)"/g, 'Bỏ qua đăng bài - $1')
    .replace(/Đăng bài thành công vào\s+"([^"]+)"/g, 'Đăng bài thành công - $1')
    .replace(/Đăng bài thất bại vào\s+"([^"]+)"\s*:/g, 'Đăng bài thất bại - $1:')
    .replace(/Lỗi đăng bài vào\s+"([^"]+)"\s*:/g, 'Lỗi đăng bài - $1:')
    .replace(/Đăng bài fanpage thành công vào\s+"([^"]+)"/g, 'Đăng bài fanpage thành công - $1')
    .replace(/Facebook API từ chối đăng fanpage\s+"([^"]+)"\s*:/g, 'Facebook API từ chối đăng fanpage - $1:')
    .replace(/Đăng fanpage trên giao diện thất bại\s+"([^"]+)"\s*:/g, 'Đăng fanpage trên giao diện thất bại - $1:')
    .replace(/Lỗi đăng fanpage\s+"([^"]+)"\s*:/g, 'Lỗi đăng fanpage - $1:')
    .replace(/Không chuyển được sang fanpage\s+"([^"]+)"\s*:/g, 'Không chuyển được sang fanpage - $1:')
    .replace(/Không comment được ([^:]+?) tại\s+"([^"]+)"\s*:/g, 'Không comment được $1 - $2:')
    .replace(/Đã comment vào ([^:]+?) tại\s+"([^"]+)"/g, 'Đã comment vào $1 - $2')
    .replace(/(.+?) thành công đến\s+"([^"]+)"/g, '$1 thành công - $2')
    .replace(/Lỗi (.+?)\s+"([^"]+)"\s*:/g, 'Lỗi $1 - $2:')
    .replace(/Bỏ qua kết bạn với\s+"([^"]+)"\s+\(/g, 'Bỏ qua kết bạn - $1 (')
    .replace(/Kết bạn thành công với\s+"([^"]+)"/g, 'Kết bạn thành công - $1')
    .replace(/Lỗi kết bạn\s+"([^"]+)"\s*:/g, 'Lỗi kết bạn - $1:')
    .replace(/Hoàn thành\s+"([^"]+)"/g, 'Hoàn thành - $1')
}

function cleanSeparators(text: string): string {
  return text
    .replace(/\s+-\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([:,.])/g, '$1')
    .replace(/\s+-\s*$/g, '')
    .trim()
}

function startsWithPart(text: string, part: string): boolean {
  if (!part) return false
  return text === part || text.startsWith(`${part} - `)
}

export function formatCampaignLogTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find(part => part.type === type)?.value || ''
  )

  return `${get('hour')}:${get('minute')}:${get('second')} ${get('day')}/${get('month')}/${get('year')}`
}

export function formatCampaignLogMessage(message: string, context: CampaignLogContext = {}): string {
  const accountName = normalizePart(context.accountName)
  const campaignName = normalizePart(context.campaignName)
  const { body, marker } = splitScreenshotMarker(message)

  let text = normalizePart(body)
  text = replaceCurrentCampaignText(text, campaignName, accountName)
  text = normalizeActionDataText(text)
  text = cleanSeparators(text)

  const parts: string[] = []
  if (accountName && !startsWithPart(text, accountName)) parts.push(accountName)
  if (campaignName && !startsWithPart(text, campaignName) && !startsWithPart(text, `${accountName} - ${campaignName}`)) {
    parts.push(campaignName)
  }
  if (text) parts.push(text)

  return `${parts.filter(Boolean).join(' - ')}${marker}`
}

export function formatStoredCampaignLogLine(message: string, context: CampaignLogContext = {}, date = new Date()): string {
  return `${formatCampaignLogTimestamp(date)} - ${formatCampaignLogMessage(message, context)}`
}

export function parseCampaignLogLine(line: string): ParsedCampaignLogLine | null {
  const text = String(line || '').trimEnd()
  if (!text.trim()) return null

  const legacyMatch = text.match(LEGACY_LOG_LINE_RE)
  if (legacyMatch) {
    return {
      timestamp: legacyMatch[1],
      message: legacyMatch[2] || ''
    }
  }

  const structuredMatch = text.match(STRUCTURED_LOG_LINE_RE)
  if (structuredMatch) {
    return {
      timestamp: structuredMatch[1],
      message: structuredMatch[2] || ''
    }
  }

  return { message: text.trim() }
}
