import { TextStyle } from 'zca-js'
import type { Style } from 'zca-js'
import { parseDocument } from 'htmlparser2'
import { getFormattedContentIndentLevel } from '../../shared/formattedContent'

export interface ZaloStyledText {
  msg: string
  styles?: Style[]
}

export type ZaloOutgoingText = string | ZaloStyledText

interface HtmlNodeLike {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string | undefined>
  children?: HtmlNodeLike[]
}

interface PendingStyle {
  start: number
  end: number
  st: TextStyle
  indentSize?: number
}

interface RenderContext {
  suppressBlockBoundary?: boolean
  preserveWhitespace?: boolean
  listDepth?: number
}

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'div',
  'footer',
  'header',
  'main',
  'nav',
  'p',
  'pre',
  'section'
])

const IGNORED_TAGS = new Set(['script', 'style', 'noscript', 'template'])

/**
 * Converts the sanitized TipTap HTML fragment stored by a campaign into the
 * text + UTF-16 style ranges expected by zca-js. Unknown presentation markup
 * is deliberately flattened to readable text.
 */
export function convertHtmlToZaloMessage(html: string): ZaloStyledText {
  const document = parseDocument(String(html || ''), {
    decodeEntities: true,
    lowerCaseAttributeNames: true,
    lowerCaseTags: true,
    recognizeSelfClosing: true
  }) as unknown as HtmlNodeLike
  const renderer = new ZaloHtmlRenderer()
  renderer.renderChildren(document.children, {})
  return renderer.finish()
}

// Keep the descriptive alias for callers that want to make the formatted
// source explicit; convertHtmlToZaloMessage is the stable scheduler contract.
export const convertFormattedHtmlToZaloMessage = convertHtmlToZaloMessage

export function extractTextFromFormattedHtml(html: string): string {
  return convertHtmlToZaloMessage(html).msg
}

class ZaloHtmlRenderer {
  private message = ''
  private readonly pendingStyles: PendingStyle[] = []

  renderChildren(children: HtmlNodeLike[] | undefined, context: RenderContext): void {
    if (!Array.isArray(children)) return
    for (const child of children) this.renderNode(child, context)
  }

  finish(): ZaloStyledText {
    this.trimTrailingHorizontalWhitespace()

    const leadingNewlines = this.message.match(/^\n+/)?.[0].length || 0
    if (leadingNewlines > 0) this.message = this.message.slice(leadingNewlines)
    this.message = this.message.replace(/\n+$/, '')

    const messageLength = this.message.length
    const normalized = this.pendingStyles
      .map(style => ({
        ...style,
        start: Math.max(0, style.start - leadingNewlines),
        end: Math.min(messageLength, style.end - leadingNewlines)
      }))
      .filter(style => style.start < messageLength && style.end > style.start)
      .filter(style => /\S/u.test(this.message.slice(style.start, style.end)))

    const styles = mergeStyles(normalized)
    return styles.length > 0
      ? { msg: this.message, styles }
      : { msg: this.message }
  }

  private renderNode(node: HtmlNodeLike, context: RenderContext): void {
    const nodeType = String(node.type || '').toLowerCase()
    if (nodeType === 'text') {
      this.appendText(node.data || '', !!context.preserveWhitespace)
      return
    }
    if (nodeType === 'comment' || nodeType === 'directive' || nodeType === 'cdata') return

    const tag = String(node.name || '').toLowerCase()
    if (!tag) {
      this.renderChildren(node.children, context)
      return
    }
    if (IGNORED_TAGS.has(tag)) return

    if (tag === 'br') {
      this.appendNewline()
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      this.renderList(node, tag === 'ol' ? TextStyle.OrderedList : TextStyle.UnorderedList, context)
      return
    }
    if (tag === 'li') {
      // Malformed fragments can contain a standalone li. Preserve its text.
      this.renderChildren(node.children, context)
      return
    }
    if (tag === 'blockquote') {
      this.renderBlockquote(node, context)
      return
    }
    if (tag === 'a') {
      this.renderLink(node, context)
      return
    }

    const inlineStyle = styleForInlineTag(tag)
    if (inlineStyle) {
      this.renderStyledChildren(node, inlineStyle, context)
      return
    }

    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      this.renderHeading(node, context)
      return
    }

    if (BLOCK_TAGS.has(tag)) {
      this.renderBlock(node, context, tag === 'pre')
      return
    }

