import { resolveValue, interpolate, type InterpolationScope } from './interpolate.js'

/**
 * Eval condition expression an toàn (KHÔNG dùng eval()/Function() trực tiếp).
 *
 * Phase 2: subset đơn giản — interpolate {{nodeId.field}} → giá trị, sau đó parse manual:
 *   - "{{a.x}} === 'pending'"
 *   - "{{a.x}} > 5"
 *   - "{{a.x}} === true"
 *   - "{{a.x}} && {{b.y}} !== 'done'"  (logic && || có thể support sau)
 *
 * Phase 5+: dùng `expr-eval` hoặc `jsep` library cho expression phức tạp hơn.
 *
 * Trả về boolean. Nếu syntax không hỗ trợ → throw để dev biết.
 */

const SUPPORTED_OPS = ['===', '!==', '==', '!=', '>=', '<=', '>', '<', '&&', '||']

export function evaluateCondition(expression: string, scope: InterpolationScope): boolean {
  if (!expression || expression.trim() === '') return false

  const interpolated = interpolate(expression, scope).trim()

  // Trường hợp đơn giản: chỉ là literal hoặc đã thành true/false
  if (interpolated === 'true') return true
  if (interpolated === 'false' || interpolated === '' || interpolated === 'null' || interpolated === 'undefined') return false

  // Tách logic && ||
  if (interpolated.includes('&&')) {
    return interpolated.split('&&').every(part => evaluateAtom(part.trim()))
  }
  if (interpolated.includes('||')) {
    return interpolated.split('||').some(part => evaluateAtom(part.trim()))
  }

  return evaluateAtom(interpolated)
}

function evaluateAtom(expr: string): boolean {
  for (const op of SUPPORTED_OPS) {
    if (op === '&&' || op === '||') continue
    const idx = expr.indexOf(op)
    if (idx > 0) {
      const left = parseLiteral(expr.slice(0, idx).trim())
      const right = parseLiteral(expr.slice(idx + op.length).trim())
      switch (op) {
        case '===': return left === right
        case '!==': return left !== right
        case '==': return left == right
        case '!=': return left != right
        case '>=': return Number(left) >= Number(right)
        case '<=': return Number(left) <= Number(right)
        case '>':  return Number(left) > Number(right)
        case '<':  return Number(left) < Number(right)
      }
    }
  }
  // Không có operator → truthy check
  const literal = parseLiteral(expr.trim())
  return Boolean(literal)
}

function parseLiteral(s: string): unknown {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  if (s === 'undefined') return undefined
  // String literal 'foo' hoặc "foo"
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1)
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // Otherwise: raw string (after interpolation)
  return s
}

// Re-export resolveValue cho convenience
export { resolveValue }
