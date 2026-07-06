export type ContentSpinRng = () => number

export interface SplitContentVariantsOptions {
  trim?: boolean
  filterEmpty?: boolean
  fallbackToRaw?: boolean
}

export interface RenderContentSpinOptions {
  rng?: ContentSpinRng
}

const ESCAPABLE_CHARS = new Set(['{', '}', '|', '\\'])
const MAX_RENDER_DEPTH = 50

const isEscapedSpecial = (value: string, index: number): boolean => (
  value[index] === '\\' && index + 1 < value.length && ESCAPABLE_CHARS.has(value[index + 1])
)

function findTemplateTokenEnd(value: string, hashIndex: number): number | null {
  if (value[hashIndex] !== '#' || value[hashIndex + 1] !== '{') return null

  let depth = 1
  for (let index = hashIndex + 2; index < value.length; index += 1) {
    if (isEscapedSpecial(value, index)) {
      index += 1
      continue
    }

    const ch = value[index]
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
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

    const ch = value[index]
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      if (depth === 0) return index
      depth -= 1
    }
  }

  return null
}

function findSpinGroupEnd(value: string, openIndex: number): number | null {
  if (value[openIndex] !== '{') return null
  if (openIndex > 0 && value[openIndex - 1] === '#') return null

  let depth = 0
  let hasTopLevelPipe = false

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

    const ch = value[index]
    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      if (depth === 0) return hasTopLevelPipe ? index : null
      depth -= 1
    } else if (ch === '|' && depth === 0) {
      hasTopLevelPipe = true
    }
  }

  return null
}

function splitTopLevelPipe(
  value: string,
  options: Required<Pick<SplitContentVariantsOptions, 'trim' | 'filterEmpty'>>
): string[] {
  const parts: string[] = []
  let start = 0

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

    if (value[index] !== '|') continue

    const rawPart = value.slice(start, index)
    const part = options.trim ? rawPart.trim() : rawPart
    if (!options.filterEmpty || part.length > 0) parts.push(part)
    start = index + 1
  }

  const rawTail = value.slice(start)
  const tail = options.trim ? rawTail.trim() : rawTail
  if (!options.filterEmpty || tail.length > 0) parts.push(tail)
  return parts
}

export function splitContentVariants(
  content: string | undefined | null,
  options: SplitContentVariantsOptions = {}
): string[] {
  const raw = String(content || '')
  const trim = options.trim ?? true
  const filterEmpty = options.filterEmpty ?? true
  const fallbackToRaw = options.fallbackToRaw ?? false
  const variants = splitTopLevelPipe(raw, { trim, filterEmpty })

  if (variants.length > 0) return variants
  if (!fallbackToRaw) return []
  return [trim ? raw.trim() : raw]
}

function renderSpin(
  content: string,
  chooseOption: (renderedOptions: string[]) => string,
  depth: number
): string {
  if (depth > MAX_RENDER_DEPTH) return unescapeContentSpin(content)

  let rendered = ''

  for (let index = 0; index < content.length; index += 1) {
    if (isEscapedSpecial(content, index)) {
      rendered += content[index + 1]
      index += 1
      continue
    }

    const tokenEnd = findTemplateTokenEnd(content, index)
    if (tokenEnd !== null) {
      rendered += content.slice(index, tokenEnd + 1)
      index = tokenEnd
      continue
    }

    const spinEnd = findSpinGroupEnd(content, index)
    if (spinEnd !== null) {
      const inner = content.slice(index + 1, spinEnd)
      const options = splitTopLevelPipe(inner, { trim: false, filterEmpty: false })
      const renderedOptions = options.map(option => renderSpin(option, chooseOption, depth + 1))
      rendered += chooseOption(renderedOptions)
      index = spinEnd
      continue
    }

    rendered += content[index]
  }

  return rendered
}

export function renderContentSpin(
  content: string | undefined | null,
  options: RenderContentSpinOptions = {}
): string {
  const rng = options.rng || Math.random
  return renderSpin(String(content || ''), renderedOptions => {
    if (renderedOptions.length === 0) return ''
    const rawIndex = Math.floor(rng() * renderedOptions.length)
    const safeIndex = Math.max(0, Math.min(renderedOptions.length - 1, rawIndex))
    return renderedOptions[safeIndex] || ''
  }, 0)
}

export function renderContentSpinMax(content: string | undefined | null): string {
  return renderSpin(String(content || ''), renderedOptions => {
    if (renderedOptions.length === 0) return ''
    return renderedOptions.reduce((best, item) => (
      item.length > best.length ? item : best
    ), renderedOptions[0] || '')
  }, 0)
}

export function unescapeContentSpin(content: string | undefined | null): string {
  const raw = String(content || '')
  let output = ''

  for (let index = 0; index < raw.length; index += 1) {
    if (isEscapedSpecial(raw, index)) {
      output += raw[index + 1]
      index += 1
      continue
    }
    output += raw[index]
  }

  return output
}
