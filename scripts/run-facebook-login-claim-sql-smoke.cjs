// Isolated PostgreSQL. No production connections, customer data or .env.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const {execFileSync, spawn} = require('node:child_process')
const root = path.resolve(__dirname,'..'), bin = process.env.AKA_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'aka-fb-claim-pg-')), socket = path.join(dir,'sock'), data = path.join(dir,'data')
fs.mkdirSync(socket)
const run = (cmd,args,options={})=>execFileSync(path.join(bin,cmd),args,{encoding:'utf8',...options})
const connection=['-h',socket,'-p','55484','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
const sql = text=>run('psql',connection,{input:text})
const migration=fs.readFileSync(path.join(root,'migrations/migration_v321_facebook_login_claim_cancellation.sql'),'utf8')
let started=false
async function orderedRace(first,second) {
  // Hold the first RPC's transaction open while the other RPC is queued.
  const owner=spawn(path.join(bin,'psql'),connection,{stdio:['pipe','pipe','pipe']})
  let output='', errors='';owner.stdout.on('data',c=>output+=c);owner.stderr.on('data',c=>errors+=c)
  const exited=new Promise(resolve=>owner.on('exit',resolve))
  owner.stdin.write('BEGIN;\n'+first+';\n\\echo OWNED\n')
  for(let i=0;!output.includes('OWNED');i++){if(i>100)throw Error(errors||'owner stalled');await new Promise(r=>setTimeout(r,10))}
  const waiter=spawn(path.join(bin,'psql'),[...connection,'-c',second],{env:{...process.env,PGAPPNAME:'fb-claim-waiter'},stdio:['ignore','pipe','pipe']})
  let waitingResult='', waitingError='';waiter.stdout.on('data',c=>waitingResult+=c);waiter.stderr.on('data',c=>waitingError+=c)
  const waited=new Promise(resolve=>waiter.on('exit',resolve))
  for(let i=0;;i++){
    if(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='fb-claim-waiter' AND wait_event_type='Lock';").trim()==='1')break
    if(i>100)throw Error('waiter did not reach the row lock: '+waitingError)
    await new Promise(r=>setTimeout(r,10))
  }
  owner.stdin.end('COMMIT;\n');assert.equal(await exited,0,errors);assert.equal(await waited,0,waitingError)
  return waitingResult
}
async function main(){
  run('initdb',['-D',data,'-U','postgres','--auth=trust','--no-locale'])
  run('pg_ctl',['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-p 55484 -k ${socket} -c listen_addresses=`,'start']);started=true
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/account-operation-cleanup-postgres.sql'),'utf8'))
  sql(fs.readFileSync(path.join(root,'scripts/fixtures/facebook-login-claim-postgres.sql'),'utf8'))
  // Deliberately mismatched source must fail before any schema change.
  assert.throws(()=>sql(migration.replace('b721f2bf997eef62f72eaf5e2728fb8c','00000000000000000000000000000000')),/v321_dependency_changed/)
  sql(migration)
  sql("INSERT INTO org_staff VALUES(811,788,true); INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete) VALUES(3883,811,788,'facebook','tạm dừng','chưa đăng nhập',true,false);")
  const smoke=fs.readFileSync(path.join(root,'migrations/tests/migration_v321_facebook_login_claim_cancellation_smoke.sql'),'utf8')
  assert.match(sql("BEGIN;SET LOCAL test.fb_account='3883';SET LOCAL test.fb_staff='811';SET LOCAL ROLE anon;"+smoke+'ROLLBACK;'),/v321_facebook_claim_smoke_passed/)
  for(const cancelFirst of [true,false]){
    const generation=sql('SELECT facebook_login_claim_generation FROM auto_accounts WHERE id=3883;').trim()
    const token=require('node:crypto').randomUUID()
    const rpc=action=>`SELECT aka_agent_facebook_account_operation(3883,811,'tạm dừng','${token}',${generation},'${action}')`
    const result=await orderedRace(rpc(cancelFirst?'cleanup':'claim'),rpc(cancelFirst?'claim':'cleanup'))
    assert.match(result,cancelFirst?/claim_closed/:/cleaned/)
    assert.equal(sql("SELECT status||':'||(runtime_operation_claim_token IS NULL) FROM auto_accounts WHERE id=3883;").trim(),'tạm dừng:true')
    assert.match(sql(rpc('claim')),/claim_closed/)
  }
  // The new trigger must not affect Email/Zalo token handling.
  sql("INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,status,login_status,is_active,is_delete) VALUES(3884,811,788,'email','tạm dừng','đã đăng nhập',true,false); SELECT aka_agent_claim_account_operation(3884,811,'email','desktop','tạm dừng',gen_random_uuid(),true,'operation');")
  assert.equal(sql('SELECT facebook_login_claim_generation FROM auto_accounts WHERE id=3884;').trim(),'0')
  const hashes=sql("SELECT json_agg(json_build_object('signature',p.oid::regprocedure::text,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proconfig',p.proconfig,'proacl',p.proacl)) FROM pg_proc p WHERE proname IN ('aka_agent_facebook_account_operation','guard_facebook_login_claim_generation');")
  fs.writeFileSync('/tmp/aka-facebook-v321-target.json',hashes.trim())
  console.log('PASS v321 SQL: anon role, cancel-before-claim, claim replay, competing tokens, late response, legacy cleanup, pause, inactive, both real transaction orders, other-platform isolation and checksum preflight')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(started)run('pg_ctl',['-D',data,'-m','immediate','stop']);fs.rmSync(dir,{recursive:true,force:true})})
