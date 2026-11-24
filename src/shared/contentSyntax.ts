/**
 * Kiểm cú pháp nội dung chiến dịch: biến `#{...}`, ngoặc `{...}` và dấu `|` ngăn các mẫu.
 *
 * File tự đứng một mình (không import gì) và được CHÉP NGUYÊN VĂN giữa hai repo:
 *   akaAgentWebApp  packages/campaign-core/src/contentSyntax.ts   (sửa ở đây trước)
 *   akaAgent        src/shared/contentSyntax.ts                   (bài kiểm so md5)
 *
 * Chỉ dùng lúc soạn và lúc lưu (form, API). Bộ chạy không gọi file này: phần "bộ tách thật" bên dưới là bản chép
 * đúng luật của `contentSpin.ts` để tính số mẫu sẽ thật sự được gửi, bài kiểm giữ hai bản khớp nhau.
 */

export type ContentSyntaxChannel = 'zalo' | 'sms' | 'voice' | 'email' | 'other'
export type ContentSyntaxSeverity = 'block' | 'warn'
export type ContentSyntaxCode =
  | 'token_unclosed'
  | 'brace_unclosed'
  | 'token_unknown'
  | 'token_malformed'
  | 'brace_stray'
  | 'hashtag_spin'
  | 'token_empty_on_channel'
  | 'separator_escaped'
  | 'variant_fragment'
  | 'legacy_token'

export interface ContentSyntaxFix {
  start: number
  end: number
  text: string
}

export interface ContentSyntaxIssue {
  code: ContentSyntaxCode
  severity: ContentSyntaxSeverity
  /** Vị trí trong chuỗi đã kiểm (`result.text`). */
  start: number
  end: number
  excerpt: string
  message: string
  /** Chỉ có khi lỗi có đúng một cách sửa và nội dung không phải HTML. */
  fix?: ContentSyntaxFix
}

export interface ContentSyntaxResult {
  /** Chuỗi đã kiểm (với HTML là phần chữ). */
  text: string
  issues: ContentSyntaxIssue[]
  /** Số mẫu bộ tách thật sẽ gửi luân phiên. */
  variantCount: number
  /** Số dấu `|` bộ tách thật coi là ngăn mẫu. */
  separatorCount: number
  /** Số dấu `|` đáng lẽ ngăn mẫu nhưng mất tác dụng vì lỗi ngoặc / biến. */
  lostSeparators: number
}

export interface ContentSyntaxOptions {
  channel: ContentSyntaxChannel
  /** `true`: nội dung có định dạng (HTML). `'auto'`: tự nhận theo thẻ. Mặc định `false`. */
  html?: boolean | 'auto'
}

export type ContentSyntaxGuardMode = 'block' | 'warn' | 'off'

export const CONTENT_SYNTAX_ERROR_CODE = 'campaign_content_syntax_invalid'
export const CONTENT_SYNTAX_SETTING_KEY = 'campaign.content_syntax_guard'

const SIMPLE_TOKENS = [
  'FULL_NAME', 'ORIGINAL_NAME', 'INPUT_FULLNAME', 'UID', 'PHONE', 'MOBILE', 'EMAIL',
  'INFO1', 'INFO2', 'INFO3', 'INFO4', 'INFO5', 'STOP_MESSAGES_LINK',
]
const DATE_TOKENS = ['TODAY', 'TOMORROW', 'YESTERDAY']
const SEX_TOKEN = 'SEX'
const DEFAULT_DATE_FORMAT = 'DD/MM/YYYY'
const DEFAULT_SEX_EXAMPLE = '#{SEX{anh-chị-anh/chị}}'
/** Biến lấy từ hồ sơ Zalo: với email luôn ra rỗng. */
const ZALO_PROFILE_ONLY_TOKENS = ['FULL_NAME', 'ORIGINAL_NAME']

const ESCAPABLE = '{}|\\'
const HTML_TAG_HINT = /<\/?(p|div|br|span|strong|em|b|i|u|s|a|ul|ol|li|h[1-6]|blockquote|img|table|tr|td)\b[^>]*>/i
/** Một mẫu từ ngần này ký tự trở xuống, đứng cạnh mẫu dài hơn `FRAGMENT_LONG_LENGTH`, bị coi là mẩu do dấu | trang trí cắt ra. */
const FRAGMENT_SHORT_LENGTH = 25
const FRAGMENT_LONG_LENGTH = 150

function isEscapedSpecial(value: string, index: number): boolean {
  return value[index] === '\\' && index + 1 < value.length && ESCAPABLE.indexOf(value[index + 1]) >= 0
}

// ── Bộ tách thật (chép luật của contentSpin.ts) ─────────────────────────────────────────────────────────────────

