/**
 * String interpolation: {{nodeId.field}} hoặc {{nodeId.field.path.to.deep}} hoặc {{nodeId.field | json}}
 *
 * - Primitive value → String() (vd "hello" → "hello", 42 → "42", true → "true")
 * - Object/array → JSON.stringify
 * - Modifier `| json` → force JSON.stringify
 * - Path không tồn tại → empty string ""
 *
 * Cũng support {{input.X}}, {{secret.X}}, {{run.X}} cho các scope đặc biệt.
 */

export type InterpolationScope = Record<string, unknown>

const TEMPLATE_RE = /\{\{\s*([^}|\s]+)(?:\s*\|\s*([a-zA-Z]+))?\s*\}\}/g

export function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function formatValue(value: unknown, modifier?: string): string {
  if (value === undefined || value === null) return ''
  if (modifier === 'json') return JSON.stringify(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Interpolate template string với scope.
 * Scope là object có top-level keys (vd { nodeId1: {...}, input: {...}, secret: {...} }).
 */
export function interpolate(template: string, scope: InterpolationScope): string {
  return template.replace(TEMPLATE_RE, (_, expr: string, modifier?: string) => {
    const value = getByPath(scope, expr)
    return formatValue(value, modifier)
  })
}

/**
 * Resolve một giá trị có thể là string template hoặc giá trị thuần. Object/array sẽ recursive interpolate.
 */
export function resolveValue(value: unknown, scope: InterpolationScope): unknown {
  if (typeof value === 'string') {
    // Nếu toàn bộ string là 1 template duy nhất → trả raw value (preserve type)
    const fullMatch = value.match(/^\s*\{\{\s*([^}|\s]+)(?:\s*\|\s*([a-zA-Z]+))?\s*\}\}\s*$/)
    if (fullMatch && fullMatch[1]) {
      const raw = getByPath(scope, fullMatch[1])
      if (fullMatch[2] === 'json') return JSON.stringify(raw)
      return raw
    }
    return interpolate(value, scope)
  }
  if (Array.isArray(value)) {
    return value.map(v => resolveValue(v, scope))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveValue(v, scope)
    }
    return result
  }
  return value
}
