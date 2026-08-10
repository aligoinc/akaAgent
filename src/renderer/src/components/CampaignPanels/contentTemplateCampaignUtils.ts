import type {
  CampaignAdvancedContentItem,
  CampaignMediaSnapshot,
  ContentTemplate,
  ContentTemplateChannelConfig,
  ContentTemplateChannelName,
  ContentTemplateGroup
} from '../../../../shared/types'
import {
  isFormattedContentEmpty,
  plainTextToFormattedContent,
  sanitizeFormattedContent
} from '../../../../shared/formattedContent'
import {
  runtimeMediaSourceMatchesSelectionMode,
  type MediaSelectionMode
} from '../../../../shared/mediaTypes'

export interface ResolvedContentTemplate {
  variants: string[]
  variantIndexes: number[]
  rich: boolean
  subject?: string
  imageUrls: string[]
  skippedVariantCount: number
}

export interface ContentTemplateGroupCandidate {
  groupId: number
  groupName: string
  totalTemplateCount: number
  compatibleTemplateCount: number
  variantCount: number
  skippedTemplateCount: number
  skippedVariantCount: number
  invalidMediaCount: number
  rich: boolean
  items: CampaignAdvancedContentItem[]
}

export const isRichContentTemplateChannel = (
  channelName: ContentTemplateChannelName,
  channel?: ContentTemplateChannelConfig
): boolean => {
  if (channelName === 'email') return channel?.isHtml === true
  if (channelName === 'zalo_message' || channelName === 'facebook_post') {
    return channel?.formattedContentEnabled === true
  }
  return false
}

export const getContentTemplateChannelLabel = (channelName: ContentTemplateChannelName): string => {
  const labels: Record<ContentTemplateChannelName, string> = {
    sms: 'SMS',
    zalo_message: 'Tin nhắn Zalo',
    facebook_post: 'Đăng bài Facebook',
    facebook_message: 'Tin nhắn Facebook',
    facebook_comment: 'Comment Facebook',
    email: 'Email'
  }
  return labels[channelName]
}

const normalizeExactChannelVariants = (
  template: ContentTemplate,
  channelName: ContentTemplateChannelName
): { variants: string[]; variantIndexes: number[]; skippedVariantCount: number } => {
  const channel = template.channels[channelName]
  if (!channel?.enabled) return { variants: [], variantIndexes: [], skippedVariantCount: 0 }

  const rich = isRichContentTemplateChannel(channelName, channel)
  let skippedVariantCount = 0
  const variantIndexes: number[] = []
  const variants = (channel.variants || []).flatMap((variant, variantIndex) => {
    const raw = String(variant?.text || '')
    if (rich) {
      const sanitized = sanitizeFormattedContent(raw)
      if (isFormattedContentEmpty(sanitized)) {
        skippedVariantCount += 1
        return []
      }
      variantIndexes.push(variantIndex)
      return [sanitized]
    }

    const text = raw.trim()
    if (!text) {
      skippedVariantCount += 1
      return []
    }
    variantIndexes.push(variantIndex)
    return [text]
  })

  return { variants, variantIndexes, skippedVariantCount }
}

export const resolveContentTemplate = (
  template: ContentTemplate,
  channelName: ContentTemplateChannelName
): ResolvedContentTemplate => {
  const channel = template.channels[channelName]
  const normalized = normalizeExactChannelVariants(template, channelName)
  const subject = channelName === 'email' ? String(channel?.subject || '').trim() : undefined

  // Email templates without a subject are not compatible with email campaigns.
  const variants = channelName === 'email' && !subject ? [] : normalized.variants
  const variantIndexes = variants.length > 0 ? normalized.variantIndexes : []
  return {
    variants,
    variantIndexes,
    rich: isRichContentTemplateChannel(channelName, channel),
    subject,
    imageUrls: channel?.enabled ? (channel.imageUrls || []) : [],
    skippedVariantCount: normalized.skippedVariantCount
  }
}

