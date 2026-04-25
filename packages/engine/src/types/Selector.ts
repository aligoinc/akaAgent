export type SelectorType = 'css' | 'xpath' | 'text-match'

export interface SelectorFallback {
  type: SelectorType
  expression: string
}

export interface InlineSelector {
  kind: 'inline'
  type: SelectorType
  expression: string
  fallbacks?: SelectorFallback[]
}

export interface NamedSelectorRef {
  kind: 'named'
  name: string
}

export type SelectorRef = InlineSelector | NamedSelectorRef

export interface NamedSelector {
  id: string
  name: string
  domain?: string
  description?: string
  selectorType: SelectorType
  expression: string
  fallbacks?: SelectorFallback[]
  lastVerifiedAt?: string
  organizationId?: number
  createdBy?: number
  createdAt?: string
  updatedAt?: string
}
