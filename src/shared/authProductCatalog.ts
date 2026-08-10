import type { AuthEntitlementFeature } from './types'

export interface AuthProductCatalogItem {
  feature: AuthEntitlementFeature
  productId: number
  label: string
  order: number
}

export const AUTH_FACEBOOK_CORE_PRODUCT_ID = 3 as const
export const AUTH_FACEBOOK_FANPAGE_PRODUCT_ID = 10 as const
export const AUTH_FACEBOOK_PRODUCT_IDS = [
  AUTH_FACEBOOK_CORE_PRODUCT_ID,
  AUTH_FACEBOOK_FANPAGE_PRODUCT_ID
] as const
export const AUTH_ZALO_PRODUCT_16_ID = 16 as const
export const AUTH_ZALO_PRODUCT_18_ID = 18 as const
export const AUTH_ZALO_PRODUCT_IDS = [AUTH_ZALO_PRODUCT_16_ID, AUTH_ZALO_PRODUCT_18_ID] as const

export const AUTH_PRODUCT_CATALOG: AuthProductCatalogItem[] = [
  { feature: 'facebookCore', productId: AUTH_FACEBOOK_CORE_PRODUCT_ID, label: 'Facebook', order: 1 },
  { feature: 'facebookFanpage', productId: AUTH_FACEBOOK_FANPAGE_PRODUCT_ID, label: 'Facebook', order: 1 },
  { feature: 'zalo', productId: AUTH_ZALO_PRODUCT_IDS[0], label: 'Zalo', order: 3 },
  { feature: 'zalo', productId: AUTH_ZALO_PRODUCT_IDS[1], label: 'Zalo', order: 3 },
  { feature: 'email', productId: 13, label: 'Email', order: 4 },
  { feature: 'sms', productId: 17, label: 'akaAgent SMS', order: 5 }
]

export const AUTH_PRODUCT_IDS = AUTH_PRODUCT_CATALOG.map(item => item.productId)

const AUTH_PHYSICAL_PRODUCTS_BY_FEATURE = AUTH_PRODUCT_CATALOG.reduce((acc, item) => {
  acc[item.feature].push(item)
  return acc
}, {
  facebookCore: [],
  facebookFanpage: [],
  email: [],
  zalo: [],
  sms: []
} as Record<AuthEntitlementFeature, AuthProductCatalogItem[]>)

const facebookProducts = AUTH_PRODUCT_CATALOG.filter(item => (
  AUTH_FACEBOOK_PRODUCT_IDS.some(productId => productId === item.productId)
))

// Effective entitlement lookup. Product 3 and Product 10 are physical source
// rows for the same Facebook access, so both compatibility aliases resolve the
// complete shared product set.
export const AUTH_PRODUCTS_BY_FEATURE: Record<AuthEntitlementFeature, AuthProductCatalogItem[]> = {
  ...AUTH_PHYSICAL_PRODUCTS_BY_FEATURE,
  facebookCore: [...facebookProducts],
  facebookFanpage: [...facebookProducts]
}

export type AuthSingleProductFeature = Exclude<
  AuthEntitlementFeature,
  'facebookCore' | 'facebookFanpage' | 'zalo'
>

function isSingleProductFeature(feature: AuthEntitlementFeature): feature is AuthSingleProductFeature {
  return feature === 'email' || feature === 'sms'
}

// Only features with exactly one effective product may use this singular
// lookup. Facebook and Zalo intentionally require their grouped product IDs.
export const AUTH_PRODUCT_BY_FEATURE = AUTH_PRODUCT_CATALOG.reduce((acc, item) => {
  if (!isSingleProductFeature(item.feature)) return acc
  if (!acc[item.feature]) acc[item.feature] = item
  return acc
}, {} as Partial<Record<AuthSingleProductFeature, AuthProductCatalogItem>>) as Record<AuthSingleProductFeature, AuthProductCatalogItem>

export function getAuthProductById(productId: number | null | undefined): AuthProductCatalogItem | null {
  if (productId == null) return null
  return AUTH_PRODUCT_CATALOG.find(item => item.productId === productId) || null
}
