// Candidate generation only: never connects to or changes production.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..'), dir = path.join(root, 'migrations/snapshots/desktop-session-rls')
const auditOnly = process.argv.includes('--audit-only')
if (fs.existsSync(path.join(dir, 'least-privilege-applied.json')) && !auditOnly) {
  throw new Error('Already applied: never rewrite the canonical migration. Use --audit-only and prepare a separate incremental migration.')
}
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name)))
const live = read('least-privilege-preflight.json'), usage = read('least-privilege-dependencies.json')
const schemaDependencies = read('least-privilege-schema-dependencies.json')
const role = 'aka_agent_desktop'
const q = s => "'"+String(s).replaceAll("'","''")+"'"
const ident = s => '"'+s.replaceAll('"','""')+'"'
const tableName = t => ident(t.schema)+'.'+ident(t.name)
const key = t => t.schema+'.'+t.name
const letters = { SELECT:'r',INSERT:'a',UPDATE:'w',DELETE:'d',TRUNCATE:'D',REFERENCES:'x',TRIGGER:'t',MAINTAIN:'m',USAGE:'U',EXECUTE:'X' }
function permissions(acl, who) {
  if (!acl) return ''
  return acl.slice(1,-1).split(',').filter(x => x.split('=')[0] === who).map(x => x.split('=')[1].split('/')[0]).join('')
}
const tableHas = (t,p) => [role,''].some(r => permissions(t.acl,r).includes(letters[p]))
const columnHas = (t,c,p) => tableHas(t,p) || [role,''].some(r => permissions(c.acl,r).includes(letters[p]))
assert.deepEqual(usage.errors,[])
assert.deepEqual(usage.dynamic,[])
const plan = { tables:[], sequences:[], functions:[], retainedFunctions:[], conditionalDependencies:[], roles:live.roles.map(r=>r.name).sort() }
for (const t of live.relations.filter(t=>t.kind!=='S')) {
  const use = usage.tables[key(t)] || {}
  const hasExplicit = permissions(t.acl,role) || t.columns.some(c=>permissions(c.acl,role))
  if (!hasExplicit && !Object.keys(use).length) continue
  // There were no PUBLIC table/column grants in the live capture. Do not
  // silently leave an inherited path open if that changes before generation.
  assert(!permissions(t.acl,''), 'Review PUBLIC table privileges: '+key(t))
  assert(t.columns.every(c=>!permissions(c.acl,'')), 'Review PUBLIC column privileges: '+key(t))
  const grants = []
  for (const p of ['SELECT','INSERT','UPDATE','DELETE']) {
    if (!use[p]) continue
    if (p==='DELETE') { if(tableHas(t,p)) grants.push({privilege:p,columns:null}); continue }
    const required = use[p].all_columns ? t.columns.map(c=>c.name) : use[p].columns
    assert(required.every(c=>t.columns.some(x=>x.name===c)), 'Unknown required column on '+key(t))
    const allowed = required.filter(name=>columnHas(t,t.columns.find(c=>c.name===name),p)).sort()
    if (allowed.length < required.length) plan.conditionalDependencies.push({table:key(t),privilege:p,ungranted:required.filter(c=>!allowed.includes(c)),reasons:use[p].reasons})
    if (allowed.length) grants.push({privilege:p,columns:p==='SELECT'&&tableHas(t,p)?null:allowed})
  }
  plan.tables.push({name:key(t),grants,source:t})
}
assert.equal(plan.tables.find(t=>t.name==='public.org_staff').grants.length,0,'Desktop must not have direct staff access')
const neededSequences = new Set()
for (const t of plan.tables.filter(t=>t.grants.some(g=>g.privilege==='INSERT'))) {
  for (const c of t.source.columns) if(c.sequence) neededSequences.add(c.sequence)
}
for (const t of live.relations.filter(t=>t.kind==='S'&&permissions(t.acl,role))) {
  assert(!permissions(t.acl,''),'Review PUBLIC sequence privileges: '+key(t))
  plan.sequences.push({name:key(t),usage:neededSequences.has(key(t)),source:t})
}
for (const f of live.functions.filter(f=>f.desktop_execute&&!f.extension)) {
  if (usage.functions[f.signature]) {plan.retainedFunctions.push(f.signature); continue}
  // PUBLIC is inherited even by a NOINHERIT role; a direct REVOKE alone cannot
  // deny Desktop. Preserve the same effective EXECUTE for every other current
  // role, explicitly including anon/authenticated and all backend roles.
  const publicExecute = f.acl===null || permissions(f.acl,'').includes('X')
  plan.functions.push({signature:f.signature,publicExecute,source:f})
}
assert(plan.functions.some(f=>f.signature==='public.aka_agent_get_vault_secret(text)'))
const functionScope = [...new Set([...plan.functions.map(f=>f.signature),...Object.keys(usage.functions),...usage.analyzed_functions])]
const functionState = live.functions.filter(f=>functionScope.includes(f.signature)).map(f=>({signature:f.signature,checksum:f.checksum,owner:f.owner,security_definer:f.security_definer,volatility:f.volatility,config:f.config,acl:f.acl}))
const relationState = [...plan.tables,...plan.sequences].map(x=>x.source).map(t=>({schema:t.schema,name:t.name,kind:t.kind,owner:t.owner,acl:t.acl,rls:t.rls,force:t.force,columns:t.columns.map(c=>({name:c.name,acl:c.acl,default:c.default}))}))
const dependencyState = {
  triggers:schemaDependencies.triggers.filter(t=>usage.tables[t.schema+'.'+t.relation]),
  constraints:schemaDependencies.constraints.filter(c=>usage.tables[c.schema+'.'+c.table]&&c.type==='c')
}
const functionQuery = `SELECT jsonb_agg(jsonb_build_object('signature',x.signature,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl::text) ORDER BY x.signature COLLATE "C") FROM jsonb_to_recordset(${q(JSON.stringify(functionState))}::jsonb) x(signature text) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(x.signature)`
const relationQuery = `SELECT jsonb_agg(jsonb_build_object('schema',x.schema,'name',x.name,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY x.schema COLLATE "C",x.name COLLATE "C") FROM jsonb_to_recordset(${q(JSON.stringify(relationState))}::jsonb) x(schema text,name text) LEFT JOIN pg_class c ON c.oid=to_regclass(format('%I.%I',x.schema,x.name))`
const tablesSql=Object.keys(usage.tables).map(q).join(',')
const dependencyQuery=`SELECT jsonb_build_object('triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'signature',t.tgfoid::regprocedure::text,'security_definer',p.prosecdef) ORDER BY n.nspname,c.relname,t.tgname),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND n.nspname||'.'||c.relname IN (${tablesSql})), 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid),'type',k.contype) ORDER BY n.nspname,c.relname,k.conname),'[]') FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='c' AND n.nspname||'.'||c.relname IN (${tablesSql})))`
functionState.sort((a,b)=>a.signature<b.signature?-1:1)
relationState.sort((a,b)=>key(a)<key(b)?-1:1)
let sql = `-- Tighten ONLY the Desktop token role. Preserve anon, existing clients,
-- backend roles, RLS/policies, function definitions and timeout settings.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$ DECLARE actual jsonb; BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aka_agent_desktop' AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls AND NOT rolcanlogin)
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='aka_agent_desktop')) THEN RAISE EXCEPTION 'Desktop role drift'; END IF;
 SELECT jsonb_agg(rolname ORDER BY rolname::text COLLATE "C") INTO actual FROM pg_roles;
 IF actual IS DISTINCT FROM ${q(JSON.stringify(plan.roles))}::jsonb THEN RAISE EXCEPTION 'Role inventory drift; preserve current roles before removing PUBLIC'; END IF;
 SELECT (${functionQuery}) INTO actual;
 IF actual IS DISTINCT FROM ${q(JSON.stringify(functionState))}::jsonb THEN RAISE EXCEPTION 'Desktop least-privilege function metadata drift'; END IF;
 SELECT (${relationQuery}) INTO actual;
 IF actual IS DISTINCT FROM ${q(JSON.stringify(relationState))}::jsonb THEN RAISE EXCEPTION 'Desktop least-privilege relation metadata drift'; END IF;
 SELECT (${dependencyQuery}) INTO actual;
 IF actual IS DISTINCT FROM ${q(JSON.stringify(dependencyState))}::jsonb THEN RAISE EXCEPTION 'Desktop trigger/check dependency drift'; END IF;
END $preflight$;
-- Only ACL changes below. In particular, no ENABLE RLS and no anon REVOKE.
`
for (const t of plan.tables) {
  const object=tableName(t.source)
  sql+=`REVOKE ALL ON TABLE ${object} FROM ${role};\n`
  if(t.source.columns.some(c=>permissions(c.acl,role))) sql+=`REVOKE ALL (${t.source.columns.map(c=>ident(c.name)).join(',')}) ON TABLE ${object} FROM ${role};\n`
  for(const g of t.grants)sql+=`GRANT ${g.privilege}${g.columns?' ('+g.columns.map(ident).join(',')+')':''} ON TABLE ${object} TO ${role};\n`
}
for(const s of plan.sequences){
  sql+=`REVOKE ALL ON SEQUENCE ${tableName(s.source)} FROM ${role};\n`
  if(s.usage)sql+=`GRANT USAGE ON SEQUENCE ${tableName(s.source)} TO ${role};\n`
}
for(const f of plan.functions){
  sql+=`REVOKE EXECUTE ON FUNCTION ${f.signature} FROM ${role};\n`
  if(f.publicExecute){
    sql+=`GRANT EXECUTE ON FUNCTION ${f.signature} TO ${plan.roles.filter(r=>r!==role).map(ident).join(',')};\n`
    sql+=`REVOKE EXECUTE ON FUNCTION ${f.signature} FROM PUBLIC;\n`
  }
}
sql+=`NOTIFY pgrst,'reload schema';\nCOMMIT;\n`
assert(!/ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|CREATE(?: OR REPLACE)? FUNCTION|ALTER FUNCTION|FROM anon|FROM authenticated/.test(sql))
const filename='supabase/migrations/20261027141754_desktop_token_least_privilege.sql'
if (!auditOnly) fs.writeFileSync(path.join(root,filename),sql)
fs.writeFileSync(path.join(dir,auditOnly?'least-privilege-plan-corrected.json':'least-privilege-plan.json'),JSON.stringify({...plan,functionState,relationState,dependencyState,dependencyQuery},null,2)+'\n')
console.log(JSON.stringify({filename,tables:plan.tables.length,sequences:plan.sequences.length,removedFunctionAccess:plan.functions.length,publicFunctionsConverted:plan.functions.filter(f=>f.publicExecute).length,retainedFunctionAccess:plan.retainedFunctions.length,conditionalDependencies:plan.conditionalDependencies},null,2))
