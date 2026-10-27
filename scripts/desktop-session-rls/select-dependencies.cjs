// Read-only PostgREST projection audit. Unknown relationships/expressions stop
// the inventory instead of silently treating them as unused permissions.
function embeddedRelations(projection, knownRelations) {
  const found = new Set()
  function parseList(input) {
    let start = 0, depth = 0, quoted = false
    for (let i = 0; i <= input.length; i++) {
      const ch = input[i]
      if (ch === '"') {
        if (quoted && input[i + 1] === '"') { i++; continue }
        quoted = !quoted
      }
      if (!quoted) {
        if (ch === '(') depth++
        if (ch === ')' && --depth < 0) throw new Error('Unbalanced select projection')
        if ((ch === ',' && depth === 0) || i === input.length) {
          parseItem(input.slice(start, i).trim())
          start = i + 1
        }
      }
    }
    if (quoted || depth) throw new Error('Unbalanced select projection')
  }
  function parseItem(item) {
    let quoted = false, open = -1, close = -1, depth = 0
    for (let i = 0; i < item.length; i++) {
      if (item[i] === '"') {
        if (quoted && item[i + 1] === '"') { i++; continue }
        quoted = !quoted
      }
      if (quoted) continue
      if (item[i] === '(') { if (depth++ === 0) open = i }
      if (item[i] === ')' && --depth === 0) close = i
    }
    if (open < 0) return
    const prefix = item.slice(0, open).trim().replace(/^\.\.\./, '')
    const body = item.slice(open + 1, close)
    const identifier = '(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z_0-9$]*)'
    const relationship = new RegExp(`^(?:${identifier}\\s*:\\s*)?(${identifier})(?:\\s*!\\s*${identifier})*\\s*$`)
    const match = prefix.match(relationship)
    const name = match?.[1].replace(/^"|"$/g, '').replaceAll('""', '"')
    if (name && knownRelations.has(name)) {
      if (item.slice(close + 1).trim() && !/^\s*::[\w]+\s*$/.test(item.slice(close + 1))) throw new Error('Unsupported relationship suffix: '+item)
      found.add(name)
      parseList(body) // Empty embeddings still need SELECT for their join/filter.
      return
    }
    // PostgREST aggregates are columns, not embedded tables.
    if (!body.trim() && /^(?:[\w]+:)?(?:[\w]+(?:->[>]?"?[\w]+"?)?(?:::[\w]+)?\.)?(?:count|sum|avg|min|max)$/.test(prefix)) return
    throw new Error('Unresolved embedded relationship: '+prefix)
  }
  parseList(projection)
  return [...found].sort()
}

function staticStrings(node, checker, ts, seen = new Set()) {
  if (!node) return ['*']
  if (seen.has(node)) return null
  seen = new Set(seen).add(node)
  if (ts.isStringLiteralLike(node)) return [node.text]
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return staticStrings(node.expression, checker, ts, seen)
  const type = checker.getTypeAtLocation(node), types = type.isUnion() ? type.types : [type]
  if (types.every(t => t.isStringLiteral())) return [...new Set(types.map(t => t.value))]
  const merge = arrays => arrays.some(a => !a) ? null : [...new Set(arrays.flat())]
  const product = (left, right, separator = '') => !left || !right || left.length * right.length > 256 ? null
    : [...new Set(left.flatMap(a => right.map(b => a + separator + b)))]
  const resolve = value => staticStrings(value, checker, ts, seen)
  if (ts.isConditionalExpression(node)) return merge([resolve(node.whenTrue), resolve(node.whenFalse)])
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return product(resolve(node.left), resolve(node.right))
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text]
    for (const span of node.templateSpans) values = product(product(values, resolve(span.expression)), [span.literal.text])
    return values
  }
  if (ts.isIdentifier(node)) {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    const declaration = symbol?.valueDeclaration
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return resolve(declaration.initializer)
    if (declaration && ts.isParameter(declaration)) {
      const fn = declaration.parent, index = fn.parameters.indexOf(declaration), values = []
      function visit(current) {
        if (ts.isCallExpression(current) && checker.getResolvedSignature(current)?.declaration === fn) {
          values.push(resolve(current.arguments[index] || declaration.initializer))
        }
        ts.forEachChild(current, visit)
      }
      visit(declaration.getSourceFile())
      if (values.length) return merge(values)
    }
  }
  // Local zero-argument projection builders (for example trusted Server vs.
  // Desktop columns). Resolve every return branch without executing the code.
  if (ts.isCallExpression(node) && node.arguments.length === 0) {
    const fn = checker.getResolvedSignature(node)?.declaration
    if (fn?.body) {
      if (!ts.isBlock(fn.body)) return resolve(fn.body)
      const values = []
      const visit = current => {
        if (ts.isReturnStatement(current)) values.push(resolve(current.expression))
        else if (!ts.isFunctionLike(current)) ts.forEachChild(current, visit)
      }
      visit(fn.body)
      if (values.length) return merge(values)
    }
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'join') {
    const delimiter = node.arguments[0] ? resolve(node.arguments[0]) : [',']
    if (!delimiter || delimiter.length !== 1) return null
    // Interpret only pure, static array/string operations; never execute source.
    const predicate = (expr, parameter, value) => {
      if (ts.isParenthesizedExpression(expr)) return predicate(expr.expression, parameter, value)
      if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
        const result = predicate(expr.operand, parameter, value)
        return result === null ? null : !result
      }
      if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(expr.operatorToken.kind)) {
        const a = predicate(expr.left, parameter, value), b = predicate(expr.right, parameter, value)
        return a === null || b === null ? null : expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ? a || b : a && b
      }
      if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)
        && ts.isIdentifier(expr.expression.expression) && expr.expression.expression.text === parameter
        && ['includes', 'startsWith', 'endsWith'].includes(expr.expression.name.text) && expr.arguments.length === 1) {
        const args = resolve(expr.arguments[0])
        if (args?.length === 1) return value[expr.expression.name.text](args[0])
      }
      return null
    }
    const arrays = expression => {
      if (ts.isArrayLiteralExpression(expression)) {
        let rows = [[]]
        for (const element of expression.elements) {
          if (ts.isSpreadElement(element)) return null
          const values = resolve(element)
          if (!values || rows.length * values.length > 256) return null
          rows = rows.flatMap(row => values.map(value => [...row, value]))
        }
        return rows
      }
      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return null
      const call = expression.expression
      if (call.name.text === 'split' && expression.arguments.length === 1) {
        const values = resolve(call.expression), separators = resolve(expression.arguments[0])
        return values && separators?.length === 1 ? values.map(value => value.split(separators[0])) : null
      }
      if (call.name.text === 'filter' && expression.arguments.length === 1) {
        const fn = expression.arguments[0], rows = arrays(call.expression)
        if (!rows || !ts.isArrowFunction(fn) || fn.parameters.length !== 1 || !ts.isIdentifier(fn.parameters[0].name)) return null
        const filtered = []
        for (const row of rows) {
          const result = []
          for (const value of row) {
            const keep = predicate(fn.body, fn.parameters[0].name.text, value)
            if (keep === null) return null
            if (keep) result.push(value)
          }
          filtered.push(result)
        }
        return filtered
      }
      return null
    }
    return arrays(node.expression.expression)?.map(row => row.join(delimiter[0])) ?? null
  }
  return null
}
module.exports = { embeddedRelations, staticStrings }