    // TipTap extensions or pasted markup outside the supported toolbar keep
    // their readable descendants, but never transport markup to Zalo.
    this.renderChildren(node.children, context)
  }

  private renderStyledChildren(node: HtmlNodeLike, style: TextStyle, context: RenderContext): void {
    const start = this.message.length
    this.renderChildren(node.children, context)
    this.addStyle(start, this.message.length, style)
  }

  private renderHeading(node: HtmlNodeLike, context: RenderContext): void {
    this.startBlock(context)
    const start = this.message.length
    this.renderChildren(node.children, { ...context, suppressBlockBoundary: true })
    const end = this.visibleEnd(start)
    this.addStyle(start, end, TextStyle.Big)
    this.addStyle(start, end, TextStyle.Bold)
    const indentLevel = getFormattedContentIndentLevel(node.attribs)
    if (indentLevel > 0) this.addStyle(start, end, TextStyle.Indent, indentLevel)
    this.endBlock(context, start)
  }

  private renderBlock(node: HtmlNodeLike, context: RenderContext, preserveWhitespace = false): void {
    this.startBlock(context)
    const start = this.message.length
    this.renderChildren(node.children, {
      ...context,
      preserveWhitespace: preserveWhitespace || context.preserveWhitespace,
      suppressBlockBoundary: true
    })
    const end = this.visibleEnd(start)
    const indentLevel = getFormattedContentIndentLevel(node.attribs)
    if (indentLevel > 0) this.addStyle(start, end, TextStyle.Indent, indentLevel)
    this.endBlock(context, start)
  }

  private renderBlockquote(node: HtmlNodeLike, context: RenderContext): void {
    this.startBlock(context)
    const start = this.message.length
    this.renderChildren(node.children, { ...context, suppressBlockBoundary: false })
    this.trimTrailingNewlines()
    const end = this.visibleEnd(start)
    this.addStyle(start, end, TextStyle.Indent, 1)
    this.endBlock(context, start)
  }

  private renderList(node: HtmlNodeLike, style: TextStyle, context: RenderContext): void {
    this.startBlock(context)
    const blockStart = this.message.length
    const listDepth = Math.max(0, context.listDepth || 0)
    const listItems = (node.children || []).filter(child => String(child.name || '').toLowerCase() === 'li')

    for (const item of listItems) {
      if (this.message && !this.message.endsWith('\n')) this.appendNewline()
      const start = this.message.length
      this.renderListItem(item, style, listDepth, context)
      this.trimTrailingNewlines()
      const end = this.visibleEnd(start)
      if (end > start) this.appendNewline()
    }

    this.endBlock(context, blockStart)
  }

  private renderListItem(
    item: HtmlNodeLike,
    style: TextStyle,
    listDepth: number,
    context: RenderContext
  ): void {
    let directContentStart = this.message.length

    const finishDirectContent = (): void => {
      const directContentEnd = this.visibleEnd(directContentStart)
      this.addStyle(directContentStart, directContentEnd, style)
      if (listDepth > 0) {
        this.addStyle(directContentStart, directContentEnd, TextStyle.Indent, listDepth)
      }
    }

    for (const child of item.children || []) {
      const tag = String(child.name || '').toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        finishDirectContent()
        this.renderNode(child, {
          ...context,
          suppressBlockBoundary: false,
          listDepth: listDepth + 1
        })
        directContentStart = this.message.length
        continue
      }

      // TipTap list items contain paragraph block*. Keep their block
      // boundaries so adjacent paragraphs remain separate lines.
      this.renderNode(child, {
        ...context,
        suppressBlockBoundary: false,
        listDepth
      })
    }

    finishDirectContent()
  }

  private renderLink(node: HtmlNodeLike, context: RenderContext): void {
    const labelStart = this.message.length
    this.renderChildren(node.children, context)
    const label = this.message.slice(labelStart)
    const href = safeHttpUrl(node.attribs?.href)
    if (!href) return

    const normalizedLabel = label.trim()
    if (!normalizedLabel) {
      this.append(href)
    } else if (normalizedLabel !== href) {
      this.append(` (${href})`)
    }
  }

  private startBlock(context: RenderContext): void {
    if (context.suppressBlockBoundary) return
    this.ensureNewline()
  }

  private endBlock(context: RenderContext, contentStart: number): void {
    if (context.suppressBlockBoundary) return
    if (this.message.length === contentStart) {
      // Preserve an explicit empty TipTap paragraph between two blocks.
      if (this.message.length > 0) this.appendNewline()
      return
    }
    this.ensureNewline()
  }

  private addStyle(start: number, end: number, st: TextStyle, indentSize?: number): void {
    let visibleStart = Math.max(0, start)
    let visibleEnd = Math.min(this.message.length, end)
    while (visibleStart < visibleEnd && this.message[visibleStart] === '\n') visibleStart += 1
    while (visibleEnd > visibleStart && this.message[visibleEnd - 1] === '\n') visibleEnd -= 1
    if (visibleEnd <= visibleStart) return
    this.pendingStyles.push({ start: visibleStart, end: visibleEnd, st, indentSize })
  }

  private visibleEnd(start: number): number {
    let end = this.message.length
    while (end > start && this.message[end - 1] === '\n') end -= 1
    return end
  }

  private appendText(value: string, preserveWhitespace: boolean): void {
    const lineNormalized = String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    if (preserveWhitespace) {
      this.append(lineNormalized)
      return
    }

    const collapsed = lineNormalized.replace(/[\t\n\f ]+/g, ' ')
    if (!collapsed) return
    if (/^ +$/.test(collapsed) && (!this.message || /\s$/u.test(this.message))) return
    this.append(collapsed)
  }

  private append(value: string): void {
    this.message += value
  }

  private appendNewline(): void {
    this.trimTrailingHorizontalWhitespace()
    this.append('\n')
  }

  private ensureNewline(): void {
    this.trimTrailingHorizontalWhitespace()
    if (this.message && !this.message.endsWith('\n')) this.append('\n')
  }

  private trimTrailingHorizontalWhitespace(): void {
    this.message = this.message.replace(/[\t ]+$/u, '')
  }

  private trimTrailingNewlines(): void {
    this.trimTrailingHorizontalWhitespace()
    this.message = this.message.replace(/\n+$/u, '')
  }
}

