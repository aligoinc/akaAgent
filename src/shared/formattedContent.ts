import { parseDocument } from 'htmlparser2'
import { escapeContentVariantSeparators, findContentVariantSeparatorIndexes } from './contentSpin'

interface HtmlNodeLike {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: HtmlNodeLike[]
}

export const FORMATTED_CONTENT_ACTION_IDS = [
  'facebook_group_post',
  'zalo_message_phone',
  'zalo_message_friend',
  'zalo_message_birthday',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation',
  'zalo_message_group'
] as const

const FORMATTED_CONTENT_ACTION_ID_SET = new Set<string>(FORMATTED_CONTENT_ACTION_IDS)

export const FORMATTED_CONTENT_MAX_INDENT = 8
export const FORMATTED_CONTENT_INDENT_EM = 2

const ALLOWED_TAGS = new Set([
  'p', 'div', 'br',
  'h1', 'h2', 'h3',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del',
  'ul', 'ol', 'li', 'blockquote', 'a'
])

const DISCARDED_WITH_CHILDREN_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed'])
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'li', 'blockquote'])

export const supportsFormattedContent = (actionId?: string | null): boolean => (
  FORMATTED_CONTENT_ACTION_ID_SET.has(String(actionId || '').trim())
)

export const escapeFormattedContentText = (value: unknown): string => (
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
)

const getChildren = (node: HtmlNodeLike): HtmlNodeLike[] => Array.isArray(node.children) ? node.children : []

const getSafeHref = (value: unknown): string => {
  const href = String(value || '').trim()
  return /^https?:\/\/[^\s]+$/i.test(href) ? href : ''
}

const getSafeTextAlign = (style: unknown): string => {
  const match = String(style || '').match(/(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i)
  return match?.[1]?.toLowerCase() || ''
}

export const getFormattedContentIndentLevel = (
  attributes?: Record<string, unknown> | null
): number => {
  const rawValue = String(attributes?.['data-indent'] ?? '').trim()
  if (!/^\d+$/.test(rawValue)) return 0
  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value <= 0) return 0
  return Math.min(value, FORMATTED_CONTENT_MAX_INDENT)
}

const serializeNode = (
  node: HtmlNodeLike,
  transformText: (text: string) => string,
  insideListItem = false
): string => {
  if (node.type === 'text') return escapeFormattedContentText(transformText(String(node.data || '')))
  if (node.type === 'comment') return ''

  const tag = String(node.name || '').toLowerCase()
  const children = getChildren(node)
    .map(child => serializeNode(child, transformText, insideListItem || tag === 'li'))
    .join('')
  if (!tag) return children
  if (DISCARDED_WITH_CHILDREN_TAGS.has(tag)) return ''
  if (!ALLOWED_TAGS.has(tag)) return children
  if (tag === 'br') return '<br>'

  const normalizedTag = tag === 'b'
    ? 'strong'
    : tag === 'i'
      ? 'em'
      : (tag === 'strike' || tag === 'del')
        ? 's'
        : tag
  const attributes: string[] = []
  const styles: string[] = []
  const align = getSafeTextAlign(node.attribs?.style)
  if (align && (normalizedTag === 'p' || /^h[1-3]$/.test(normalizedTag))) {
    styles.push(`text-align: ${align}`)
  }
  const indentLevel = getFormattedContentIndentLevel(node.attribs)
  if (!insideListItem && indentLevel > 0 && (normalizedTag === 'p' || /^h[1-3]$/.test(normalizedTag))) {
    attributes.push(`data-indent="${indentLevel}"`)
    styles.push(`margin-left: ${indentLevel * FORMATTED_CONTENT_INDENT_EM}em`)
  }
  if (styles.length > 0) {
    attributes.push(`style="${styles.join('; ')}"`)
  }
  if (normalizedTag === 'a') {
    const href = getSafeHref(node.attribs?.href)
    if (!href) return children
    attributes.push(`href="${escapeFormattedContentText(href)}"`, 'rel="noopener noreferrer"', 'target="_blank"')
  }

  return `<${normalizedTag}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}>${children}</${normalizedTag}>`
}

const parseFragment = (html: unknown): HtmlNodeLike[] => {
  const document = parseDocument(String(html || ''), {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true
  }) as unknown as HtmlNodeLike
  return getChildren(document)
}

export const transformFormattedContentTextNodes = (
  html: unknown,
  transformText: (text: string) => string
): string => parseFragment(html).map(node => serializeNode(node, transformText)).join('')

