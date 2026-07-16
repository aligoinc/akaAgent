import type {
  CampaignMediaSnapshot,
  ContentTemplate,
  ContentTemplateChannelName
} from '../../../../shared/types'
import { splitContentVariants } from '../../../../shared/contentSpin'
import {
  isFormattedContentEmpty,
  sanitizeFormattedContent,
  splitFormattedContentVariants
} from '../../../../shared/formattedContent'

export interface ResolvedContentTemplate {
  variants: string[]
  rich: boolean
  source: 'channel' | 'base'
  subject?: string
  isHtml?: boolean
}

const getEnabledChannelVariants = (
  template: ContentTemplate,
  channelName: ContentTemplateChannelName
): string[] => {
  const channel = template.channels[channelName]
  if (!channel?.enabled) return []
  return (channel.variants || [])
    .map(variant => String(variant?.text || '').trim())
    .filter(Boolean)
}

export const resolveContentTemplate = (
  template: ContentTemplate,
  channelName: ContentTemplateChannelName
): ResolvedContentTemplate => {
  const channel = template.channels[channelName]
  const channelVariants = getEnabledChannelVariants(template, channelName)
  if (channel && channelVariants.length > 0) {
    const rich = channelName === 'email'
      ? channel.isHtml === true
      : channel.formattedContentEnabled === true
    return {
      variants: rich
        ? channelVariants
          .map(variant => sanitizeFormattedContent(variant))
          .filter(variant => !isFormattedContentEmpty(variant))
        : channelVariants,
      rich,
      source: 'channel',
      subject: channelName === 'email' ? String(channel.subject || '') : undefined,
      isHtml: channelName === 'email' ? channel.isHtml === true : undefined
    }
  }

  const baseHtml = String(template.baseContentHtml || '').trim()
  if (baseHtml) {
    return {
      variants: splitFormattedContentVariants(baseHtml),
      rich: true,
      source: 'base',
      isHtml: channelName === 'email'
    }
  }

  return {
    variants: splitContentVariants(template.content, { fallbackToRaw: true }),
    rich: false,
    source: 'base',
    isHtml: false
  }
}

const inferImageMimeType = (url: string): string => {
  const clean = url.split(/[?#]/, 1)[0].toLowerCase()
  if (/\.png$/.test(clean)) return 'image/png'
  if (/\.gif$/.test(clean)) return 'image/gif'
  if (/\.webp$/.test(clean)) return 'image/webp'
  if (/\.avif$/.test(clean)) return 'image/avif'
  if (/\.svg$/.test(clean)) return 'image/svg+xml'
  return 'image/jpeg'
}

const getImageName = (url: string, index: number): string => {
  try {
    const pathname = new URL(url).pathname
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '')
    return name || `Ảnh mẫu ${index + 1}`
  } catch {
    return `Ảnh mẫu ${index + 1}`
  }
}

export const contentTemplateImagesToSnapshots = (
  imageUrls: string[]
): { snapshots: CampaignMediaSnapshot[]; invalidCount: number } => {
  let invalidCount = 0
  const snapshots = Array.from(new Set(imageUrls.map(url => String(url || '').trim()).filter(Boolean)))
    .flatMap((url, index) => {
      if (!/^https?:\/\//i.test(url)) {
        invalidCount += 1
        return []
      }
      return [{
        name: getImageName(url, index),
        localPath: null,
        cloudUrl: url,
        mimeType: inferImageMimeType(url),
        sizeBytes: null,
        provider: 'content-template'
      }]
    })
  return { snapshots, invalidCount }
}

export const getContentTemplateSearchText = (template: ContentTemplate): string => {
  const channelText = Object.values(template.channels)
    .flatMap(channel => channel?.variants || [])
    .map(variant => variant.text)
    .join('\n')
  return `${template.name}\n${template.groupName || ''}\n${template.content}\n${channelText}`.toLocaleLowerCase('vi-VN')
}
