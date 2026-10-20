import { applyContentAiItems, type ContentAiItem, type ContentAiPatch } from './campaignContentAi'
import { splitContentVariants, serializeContentVariants } from './contentSpin'
import { splitFormattedContentVariants, serializeFormattedContentVariants, sanitizeFormattedContent } from './formattedContent'

export function basicContentAiItems(content: string, html: boolean, subject: string | null = null): ContentAiItem[] {
  const parts = html ? splitFormattedContentVariants(content) : splitContentVariants(content)
  return (parts.length ? parts : ['']).map((part, i) => ({ content: part, emailSubject: i === 0 ? subject : null }))
}
export function applyBasicContentAiPatch(content: string, html: boolean, subject: string | null, patch: ContentAiPatch) {
  const items = basicContentAiItems(content, html, subject)
  const next = applyContentAiItems(items, patch, source => ({ ...source, emailSubject: null }), html ? sanitizeFormattedContent : undefined)
  return {
    content: patch.additions.length || patch.edits.some(edit => edit.content !== null)
      ? (html ? serializeFormattedContentVariants : serializeContentVariants)(next.map(item => item.content)) : content,
    emailSubject: next[0].emailSubject
  }
}