export const transformFormattedContentText = transformFormattedContentTextNodes

export const sanitizeFormattedContent = (html: unknown): string => (
  transformFormattedContentTextNodes(html, text => text)
)

const cloneHtmlNode = (node: HtmlNodeLike, children = getChildren(node)): HtmlNodeLike => ({
  type: node.type,
  name: node.name,
  data: node.data,
  attribs: node.attribs ? { ...node.attribs } : undefined,
  children: children.map(child => cloneHtmlNode(child))
})

const collectFormattedText = (nodes: HtmlNodeLike[]): string => nodes
  .map(node => node.type === 'text'
    ? String(node.data || '')
    : collectFormattedText(getChildren(node)))
  .join('')

/**
 * Treats one rich document as an atomic campaign variant by escaping visible
 * pipes that would otherwise be interpreted as top-level separators.
 */
export const escapeFormattedContentVariantSeparators = (html: unknown): string => {
  const sanitized = sanitizeFormattedContent(html)
  const nodes = parseFragment(sanitized)
  const separatorIndexes = new Set(findContentVariantSeparatorIndexes(collectFormattedText(nodes)))
  if (separatorIndexes.size === 0) return sanitized

  let textOffset = 0
  const transformText = (text: string): string => {
    let escaped = ''
    for (let index = 0; index < text.length; index += 1) {
      if (separatorIndexes.has(textOffset + index)) escaped += '\\'
      escaped += text[index]
    }
    textOffset += text.length
    return escaped
  }

  return nodes.map(node => serializeNode(node, transformText)).join('')
}

/** Serializes atomic rich documents to the formatted Simple variant syntax. */
export const serializeFormattedContentVariants = (variants: unknown[]): string => (
  variants
    .map(variant => escapeFormattedContentVariantSeparators(variant))
    .filter(variant => !isFormattedContentEmpty(variant))
    .join('|')
)

interface FormattedVariantSplitState {
  separatorIndexes: Set<number>
  textOffset: number
}

const splitFormattedNodeSequence = (
  nodes: HtmlNodeLike[],
  state: FormattedVariantSplitState
): HtmlNodeLike[][] => {
  const variants: HtmlNodeLike[][] = [[]]

  for (const node of nodes) {
    const nodeVariants = splitFormattedNode(node, state)
    variants[variants.length - 1].push(...(nodeVariants[0] || []))
    for (let index = 1; index < nodeVariants.length; index += 1) {
      variants.push([...(nodeVariants[index] || [])])
    }
  }

  return variants
}

const hasFormattedNodeText = (node: HtmlNodeLike): boolean => {
  if (node.type === 'text') return String(node.data || '').trim().length > 0
  const tag = String(node.name || '').toLowerCase()
  if (node.type === 'comment' || tag === 'br') return false
  if (tag === 'a' && getSafeHref(node.attribs?.href)) return true
  return getChildren(node).some(hasFormattedNodeText)
}

const splitFormattedNode = (
  node: HtmlNodeLike,
  state: FormattedVariantSplitState
): HtmlNodeLike[][] => {
  if (node.type === 'text') {
    const text = String(node.data || '')
    const nodeStart = state.textOffset
    state.textOffset += text.length
    const localSeparators = Array.from(state.separatorIndexes)
      .filter(index => index >= nodeStart && index < state.textOffset)
      .map(index => index - nodeStart)

    if (localSeparators.length === 0) return [[cloneHtmlNode(node, [])]]

    const variants: HtmlNodeLike[][] = []
    let start = 0
    for (const separatorIndex of localSeparators) {
      const part = text.slice(start, separatorIndex)
      variants.push(part ? [{ type: 'text', data: part }] : [])
      start = separatorIndex + 1
    }
    const tail = text.slice(start)
    variants.push(tail ? [{ type: 'text', data: tail }] : [])
    return variants
  }

  if (node.type === 'comment') return [[cloneHtmlNode(node, [])]]
  if (String(node.name || '').toLowerCase() === 'br') return [[cloneHtmlNode(node, [])]]

  const childVariants = splitFormattedNodeSequence(getChildren(node), state)
  if (childVariants.length === 1) return [[cloneHtmlNode(node, childVariants[0])]]

  return childVariants.map(children => (
    children.some(hasFormattedNodeText)
      ? [cloneHtmlNode(node, children)]
      : []
  ))
}

