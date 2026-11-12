/**
 * Nội dung định dạng → { msg, styles } của zca-js. Logic nằm ở src/shared/zaloFormattedContent.ts (dùng chung với lõi engine v2,
 * không import zca-js; giá trị kiểu đúng enum TextStyle của zca-js 2.1.x). File này giữ kiểu Style của zca-js cho
 * zaloRuntimeService và bộ lập lịch cũ. Đối chiếu 12/11/2026: kết quả giống hệt bản cũ trên 26 nội dung định dạng thật + mẫu tổng hợp.
 */
import type { Style } from 'zca-js'
import { convertHtmlToZaloMessage as convertSharedHtmlToZaloMessage } from '../../shared/zaloFormattedContent'

export interface ZaloStyledText {
  msg: string
  styles?: Style[]
}

export type ZaloOutgoingText = string | ZaloStyledText

/**
 * Converts the sanitized TipTap HTML fragment stored by a campaign into the
 * text + UTF-16 style ranges expected by zca-js. Unknown presentation markup
 * is deliberately flattened to readable text.
 */
export function convertHtmlToZaloMessage(html: string): ZaloStyledText {
  return convertSharedHtmlToZaloMessage(html) as unknown as ZaloStyledText
}

// Keep the descriptive alias for callers that want to make the formatted
// source explicit; convertHtmlToZaloMessage is the stable scheduler contract.
export const convertFormattedHtmlToZaloMessage = convertHtmlToZaloMessage

export function extractTextFromFormattedHtml(html: string): string {
  return convertHtmlToZaloMessage(html).msg
}