function findTemplateTokenEnd(value: string, hashIndex: number): number | null {
  if (value[hashIndex] !== '#' || value[hashIndex + 1] !== '{') return null
  let depth = 1
  for (let index = hashIndex + 2; index < value.length; index += 1) {
    if (isEscapedSpecial(value, index)) {
      index += 1
      continue
    }
    if (value[index] === '{') depth += 1
    else if (value[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return null
}

function findBraceGroupEnd(value: string, openIndex: number): number | null {
  if (value[openIndex] !== '{') return null
  let depth = 0
  for (let index = openIndex + 1; index < value.length; index += 1) {
    if (isEscapedSpecial(value, index)) {
      index += 1
      continue
    }
    const tokenEnd = findTemplateTokenEnd(value, index)
    if (tokenEnd !== null) {
      index = tokenEnd
      continue
    }
    if (value[index] === '{') depth += 1
    else if (value[index] === '}') {
      if (depth === 0) return index
      depth -= 1
    }
  }
  return null
}

function findSpinGroupEnd(value: string, openIndex: number): number | null {
  if (value[openIndex] !== '{' || (openIndex > 0 && value[openIndex - 1] === '#')) return null
  let depth = 0
  let hasPipe = false
  for (let index = openIndex + 1; index < value.length; index += 1) {
    if (isEscapedSpecial(value, index)) {
      index += 1
      continue
    }
    const tokenEnd = findTemplateTokenEnd(value, index)
    if (tokenEnd !== null) {
      index = tokenEnd
      continue
    }
    if (value[index] === '{') depth += 1
    else if (value[index] === '}') {
      if (depth === 0) return hasPipe ? index : null
      depth -= 1
    } else if (value[index] === '|' && depth === 0) hasPipe = true
  }
  return null
}

/** Vị trí các dấu `|` mà bộ tách đang chạy coi là ngăn mẫu. */
export function actualVariantSeparatorIndexes(content: string | null | undefined): number[] {
  const value = String(content || '')
  const separatorIndexes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    if (isEscapedSpecial(value, index)) {
      index += 1
      continue
    }
    const tokenEnd = findTemplateTokenEnd(value, index)
    if (tokenEnd !== null) {
      index = tokenEnd
      continue
    }
    const spinEnd = findSpinGroupEnd(value, index)
    if (spinEnd !== null) {
      index = spinEnd
      continue
    }
    if (value[index] === '{') {
      const braceEnd = findBraceGroupEnd(value, index)
      if (braceEnd !== null) {
        index = braceEnd
        continue
      }
      break
    }
    if (value[index] === '|') separatorIndexes.push(index)
  }
  return separatorIndexes
}

/** Từ `index` lùi về trước chỉ gặp khoảng trắng rồi tới đầu dòng / đầu nội dung. */
function atLineStart(value: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = value[cursor]
    if (char === '\n' || char === '\r') return true
    if (char !== ' ' && char !== '\t') return false
  }
  return true
}

/** Từ `index` đi tiếp chỉ gặp khoảng trắng rồi tới cuối dòng / cuối nội dung. */
function atLineEnd(value: string, index: number): boolean {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const char = value[cursor]
    if (char === '\n' || char === '\r') return true
    if (char !== ' ' && char !== '\t') return false
  }
  return true
}

/**
 * Dấu `|` ngoài cùng chia làm hai loại theo chỗ đứng: sát chỗ xuống dòng (gần như chắc là dấu ngăn mẫu) và nằm giữa
 * dòng (có thể chỉ là ký tự trang trí như "2PN | 65m²").
 */
export function variantSeparatorPlacement(content: string | null | undefined): { boundary: number[]; inline: number[] } {
  const value = String(content || '')
  const boundary: number[] = []
  const inline: number[] = []
  for (const index of actualVariantSeparatorIndexes(value)) {
    if (atLineStart(value, index) || atLineEnd(value, index + 1)) boundary.push(index)
    else inline.push(index)
  }
  return { boundary, inline }
}

/**
 * Tách một khối nội dung tại các dấu `|` sát chỗ xuống dòng; dấu `|` giữa dòng giữ nguyên trong từng phần.
 * Dùng khi một ô "Biến thể" của mẫu nội dung chứa nhiều mẫu khách gõ liền nhau.
 */
export function splitAtBoundarySeparators(content: string | null | undefined): string[] {
  const value = String(content || '')
  const parts: string[] = []
  let start = 0
  for (const index of variantSeparatorPlacement(value).boundary) {
    const part = value.slice(start, index).trim()
    if (part) parts.push(part)
    start = index + 1
  }
  const last = value.slice(start).trim()
  if (last) parts.push(last)
  return parts
}

/**
 * Mỗi ô "Biến thể" của mẫu nội dung là một khối nguyên. Ô nào chứa nhiều nội dung khách gõ liền nhau (dấu `|` sát chỗ
 * xuống dòng) thì tách ra từng nội dung. Ô có định dạng (HTML) giữ nguyên: vị trí dấu `|` không khớp với chuỗi HTML.
 */
export function expandPackedVariants(variants: Array<string | null | undefined>): string[] {
  const expanded: string[] = []
  for (const variant of variants) {
    const text = String(variant || '')
    if (!text.trim()) continue
    if (HTML_TAG_HINT.test(text)) expanded.push(text)
    else for (const part of splitAtBoundarySeparators(text)) expanded.push(part)
  }
  return expanded
}

/** Câu hỏi khi áp / lưu một mẫu có ô biến thể chứa nhiều nội dung. `null` = không có gì để tách. */
export function packedVariantsPrompt(variants: Array<string | null | undefined>): {
  total: number; title: string; message: string; confirmText: string; cancelText: string
} | null {
  const kept = variants.filter(variant => String(variant || '').trim()).length
  const total = expandPackedVariants(variants).length
  if (total <= kept) return null
  return {
    total,
    title: 'Một biến thể đang chứa nhiều nội dung',
    message: `Có ô biến thể chứa nhiều nội dung ngăn bằng dấu |. Tách ra thì sẽ có ${total} nội dung gửi luân phiên. `
      + 'Giữ nguyên thì các nội dung trong ô đó được gửi chung một tin, kèm ký tự |.',
    confirmText: `Tách thành ${total} nội dung`,
    cancelText: 'Giữ nguyên',
  }
}