const trimFormattedNodesAtBoundary = (
  nodes: HtmlNodeLike[],
  boundary: 'start' | 'end'
): HtmlNodeLike[] => {
  const result = nodes.map(node => cloneHtmlNode(node))

  while (result.length > 0) {
    const index = boundary === 'start' ? 0 : result.length - 1
    const trimmed = trimFormattedNodeAtBoundary(result[index], boundary)
    if (!trimmed || !hasFormattedNodeText(trimmed)) {
      result.splice(index, 1)
      continue
    }
    result[index] = trimmed
    break
  }

  return result
}

const trimFormattedNodeAtBoundary = (
  node: HtmlNodeLike,
  boundary: 'start' | 'end'
): HtmlNodeLike | null => {
  if (node.type === 'text') {
    const data = boundary === 'start'
      ? String(node.data || '').replace(/^\s+/, '')
      : String(node.data || '').replace(/\s+$/, '')
    return data ? { type: 'text', data } : null
  }
  const tag = String(node.name || '').toLowerCase()
  if (node.type === 'comment' || tag === 'br') return null

  const children = trimFormattedNodesAtBoundary(getChildren(node), boundary)
  if (tag === 'a' && getSafeHref(node.attribs?.href)) return cloneHtmlNode(node, children)
  if (!children.some(hasFormattedNodeText)) return null
  return cloneHtmlNode(node, children)
}

/**
 * Splits a sanitized rich-text document on visible top-level `|` separators.
 * Pipes in attributes, escaped `\|`, template tokens and spintax groups stay intact.
 */
export const splitFormattedContentVariants = (html: unknown): string[] => {
  const sanitized = sanitizeFormattedContent(html)
  const nodes = parseFragment(sanitized)
  const text = collectFormattedText(nodes)
  const separatorIndexes = findContentVariantSeparatorIndexes(text)

  if (separatorIndexes.length === 0) {
    return isFormattedContentEmpty(sanitized) ? [] : [sanitized]
  }

  const variants = splitFormattedNodeSequence(nodes, {
    separatorIndexes: new Set(separatorIndexes),
    textOffset: 0
  })

  return variants
    .map(nodesInVariant => trimFormattedNodesAtBoundary(
      trimFormattedNodesAtBoundary(nodesInVariant, 'start'),
      'end'
    ))
    .map(nodesInVariant => nodesInVariant.map(node => serializeNode(node, value => value)).join(''))
    .filter(variant => !isFormattedContentEmpty(variant))
}

export const plainTextToFormattedContent = (plainText: unknown): string => {
  const normalized = String(plainText ?? '').replace(/\r\n?/g, '\n')
  if (!normalized) return ''
  return normalized
    .split('\n')
    .map(line => `<p>${line ? escapeFormattedContentText(line) : '<br>'}</p>`)
    .join('')
}

interface PlainRenderContext {
  listType?: 'ul' | 'ol'
  listIndex?: number
  listDepth?: number
}

const renderPlainChildren = (node: HtmlNodeLike): string => (
  getChildren(node).map(child => renderPlainNode(child)).join('')
)

const renderPlainBlock = (inner: string): string => {
  if (!inner) return '\n'
  if (/^\n+$/.test(inner)) return '\n\n'
  return `${inner.replace(/\n+$/g, '')}\n`
}

const PLAIN_INDENT_MARKER = '\uE000'

const renderIndentedPlainBlock = (inner: string, indentLevel: number): string => {
  const rendered = renderPlainBlock(inner)
  if (indentLevel <= 0) return rendered
  const prefix = PLAIN_INDENT_MARKER.repeat(indentLevel)
  return rendered.replace(/(^|\n)(?=[^\n])/g, `$1${prefix}`)
}

