// Inventory the actual operations, rather than copying a role's old ACLs.
// No database connections. The checked-in report is input to the SQL audit.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const { createHash } = require('node:crypto')
const { embeddedRelations, staticStrings } = require('./select-dependencies.cjs')
const root = path.resolve(__dirname, '../..')
const dir = path.join(root, 'migrations/snapshots/desktop-session-rls')
const previous = JSON.parse(fs.readFileSync(path.join(dir, 'source-access.json')))
const config = ts.readConfigFile(path.join(root, 'tsconfig.node.json'), ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, parsed.options), checker = program.getTypeChecker()
const records = [], selects = [], unresolved = []
const knownRelations = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'least-privilege-preflight.json')))
  .relations.filter(t => t.schema === 'public' && t.kind !== 'S').map(t => t.name))
// Two Record<string, unknown> payloads cross a local function/array boundary.
// Reviewed against the concrete builders; the source assertions prevent silent
// broadening when those builders change.
const reviewedPayloads = {
  'src/main/data/repositories/accountContactRepository.ts:2457': ['account_id','contact_type','flatform_type','uid','name','url','extra_data','is_delete','zalo_user_id','staff_id','organization_id','updated_at','is_friend'],
  'src/main/data/repositories/campaignRepository.ts:2262': ['content','phone_carrier','schedule']
}
const reviewedFiles = {
  'src/main/data/repositories/accountContactRepository.ts': 'fefa5011a69770140f88997adb47dbb14f2bec223023e0f9932accef60b9b382',
  'src/main/data/repositories/campaignRepository.ts': '7bf2aa5f13eb2f99d753ee92f8c3e8b87162b3744b333ab3f94b8cf1a446ff9d'
}
for (const [file, checksum] of Object.entries(reviewedFiles)) {
  if (createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex') !== checksum) {
    throw new Error('Review the manually resolved write payload before refreshing permissions: '+file)
  }
}
function enclosing(node, predicate) { for (let n = node.parent; n; n = n.parent) if (predicate(n)) return n }
function functionName(node) {
  const f = enclosing(node, n => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n))
  return f?.name?.getText() || null
}
function columns(arg, seen = new Set()) {
  if (!arg) return []
  if (seen.has(arg)) return null
  seen = new Set(seen).add(arg)
  if (ts.isAsExpression(arg) || ts.isParenthesizedExpression(arg)) return columns(arg.expression, seen)
  const merge = values => values.some(v => v === null) ? null : [...new Set(values.flat())].sort()
  if (ts.isObjectLiteralExpression(arg)) return merge(arg.properties.map(p => {
    if (ts.isSpreadAssignment(p)) return columns(p.expression, seen)
    if (p.name && !ts.isComputedPropertyName(p.name)) return [p.name.text]
    if (p.name && ts.isComputedPropertyName(p.name) && ts.isStringLiteralLike(p.name.expression)) return [p.name.expression.text]
    return null
  }))
  if (ts.isArrayLiteralExpression(arg)) return merge(arg.elements.map(n => columns(ts.isSpreadElement(n) ? n.expression : n, seen)))
  if (ts.isConditionalExpression(arg)) return merge([columns(arg.whenTrue, seen), columns(arg.whenFalse, seen)])
  // Resolve builders/initializers before trusting an inferred object type:
  // {...Record<string, unknown>, staff_id} has only staff_id in that type.
  if (ts.isIdentifier(arg)) {
    const symbol = checker.getSymbolAtLocation(arg)
    const declaration = symbol?.valueDeclaration
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const found = [columns(declaration.initializer, seen)]
      const visit = n => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
          && n.expression.getText() === 'Object.assign' && n.arguments[0]
          && checker.getSymbolAtLocation(n.arguments[0]) === symbol) {
          found.push(...n.arguments.slice(1).map(value => columns(value, seen)))
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          if (ts.isIdentifier(n.left) && checker.getSymbolAtLocation(n.left) === symbol) found.push(columns(n.right, seen))
          if (ts.isPropertyAccessExpression(n.left) && checker.getSymbolAtLocation(n.left.expression) === symbol) found.push([n.left.name.text])
          if (ts.isElementAccessExpression(n.left) && checker.getSymbolAtLocation(n.left.expression) === symbol) {
            const indexType = checker.getTypeAtLocation(n.left.argumentExpression)
            const options = indexType.isUnion() ? indexType.types : [indexType]
            found.push(options.every(t => t.isStringLiteral()) ? options.map(t => t.value) : null)
          }
        }
        ts.forEachChild(n, visit)
      }
      visit(declaration.getSourceFile())
      return merge(found)
    }
  }
  if (ts.isCallExpression(arg)) {
    if (arg.expression.getText() === 'removeUndefined') {
      const declaration = checker.getResolvedSignature(arg)?.declaration
      const body = declaration?.body?.getText().replace(/\s/g, '')
      if (body !== '{returnObject.fromEntries(Object.entries(payload).filter(([,value])=>value!==undefined))asPartial<T>}') {
        throw new Error('Review removeUndefined before resolving payload columns')
      }
      return columns(arg.arguments[0], seen)
    }
    let fn
    if (ts.isPropertyAccessExpression(arg.expression) && arg.expression.name.text === 'map') {
      const callback = arg.arguments[0]
      fn = callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : checker.getSymbolAtLocation(callback)?.valueDeclaration
    } else fn = checker.getResolvedSignature(arg)?.declaration
    if (fn?.body) {
      if (!ts.isBlock(fn.body)) return columns(fn.body, seen)
      const results = []
      const visit = n => {
        if (ts.isReturnStatement(n) && n.expression) results.push(columns(n.expression, seen))
        else if (!(ts.isFunctionLike(n) && n !== fn)) ts.forEachChild(n, visit)
      }
      visit(fn.body)
      if (results.length) return merge(results)
    }
  }
  let type = checker.getTypeAtLocation(arg)
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
  if (element) type = element
  if (!checker.getIndexTypeOfType(type, ts.IndexKind.String) && !(type.flags & ts.TypeFlags.Any)) {
    const props = checker.getPropertiesOfType(type).map(p => p.name).sort()
    if (props.length) return props
  }
  return null
}
for (const source of program.getSourceFiles().filter(s => s.fileName.startsWith(path.join(root, 'src')))) {
  const file = path.relative(root, source.fileName)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text, receiver = node.expression.expression.getText(source)
      // Inspect every PostgREST select, including calls made after a query was
      // assigned to a variable. Embedded relations need privileges of their own.
      if (method === 'select' && checker.typeToString(checker.getTypeAtLocation(node.expression.expression)).includes('Postgrest')) {
        const location = `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
        const serverOnly = file.endsWith('/serverRuntimeRepository.ts')
          || (file.endsWith('/zaloCampaignEngagement.ts') && functionName(node) === 'prepareServerOwner')
        const projections = staticStrings(node.arguments[0], checker, ts)
        try {
          if (!projections) throw new Error('Unresolved select projection')
          selects.push({ location, serverOnly, projections,
            relations: [...new Set(projections.flatMap(value => embeddedRelations(value, knownRelations)))].sort() })
        } catch (error) { unresolved.push({ location, method, expression: node.arguments[0]?.getText(source), error: error.message }) }
      }
      if (['from', 'rpc'].includes(method) && !['Buffer', 'Array', 'this'].includes(receiver)
        && !(file.endsWith('/dataGroupExternalSyncRepository.ts') && ['context()', 'ctx'].includes(receiver))) {
        const arg = node.arguments[0], line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const location = `${file}:${line}`, fn = functionName(node)
        const dynamic = previous.dynamic.find(d => d.location === location)
          || previous.dynamic.find(d => d.location.split(':')[0] === file && d.method === method && d.expression === arg?.getText(source))
        const names = arg && ts.isStringLiteralLike(arg) ? [arg.text] : dynamic?.resolved
        if (!names) { unresolved.push({ location, method, expression: arg?.getText(source) }); return }
        // These paths belong to the centrally operated Server, which uses its
        // independent backend role. Desktop has RPC equivalents for staff.
        const serverOnly = file.endsWith('/serverRuntimeRepository.ts')
          || (file.endsWith('/staffIntegrationRepository.ts') && method === 'from' && names.includes('org_staff'))
          || (file.endsWith('/zaloCampaignEngagement.ts') && fn === 'prepareServerOwner')
        const operations = [], payloads = [], chain = []
        let top = node
        while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top
          && ts.isCallExpression(top.parent.parent) && top.parent.parent.expression === top.parent) {
          top = top.parent.parent
          const name = top.expression.name.text
          chain.push(name)
          if (['select', 'insert', 'update', 'delete', 'upsert'].includes(name)) {
            operations.push(...(name === 'upsert' ? ['INSERT', 'UPDATE'] : [name.toUpperCase()]))
            if (['insert', 'update', 'upsert'].includes(name)) payloads.push({ operation: name, columns: columns(top.arguments[0]) ?? reviewedPayloads[location] ?? null, expression: top.arguments[0]?.getText(source) })
          }
        }
        if (method === 'from' && !operations.length) unresolved.push({ location, method, expression: top.getText(source) })
        for (const name of names) records.push({ name, method, location, function: fn, serverOnly, operations: [...new Set(operations)].sort(), payloads, chain,
          ...(method === 'rpc' ? { parameters: columns(node.arguments[1]) } : {}) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
const result = { records, selects, unresolved }
fs.writeFileSync(path.join(dir, 'least-privilege-source.json'), JSON.stringify(result, null, 2) + '\n')
const tables = {}
for (const r of records.filter(r => r.method === 'from' && !r.serverOnly)) {
  const t = tables[r.name] ||= { operations: new Set(), unknownPayloads: [] }
  r.operations.forEach(p => t.operations.add(p))
  for (const p of r.payloads.filter(p => !p.columns)) t.unknownPayloads.push({ location: r.location, ...p })
}
console.log(JSON.stringify({ records: records.length, unresolved, tables: Object.fromEntries(Object.entries(tables).sort().map(([name,t]) => [name, { operations: [...t.operations].sort(), unknownPayloads: t.unknownPayloads }])) }, null, 2))
if (unresolved.length || Object.values(tables).some(t => t.unknownPayloads.length)) process.exitCode = 1