function styleForInlineTag(tag: string): TextStyle | null {
  switch (tag) {
    case 'b':
    case 'strong':
      return TextStyle.Bold
    case 'i':
    case 'em':
      return TextStyle.Italic
    case 'u':
      return TextStyle.Underline
    case 's':
    case 'strike':
    case 'del':
      return TextStyle.StrikeThrough
    default:
      return null
  }
}

function safeHttpUrl(value: string | undefined): string {
  const href = String(value || '').trim()
  if (!href) return ''
  try {
    const parsed = new URL(href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? href : ''
  } catch {
    return ''
  }
}

function mergeRegularStyles(styles: PendingStyle[]): PendingStyle[] {
  const grouped = new Map<string, PendingStyle[]>()
  for (const style of styles) {
    const key = style.st
    const group = grouped.get(key) || []
    group.push(style)
    grouped.set(key, group)
  }

  const merged: PendingStyle[] = []
  for (const group of grouped.values()) {
    group.sort((left, right) => left.start - right.start || left.end - right.end)
    for (const style of group) {
      const previous = merged[merged.length - 1]
      if (
        previous
        && previous.st === style.st
        && style.start <= previous.end
      ) {
        previous.end = Math.max(previous.end, style.end)
      } else {
        merged.push({ ...style })
      }
    }
  }

  return merged
}

function mergeIndentStyles(styles: PendingStyle[]): PendingStyle[] {
  if (styles.length === 0) return []
  const boundaries = Array.from(new Set(styles.flatMap(style => [style.start, style.end])))
    .sort((left, right) => left - right)
  const merged: PendingStyle[] = []

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const indentSize = styles.reduce((total, style) => (
      style.start < end && style.end > start
        ? total + Math.max(1, style.indentSize || 1)
        : total
    ), 0)
    if (indentSize <= 0) continue

    const previous = merged[merged.length - 1]
    if (previous && previous.end === start && previous.indentSize === indentSize) {
      previous.end = end
    } else {
      merged.push({ start, end, st: TextStyle.Indent, indentSize })
    }
  }

  return merged
}

function mergeStyles(styles: PendingStyle[]): Style[] {
  const merged = [
    ...mergeRegularStyles(styles.filter(style => style.st !== TextStyle.Indent)),
    ...mergeIndentStyles(styles.filter(style => style.st === TextStyle.Indent))
  ]

  merged.sort((left, right) => left.start - right.start || left.end - right.end || left.st.localeCompare(right.st))
  return merged.map(style => style.st === TextStyle.Indent
    ? {
        start: style.start,
        len: style.end - style.start,
        st: TextStyle.Indent,
        indentSize: style.indentSize || 1
      }
    : {
        start: style.start,
        len: style.end - style.start,
        st: style.st as Exclude<TextStyle, TextStyle.Indent>
      })
}
