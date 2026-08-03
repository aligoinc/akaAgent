import type { AuthEntitlementFeature } from './types'

export interface AuthProductCatalogItem {
  feature: AuthEntitlementFeature
  productId: number
  label: string
  order: number
}

export const AUTH_ZALO_PRODUCT_16_ID = 16 as const
export const AUTH_ZALO_PRODUCT_18_ID = 18 as const
export const AUTH_ZALO_PRODUCT_IDS = [AUTH_ZALO_PRODUCT_16_ID, AUTH_ZALO_PRODUCT_18_ID] as const

export const AUTH_PRODUCT_CATALOG: AuthProductCatalogItem[] = [
  { feature: 'facebookCore', productId: 3, label: 'Facebook', order: 1 },
  { feature: 'facebookFanpage', productId: 10, label: 'Fanpage', order: 2 },
  { feature: 'zalo', productId: AUTH_ZALO_PRODUCT_IDS[0], label: 'Zalo', order: 3 },
  { feature: 'zalo', productId: AUTH_ZALO_PRODUCT_IDS[1], label: 'Zalo', order: 3 },
  { feature: 'email', productId: 13, label: 'Email', order: 4 },
  { feature: 'sms', productId: 17, label: 'akaAgent SMS', order: 5 }
]

export const AUTH_PRODUCT_IDS = AUTH_PRODUCT_CATALOG.map(item => item.productId)

export const AUTH_PRODUCTS_BY_FEATURE = AUTH_PRODUCT_CATALOG.reduce((acc, item) => {
  acc[item.feature].push(item)
  return acc
}, {
  facebookCore: [],
  facebookFanpage: [],
  email: [],
  zalo: [],
  sms: []
} as Record<AuthEntitlementFeature, AuthProductCatalogItem[]>)

export type AuthSingleProductFeature = Exclude<AuthEntitlementFeature, 'zalo'>

// Only features with exactly one product may use this singular lookup. Zalo
// intentionally has no primary product because the newest effective row across
// products 16 and 18 determines the complete Zalo capability snapshot.
export const AUTH_PRODUCT_BY_FEATURE = AUTH_PRODUCT_CATALOG.reduce((acc, item) => {
  if (item.feature === 'zalo') return acc
  if (!acc[item.feature]) acc[item.feature] = item
  return acc
}, {} as Partial<Record<AuthSingleProductFeature, AuthProductCatalogItem>>) as Record<AuthSingleProductFeature, AuthProductCatalogItem>

export function getAuthProductById(productId: number | null | undefined): AuthProductCatalogItem | null {
  if (productId == null) return null
  return AUTH_PRODUCT_CATALOG.find(item => item.productId === productId) || null
}