function countVariants(value: string, separators: number[]): number {
  let count = 0
  let start = 0
  for (let position = 0; position <= separators.length; position += 1) {
    const end = position < separators.length ? separators[position] : value.length
    if (value.slice(start, end).trim()) count += 1
    start = end + 1
  }
  return count
}

// ── HTML → chữ ──────────────────────────────────────────────────────────────────────────────────────────────────


function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
}

// ── Kiểm ────────────────────────────────────────────────────────────────────────────────────────────────────────

const TOKEN_HEAD = /^#\{([A-Za-z_][A-Za-z_0-9]*)/
const TOKEN_SIMPLE = /^#\{([A-Za-z_][A-Za-z_0-9]*)\}/
const TOKEN_DATE = /^#\{([A-Za-z_][A-Za-z_0-9]*)\(([^{}\n]*)\)\}/
const TOKEN_BRACE = /^#\{([A-Za-z_][A-Za-z_0-9]*)\{([^{}\n]*)\}\}/
const TOKEN_DATE_PARTIAL = /^#\{([A-Za-z_][A-Za-z_0-9]*)\(([^{}()|\n]*)\)/
const TOKEN_BRACE_PARTIAL = /^#\{([A-Za-z_][A-Za-z_0-9]*)\{([^{}|\n]*)\}/

function has(list: string[], value: string): boolean {
  return list.indexOf(value) >= 0
}

function isKnownTokenName(upper: string): boolean {
  return has(SIMPLE_TOKENS, upper) || has(DATE_TOKENS, upper) || upper === SEX_TOKEN
}

