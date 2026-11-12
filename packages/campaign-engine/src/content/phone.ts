export const OLD_VN_MOBILE_PREFIX_MAP: Record<string, string> = {
  '0162': '032',
  '0163': '033',
  '0164': '034',
  '0165': '035',
  '0166': '036',
  '0167': '037',
  '0168': '038',
  '0169': '039',
  '0120': '070',
  '0121': '079',
  '0122': '077',
  '0126': '076',
  '0128': '078',
  '0123': '083',
  '0124': '084',
  '0125': '085',
  '0127': '081',
  '0129': '082',
  '0186': '056',
  '0188': '058',
  '0199': '059'
}

export type VietnamMobileCarrier =
  | 'viettel'
  | 'vinaphone'
  | 'mobifone'
  | 'vietnamobile'
  | 'gmobile'
  | 'itel'
  | 'wintel'
  | 'unknown'

export const VIETNAM_MOBILE_PREFIX_CARRIER_MAP: Record<string, VietnamMobileCarrier> = {
  '032': 'viettel',
  '033': 'viettel',
  '034': 'viettel',
  '035': 'viettel',
  '036': 'viettel',
  '037': 'viettel',
  '038': 'viettel',
  '039': 'viettel',
  '086': 'viettel',
  '096': 'viettel',
  '097': 'viettel',
  '098': 'viettel',
  '081': 'vinaphone',
  '082': 'vinaphone',
  '083': 'vinaphone',
  '084': 'vinaphone',
  '085': 'vinaphone',
  '088': 'vinaphone',
  '091': 'vinaphone',
  '094': 'vinaphone',
  '070': 'mobifone',
  '076': 'mobifone',
  '077': 'mobifone',
  '078': 'mobifone',
  '079': 'mobifone',
  '089': 'mobifone',
  '090': 'mobifone',
  '093': 'mobifone',
  '052': 'vietnamobile',
  '056': 'vietnamobile',
  '058': 'vietnamobile',
  '092': 'vietnamobile',
  '059': 'gmobile',
  '099': 'gmobile',
  '087': 'itel',
  '055': 'wintel'
}

const VIETNAM_MOBILE_CARRIER_LABELS: Record<VietnamMobileCarrier, string> = {
  viettel: 'Viettel',
  vinaphone: 'VinaPhone',
  mobifone: 'MobiFone',
  vietnamobile: 'Vietnamobile',
  gmobile: 'Gmobile',
  itel: 'iTel',
  wintel: 'Wintel',
  unknown: 'Không xác định'
}

export function phoneInputText(value: unknown): string {
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

export function normalizeVietnamMobilePhone(value: unknown): string {
  let digits = phoneInputText(value).replace(/\D+/g, '')
  if (!digits) return ''

  if (digits.startsWith('0084') && digits.length >= 13) {
    digits = `0${digits.slice(4)}`
  } else if (digits.startsWith('84') && digits.length >= 11) {
    digits = `0${digits.slice(2)}`
  }
  if (digits.length === 9 && /^[35789]/.test(digits)) {
    digits = `0${digits}`
  }
  if (digits.length === 10) {
    const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[`0${digits.slice(0, 3)}`]
    if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(3)}`
  }
  if (digits.length === 11) {
    const mappedPrefix = OLD_VN_MOBILE_PREFIX_MAP[digits.slice(0, 4)]
    if (mappedPrefix) digits = `${mappedPrefix}${digits.slice(4)}`
  }

  return /^0[35789]\d{8}$/.test(digits) ? digits : ''
}

export function getVietnamMobileCarrier(value: unknown): VietnamMobileCarrier | '' {
  const phone = normalizeVietnamMobilePhone(value)
  if (!phone) return ''
  return VIETNAM_MOBILE_PREFIX_CARRIER_MAP[phone.slice(0, 3)] || 'unknown'
}

export function getVietnamMobileCarrierLabel(value?: VietnamMobileCarrier | string | null): string {
  if (!value) return ''
  return VIETNAM_MOBILE_CARRIER_LABELS[value as VietnamMobileCarrier] || String(value)
}
