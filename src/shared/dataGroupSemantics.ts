import type { ContactDatasetScanType, ContactType, DataTypeCategoryCode } from './types'

const DATA_SCAN_ACTION_TYPE_CODES: Readonly<Record<string, DataTypeCategoryCode>> = {
  facebook_friends: 'facebook_person',
  facebook_groups: 'facebook_group',
  facebook_pages: 'facebook_page',
  facebook_post_commenters: 'facebook_person',
  facebook_post_likes: 'facebook_person',
  facebook_profile_friends: 'facebook_person',
  facebook_group_members: 'facebook_person',
  facebook_page_inbox_customers: 'facebook_page_inbox_customer',
  zalo_friends: 'zalo_person',
  zalo_groups: 'zalo_group',
  zalo_group_members: 'zalo_person',
  zalo_remarketing_customers: 'zalo_person'
}

const CONTACT_DATASET_SCAN_TYPE_CODES: Partial<Record<ContactDatasetScanType, DataTypeCategoryCode>> = {
  facebook_group_members: 'facebook_person',
  facebook_profile_friends: 'facebook_person',
  facebook_post_commenters: 'facebook_person',
  facebook_post_likes: 'facebook_person',
  zalo_group_members: 'zalo_person'
}

export const getDataScanActionTypeCode = (action: string | null | undefined): DataTypeCategoryCode | null => (
  action ? DATA_SCAN_ACTION_TYPE_CODES[action] || null : null
)

export const getContactDatasetScanTypeCode = (
  scanType: ContactDatasetScanType | null | undefined
): DataTypeCategoryCode | null => (
  scanType ? CONTACT_DATASET_SCAN_TYPE_CODES[scanType] || null : null
)

export const inferDataTypeCodeFromContact = (
  flatformType: string | null | undefined,
  contactType: ContactType | null | undefined
): DataTypeCategoryCode | null => {
  const platform = String(flatformType || '').trim().toLowerCase()
  if (contactType === 'phone') return 'phone'
  if (contactType === 'email') return 'email'
  if (platform === 'facebook') {
    if (contactType === 'person') return 'facebook_person'
    if (contactType === 'group') return 'facebook_group'
    if (contactType === 'page') return 'facebook_page'
    if (contactType === 'page_inbox_customer') return 'facebook_page_inbox_customer'
  }
  if (platform === 'zalo') {
    if (contactType === 'person') return 'zalo_person'
    if (contactType === 'group') return 'zalo_group'
  }
  return null
}

export const getContactTypeForDataTypeCode = (
  code: DataTypeCategoryCode | string | null | undefined
): ContactType | null => {
  if (code === 'phone') return 'phone'
  if (code === 'email') return 'email'
  if (code === 'facebook_person' || code === 'zalo_person') return 'person'
  if (code === 'facebook_group' || code === 'zalo_group') return 'group'
  if (code === 'facebook_page') return 'page'
  if (code === 'facebook_page_inbox_customer') return 'page_inbox_customer'
  return null
}

export const isDataGroupTypeCompatible = (
  groupTypeCode: string | null | undefined,
  targetTypeCode: string | null | undefined
): boolean => !groupTypeCode || (!!targetTypeCode && groupTypeCode === targetTypeCode)

export const getDataTypeDisplayName = (
  code: string | null | undefined,
  fallback?: string | null
): string => {
  if (fallback?.trim()) return fallback.trim()
  const labels: Record<string, string> = {
    phone: 'Số điện thoại',
    email: 'Email',
    facebook_search_keyword: 'Facebook · Từ khóa tìm kiếm',
    facebook_post_url: 'Facebook · Link bài viết',
    facebook_person: 'Facebook · User',
    facebook_group: 'Facebook · Group',
    facebook_page: 'Facebook · Page',
    facebook_page_inbox_customer: 'Facebook · Khách inbox Page',
    zalo_person: 'Zalo · User',
    zalo_group: 'Zalo · Group'
  }
  return code ? labels[code] || code : 'Mọi loại dữ liệu'
}