function squash(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Biến đơn mà khách nhiều khả năng muốn viết: khác chữ hoa / thường, thiếu gạch dưới, thừa khoảng trắng. */
function closestSimpleToken(inner: string): string | null {
  const key = squash(inner)
  if (!key) return null
  const matches = SIMPLE_TOKENS.filter(name => squash(name) === key)
  return matches.length === 1 ? matches[0] : null
}

function excerptOf(text: string, start: number, end: number): string {
  const raw = text.slice(start, Math.min(end, start + 48)).replace(/\s+/g, ' ')
  return end - start > 48 ? `${raw}…` : raw
}

function usesTokens(channel: ContentSyntaxChannel): boolean {
  return channel !== 'other'
}

interface Scan {
  text: string
  channel: ContentSyntaxChannel
  allowFix: boolean
  issues: ContentSyntaxIssue[]
}

function push(
  scan: Scan,
  code: ContentSyntaxCode,
  severity: ContentSyntaxSeverity,
  start: number,
  end: number,
  message: string,
  fix?: ContentSyntaxFix,
): ContentSyntaxIssue {
  const issue: ContentSyntaxIssue = { code, severity, start, end, excerpt: excerptOf(scan.text, start, end), message }
  if (fix && scan.allowFix) issue.fix = fix
  scan.issues.push(issue)
  return issue
}

/** Kiểm một biến đã đóng đủ ngoặc và đúng một trong ba dạng. */
function checkWellFormedToken(scan: Scan, start: number, end: number, name: string, shape: 'simple' | 'date' | 'brace', body: string): void {
  if (!usesTokens(scan.channel)) return
  const token = scan.text.slice(start, end)
  const upper = name.toUpperCase()
  const replaceWith = (text: string): ContentSyntaxFix => ({ start, end, text })
  const unknown = () => push(scan, 'token_unknown', 'block', start, end,
    `${token} không phải biến của hệ thống nên sẽ bị giữ nguyên văn, không được thay bằng thông tin của khách.`)

  if (shape === 'simple') {
    if (has(SIMPLE_TOKENS, name)) {
      if (scan.channel === 'email' && has(ZALO_PROFILE_ONLY_TOKENS, name)) {
        push(scan, 'token_empty_on_channel', 'warn', start, end,
          `${token} lấy tên từ hồ sơ Zalo nên trong email sẽ để trống. Muốn dùng tên trong danh sách đã nhập, hãy dùng #{INPUT_FULLNAME}.`)
      }
      return
    }
    const closest = closestSimpleToken(name)
    if (closest) {
      push(scan, 'token_unknown', 'block', start, end,
        `${token} không phải biến của hệ thống nên sẽ bị giữ nguyên văn. Biến đúng là #{${closest}}.`,
        replaceWith(`#{${closest}}`))
      return
    }
    if (has(DATE_TOKENS, upper)) {
      push(scan, 'token_malformed', 'block', start, end,
        `${token} thiếu định dạng ngày. Viết đúng là #{${upper}(${DEFAULT_DATE_FORMAT})}.`,
        replaceWith(`#{${upper}(${DEFAULT_DATE_FORMAT})}`))
      return
    }
    if (upper === SEX_TOKEN) {
      push(scan, 'token_malformed', 'block', start, end,
        `${token} thiếu phần xưng hô. Viết đúng là ${DEFAULT_SEX_EXAMPLE}.`)
      return
    }
    unknown()
    return
  }

  if (shape === 'date') {
    if (has(DATE_TOKENS, name)) return
    if (has(DATE_TOKENS, upper)) {
      push(scan, 'token_unknown', 'block', start, end,
        `${token} không phải biến của hệ thống nên sẽ bị giữ nguyên văn. Biến đúng là #{${upper}(${body})}.`,
        replaceWith(`#{${upper}(${body})}`))
      return
    }
    unknown()
    return
  }

  if (upper !== SEX_TOKEN) {
    unknown()
    return
  }
  if (body.indexOf('|') >= 0) {
    push(scan, 'token_malformed', 'block', start, end,
      `${token} đang ngăn các cách xưng hô bằng dấu |. Biến xưng hô dùng dấu gạch ngang, ví dụ ${DEFAULT_SEX_EXAMPLE}.`,
      replaceWith(`#{${SEX_TOKEN}{${body.split('|').map(part => part.trim()).join('-')}}}`))
    return
  }
  if (name !== SEX_TOKEN) {
    push(scan, 'token_unknown', 'block', start, end,
      `${token} không phải biến của hệ thống nên sẽ bị giữ nguyên văn. Biến đúng là #{${SEX_TOKEN}{${body}}}.`,
      replaceWith(`#{${SEX_TOKEN}{${body}}}`))
  }
}

const LOOSE_BRACE = /^#\{\s*([A-Za-z_]+)\s*\{([^{}\n]*)\}\s*\}$/
const LOOSE_DATE = /^#\{\s*([A-Za-z_]+)\s*\(([^{}()\n]*)\)\s*\}$/

/** Biến đủ ngoặc nhưng thừa khoảng trắng / sai chữ hoa, gạch dưới: trả dạng đúng nếu chỉ có một cách hiểu. */
function looseTokenFix(token: string): string | null {
  const brace = LOOSE_BRACE.exec(token)
  if (brace) {
    return brace[1].toUpperCase() === SEX_TOKEN
      ? `#{${SEX_TOKEN}{${brace[2].split('|').map(part => part.trim()).join('-')}}}`
      : null
  }
  const date = LOOSE_DATE.exec(token)
  if (date) return has(DATE_TOKENS, date[1].toUpperCase()) ? `#{${date[1].toUpperCase()}(${date[2].trim()})}` : null
  const closest = closestSimpleToken(token.slice(2, -1))
  return closest ? `#{${closest}}` : null
}

/**
 * Xử lý một chỗ `#{` ở vị trí `index`. Trả vị trí ký tự cuối đã tiêu thụ (bộ quét tiếp tục từ vị trí sau đó).
 * Biến thiếu ngoặc đóng được coi như đã đóng tại chỗ dễ thấy nhất, để các dấu `|` phía sau vẫn được đếm là ngăn mẫu.
 */
function scanToken(scan: Scan, index: number): number {
  const text = scan.text
  const rest = text.slice(index)
  const tokenChannel = usesTokens(scan.channel)

  const simple = TOKEN_SIMPLE.exec(rest)
  if (simple) {
    checkWellFormedToken(scan, index, index + simple[0].length, simple[1], 'simple', '')
    return index + simple[0].length - 1
  }
  const date = TOKEN_DATE.exec(rest)
  if (date) {
    checkWellFormedToken(scan, index, index + date[0].length, date[1], 'date', date[2])
    return index + date[0].length - 1
  }
  const brace = TOKEN_BRACE.exec(rest)
  if (brace) {
    checkWellFormedToken(scan, index, index + brace[0].length, brace[1], 'brace', brace[2])
    return index + brace[0].length - 1
  }

  const balancedEnd = findTemplateTokenEnd(text, index)
  const balanced = balancedEnd === null ? '' : text.slice(index, balancedEnd + 1)
  const balancedIsLocal = balancedEnd !== null && balanced.indexOf('|') < 0 && balanced.indexOf('\n') < 0

  // Biến viết dở: đủ phần đầu của một dạng quen thuộc nhưng thiếu ngoặc đóng.
  let partialLength = 0
  let partialValid = false
  const bracePartial = TOKEN_BRACE_PARTIAL.exec(rest)
  const datePartial = TOKEN_DATE_PARTIAL.exec(rest)
  const head = TOKEN_HEAD.exec(rest)
  if (bracePartial) {
    partialLength = bracePartial[0].length
    partialValid = bracePartial[1].toUpperCase() === SEX_TOKEN
  } else if (datePartial) {
    partialLength = datePartial[0].length
    partialValid = has(DATE_TOKENS, datePartial[1].toUpperCase())
  } else if (head && isKnownTokenName(head[1].toUpperCase()) && has(SIMPLE_TOKENS, head[1].toUpperCase())) {
    partialLength = head[0].length
    partialValid = true
  }

  if (partialLength > 0 && !balancedIsLocal && (partialValid || tokenChannel)) {
    const end = index + partialLength
    const partial = text.slice(index, end)
    const severity: ContentSyntaxSeverity = tokenChannel || partialValid ? 'block' : 'warn'
    push(scan, 'token_unclosed', severity, index, end,
      `Biến ${partial} đang thiếu dấu } ở cuối. Viết đúng là ${partial}}.`,
      { start: end, end, text: '}' })
    return end - 1
  }

  if (balancedEnd !== null) {
    if (tokenChannel) {
      const loose = looseTokenFix(balanced)
      if (loose) {
        push(scan, 'token_malformed', 'block', index, balancedEnd + 1,
          `${excerptOf(text, index, balancedEnd + 1)} viết chưa đúng nên sẽ bị giữ nguyên văn. Biến đúng là ${loose}.`,
          { start: index, end: balancedEnd + 1, text: loose })
        return balancedEnd
      }
      push(scan, 'token_unknown', 'block', index, balancedEnd + 1,
        `${excerptOf(text, index, balancedEnd + 1)} không phải biến của hệ thống nên sẽ bị giữ nguyên văn, không được thay bằng thông tin của khách.`)
    } else if (balanced.indexOf('|') >= 0) {
      push(scan, 'hashtag_spin', 'warn', index, balancedEnd + 1,
        `Dấu # đứng sát dấu { nên đoạn ${excerptOf(text, index, balancedEnd + 1)} không được xoay vòng. Hãy thêm khoảng trắng hoặc đặt # vào trong ngoặc.`)
    }
    return balancedEnd
  }

  push(scan, 'token_unclosed', 'block', index, Math.min(text.length, index + 2 + (head ? head[1].length : 0)),
    'Biến bắt đầu bằng #{ nhưng chưa có dấu } đóng.')
  return index + 1
}

const LEGACY_TOKEN = /\[(fullname_original|fullname_web|fullname|mobile|phone|email|info[1-5]|vocative_web)\]/gi
const LEGACY_TOKEN_MAP: Record<string, string> = {
  fullname: '#{INPUT_FULLNAME}', fullname_web: '#{FULL_NAME}', fullname_original: '#{ORIGINAL_NAME}',
  mobile: '#{PHONE}', phone: '#{PHONE}', email: '#{EMAIL}',
  info1: '#{INFO1}', info2: '#{INFO2}', info3: '#{INFO3}', info4: '#{INFO4}', info5: '#{INFO5}',
}

/** Biến kiểu akaBiz cũ (`[fullname]`, `[Vocative_web]`…): akaAgent không thay nên bị gửi nguyên văn. */
function scanLegacyTokens(scan: Scan): void {
  if (!usesTokens(scan.channel)) return
  LEGACY_TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LEGACY_TOKEN.exec(scan.text)) !== null) {
    const key = match[1].toLowerCase()
    const capital = match[1].charAt(0) !== match[1].charAt(0).toLowerCase()
    const replacement = key === 'vocative_web'
      ? (capital ? '#{SEX{Anh-Chị-Anh/Chị}}' : DEFAULT_SEX_EXAMPLE)
      : LEGACY_TOKEN_MAP[key]
    push(scan, 'legacy_token', 'warn', match.index, match.index + match[0].length,
      `${match[0]} là biến của phần mềm akaBiz cũ. akaAgent không thay biến này nên sẽ gửi nguyên văn. Biến tương ứng là ${replacement}.`,
      { start: match.index, end: match.index + match[0].length, text: replacement })
  }
}

