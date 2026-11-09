import { renderContentSpin, splitContentVariants } from './contentSpin'
import { normalizeVietnamMobilePhone } from './phone'
import { normalizeSmsContentForSend } from './smsContent'

/**
 * Cùng luật với `renderSmsInputContent` (`smsContent.ts`, Desktop/main dựng sẵn nội dung SMS cho từng
 * dòng data; API WebApp dùng bản giống hệt). Bản này thêm tham số `rng` để khung xem trước giữ nguyên
 * lựa chọn spin; `scripts/recipient-preview-smoke.cjs` so từng byte với `renderSmsInputContent`.
 * Chép theo akaAgentWebApp `packages/campaign-core/src/smsRecipientContent.ts` (chỉ đổi API spin của Desktop).
 */
export interface SmsRecipientCampaign {
  content: string
  schedule?: string | null
  originalSchedule?: string | null
  extraSettings: Record<string, unknown>
}

export interface SmsRecipientRow {
  name?: string | null
  phone?: string | null
  uid?: string | null
  email?: string | null
  info1?: string | null
  info2?: string | null
  info3?: string | null
  info4?: string | null
  info5?: string | null
  schedule?: string | null
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const positiveModulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

const nullableText = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized || null
}

/** Biến thể SMS đúng thứ tự API dùng: nâng cao theo mục, cơ bản tách `|` ngoài cùng. */
export function smsRecipientVariants(campaign: SmsRecipientCampaign): string[] {
  if (campaign.extraSettings.advancedContentEnabled === true) {
    const items = Array.isArray(campaign.extraSettings.advancedContentItems)
      ? campaign.extraSettings.advancedContentItems
      : []
    return items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => String(item.content ?? ''))
  }
  return splitContentVariants(campaign.content, { fallbackToRaw: true }).filter(Boolean)
}

/** Dòng thứ `rowIndex` (0-based, theo thứ tự `id`) nhận biến thể này. */
export function smsRecipientVariantIndex(rowIndex: number, variantCount: number): number {
  return variantCount > 0 ? positiveModulo(Math.floor(rowIndex), variantCount) : 0
}

export function smsRenderBaseDate(schedule?: string | null): Date {
  const date = schedule ? new Date(schedule) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

export function formatSmsTemplateDate(baseDate: Date, format: string, offsetDays = 0): string {
  const date = new Date(baseDate.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const dateMap = Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>
  return String(format || 'DD/MM/YYYY')
    .replace(/DD/g, dateMap.day || '')
    .replace(/MM/g, dateMap.month || '')
    .replace(/YYYY/g, dateMap.year || '')
    .replace(/YY/g, (dateMap.year || '').slice(-2))
}

/** Điền biến SMS: tên trong data thay mọi biến tên; không biết giới tính nên SEX lấy vế thứ ba. */
export function renderSmsTemplateTokens(template: string, row: SmsRecipientRow, baseDate: Date): string {
  const getInput = (key: keyof SmsRecipientRow): string => String(row[key] ?? '').trim()
  const renderPhone = (): string => normalizeVietnamMobilePhone(row.phone)
  const renderSex = (body: string): string => {
    const [male = '', female = '', unknown = ''] = String(body || '').split('-')
    return unknown || male || female
  }
  return template
    .replace(/#\{(TODAY|TOMORROW|YESTERDAY)\(([^}]*)\)\}/g, (_, token, fmt) => {
      const offsetDays = token === 'TOMORROW' ? 1 : token === 'YESTERDAY' ? -1 : 0
      return formatSmsTemplateDate(baseDate, String(fmt || 'DD/MM/YYYY'), offsetDays)
    })
    .replace(/#\{SEX\{([^}]*)\}\}/g, (_, body) => renderSex(String(body || '')))
    .replace(/#\{FULL_NAME\}/g, getInput('name'))
    .replace(/#\{ORIGINAL_NAME\}/g, getInput('name'))
    .replace(/#\{INPUT_FULLNAME\}/g, getInput('name'))
    .replace(/#\{UID\}/g, getInput('uid'))
    .replace(/#\{PHONE\}/g, renderPhone())
    .replace(/#\{MOBILE\}/g, renderPhone())
    .replace(/#\{EMAIL\}/g, getInput('email'))
    .replace(/#\{INFO1\}/g, getInput('info1'))
    .replace(/#\{INFO2\}/g, getInput('info2'))
    .replace(/#\{INFO3\}/g, getInput('info3'))
    .replace(/#\{INFO4\}/g, getInput('info4'))
    .replace(/#\{INFO5\}/g, getInput('info5'))
}

/** Nội dung SMS khách nhận cho một dòng data, như API dựng khi thêm data. */
export function renderSmsRecipientContent(
  campaign: SmsRecipientCampaign,
  row: SmsRecipientRow,
  rowIndex: number,
  options: { rng?: () => number; scheduleOverride?: string | null } = {},
): string {
  const variants = smsRecipientVariants(campaign)
  const raw = variants.length ? variants[smsRecipientVariantIndex(rowIndex, variants.length)] || '' : ''
  const template = renderContentSpin(raw, { rng: options.rng })
  if (!template) return ''
  const baseDate = smsRenderBaseDate(
    options.scheduleOverride || nullableText(row.schedule) || campaign.schedule || campaign.originalSchedule,
  )
  return normalizeSmsContentForSend(renderSmsTemplateTokens(template, row, baseDate), {
    useUnicode: campaign.extraSettings.smsUseUnicode === true,
    keepNewLines: campaign.extraSettings.smsKeepNewLines === true,
  })
}