const inferMediaMimeType = (url: string): string => {
  const clean = url.split(/[?#]/, 1)[0].toLowerCase()
  if (/\.mp4$|\.m4v$/.test(clean)) return 'video/mp4'
  if (/\.mov$/.test(clean)) return 'video/quicktime'
  if (/\.webm$/.test(clean)) return 'video/webm'
  if (/\.avi$/.test(clean)) return 'video/x-msvideo'
  if (/\.mpe?g$|\.mpg$/.test(clean)) return 'video/mpeg'
  if (/\.mkv$/.test(clean)) return 'video/x-matroska'
  if (/\.ogv$/.test(clean)) return 'video/ogg'
  if (/\.wmv$/.test(clean)) return 'video/x-ms-wmv'
  if (/\.3gp$/.test(clean)) return 'video/3gpp'
  if (/\.3g2$/.test(clean)) return 'video/3gpp2'
  if (/\.m2ts$/.test(clean)) return 'video/mp2t'
  if (/\.png$/.test(clean)) return 'image/png'
  if (/\.gif$/.test(clean)) return 'image/gif'
  if (/\.webp$/.test(clean)) return 'image/webp'
  if (/\.avif$/.test(clean)) return 'image/avif'
  if (/\.svg$/.test(clean)) return 'image/svg+xml'
  if (/\.jpe?g$/.test(clean)) return 'image/jpeg'
  return ''
}

const getMediaName = (url: string, index: number): string => {
  try {
    const pathname = new URL(url).pathname
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
    return name || `Media mẫu ${index + 1}`
  } catch {
    return `Media mẫu ${index + 1}`
  }
}

export const contentTemplateImagesToSnapshots = (
  imageUrls: string[],
  mode: MediaSelectionMode = 'image'
): { snapshots: CampaignMediaSnapshot[]; invalidCount: number } => {
  let invalidCount = 0
  const snapshots = Array.from(new Set(imageUrls.map(url => String(url || '').trim()).filter(Boolean)))
    .flatMap((url, index) => {
      if (!/^https?:\/\//i.test(url)) {
        invalidCount += 1
        return []
      }
      const mimeType = inferMediaMimeType(url)
      const name = getMediaName(url, index)
      if (!runtimeMediaSourceMatchesSelectionMode(mode, {
        cloudUrl: url,
        name,
        mimeType
      })) {
        invalidCount += 1
        return []
      }
      return [{
        name,
        localPath: null,
        cloudUrl: url,
        mimeType,
        sizeBytes: null,
        provider: 'content-template'
      }]
    })
  return { snapshots, invalidCount }
}

const getChannelMediaLimit = (channelName: ContentTemplateChannelName): number => {
  if (channelName === 'sms') return 0
  return 10
}

export const buildContentTemplateGroupCandidate = (
  templates: ContentTemplate[],
  group: Pick<ContentTemplateGroup, 'id' | 'name'>,
  channelName: ContentTemplateChannelName,
  mediaMode: MediaSelectionMode = channelName === 'facebook_post' || channelName === 'facebook_message' || channelName === 'facebook_comment'
    ? 'image-video'
    : 'image'
): ContentTemplateGroupCandidate => {
  const groupTemplates = templates.filter(template => template.groupId === group.id && !template.isDelete)
  const items: CampaignAdvancedContentItem[] = []
  const richItemIds = new Set<string>()
  let compatibleTemplateCount = 0
  let skippedTemplateCount = 0
  let skippedVariantCount = 0
  let invalidMediaCount = 0
  const mediaLimit = getChannelMediaLimit(channelName)

  for (const template of groupTemplates) {
    const resolved = resolveContentTemplate(template, channelName)
    skippedVariantCount += resolved.skippedVariantCount
    if (resolved.variants.length === 0) {
      skippedTemplateCount += 1
      continue
    }

    const media = mediaLimit > 0
      ? contentTemplateImagesToSnapshots(resolved.imageUrls, mediaMode)
      : { snapshots: [] as CampaignMediaSnapshot[], invalidCount: 0 }
    invalidMediaCount += media.invalidCount
    const snapshots = media.snapshots.slice(0, mediaLimit)
    if (mediaMode === 'video' && snapshots.length === 0) {
      skippedTemplateCount += 1
      continue
    }
    compatibleTemplateCount += 1

    resolved.variants.forEach((content, variantIndex) => {
      const id = `template-${template.id}-variant-${variantIndex + 1}`
      if (resolved.rich) richItemIds.add(id)
      items.push({
        id,
        content,
        mediaOption: snapshots.length > 1 && (channelName === 'facebook_comment' || mediaMode === 'video')
          ? 'random'
          : snapshots.length > 0 ? 'all' : 'none',
        mediaItems: snapshots,
        randomMediaCount: channelName === 'facebook_comment' || mediaMode === 'video' ? 1 : 3,
        ...(channelName === 'email' ? { emailSubject: resolved.subject || '' } : {}),
        sourceTemplateId: template.id,
        sourceTemplateName: template.name,
        sourceVariantIndex: resolved.variantIndexes[variantIndex] ?? variantIndex
      })
    })
  }

  const rich = richItemIds.size > 0
  const normalizedItems = rich
    ? items.map(item => richItemIds.has(item.id)
      ? item
      : { ...item, content: plainTextToFormattedContent(item.content) })
    : items

  return {
    groupId: group.id,
    groupName: group.name,
    totalTemplateCount: groupTemplates.length,
    compatibleTemplateCount,
    variantCount: normalizedItems.length,
    skippedTemplateCount,
    skippedVariantCount,
    invalidMediaCount,
    rich,
    items: normalizedItems
  }
}

export const getContentTemplateSearchText = (template: ContentTemplate): string => {
  const channelText = Object.values(template.channels)
    .flatMap(channel => [
      String(channel?.subject || ''),
      ...(channel?.variants || []).map(variant => variant.text)
    ])
    .join('\n')
  return `${template.name}\n${template.groupName || ''}\n${channelText}`.toLocaleLowerCase('vi-VN')
}