function resolveHtml(text: string, html: boolean | 'auto' | undefined): boolean {
  if (html === true) return true
  if (html === 'auto') return HTML_TAG_HINT.test(text)
  return false
}

export function analyzeContentSyntax(content: string | null | undefined, options: ContentSyntaxOptions): ContentSyntaxResult {
  const raw = String(content || '')
  const isHtml = resolveHtml(raw, options.html)
  const text = isHtml ? htmlToText(raw) : raw
  const scan: Scan = { text, channel: options.channel, allowFix: !isHtml, issues: [] }

  // Quét "khoan dung": biến viết dở coi như đã đóng, ngoặc { mở dở coi như chữ thường.
  const openBraces: Array<{ index: number; closed: boolean }> = []
  const stack: number[] = []
  const pipes: Array<{ index: number; inside: number }> = []
  const escapedPipes: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (isEscapedSpecial(text, index)) {
      if (text[index + 1] === '|' && stack.length === 0) escapedPipes.push(index)
      index += 1
      continue
    }
    const char = text[index]
    if (char === '#' && text[index + 1] === '{') {
      index = scanToken(scan, index)
      continue
    }
    if (char === '{') {
      stack.push(openBraces.length)
      openBraces.push({ index, closed: false })
    } else if (char === '}') {
      if (stack.length === 0) {
        push(scan, 'brace_stray', 'warn', index, index + 1,
          'Dấu } này không có dấu { mở. Nếu muốn gửi đúng ký tự }, hãy viết \\}.',
          { start: index, end: index + 1, text: '\\}' })
      } else {
        openBraces[stack.pop() as number].closed = true
      }
    } else if (char === '|') {
      pipes.push({ index, inside: stack.length ? stack[stack.length - 1] : -1 })
    }
  }

  const actual = actualVariantSeparatorIndexes(text)
  const intended = pipes.filter(pipe => pipe.inside < 0 || !openBraces[pipe.inside].closed).map(pipe => pipe.index)
  const lostSeparators = intended.filter(index => actual.indexOf(index) < 0).length

  for (const brace of openBraces) {
    if (brace.closed) continue
    push(scan, 'brace_unclosed', lostSeparators > 0 ? 'block' : 'warn', brace.index, brace.index + 1,
      'Dấu { này chưa có dấu } đóng. Nếu muốn gửi đúng ký tự {, hãy viết \\{.')
  }
  if (!usesTokens(options.channel) && lostSeparators === 0) {
    for (const issue of scan.issues) {
      if (issue.code === 'token_unclosed') issue.severity = 'warn'
    }
  }

  // Dấu ngăn mẫu bị vô hiệu: `\|` đứng sát chỗ xuống dòng. App tự thêm `\` khi áp một biến thể của mẫu nội dung có
  // nhiều mẫu gõ liền nhau, nên hai mẫu bị gửi chung một tin.
  for (const index of escapedPipes) {
    if (!atLineStart(text, index) && !atLineEnd(text, index + 2)) continue
    push(scan, 'separator_escaped', 'warn', index, index + 2,
      'Dấu | này có dấu \\ đứng trước nên không còn ngăn mẫu: phần trước và phần sau nó sẽ được gửi chung một tin, kèm ký tự |. Nếu đây là chỗ ngăn hai mẫu, hãy bỏ dấu \\.',
      { start: index, end: index + 2, text: '|' })
  }

  // Dấu | trang trí bị hiểu là dấu ngăn mẫu: một mẫu chỉ vài chữ đứng cạnh mẫu dài, dấu | nằm giữa dòng.
  if (actual.length > 0) {
    const lengths: number[] = []
    const bounds: Array<[number, number]> = []
    let from = 0
    for (let position = 0; position <= actual.length; position += 1) {
      const to = position < actual.length ? actual[position] : text.length
      lengths.push(text.slice(from, to).trim().length)
      bounds.push([from, to])
      from = to + 1
    }
    if (Math.max.apply(null, lengths) > FRAGMENT_LONG_LENGTH) {
      actual.forEach((separator, position) => {
        if (atLineStart(text, separator) || atLineEnd(text, separator + 1)) return
        const side = lengths[position] > 0 && lengths[position] <= FRAGMENT_SHORT_LENGTH ? position
          : lengths[position + 1] > 0 && lengths[position + 1] <= FRAGMENT_SHORT_LENGTH ? position + 1 : -1
        if (side < 0) return
        const fragment = text.slice(bounds[side][0], bounds[side][1]).trim()
        push(scan, 'variant_fragment', 'warn', separator, separator + 1,
          `Dấu | này đang tách "${fragment}" thành một mẫu riêng: tới lượt mẫu đó người nhận chỉ nhận được ${lengths[side]} ký tự này. Nếu chỉ muốn hiện ký tự |, hãy viết \\|.`,
          { start: separator, end: separator + 1, text: '\\|' })
      })
    }
  }
  scanLegacyTokens(scan)

  scan.issues.sort((left, right) => left.start - right.start || left.end - right.end)
  return {
    text,
    issues: scan.issues,
    variantCount: countVariants(text, actual),
    separatorCount: actual.length,
    lostSeparators,
  }
}