const renderPlainNode = (node: HtmlNodeLike, context: PlainRenderContext = {}): string => {
  if (node.type === 'text') return String(node.data || '')
  if (node.type === 'comment') return ''

  const tag = String(node.name || '').toLowerCase()
  if (DISCARDED_WITH_CHILDREN_TAGS.has(tag)) return ''
  if (tag === 'br') return '\n'

  if (tag === 'ul' || tag === 'ol') {
    const listType = tag as 'ul' | 'ol'
    const listDepth = Math.max(0, context.listDepth || 0)
    const items = getChildren(node).filter(child => String(child.name || '').toLowerCase() === 'li')
    const renderedItems = items.map((item, index) => renderPlainNode(item, {
      listType,
      listIndex: index,
      listDepth
    })).join('')
    return renderedItems ? `${renderedItems.replace(/\n+$/g, '')}\n` : ''
  }

  if (tag === 'li') {
    const listDepth = Math.max(0, context.listDepth || 0)
    let directContent = ''
    let nestedContent = ''
    for (const child of getChildren(node)) {
      const childTag = String(child.name || '').toLowerCase()
      if (childTag === 'ul' || childTag === 'ol') {
        nestedContent += renderPlainNode(child, { listDepth: listDepth + 1 })
      } else {
        directContent += renderPlainNode(child)
      }
    }
    const content = directContent.replace(/^\s+|\s+$/g, '')
    const prefix = context.listType === 'ol' ? `${(context.listIndex || 0) + 1}. ` : '• '
    let rendered = ''
    if (content) {
      const baseIndent = '  '.repeat(listDepth)
      const continuationIndent = `${baseIndent}${' '.repeat(prefix.length)}`
      rendered += content
        .split('\n')
        .map((line, index) => `${index === 0 ? `${baseIndent}${prefix}` : continuationIndent}${line}`)
        .join('\n')
      rendered += '\n'
    }
    rendered += nestedContent
    return rendered
  }
  const children = renderPlainChildren(node)
  if (tag === 'a') {
    const href = getSafeHref(node.attribs?.href)
    const visibleLabel = children.replace(/\s+/g, ' ').trim()
    if (!href) return children
    if (!visibleLabel) return href
    return visibleLabel === href ? children : `${children} (${href})`
  }
  if (BLOCK_TAGS.has(tag)) {
    const indentLevel = getFormattedContentIndentLevel(node.attribs) + (tag === 'blockquote' ? 1 : 0)
    return renderIndentedPlainBlock(children, indentLevel)
  }
  return children
}

export const formattedContentToPlainText = (html: unknown): string => {
  return parseFragment(html)
    .map(node => renderPlainNode(node))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(new RegExp(PLAIN_INDENT_MARKER, 'g'), '  ')
}

/** Converts rich Simple content to the equivalent plain variant expression. */
export const formattedContentToPlainCampaignContent = (html: unknown): string => (
  splitFormattedContentVariants(html)
    .map(variant => escapeContentVariantSeparators(formattedContentToPlainText(variant)))
    .join('|')
)

const renderZaloPreviewChildren = (node: HtmlNodeLike): string => (
  getChildren(node).map(renderZaloPreviewNode).join('')
)

const renderZaloPreviewNode = (node: HtmlNodeLike): string => {
  if (node.type === 'text') return escapeFormattedContentText(node.data || '')
  if (node.type === 'comment') return ''

  const tag = String(node.name || '').toLowerCase()
  if (DISCARDED_WITH_CHILDREN_TAGS.has(tag)) return ''
  if (tag === 'br') return '<br>'

  const children = renderZaloPreviewChildren(node)
  if (!tag) return children
  if (tag === 'strong' || tag === 'b') return `<strong>${children}</strong>`
  if (tag === 'em' || tag === 'i') return `<em>${children}</em>`
  if (tag === 'u') return `<u>${children}</u>`
  if (tag === 's' || tag === 'strike' || tag === 'del') return `<s>${children}</s>`
  const indentLevel = getFormattedContentIndentLevel(node.attribs)
  const indentAttributes = indentLevel > 0
    ? ` data-indent="${indentLevel}" style="margin-left: ${indentLevel * FORMATTED_CONTENT_INDENT_EM}em"`
    : ''
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
    return `<p class="zalo-preview-heading"${indentAttributes}><strong>${children}</strong></p>`
  }
  if (tag === 'p' || tag === 'div') return `<p${indentAttributes}>${children || '<br>'}</p>`
  if (tag === 'ul' || tag === 'ol') return `<${tag} class="zalo-preview-list">${children}</${tag}>`
  if (tag === 'li') return `<li>${children}</li>`
  if (tag === 'blockquote') return `<div class="zalo-preview-indent">${children}</div>`
  if (tag === 'a') {
    const href = getSafeHref(node.attribs?.href)
    if (!href) return children
    const visibleLabel = renderPlainChildren(node).replace(/\s+/g, ' ').trim()
    if (!visibleLabel) return escapeFormattedContentText(href)
    if (visibleLabel === href) return children
    return `${children} <span class="zalo-preview-link-url">(${escapeFormattedContentText(href)})</span>`
  }
  return children
}

/** Renderer-only projection that mirrors the Zalo transport's supported style set. */
export const formattedContentToZaloPreviewHtml = (html: unknown): string => (
  parseFragment(html).map(renderZaloPreviewNode).join('')
)

export const isFormattedContentEmpty = (html: unknown): boolean => (
  formattedContentToPlainText(html).trim().length === 0
)
