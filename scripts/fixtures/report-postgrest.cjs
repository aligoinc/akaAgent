// Minimal read-only PostgREST predicate evaluator for report regression fixtures.
function split(source) {
  const result = []; let start = 0, depth = 0, quoted = false, escaped = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\' && quoted) { escaped = true; continue }
    if (c === '"') quoted = !quoted
    if (!quoted) {
      if (c === '(') depth++
      if (c === ')') depth--
      if (c === ',' && depth === 0) { result.push(source.slice(start,i)); start = i + 1 }
    }
  }
  result.push(source.slice(start)); return result
}
function value(row, path) { return path.split('.').reduce((v,k) => v?.[k], row) }
function scalar(raw) { return raw.startsWith('"') ? JSON.parse(raw) : raw }
function compare(a, b) {
  const stamp = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d[T ]/.test(v)
  if (stamp(a) && stamp(b)) {
    const micros = v => BigInt(Date.parse(v)) * 1000n + BigInt(((v.match(/\.(\d+)/)?.[1] || '').padEnd(6,'0')).slice(3,6))
    const x=micros(a),y=micros(b);return x<y?-1:x>y?1:0
  }
  if (typeof a === 'number' || typeof b === 'number') return Number(a)-Number(b)
  return String(a).localeCompare(String(b))
}
function match(row, expression) {
  for (const op of ['or','and']) if (expression.startsWith(op+'(') && expression.endsWith(')')) {
    const conditions = split(expression.slice(op.length + 1,-1)); return op==='or' ? conditions.some(x=>match(row,x)) : conditions.every(x=>match(row,x))
  }
  const m = /^(.*?)\.(eq|neq|in|is|gt|gte|lt|lte)\.(.*)$/.exec(expression)
  if (!m) throw new Error('Unsupported report predicate '+expression)
  const [,key,op,raw]=m,v=value(row,key),expected=scalar(raw)
  if (op==='eq') return String(v)===String(expected)
  if (op==='neq') return String(v)!==String(expected)
  if (op==='in') return split(raw.slice(1,-1)).map(scalar).map(String).includes(String(v))
  if (op==='is') return expected==='null'?v==null:String(v)===String(expected)
  if(v==null) return false
  const c=compare(v,expected)
  return op==='gt'?c>0:op==='gte'?c>=0:op==='lt'?c<0:c<=0
}
module.exports={split,value,compare,match}
