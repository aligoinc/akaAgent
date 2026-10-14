const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
if (fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== 'cgjbsmqtfhqvttudyjzq') throw Error('Wrong linked project')
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v398_facebook_web_enrichment.sql'), 'utf8')
const smoke = fs.readFileSync(path.join(root, 'migrations/tests/migration_v398_facebook_web_enrichment_smoke.sql'), 'utf8')
const mode = process.argv[2]
const verify = `SELECT jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),
 'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl,
 'blocks',(SELECT jsonb_agg(jsonb_build_object('name',name,'md5',md5(code))) FROM public.auto_blocks WHERE name='fb_web_enrichment_browse'),
 'elements',(SELECT jsonb_agg(jsonb_build_object('name',name,'md5',md5(xpath))) FROM public.auto_elements WHERE name LIKE 'fb_web_enrichment%'),
 'workflow',(SELECT jsonb_build_object('name',name,'nodes',nodes,'edges',edges) FROM public.auto_workflows WHERE name='fb_web_enrichment'),
 'history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name='migration_v398_facebook_web_enrichment')) receipt
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)');`
let sql
if (mode === 'smoke') {
  // Explicit negative fixture IDs: rollback must not consume catalog sequences.
  const fixture = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
    .replace('auto_elements(name,', 'auto_elements(id,name,')
    .replace("('fb_web_enrichment_result',", "(-398001,'fb_web_enrichment_result',")
    .replace("('fb_web_enrichment_captcha',", "(-398002,'fb_web_enrichment_captcha',")
    .replace('auto_blocks(name,', 'auto_blocks(id,name,')
    .replace("('fb_web_enrichment_browse',", "(-398001,'fb_web_enrichment_browse',")
    .replace('auto_workflows(name,', 'auto_workflows(id,name,')
    .replace("SELECT 'fb_web_enrichment',", "SELECT -398001,'fb_web_enrichment',")
  sql = `BEGIN; ${fixture}\n${smoke}\n${verify}\nROLLBACK; SELECT 'PASS: v398 fixture, settings/CAS/validation/ACL/tenant/credentials/business fields; rolled back' result;`
} else if (mode === 'post-smoke') sql = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'; ${smoke}\nROLLBACK; SELECT 'PASS: post-apply rollback smoke' result;`
else if (mode === 'verify') sql = verify
else throw Error('Usage: node scripts/web-enrichment-migration.cjs smoke|post-smoke|verify')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'web-enrichment-sql-'))
try {
  const file = path.join(directory, 'query.sql'); fs.writeFileSync(file, sql)
  const output = execFileSync('supabase', ['db','query','--linked','--file',file], {cwd:root,encoding:'utf8',maxBuffer:4*1024*1024})
  const parsed = JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1))
  fs.mkdirSync(path.join(root,'docs/audits/web-enrichment-v398'),{recursive:true})
  fs.writeFileSync(path.join(root,`docs/audits/web-enrichment-v398/${mode}.json`),JSON.stringify(parsed.rows,null,2)+'\n')
  console.log(mode === 'verify' ? 'Saved verification receipt.' : JSON.stringify(parsed.rows))
} finally { fs.rmSync(directory,{recursive:true,force:true}) }
