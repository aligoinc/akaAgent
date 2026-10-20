// Rollback-only production rehearsal through the existing linked Management API.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'), snapshots=path.join(root,'migrations/snapshots/group-sharing-v409')
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'cgjbsmqtfhqvttudyjzq')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const migration=read('migrations/migration_v409_group_sharing.sql'), smoke=read('migrations/tests/migration_v409_group_sharing_smoke.sql')
const inventory=JSON.parse(fs.readFileSync(path.join(snapshots,'inventory.json'),'utf8'))
const expected=JSON.parse(fs.readFileSync(path.join(snapshots,'expected-functions.json'),'utf8'))
const querySql=`SELECT oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) checksum,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig,proacl::text proacl FROM pg_proc WHERE oid IN (${inventory.map(x=>`to_regprocedure('public.${x.signature}')`).join(',')}) ORDER BY 1;`
function query(sql){const d=fs.mkdtempSync(path.join(os.tmpdir(),'sharing-query-'));try{const f=path.join(d,'q.sql');fs.writeFileSync(f,sql,{mode:0o600});return JSON.parse(cp.execFileSync('supabase',['db','query','--linked','--file',f,'--output','json'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']})).rows}finally{fs.rmSync(d,{recursive:true,force:true})}}
const before=query(querySql)
const after=query('BEGIN;\n'+migration+'\n'+smoke+'\n'+querySql+'\nROLLBACK;')
for(const row of expected){const actual=after.find(x=>x.signature===row.signature);assert.equal(actual.checksum,row.checksum);const old=before.find(x=>x.signature===row.signature);for(const k of ['owner','prosecdef','provolatile','proconfig','proacl'])assert.deepEqual(actual[k],old[k],row.signature+' '+k)}
const rollback=read('migrations/tests/migration_v409_group_sharing_rollback.sql').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
const restored=query('BEGIN;\n'+migration+'\n'+smoke+'\n'+rollback+'\n'+querySql+'\nROLLBACK;')
assert.deepEqual(restored,before)
assert.deepEqual(query(querySql),before)
const receipt={at:new Date().toISOString(),productionChanged:false,migrationSha256:crypto.createHash('sha256').update(migration).digest('hex'),smoke:'passed',rollback:'passed',originalFunctionsUnchanged:true,patchedFunctionAttributesPreserved:true,expected}
fs.writeFileSync(path.join(snapshots,'verification.json'),JSON.stringify(receipt,null,2)+'\n')
console.log('PASS full live SQL rollback smoke; expected bodies/owner/ACL/config, rollback restoration and production unchanged')
