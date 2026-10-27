const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const os = require('node:os'), ts = require('typescript')
const { embeddedRelations, staticStrings } = require('./select-dependencies.cjs')
const known = new Set(['category_type', 'auto_accounts', 'auto_campaigns', 'zalo_users', 'quoted table'])
const cases = [
  ['id,name,settings->>code', []],
  ['id,category_type!inner(namespace,code)', ['category_type']],
  ['owner:auto_accounts!owner_id!inner(id)', ['auto_accounts']],
  ['...auto_accounts(id, campaigns:auto_campaigns(id,zalo_users(name)))', ['auto_accounts','auto_campaigns','zalo_users']],
  ['active:category_type(),other:category_type(id)', ['category_type']],
  ['"alias":"quoted table"("field(name)")', ['quoted table']],
  ['count(),total:amount.sum(),amount::numeric.avg()', []],
  ['"field(name)",payload->>"field(name)"', []]
]
for (const [query, expected] of cases) assert.deepEqual(embeddedRelations(query, known), expected)
for (const query of ['missing(id)', 'category_type(id', 'category_type(id))', 'category_type(id)unexpected']) {
  assert.throws(() => embeddedRelations(query, known))
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-select-audit-'))
try {
  const file = path.join(dir,'fixture.ts')
  fs.writeFileSync(file, `
declare const client: { select(projection: string): unknown }; declare const unknownProjection: string;
const relation = 'category_type!inner(code)';
const base = ['id', 'drop:extra_settings->x', 'keep:extra_settings->y', relation].join(', ');
const filtered = base.split(', ').filter(field => !field.includes(':extra_settings->') || field.startsWith('keep:')).join(', ');
client.select(filtered);
const read = (fields: string) => client.select(fields);
read('auto_accounts(id)'); read('auto_campaigns(id)');
client.select(unknownProjection);
declare const trusted: boolean;
const modelColumns = (): string => trusted ? '*' : 'id,model';
client.select(modelColumns());
function branchColumns(): string { if (trusted) return 'auto_accounts(id)'; return 'id'; }
client.select(branchColumns());
`)
  const program = ts.createProgram([file], { target:ts.ScriptTarget.ES2022 }), checker = program.getTypeChecker()
  const selections=[]
  function visit(node) {
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='select') selections.push(staticStrings(node.arguments[0],checker,ts))
    ts.forEachChild(node,visit)
  }
  visit(program.getSourceFile(file))
  assert.deepEqual(selections, [['id, keep:extra_settings->y, category_type!inner(code)'], ['auto_accounts(id)','auto_campaigns(id)'], null, ['*','id,model'], ['auto_accounts(id)','id']])
} finally { fs.rmSync(dir,{recursive:true,force:true}) }
const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../../migrations/snapshots/desktop-session-rls/least-privilege-source.json')))
assert.deepEqual(report.unresolved,[])
assert(report.selects.some(s=>s.location.includes('/dataGroupRepository.ts:')&&s.relations.includes('category_type')))
assert(report.selects.some(s=>s.location.includes('/campaignRepository.ts:')&&s.relations.includes('auto_accounts')))
assert(report.selects.some(s=>s.projections.some(p=>p.includes('blocklist_members:'))&&s.relations.includes('auto_account_contact_group_members')))
console.log(`PASS projection parser/resolver, unresolved-input rejection and real-source embedded joins (${report.selects.length} selects, ${report.selects.filter(s=>s.relations.length).length} embedded)`)
