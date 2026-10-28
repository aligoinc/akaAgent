// One concurrent index statement per existing linked Management API request.
// Never opens a direct DB connection or changes a runtime pool.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..')
const migrationPath='supabase/migrations/20261028045419_cooldown_recipient_indexes.sql'
const migration=fs.readFileSync(path.join(root,migrationPath),'utf8')
const phases=Object.fromEntries([...migration.matchAll(/-- @phase (\w+)\n([\s\S]*?)(?=-- @phase |$)/g)].map(m=>[m[1],m[2]]))
assert.deepEqual(Object.keys(phases),['preflight','uid','phone','postflight'])
assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'cgjbsmqtfhqvttudyjzq')
const selected=process.argv.find(x=>x.startsWith('--phase='))?.slice(8)
if(!['uid','phone','postflight','repair-phone'].includes(selected)||!process.argv.includes('--apply')) {
 console.log('Use --apply --phase=uid, then phone, then postflight. Inspect failed/uncertain builds before retry.');process.exit(0)
}
const q=s=>"'"+s.replaceAll("'","''")+"'"
let token=process.env.SUPABASE_ACCESS_TOKEN
if(!token)for(const account of ['supabase','access-token']){
 const r=spawnSync('security',['find-generic-password','-s','Supabase CLI','-a',account,'-w'],{encoding:'utf8'})
 if(r.status===0&&r.stdout.trim()){token=r.stdout.trim();break}
}
if(!token)throw Error('No existing Management API credential')
async function query(name,sql){
 const response=await fetch('https://api.supabase.com/v1/projects/cgjbsmqtfhqvttudyjzq/database/query',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(125000)
 })
 const body=await response.text()
 if(!response.ok)throw Error(name+': HTTP '+response.status+' '+body.slice(0,2000))
 return JSON.parse(body)
}
async function main(){
try {
 if(selected==='repair-phone') {
  // Explicit operator recovery after a confirmed timeout. Never automatic.
  await query('preflight',phases.preflight.replaceAll('AND indisvalid AND indisready','AND indisready'))
  const state=await query('repair-state',"SELECT indisvalid,indisready,(SELECT count(*) FROM pg_stat_progress_create_index WHERE relid='public.auto_campaign_input_data'::regclass) AS running FROM pg_index WHERE indexrelid='public.idx_campaign_input_cooldown_phone'::regclass")
  assert.equal(state[0]?.indisvalid,false);assert.equal(state[0]?.indisready,true);assert.equal(Number(state[0]?.running),0)
  const started=Date.now()
  await query('repair-phone','REINDEX INDEX CONCURRENTLY public.idx_campaign_input_cooldown_phone;')
  console.log('Rebuilt phone index in',Date.now()-started,'ms')
  return
 }
 await query('preflight',phases.preflight)
 if(selected!=='postflight') {
  const name='idx_campaign_input_cooldown_'+selected
  const existing=await query('existing',"SELECT to_regclass('public."+name+"') IS NOT NULL AS exists")
  if(!Array.isArray(existing))throw Error('Unexpected Management API JSON; inspect response before continuing')
  if(existing[0]?.exists)console.log('Already present and verified:',name)
  else {const start=Date.now();await query('build',phases[selected]);console.log('Built',name,'in',Date.now()-start,'ms')}
 } else {
  await query('postflight',phases.postflight)
  const rows=await query('record',`BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s';
    INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
    SELECT '20261028045419','cooldown_recipient_indexes',ARRAY[${q(migration)}]
    WHERE NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261028045419');
    SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20261028045419'; COMMIT;`)
  console.log(JSON.stringify(rows))
 }
} catch(e){ console.error(e.message);process.exitCode=1 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
