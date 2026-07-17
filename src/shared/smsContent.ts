import {
  findInvalidAdvancedContentItemIndex,
  getAdvancedContentItems,
  isAdvancedContentItemValid
} from './advancedContent'
import { renderContentSpin, renderContentSpinMax, splitContentVariants } from './contentSpin'
import { normalizeVietnamMobilePhone } from './phone'
import type { Campaign, CampaignInputData } from './types'

export interface SmsContentOptions {
  useUnicode: boolean
  keepNewLines: boolean
}

export interface SmsContentCount {
  countChar: number
  countSms: number
}

const VIETNAMESE_DIACRITIC_PATTERN = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

export function hasVietnameseDiacritics(value: string | null | undefined): boolean {
  return VIETNAMESE_DIACRITIC_PATTERN.test(String(value || ''))
}

export function stripVietnameseDiacritics(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

export function normalizeSmsContentForSend(
  content: string | null | undefined,
  options: SmsContentOptions
): string {
  let text = String(content || '')
  if (!options.useUnicode) text = stripVietnameseDiacritics(text)
  if (!options.keepNewLines) text = text.replace(/\r/g, '').replace(/\n/g, '')
  return text.trim()
}

export function countSingleSmsContent(content: string, useUnicode: boolean): SmsContentCount {
  const text = String(content || '')
  if (!text) return { countChar: 0, countSms: 0 }
  const segmentSize = useUnicode && hasVietnameseDiacritics(text) ? 70 : 160
  return {
    countChar: text.length,
    countSms: Math.ceil(text.length / segmentSize)
  }
}

export function countSmsContentVariants(
  content: string | null | undefined,
  options: SmsContentOptions
): SmsContentCount[] {
  const variants = splitContentVariants(content, { fallbackToRaw: true })
    .map(item => normalizeSmsContentForSend(renderContentSpinMax(item), options))
    .filter(Boolean)

  if (variants.length === 0) return [{ countChar: 0, countSms: 0 }]
  return variants.map(item => countSingleSmsContent(item, options.useUnicode))
}

function cycleSmsContentVariant(
  campaign: Pick<Campaign, 'content'> & { extraSettings?: Campaign['extraSettings'] },
  index: number
): string {
  if (campaign.extraSettings?.advancedContentEnabled === true) {
    const items = getAdvancedContentItems(campaign.extraSettings)
    if (items.length === 0) {
      throw new Error('Nội dung nâng cao SMS chưa có nội dung nào.')
    }
    const invalidIndex = findInvalidAdvancedContentItemIndex(items, { allowMediaOnly: false })
    if (invalidIndex >= 0) {
      throw new Error(`Nội dung nâng cao SMS số ${invalidIndex + 1} chưa có nội dung.`)
    }
    const safeIndex = ((index % items.length) + items.length) % items.length
    const item = items[safeIndex]
    return isAdvancedContentItemValid(item, { allowMediaOnly: false }) ? item.content || '' : ''
  }

  const variants = splitContentVariants(campaign.content, { fallbackToRaw: true })
  if (variants.length === 0) return ''
  const safeIndex = ((index % variants.length) + variants.length) % variants.length
  return variants[safeIndex] || ''
}

function getSmsRenderBaseDate(schedule?: string | null): Date {
  const date = schedule ? new Date(schedule) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function formatSmsTemplateDate(baseDate: Date, format: string, offsetDays = 0): string {
  const date = new Date(baseDate.getTime() + offsetDays * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const dateMap = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
  return String(format || 'DD/MM/YYYY')
    .replace(/DD/g, dateMap.day || '')
    .replace(/MM/g, dateMap.month || '')
    .replace(/YYYY/g, dateMap.year || '')
    .replace(/YY/g, (dateMap.year || '').slice(-2))
}

function getSmsContentOptions(extraSettings?: Campaign['extraSettings'] | null): SmsContentOptions {
  return {
    useUnicode: extraSettings?.smsUseUnicode ?? false,
    keepNewLines: extraSettings?.smsKeepNewLines ?? false
  }
}

/**
 * Render the immutable SMS content snapshot stored on a campaign input row.
 * Keep every SMS insertion path on this helper so variant rotation, tokens,
 * Unicode handling and newline handling cannot drift between runtimes.
 */
export function renderSmsInputContent(
  campaign: Pick<Campaign, 'content' | 'schedule' | 'originalSchedule'> & { extraSettings?: Campaign['extraSettings'] },
  row: Partial<CampaignInputData>,
  rowIndex: number,
  scheduleOverride?: string | null
): string {
  const template = renderContentSpin(cycleSmsContentVariant(campaign, rowIndex))
  if (!template) return ''
  const baseDate = getSmsRenderBaseDate(scheduleOverride || row.schedule || campaign.schedule || campaign.originalSchedule)
  const getInput = (key: keyof CampaignInputData): string => String(row[key] ?? '').trim()
  const renderPhone = (): string => normalizeVietnamMobilePhone(row.phone)
  const renderSex = (body: string): string => {
    const [male = '', female = '', unknown = ''] = String(body || '').split('-')
    return unknown || male || female
  }

  const rendered = template
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

  return normalizeSmsContentForSend(rendered, getSmsContentOptions(campaign.extraSettings))
}

/**
 * Voice-call content shares SMS token/spintax materialization, but it must
 * always preserve Vietnamese diacritics and line breaks for server-side TTS.
 */
export function renderVoiceCallInputContent(
  campaign: Pick<Campaign, 'content' | 'schedule' | 'originalSchedule'> & { extraSettings?: Campaign['extraSettings'] },
  row: Partial<CampaignInputData>,
  rowIndex: number,
  scheduleOverride?: string | null
): string {
  return renderSmsInputContent({
    ...campaign,
    extraSettings: {
      ...(campaign.extraSettings || {}),
      advancedContentEnabled: false,
      smsUseUnicode: true,
      smsKeepNewLines: true
    }
  }, row, rowIndex, scheduleOverride)
}