export function blockingContentSyntaxIssues(result: ContentSyntaxResult): ContentSyntaxIssue[] {
  return result.issues.filter(issue => issue.severity === 'block')
}

/** Câu báo số mẫu của một ô nội dung; rỗng khi nội dung không có dấu `|` nào ngăn mẫu. */
export function contentVariantCountMessage(result: ContentSyntaxResult): string {
  if (result.lostSeparators > 0) {
    const pipes = result.separatorCount + result.lostSeparators
    return `Nội dung có ${pipes} dấu | ngăn mẫu nhưng chỉ tách được ${result.variantCount} mẫu. Các mẫu còn lại đang bị gộp chung vào một tin.`
  }
  if (result.variantCount > 1) return `Nội dung này có ${result.variantCount} mẫu, gửi luân phiên.`
  return ''
}

/** Câu trả cho khách khi không lưu được (dùng ở API và khi form không vẽ từng lỗi). */
export function contentSyntaxBlockMessage(label: string, result: ContentSyntaxResult): string {
  const blocking = blockingContentSyntaxIssues(result)
  if (blocking.length === 0) return ''
  const first = blocking[0]
  const merged = result.lostSeparators > 0
    ? ` Vì lỗi này, ${result.separatorCount + result.lostSeparators + 1 - result.variantCount} mẫu nội dung đang bị gộp chung vào một tin.`
    : ''
  const more = blocking.length > 1 ? ` (còn ${blocking.length - 1} lỗi khác)` : ''
  return `${label} còn lỗi cú pháp nên chưa lưu được: ${first.message}${merged}${more}`
}

/**
 * Áp "Sửa giúp" hàng loạt, lặp tới khi không còn gì để sửa (tối đa 5 vòng). Không dùng cho HTML.
 * Mặc định chỉ sửa lỗi mức chặn; cảnh báo (dấu `\|`, mẩu vụn, biến akaBiz cũ, dấu } thừa) là việc khách tự quyết từng chỗ,
 * muốn sửa hàng loạt thì nêu rõ `codes`.
 */
export function applyContentSyntaxFixes(content: string, options: ContentSyntaxOptions, codes?: ContentSyntaxCode[]): string {
  let text = String(content || '')
  for (let round = 0; round < 5; round += 1) {
    const result = analyzeContentSyntax(text, { channel: options.channel, html: false })
    const fixes = result.issues
      .filter(issue => issue.fix && (codes ? codes.indexOf(issue.code) >= 0 : issue.severity === 'block'))
      .map(issue => issue.fix as ContentSyntaxFix)
      .sort((left, right) => right.start - left.start)
    if (fixes.length === 0) break
    let lastStart = text.length + 1
    for (const fix of fixes) {
      if (fix.end > lastStart) continue
      text = text.slice(0, fix.start) + fix.text + text.slice(fix.end)
      lastStart = fix.start
    }
  }
  return text
}

export function applyContentSyntaxFix(content: string, fix: ContentSyntaxFix): string {
  const text = String(content || '')
  return text.slice(0, fix.start) + fix.text + text.slice(fix.end)
}

// ── Các ô nội dung của một chiến dịch ───────────────────────────────────────────────────────────────────────────

