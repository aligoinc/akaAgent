/**
 * Nội dung nâng cao (advancedContentEnabled): mỗi mục là một biến thể chữ kèm tệp riêng, xoay vòng theo cùng vị trí như nội dung
 * cơ bản. Tách từ Desktop: normalizeAdvancedContentItems / selectAdvancedContentItem (src/shared/advancedContent.ts, phần lõi cần)
 * và getAdvancedContentConfigError (campaignScheduler.ts). Mục có chữ hoặc có tệp là hợp lệ (Zalo cho gửi chỉ tệp).
 */
import type { ConfigIssue } from '../validation.js'
import { isFormattedContentEmpty } from '../content/formattedContent.js'
import { hasDeclaredMediaSource, type CampaignMediaItem } from './media.js'

type JsonObject = Record<string, unknown>

export interface AdvancedContentItem {
  id: string
  content: string
  mediaOption: 'none' | 'all' | 'random'
  mediaItems: unknown[]
  randomMediaCount: number
}

const MEDIA_OPTIONS = new Set(['none', 'all', 'random'])

/** Như normalizeAdvancedContentItems: bỏ mục không phải object; mediaOption lạ → 'none'; randomMediaCount không hợp lệ → 3. */
export function advancedContentItems(extra: JsonObject): AdvancedContentItem[] {
  if (extra.advancedContentEnabled !== true || !Array.isArray(extra.advancedContentItems)) return []
  const items: AdvancedContentItem[] = []
  for (const [index, raw] of (extra.advancedContentItems as unknown[]).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as JsonObject
    const option = String(item.mediaOption || '').trim()
    const count = Math.floor(Number(item.randomMediaCount))
    items.push({
      id: String(item.id || '').trim() || `advanced-${index + 1}`,
      content: String(item.content ?? ''),
      mediaOption: MEDIA_OPTIONS.has(option) ? option as AdvancedContentItem['mediaOption'] : 'none',
      mediaItems: Array.isArray(item.mediaItems) ? item.mediaItems as unknown[] : [],
      randomMediaCount: Number.isFinite(count) && count > 0 ? count : 3
    })
  }
  return items
}

/** Như selectAdvancedContentItem: vị trí xoay vòng chia lấy dư số mục. */
export function selectAdvancedContentItem(extra: JsonObject, index: number): AdvancedContentItem | null {
  const items = advancedContentItems(extra)
  if (items.length === 0) return null
  return items[((index % items.length) + items.length) % items.length] ?? null
}

/** Tệp của một mục (resolveCampaignMediaForIndex nhánh nâng cao): 'none' mặc định; 'random' bốc lại mỗi lần gửi. */
export function selectAdvancedContentMedia(item: AdvancedContentItem | null, random: () => number = Math.random): CampaignMediaItem[] {
  if (!item || item.mediaOption === 'none') return []
  const declared = item.mediaItems.filter(hasDeclaredMediaSource)
  if (item.mediaOption !== 'random') return declared
  return [...declared].sort(() => 0.5 - random()).slice(0, Math.max(1, item.randomMediaCount || 1))
}

/**
 * Như getAdvancedContentConfigError của Desktop cho Zalo (cho phép chỉ tệp): không có mục nào, hoặc mục không chữ không tệp
 * (nội dung định dạng: chữ rỗng theo isFormattedContentEmpty). Lõi báo CFG16 một lần đầu lượt (tạm dừng chiến dịch, data về hàng đợi).
 */
export function advancedContentConfigIssue(extra: JsonObject, formatted: boolean): ConfigIssue | null {
  if (extra.advancedContentEnabled !== true) return null
  const items = advancedContentItems(extra)
  const issue = (message: string): ConfigIssue =>
    ({ errorCode: 'err_cfg_advanced_content_invalid', publicCode: 'CFG16', scope: 'campaign', field: 'advancedContentItems', message })
  if (items.length === 0) return issue('Vui lòng thêm ít nhất 1 nội dung nâng cao hoặc chuyển về chế độ Cơ bản.')
  const invalid = items.findIndex(item => {
    const hasContent = formatted ? !isFormattedContentEmpty(item.content) : item.content.trim().length > 0
    const hasMedia = item.mediaOption !== 'none' && item.mediaItems.length > 0
    return !hasContent && !hasMedia
  })
  return invalid < 0 ? null : issue(`Nội dung nâng cao số ${invalid + 1} đang rỗng. Vui lòng nhập nội dung hoặc chọn media.`)
}
