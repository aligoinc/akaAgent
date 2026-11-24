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

const HTML_TAG_HINT = /<\/?(p|div|br|span|strong|em|b|i|u|s|a|ul|ol|li|h[1-6]|blockquote|img|table|tr|td)\b[^>]*>/i

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
  for (let index = 0; index < text.length; index += 1) {
    if (isEscapedSpecial(text, index)) {
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

/** Áp mọi "Sửa giúp" có sẵn, lặp tới khi không còn gì để sửa (tối đa 5 vòng). Không dùng cho HTML. */
export function applyContentSyntaxFixes(content: string, options: ContentSyntaxOptions, codes?: ContentSyntaxCode[]): string {
  let text = String(content || '')
  for (let round = 0; round < 5; round += 1) {
    const result = analyzeContentSyntax(text, { channel: options.channel, html: false })
    const fixes = result.issues
      .filter(issue => issue.fix && issue.code !== 'brace_stray' && (!codes || codes.indexOf(issue.code) >= 0))
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
    reports.push({ field, label, result })
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