export function contentSyntaxChannelForAction(actionId: string | null | undefined): ContentSyntaxChannel {
  const action = String(actionId || '')
  if (action === 'sms_send') return 'sms'
  if (action === 'voice_call') return 'voice'
  if (action === 'email_send') return 'email'
  if (action.indexOf('zalo_') === 0) return 'zalo'
  return 'other'
}

export interface CampaignContentSyntaxInput {
  actionId?: string | null
  /** `undefined` = lần lưu này không gửi nội dung chính nên không kiểm. */
  content?: unknown
  extraSettings?: Record<string, unknown> | null
}

export interface CampaignContentFieldReport {
  /** Khoá ô: `content`, `emailSubject`, `advancedContentItems[2].content`… */
  field: string
  label: string
  result: ContentSyntaxResult
  /** Giá trị gốc của ô và cách ô đó được kiểm (để áp "Sửa giúp" lúc lưu). */
  value: string
  channel: ContentSyntaxChannel
  html: boolean
}

function fieldText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Kiểm mọi ô nội dung CÓ MẶT trong dữ liệu được lưu. Ô vắng mặt (undefined) không bị kiểm. */
export function analyzeCampaignContentFields(input: CampaignContentSyntaxInput): CampaignContentFieldReport[] {
  const channel = contentSyntaxChannelForAction(input.actionId)
  const extra = (input.extraSettings && typeof input.extraSettings === 'object' ? input.extraSettings : {}) as Record<string, unknown>
  const reports: CampaignContentFieldReport[] = []
  const add = (field: string, label: string, value: unknown, fieldChannel: ContentSyntaxChannel, html: boolean | 'auto', warnOnly = false) => {
    const text = fieldText(value)
    if (text === null) return
    const result = analyzeContentSyntax(text, { channel: fieldChannel, html })
    if (warnOnly) for (const issue of result.issues) issue.severity = 'warn'
    reports.push({ field, label, result, value: text, channel: fieldChannel, html: resolveHtml(text, html) })
  }
  const mainHtml: boolean | 'auto' = extra.formattedContentEnabled === true || extra.emailBodyIsHtml === true ? true : 'auto'

  add('content', 'Nội dung', input.content, channel, mainHtml)
  add('emailSubject', 'Tiêu đề email', extra.emailSubject, 'email', false)
  if (Array.isArray(extra.advancedContentItems)) {
    extra.advancedContentItems.forEach((item, index) => {
      if (!item || typeof item !== 'object') return
      const row = item as Record<string, unknown>
      add(`advancedContentItems[${index}].content`, `Nội dung ${index + 1}`, row.content, channel, 'auto')
      add(`advancedContentItems[${index}].emailSubject`, `Tiêu đề email của nội dung ${index + 1}`, row.emailSubject, 'email', false)
    })
  }
  add('friendRequestMessage', 'Lời mời kết bạn', extra.friendRequestMessage, 'zalo', false)
  // Tên gợi nhớ là nhãn nội bộ của khách (nhiều khách cố ý viết kiểu `#{TÊN DỰ ÁN}`): chỉ nhắc, không chặn.
  add('zaloAliasTemplate', 'Tên gợi nhớ', extra.zaloAliasTemplate, 'zalo', false, true)
  add('internalSmsContent', 'Nội dung SMS gửi kèm', extra.internalSmsContent, 'sms', false)
  add('externalSmsContent', 'Nội dung SMS gửi kèm (akaBiz Sms)', extra.externalSmsContent, 'other', false)
  add('commentContent', 'Nội dung comment', extra.commentContent, 'other', false)
  add('postBumpContent', 'Nội dung up tin', extra.postBumpContent, 'other', false)
  add('newsfeedCommentContent', 'Nội dung comment newsfeed', extra.newsfeedCommentContent, 'other', false)
  return reports
}

export interface CampaignContentSyntaxVerdict {
  ok: boolean
  /** Ô đầu tiên còn lỗi mức chặn. */
  field: string | null
  message: string
  reports: CampaignContentFieldReport[]
}

/** Kết luận cho một lần lưu. `mode` khác `block` thì luôn `ok`. */
export function checkCampaignContentSyntax(input: CampaignContentSyntaxInput, mode: ContentSyntaxGuardMode = 'block'): CampaignContentSyntaxVerdict {
  if (mode === 'off') return { ok: true, field: null, message: '', reports: [] }
  const reports = analyzeCampaignContentFields(input)
  if (mode === 'block') {
    for (const report of reports) {
      const message = contentSyntaxBlockMessage(report.label, report.result)
      if (message) return { ok: false, field: report.field, message, reports }
    }
  }
  return { ok: true, field: null, message: '', reports }
}

// ── Cảnh báo hỏi lại lúc lưu ────────────────────────────────────────────────────────────────────────────────────

/** Ba cảnh báo "nội dung có thể gửi không đúng ý" được hỏi lại một lần lúc lưu. */
export const CONTENT_SYNTAX_SAVE_WARNING_CODES: ContentSyntaxCode[] = ['separator_escaped', 'variant_fragment', 'legacy_token']

export interface CampaignContentSaveWarning {
  count: number
  /** Dấu nhận ra đúng nội dung đã hỏi: khách chọn "Vẫn lưu" thì không hỏi lại cùng nội dung đó. */
  signature: string
  title: string
  message: string
  /** Giá trị đã sửa theo khoá ô (`content`, `advancedContentItems[2].content`…); rỗng khi không sửa hộ được. */
  fixes: Record<string, string>
  fixText: string
  keepText: string
  backText: string
}

