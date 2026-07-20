import type { CampaignAdvancedContentItem, CampaignExtraSettings, CampaignMediaInput } from './types'

export type AdvancedContentMediaOption = NonNullable<CampaignAdvancedContentItem['mediaOption']>

export interface AdvancedContentValidationOptions {
  allowMediaOnly?: boolean
  contentIsEmpty?: (content: string) => boolean
}

const MEDIA_OPTIONS = new Set<AdvancedContentMediaOption>(['none', 'all', 'random'])

const normalizeMediaOption = (value: unknown): AdvancedContentMediaOption => {
  const option = String(value || '').trim()
  return MEDIA_OPTIONS.has(option as AdvancedContentMediaOption)
    ? option as AdvancedContentMediaOption
    : 'none'
}

const normalizeRandomMediaCount = (value: unknown): number => {
  const count = Math.floor(Number(value))
  return Number.isFinite(count) && count > 0 ? count : 3
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const normalizeAdvancedContentItems = (items: unknown): CampaignAdvancedContentItem[] => {
  if (!Array.isArray(items)) return []

  return items
    .map((item, index): CampaignAdvancedContentItem | null => {
      if (!isObjectRecord(item)) return null
      const id = String(item.id || '').trim() || `advanced-${index + 1}`
      const mediaOption = normalizeMediaOption(item.mediaOption)
      const mediaItems = Array.isArray(item.mediaItems)
        ? item.mediaItems as CampaignMediaInput[]
        : []
      const normalizedItem: CampaignAdvancedContentItem = {
        id,
        content: String(item.content ?? ''),
        mediaOption,
        mediaItems,
        randomMediaCount: normalizeRandomMediaCount(item.randomMediaCount)
      }

      // These fields are immutable snapshot metadata. Runtime deliberately
      // does not dereference sourceTemplateId; preserving it here only keeps
      // campaign edit/view round-trips lossless.
      if (item.emailSubject !== undefined && item.emailSubject !== null) {
        normalizedItem.emailSubject = String(item.emailSubject)
      }
      const sourceTemplateId = Math.floor(Number(item.sourceTemplateId))
      if (Number.isSafeInteger(sourceTemplateId) && sourceTemplateId > 0) {
        normalizedItem.sourceTemplateId = sourceTemplateId
      }
      if (item.sourceTemplateName !== undefined && item.sourceTemplateName !== null) {
        normalizedItem.sourceTemplateName = String(item.sourceTemplateName)
      }
      if (item.sourceVariantIndex !== undefined && item.sourceVariantIndex !== null) {
        const sourceVariantIndex = Math.floor(Number(item.sourceVariantIndex))
        if (Number.isSafeInteger(sourceVariantIndex) && sourceVariantIndex >= 0) {
          normalizedItem.sourceVariantIndex = sourceVariantIndex
        }
      }

      return normalizedItem
    })
    .filter((item): item is CampaignAdvancedContentItem => Boolean(item))
}

export const isAdvancedContentItemUsable = (item: CampaignAdvancedContentItem): boolean => {
  return isAdvancedContentItemValid(item)
}

export const isAdvancedContentItemValid = (
  item: CampaignAdvancedContentItem,
  options: AdvancedContentValidationOptions = {}
): boolean => {
  const content = String(item.content || '')
  const hasContent = options.contentIsEmpty
    ? !options.contentIsEmpty(content)
    : content.trim().length > 0
  const hasMedia = item.mediaOption !== 'none' && Array.isArray(item.mediaItems) && item.mediaItems.length > 0
  const allowMediaOnly = options.allowMediaOnly ?? true
  return hasContent || (allowMediaOnly && hasMedia)
}

export const findInvalidAdvancedContentItemIndex = (
  items: CampaignAdvancedContentItem[],
  options: AdvancedContentValidationOptions = {}
): number => items.findIndex(item => !isAdvancedContentItemValid(item, options))

export const getAdvancedContentItems = (
  extraSettings: Pick<CampaignExtraSettings, 'advancedContentEnabled' | 'advancedContentItems'> | undefined | null
): CampaignAdvancedContentItem[] => {
  if (extraSettings?.advancedContentEnabled !== true) return []
  return normalizeAdvancedContentItems(extraSettings.advancedContentItems)
}

export const getUsableAdvancedContentItems = (
  extraSettings: Pick<CampaignExtraSettings, 'advancedContentEnabled' | 'advancedContentItems'> | undefined | null
): CampaignAdvancedContentItem[] => {
  if (extraSettings?.advancedContentEnabled !== true) return []
  return normalizeAdvancedContentItems(extraSettings.advancedContentItems)
    .filter(isAdvancedContentItemUsable)
}

export const selectAdvancedContentItem = (
  extraSettings: Pick<CampaignExtraSettings, 'advancedContentEnabled' | 'advancedContentItems'> | undefined | null,
  index: number
): CampaignAdvancedContentItem | null => {
  const items = getAdvancedContentItems(extraSettings)
  if (items.length === 0) return null
  const safeIndex = ((index % items.length) + items.length) % items.length
  return items[safeIndex] || null
}
