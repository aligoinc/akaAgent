// Requires isolated PostgREST on localhost:55422 backed by the fixture at localhost:55421.
// A short exclusive lock on the synthetic table checks that the RPC's timeout is hoisted.
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs')
const base='http://127.0.0.1:55422/rpc/'
async function call(name,query={},patch={}){const response=await fetch(base+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_staff_id:10,p_organization_id:1,p_auth_username:'owner',p_auth_password:'fixture',p_query:{columnFilters:{version:1,filters:[]},limit:10,...query},...patch}),signal:AbortSignal.timeout(65000)});return {status:response.status,body:await response.json()}}
;(async()=>{
 let checks=0,r=await call('aka_agent_read_filtered_contacts_v1',{accountId:1},{p_source:'contacts'});assert.equal(r.status,200);assert.equal(r.body.total,100000);checks++
 r=await call('aka_agent_read_filtered_group_v1',{groupId:1},{p_staff_id:11,p_auth_username:'reader'});assert.equal(r.status,200);assert.equal(r.body.rows[0].source_account_name,'Tài khoản A');checks++
 r=await call('aka_agent_read_filtered_group_v1',{groupId:2});assert.equal(r.status,401);assert.equal(r.body.code,'42501');checks++
 r=await call('aka_agent_read_filtered_remarketing_v1',{accountId:3,dateFrom:'2026-10-10',dateTo:'2026-10-10'});assert.equal(r.status,200);assert.equal(r.body.rows[0].extra_data.sentCount,1);checks++
 const lock=spawn('/opt/homebrew/bin/psql',['-X','-qAt','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='';const closed=new Promise(resolve=>lock.once('close',resolve));
 lock.stdin.end("DO $$ BEGIN IF inet_server_port()<>55421 THEN RAISE EXCEPTION 'local only';END IF;END $$; BEGIN; LOCK public.auto_account_contacts IN ACCESS EXCLUSIVE MODE; SELECT 'LOCK_READY'; SELECT pg_sleep(63); ROLLBACK;")
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('lock setup timeout')),3000);lock.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCK_READY')){clearTimeout(timer);resolve()}});lock.once('error',reject)})
 const started=performance.now();r=await call('aka_agent_read_filtered_contacts_v1',{accountId:1},{p_source:'contacts'});const elapsed=performance.now()-started;await closed;assert.equal(r.body.code,'57014');assert.ok(elapsed>=59000&&elapsed<64000,elapsed);checks++
 r=await call('aka_agent_read_filtered_contacts_v1',{accountId:1},{p_source:'contacts'});assert.equal(r.status,200);assert.equal(r.body.total,100000);checks++
 const result={checks,postgres:'16.15 local',postgrest:'16.5 local',rpcDatabaseTimeoutMs:Math.round(elapsed),recovery:true,productionChanged:false};fs.writeFileSync('scripts/column-filters/http-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
})().catch(e=>{console.error(e);process.exitCode=1})
