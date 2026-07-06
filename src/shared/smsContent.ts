import { renderContentSpinMax, splitContentVariants } from './contentSpin'

export interface SmsContentOptions {
  useUnicode: boolean
  keepNewLines: boolean
}

export interface SmsContentCount {
  countChar: number
  countSms: number
}

const VIETNAMESE_DIACRITIC_PATTERN = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/

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