/**
 * Câu hỏi lúc lưu khi nội dung có dấu ngăn mẫu bị vô hiệu, mẩu vài chữ do dấu | trang trí hoặc biến akaBiz cũ.
 * `null` = không có gì để hỏi (hoặc công tắc đang `off`). Không chặn lưu: khách chọn sửa giúp hoặc vẫn lưu.
 */
export function campaignContentSaveWarning(input: CampaignContentSyntaxInput, mode: ContentSyntaxGuardMode = 'block'): CampaignContentSaveWarning | null {
  if (mode === 'off') return null
  const counts: Record<string, number> = {}
  const fixes: Record<string, string> = {}
  const signature: string[] = []
  let count = 0
  let legacyExample = ''
  let legacyReplacement = ''
  for (const report of analyzeCampaignContentFields(input)) {
    const found = report.result.issues.filter(issue => CONTENT_SYNTAX_SAVE_WARNING_CODES.indexOf(issue.code) >= 0)
    if (found.length === 0) continue
    count += found.length
    signature.push(report.field, report.value)
    for (const issue of found) {
      counts[issue.code] = (counts[issue.code] || 0) + 1
      if (issue.code === 'legacy_token' && !legacyExample) {
        legacyExample = report.result.text.slice(issue.start, issue.end)
        legacyReplacement = issue.fix ? issue.fix.text : ''
      }
    }
    if (!report.html) {
      // Chỉ sửa đúng các chỗ vừa nêu (một lượt): chỗ mới lộ ra sau khi sửa sẽ được hỏi ở lần lưu kế tiếp.
      let fixed = report.value
      let lastStart = fixed.length + 1
      const ordered = found.filter(issue => issue.fix).map(issue => issue.fix as ContentSyntaxFix).sort((left, right) => right.start - left.start)
      for (const fix of ordered) {
        if (fix.end > lastStart) continue
        fixed = fixed.slice(0, fix.start) + fix.text + fixed.slice(fix.end)
        lastStart = fix.start
      }
      if (fixed !== report.value) fixes[report.field] = fixed
    }
  }
  if (count === 0) return null
  const fixable = Object.keys(fixes).length > 0
  const lines: string[] = []
  if (counts.separator_escaped) {
    lines.push(`• ${counts.separator_escaped} dấu \\| nằm riêng ở đầu hoặc cuối dòng nên các mẫu hai bên đang gửi chung một tin.`
      + (fixable ? ' Sửa giúp: đổi thành dấu | để tách mẫu.' : ''))
  }
  if (counts.variant_fragment) {
    lines.push(`• ${counts.variant_fragment} dấu | giữa dòng đang cắt một mẩu vài chữ thành mẫu riêng.`
      + (fixable ? ' Sửa giúp: đổi thành \\| để chỉ hiện ký tự |.' : ''))
  }
  if (counts.legacy_token) {
    lines.push(`• ${counts.legacy_token} biến của phần mềm akaBiz cũ (ví dụ ${legacyExample}) sẽ bị gửi nguyên văn.`
      + (fixable && legacyReplacement ? ` Sửa giúp: đổi sang biến tương ứng (${legacyReplacement}).` : ''))
  }
  return {
    count,
    signature: signature.join('\u0001'),
    title: 'Nội dung có chỗ cần xem lại',
    message: `Nội dung có thể gửi không đúng ý bạn:\n${lines.join('\n')}`
      + (fixable ? '\n\nBấm "Sửa giúp" để phần mềm sửa các chỗ này, bạn xem lại rồi lưu.' : ''),
    fixes,
    fixText: 'Sửa giúp',
    keepText: 'Vẫn lưu',
    backText: 'Quay lại sửa',
  }
}

/** Áp `fixes` của `campaignContentSaveWarning` vào một bản ghi phẳng kiểu form (`content`, `friendRequestMessage`, `advancedContentItems`…). */
export function applyCampaignContentFixes<T extends object>(values: T, fixes: Record<string, string>): T {
  const next: Record<string, unknown> = { ...(values as Record<string, unknown>) }
  for (const field of Object.keys(fixes)) {
    const item = /^advancedContentItems\[(\d+)\]\.(content|emailSubject)$/.exec(field)
    if (item) {
      const rows = Array.isArray(next.advancedContentItems) ? next.advancedContentItems.slice() : []
      const index = Number(item[1])
      if (rows[index] && typeof rows[index] === 'object') {
        rows[index] = { ...(rows[index] as Record<string, unknown>), [item[2]]: fixes[field] }
        next.advancedContentItems = rows
      }
    } else if (typeof next[field] === 'string') next[field] = fixes[field]
  }
  return next as T
}

/** Đọc giá trị của khoá cài đặt `campaign.content_syntax_guard`. Thiếu hoặc không hiểu = `block`. */
export function parseContentSyntaxGuardMode(value: unknown): ContentSyntaxGuardMode {
  let raw: unknown = value
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '"') {
      try {
        raw = JSON.parse(trimmed)
      } catch {
        raw = trimmed
      }
    } else raw = trimmed
  }
  if (raw && typeof raw === 'object') raw = (raw as Record<string, unknown>).mode
  const mode = String(raw ?? '').trim().toLowerCase()
  return mode === 'warn' || mode === 'off' ? mode : 'block'
}
