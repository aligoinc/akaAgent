// Test-only PostgreSQL instance. No production connection, fixture or background polling.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict')
const { Client } = require(require.resolve('pg', { paths: [path.resolve(__dirname, '../../../akaAgentChatApi')] }))
const bin='/opt/homebrew/opt/postgresql@16/bin', dir=fs.mkdtempSync(path.join(os.tmpdir(),'sharing-pg-')), port=55409, clients=[]
let started=false
const run=(exe,args)=>cp.execFileSync(path.join(bin,exe),args,{stdio:'pipe'})
const connect=async()=>{const c=new Client({host:dir,port,user:'postgres',database:'postgres'});await c.connect();clients.push(c);return c}
const scalar=async(c,q)=>Object.values((await c.query(q)).rows[0])[0]
async function main(){
 try {
 run('initdb',['-D',path.join(dir,'data'),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
 run('pg_ctl',['-D',path.join(dir,'data'),'-l',path.join(dir,'log'),'-o',`-k ${dir} -p ${port} -c listen_addresses='' -c max_connections=8`,'-w','start']);started=true
 const a=await connect(),b=await connect(),monitor=await connect()
 await a.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA private;
 CREATE TABLE org_organization(id bigint PRIMARY KEY);
 CREATE TABLE org_staff(id bigint PRIMARY KEY,organization_id bigint,name text,is_active boolean,deleted_at timestamptz);
 CREATE TABLE auto_account_contact_groups(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,purpose text,is_delete boolean);
 CREATE TABLE auto_content_groups(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,is_delete boolean,is_active boolean);
 CREATE TABLE auto_campaign_data_group_sources(id bigint PRIMARY KEY,group_id bigint,staff_id bigint,organization_id bigint,campaign_id bigint,status text,stop_reason text,stopped_at timestamptz,updated_at timestamptz);
 CREATE FUNCTION auto_assert_automation_identity(bigint,bigint,text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM org_staff WHERE id=$1 AND organization_id=$2 AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'access denied'; END IF; END $$;
 CREATE FUNCTION aka_agent_lock_campaign_input_serialization(bigint) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock($1) $$;
 INSERT INTO org_organization VALUES(9),(10);
 INSERT INTO org_staff VALUES(1,9,'Owner',true,NULL),(2,9,'Recipient',true,NULL);
 INSERT INTO auto_account_contact_groups VALUES(1,1,9,'data_group',false);`)
 await a.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'))
 await a.query(fs.readFileSync(path.join(__dirname,'rpc.sql'),'utf8'))
 await a.query("UPDATE auto_account_contact_groups SET sharing_scope='organization'; INSERT INTO auto_campaign_data_group_sources VALUES(1,1,2,9,11,'active',NULL,NULL,NULL)")
 const save=(c,scope,rev)=>c.query(`SELECT aka_agent_group_sharing(1,9,NULL,NULL,'save','{"kind":"data","groupId":1,"scope":"${scope}","recipientIds":[],"expectedRevision":"${rev}"}')`)
 // The exact new lock helper is used by the patched live intake router before its old barrier.
 await a.query('BEGIN');assert.equal(await scalar(a,'SELECT private.lock_read_data_group(1,2,9)'),true)
 const pid=await scalar(b,'SELECT pg_backend_pid()');let done=false
 const revoke=save(b,'private',0).finally(()=>done=true)
 for(let i=0;i<100;i++){if(await scalar(monitor,`SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=${pid}`))break;await new Promise(r=>setTimeout(r,10))}
 assert.equal(done,false,'revoke waits for the intake/snapshot group lock')
 await a.query('COMMIT');await revoke
 assert.equal(await scalar(a,'SELECT private.can_read_data_group(1,2,9)'),false)
 assert.equal(await scalar(a,"SELECT status FROM auto_campaign_data_group_sources WHERE id=1"),'stopped')
 // Reverse order: a reader waiting behind revoke must recheck after the lock.
 await save(a,'organization',1);await a.query('BEGIN');await save(a,'private',2)
 const read=b.query('SELECT private.lock_read_data_group(1,2,9) allowed')
 await a.query('COMMIT');assert.equal((await read).rows[0].allowed,false)
 // Two sharing editors with the same revision cannot overwrite each other.
 await save(a,'organization',3)
 const results=await Promise.allSettled([save(a,'private',4),save(b,'organization',4)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.match(results.find(r=>r.status==='rejected').reason.message,/group_sharing_conflict/)
 // Grant and org rejoin never revive stopped sources; leaving while active stops it.
 const rev=await scalar(a,'SELECT sharing_revision FROM auto_account_contact_groups WHERE id=1')
 await save(a,'organization',rev)
 assert.equal(await scalar(a,"SELECT status FROM auto_campaign_data_group_sources WHERE id=1"),'stopped')
 await a.query("UPDATE auto_campaign_data_group_sources SET status='active'; UPDATE org_staff SET organization_id=10 WHERE id=2; UPDATE org_staff SET organization_id=9 WHERE id=2")
 assert.equal(await scalar(a,"SELECT status FROM auto_campaign_data_group_sources WHERE id=1"),'stopped')
 console.log('PASS isolated PostgreSQL: intake/revoke both lock orders, CAS race, org leave/rejoin, no automatic reactivation')
 } finally {await Promise.allSettled(clients.map(c=>c.end()));if(started)run('pg_ctl',['-D',path.join(dir,'data'),'-m','immediate','-w','stop']);fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode=1})
