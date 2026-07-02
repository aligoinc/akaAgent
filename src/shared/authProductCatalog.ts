import type { AuthEntitlementFeature } from './types'

export interface AuthProductCatalogItem {
  feature: AuthEntitlementFeature
  productId: number
  label: string
  order: number
}

export const AUTH_PRODUCT_CATALOG: AuthProductCatalogItem[] = [
  { feature: 'facebookCore', productId: 3, label: 'Facebook', order: 1 },
  { feature: 'facebookFanpage', productId: 10, label: 'Fanpage', order: 2 },
  { feature: 'zalo', productId: 16, label: 'Zalo', order: 3 },
  { feature: 'email', productId: 13, label: 'Email', order: 4 },
  { feature: 'sms', productId: 17, label: 'akaAgent SMS', order: 5 }
]

export const AUTH_PRODUCT_IDS = AUTH_PRODUCT_CATALOG.map(item => item.productId)

export const AUTH_PRODUCT_BY_FEATURE = AUTH_PRODUCT_CATALOG.reduce((acc, item) => {
  acc[item.feature] = item
  return acc
}, {} as Record<AuthEntitlementFeature, AuthProductCatalogItem>)

export function getAuthProductById(productId: number | null | undefined): AuthProductCatalogItem | null {
  if (productId == null) return null
  return AUTH_PRODUCT_CATALOG.find(item => item.productId === productId) || null
}
