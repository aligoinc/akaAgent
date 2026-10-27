/* Read-only source inventory. Dynamic call sites must be reviewed before cutover. */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const result = { tables: {}, rpcs: {}, realtime: [], dynamic: [] }
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
}
for (const file of files(path.join(root, 'src'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression.getText(source)
      if (['from', 'rpc'].includes(method) && !['Buffer', 'Array', 'this'].includes(receiver) && !(file.endsWith('/dataGroupExternalSyncRepository.ts') && ['context()', 'ctx'].includes(receiver))) {
        const arg = node.arguments[0]
        const location = `${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
        if (arg && ts.isStringLiteralLike(arg)) {
          const map = method === 'from' ? result.tables : result.rpcs
          ;(map[arg.text] ||= []).push(location)
        } else result.dynamic.push({ method, expression: arg?.getText(source), location })
      }
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'table' && ts.isStringLiteralLike(node.initializer)) {
      result.realtime.push({ table: node.initializer.text, file: path.relative(root, file) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
for (const key of ['tables', 'rpcs']) result[key] = Object.fromEntries(Object.entries(result[key]).sort(([a], [b]) => a.localeCompare(b)))
const known=new Set(JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/desktop-session-rls/entry-functions.json'))).map(f=>f.signature.split('(')[0]))
for(const d of result.dynamic){
 const file=d.location.split(':')[0],text=fs.readFileSync(path.join(root,file),'utf8')
 let names
 if(file.endsWith('/adminRepository.ts'))names=['docs','notifications','settings','cron','triggers'].map(n=>'aka_agent_admin_'+n)
 else if(file.endsWith('/zaloCampaignEngagement.ts'))names=['register','read','record'].map(n=>'aka_agent_'+n+'_campaign_engagement')
 else if(file.endsWith('/deviceChangeService.ts'))names=['aka_agent_prepare_device_change','aka_agent_prepare_device_change_v2','aka_agent_reset_device_binding','aka_agent_reset_device_binding_v2']
 else {
  const literals=[...text.matchAll(/['"]([a-z][a-z0-9_]+)['"]/g)].map(m=>m[1])
  names=[...new Set(literals.filter(n=>d.method==='from'?/^(auto_|category_)/.test(n):known.has(n)||n.startsWith('aka_agent_desktop_')))]
 }
 if(!names.length)throw Error('Unresolved dynamic database call: '+d.location)
 d.resolved=names.sort()
 for(const name of names){const map=d.method==='from'?result.tables:result.rpcs;(map[name]||=[]).push(d.location+' (reviewed dynamic)')}
}
const output = path.join(root, 'migrations/snapshots/desktop-session-rls/source-access.json')
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ tables: Object.keys(result.tables).length, rpcs: Object.keys(result.rpcs).length, realtime: result.realtime, dynamic: result.dynamic }, null, 2))
