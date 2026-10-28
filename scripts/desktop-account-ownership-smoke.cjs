const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const createFixture=require('./desktop-account-ownership-fixture.cjs')
const f=createFixture(),{sql,quote:q,root,dir,plan,m,desktop,runAs,claims}=f
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261027183537_desktop_account_campaign_ownership.sql'),'utf8')
const checks=[],pass=s=>{checks.push(s);console.log('PASS',s)},json=s=>JSON.parse(s)
try{
 sql(`INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'Fixture org',false),(20,'Other org',false);
 INSERT INTO org_staff(id,organization_id,name,username,password,is_active,is_policy_accepted,is_admin,is_admin_akabiz)
 VALUES(1,10,'Alice','alice','fixture-only',true,true,true,true),(2,10,'Bob','bob','fixture-only',true,true,false,false),(3,20,'Other','other','fixture-only',true,true,false,false);
 INSERT INTO auth.users(id) VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
 INSERT INTO private.aka_agent_desktop_users(staff_id,auth_user_id) VALUES(1,'11111111-1111-4111-8111-111111111111'),(2,'22222222-2222-4222-8222-222222222222');
 INSERT INTO org_organization_product(id,organization_id,product_package_id,product_id,max_accounts,max_sends_per_day,expiration_date,created_at,is_deleted,is_zalo_show_web,is_zalo_server)
 VALUES(901,10,1,18,100,1000,now()+interval '10 years',now(),false,true,true),(902,10,1,3,100,1000,now()+interval '10 years',now(),false,false,false);
 INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_zalo_server,is_zalo_show_web,is_active,is_delete)
 VALUES(101,1,10,'Own','facebook',false,false,true,false),(102,2,10,'Other staff','facebook',false,false,true,false),(103,3,20,'Other org','facebook',false,false,true,false);
 INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_zalo_server,is_zalo_show_web,is_active,is_delete,login_status,status,zalo_session)
 VALUES(104,1,10,'Own QR','zalo',false,false,true,false,'đã đăng nhập','chờ xử lý','{"fixture":true}'),(105,1,10,'Own Web','zalo',false,true,true,false,'đã đăng nhập','chờ xử lý','{"fixture":true}'),(106,2,10,'Other Zalo','zalo',false,false,true,false,'đã đăng nhập','chờ xử lý','{"fixture":true}');
 UPDATE auto_accounts SET status='chờ xử lý',login_status='đã đăng nhập' WHERE id IN(101,102);
 INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,name,status,is_delete)
 VALUES(201,1,10,101,'Own','chờ xử lý',false),(202,2,10,102,'Other','chờ xử lý',false),(203,1,20,101,'Legacy org mismatch','chờ xử lý',false);
 UPDATE auto_campaigns SET schedule=now()-interval '1 hour';
 INSERT INTO auto_campaign_inputs(id,campaign_id,name) VALUES(301,201,'Own'),(302,202,'Other');
 INSERT INTO auto_campaign_input_data(id,campaign_id,input_id,name) VALUES(401,201,301,'Own'),(402,202,302,'Other');
 INSERT INTO auto_runs(id,campaign_id,account_id,status) VALUES(501,201,101,'running'),(502,202,102,'running');
 INSERT INTO auto_run_steps(id,run_id,node_id,status) VALUES(601,501,'node','success'),(602,502,'node','success');
 INSERT INTO auto_account_groups(id,name,staff_id,organization_id,is_active,is_delete) VALUES(701,'Own',1,10,true,false),(702,'Other',2,10,true,false);
 INSERT INTO auto_proxies(id,name,host,port,staff_id,organization_id,is_active,is_delete) VALUES(801,'Own','localhost',8080,1,10,true,false),(802,'Other','localhost',8081,2,10,true,false);
 INSERT INTO auto_content_groups(id,name,staff_id,organization_id,is_active,is_delete,sharing_scope,sharing_revision) VALUES(901,'Shared',2,10,true,false,'selected',0),(902,'Own',1,10,true,false,'private',0);
 INSERT INTO auto_content_group_recipients(group_id,staff_id) VALUES(901,1);
 INSERT INTO auto_content_templates(id,name,content,staff_id,organization_id,group_id,is_delete) VALUES(1001,'Shared content','fixture content',2,10,901,false);
 INSERT INTO auto_account_contact_groups(id,name,staff_id,organization_id,is_delete,purpose,sharing_scope,sharing_revision,revision) VALUES(1101,'Shared data',2,10,false,'data_group','selected',0,0);
 INSERT INTO auto_data_group_recipients(group_id,staff_id) VALUES(1101,1);
 INSERT INTO auto_account_contacts(id,staff_id,organization_id,account_id,contact_type,flatform_type,name,uid,is_delete) VALUES(1201,2,10,102,'person','facebook','Shared contact','1000000000409',false);
 INSERT INTO auto_account_contact_group_members(id,group_id,contact_id,is_delete) VALUES(1301,1101,1201,false);
 INSERT INTO auto_system_settings(id,key,value,is_active,is_secret) VALUES(990001,'desktop.updates.startup_prompt_max_version',NULL,true,false);`)
 const sharing=(action,data={})=>`SELECT aka_agent_group_sharing(1,10,'alice','fixture-only',${q(action)},${q(JSON.stringify(data))})`
 const preserved=["SELECT name FROM auto_accounts WHERE id=101","SELECT name FROM auto_campaigns WHERE id=201","SELECT name FROM auto_campaigns WHERE id=203",sharing('staff'),sharing('content_groups'),sharing('content_templates'),sharing('data_panel',{kind:'data',groupId:1101}),sharing('data_members',{kind:'data',groupId:1101}),sharing('validate_content_selection',{kind:'content',groupId:901}),"SELECT aka_agent_staff_time_allowed(1)"]
 const claim=(account,platform)=>`SELECT aka_agent_claim_account_operation(${account},1,'${platform}','desktop','chờ xử lý','33333333-3333-4333-8333-333333333333',true,'operation')->>'claimed'`
 const lifecycle=[claim(101,'facebook'),claim(104,'zalo'),claim(105,'zalo'),"SELECT (increment_auto_account_action_count(101,'fixture_action',1)).count_action_in_day","SELECT aka_agent_facebook_login(1,'alice','fixture-only','preview','{\"uids\":[]}')->>'duplicates'", "SELECT aka_agent_zalo_phone_check_usage(1,10,104,'desktop',NULL,false,'alice','fixture-only')->>'allowed'","SELECT claim_campaign_runtime(201,101,1,'desktop')"]
 const lifecycleBefore=lifecycle.map(s=>desktop(s));assert.deepEqual(lifecycleBefore,['true','true','true','1','[]','true','t'])
 const ownBefore=preserved.map(s=>desktop(s)),backendBefore=runAs('service_role','SELECT count(*) FROM auto_accounts'),chatBefore=runAs('aka_agent_chat_api','SELECT count(*) FROM auto_accounts')
 assert.equal(json(desktop(sharing('data_members',{kind:'data',groupId:1101}))).length,1)
 assert.equal(desktop('SELECT count(*) FROM auto_accounts'),'6')
 assert.throws(()=>sql('BEGIN;ALTER FUNCTION public.append_auto_campaign_log(bigint,bigint,text) SET lock_timeout=\'9s\';'+migration+'ROLLBACK;'),/source drift/)
 pass('preflight refuses newer live RPC changes')
 sql('BEGIN;'+migration+'COMMIT;')
 assert.deepEqual(preserved.map(s=>desktop(s)),ownBefore)
 assert.deepEqual(lifecycle.map(s=>desktop(s)),lifecycleBefore)
 assert.equal(runAs('service_role','SELECT count(*) FROM auto_accounts'),backendBefore);assert.equal(runAs('aka_agent_chat_api','SELECT count(*) FROM auto_accounts'),chatBefore)
 pass('own/legacy rows, shared content/data, ID+name directory, backend and Chat reads preserved')
 for(const [table,id]of [['auto_accounts',102],['auto_accounts',103],['auto_campaigns',202],['auto_campaign_inputs',302],['auto_campaign_input_data',402],['auto_runs',502],['auto_run_steps',602],['auto_account_groups',702],['auto_proxies',802]])assert.equal(desktop(`SELECT count(*) FROM ${table} WHERE id=${id}`),'0',table)
 assert.equal(desktop('SELECT count(*) FROM auto_accounts'),'3')
 assert.equal(desktop("WITH x AS (UPDATE auto_accounts SET name='attack' WHERE id=102 RETURNING id) SELECT count(*) FROM x"),'0')
 assert.equal(desktop("WITH x AS (UPDATE auto_campaigns SET name='attack' WHERE id=202 RETURNING id) SELECT count(*) FROM x"),'0')
 pass('direct list/ID read and updates cannot access other-staff or other-org resources')
 for(const c of [{},{role:'aka_agent_desktop',sub:'invalid'},{role:'aka_agent_desktop',sub:'99999999-9999-4999-8999-999999999999'}])assert.equal(desktop('SELECT count(*) FROM auto_accounts',c),'0')
 assert.equal(desktop('SELECT id FROM auto_accounts ORDER BY id',{...claims,sub:'22222222-2222-4222-8222-222222222222'}),'102\n106')
 pass('missing/malformed/unmapped token rejected; second staff sees only their account')
 const createAccount=(staff,org)=>`INSERT INTO auto_accounts(name,flatform_type,staff_id,organization_id,is_zalo_show_web,is_zalo_server) VALUES('new','facebook',${staff},${org},false,false) RETURNING name`
 const createCampaign=(staff,org,account)=>`INSERT INTO auto_campaigns(name,staff_id,organization_id,account_id) VALUES('new',${staff},${org},${account}) RETURNING name`
 assert.equal(desktop(createAccount(1,10)),'new');assert.equal(desktop(createCampaign(1,10,101)),'new')
 for(const s of [createAccount(2,10),createAccount(1,20),createCampaign(2,10,102),createCampaign(1,10,102),createCampaign(1,20,101),"UPDATE auto_campaigns SET secondary_account_id=102 WHERE id=201","UPDATE auto_accounts SET proxy_id=802 WHERE id=101","UPDATE auto_accounts SET account_group_id=702 WHERE id=101","UPDATE auto_campaign_input_data SET input_id=302 WHERE id=401"]){assert.throws(()=>desktop(s),/denied|row-level security/,s)}
 assert.equal(desktop("UPDATE auto_accounts SET name='own edit' WHERE id=101 RETURNING name"),'own edit')
 assert.equal(desktop("UPDATE auto_campaigns SET name='legacy edit' WHERE id=203 RETURNING name"),'legacy edit')
 pass('own create/edit succeeds; foreign owner/org/primary/secondary/proxy/group/child references denied; legacy org row stays editable')
 assert.throws(()=>desktop("SELECT aka_agent_campaign_drafts(2,10,'bob','fixture-only','list',NULL,'{}')"),/desktop_staff_scope_denied/)
 assert.throws(()=>desktop("SELECT append_auto_campaign_log(202,2,'attack')"),/desktop_staff_scope_denied/)
 assert.throws(()=>desktop("SELECT append_auto_campaign_log(202,1,'attack')"),/desktop_campaign_scope_denied/)
 assert.equal(desktop("SELECT append_auto_campaign_log(201,1,'fixture log')"),'t')
 try{assert.equal(desktop('SELECT count(*) FROM aka_agent_list_email_campaign_link_tracking_summaries(202)'),'0')}catch(e){assert.match(e.message,/desktop_campaign_scope_denied/)}
 assert.throws(()=>desktop("SELECT aka_agent_apply_campaign_delivery_cooldown(202,102,2,ARRAY[402]::bigint[])"),/desktop_staff_scope_denied/)
 assert.equal(desktop("SELECT count(*) FROM aka_agent_list_email_campaign_link_tracking_summaries(201)"),'0')
 pass('privileged RPCs bind token even with valid other-staff credentials; own logging and email summaries still work')
 assert.deepEqual(json(desktop(sharing('staff'))),[{id:2,name:'Bob'}])
 const saved=json(desktop(sharing('save',{kind:'content',groupId:902,scope:'selected',recipientIds:[2],expectedRevision:'0'})));assert.deepEqual(saved.recipientIds,[2])
 pass('existing-client sharing recipient selection/save remains functional')
 for(const fn of plan.functions.filter(fn=>fn.desktop_execute&&/LANGUAGE plpgsql/.test(fn.definition))){
  const args=fn.arguments.split(/, (?=p_)/).map(a=>{const [name,...rest]=a.split(' '),type=rest.join(' ').split(' DEFAULT ')[0];let value='NULL';if(['p_staff_id','p_staff'].includes(name))value='2';if(['p_account_id','p_account'].includes(name))value='102';if(['p_campaign_id','p_campaign'].includes(name))value='202';if(type==='jsonb')value="'{}'";return name+'=>'+value+'::'+type})
  assert.throws(()=>desktop('SELECT '+fn.schema+'.'+fn.name+'('+args.join(',')+')'),/desktop_(staff|account|campaign)_scope_denied/,fn.signature)
 }
 pass('every patched callable PL/pgSQL entry rejects foreign identity before privileged work')
 assert.equal(desktop("SELECT count(*) FROM auto_accounts WHERE id=106 AND zalo_session IS NOT NULL"),'0')
 assert.equal(desktop("UPDATE auto_accounts SET zalo_session='{\"fixture\":\"updated\"}' WHERE id=104 RETURNING zalo_session::jsonb->>'fixture'"),'updated')
 assert.equal(desktop("WITH x AS (UPDATE auto_accounts SET zalo_session='{}' WHERE id=106 RETURNING id) SELECT count(*) FROM x"),'0')
 assert.throws(()=>desktop("SELECT (increment_auto_account_action_count(102,'fixture_action',1)).count_action_in_day"),/row-level security/)
 assert.equal(desktop("SELECT aka_agent_claim_account_operation(102,1,'facebook','desktop','chờ xử lý','33333333-3333-4333-8333-333333333333',true,'operation')->>'claimed'"),'false')
 assert.equal(desktop("SELECT aka_agent_claim_account_operation(102,2,'facebook','desktop','chờ xử lý','33333333-3333-4333-8333-333333333333',true,'operation')->>'claimed'"),'false')
 assert.equal(runAs('aka_agent_chat_api',"UPDATE auto_accounts SET status='đang chạy' WHERE id=106 RETURNING status"),'đang chạy')
 pass('own FB/QR/Web claims, quota, phone-check/session and trusted Chat writes work; foreign session/claims/quota denied')
 const target=plan.functions.map(f=>({signature:f.signature,checksum:sql(`SELECT md5(pg_get_functiondef(${q(f.sig||((f.schema+'.'+f.signature.replace(/^(public|private)\./,''))))}::regprocedure))`)}))
 for(const t of target)assert.equal(t.checksum,plan.functions.find(f=>f.signature===t.signature).target_checksum,t.signature)
 pass('all patched function bodies match planned live-derived checksums')
 const targetMeta=json(sql(`SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'checksum',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,'owner',pg_get_userbyid(p.proowner),'config',p.proconfig,'security_definer',p.prosecdef,'volatility',p.provolatile) ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid=ANY(ARRAY[${[...plan.functions.map(f=>q(f.schema+'.'+f.signature.replace(/^(public|private)\./,''))+'::regprocedure'),...plan.newHelpers.map(f=>q(f.signature)+'::regprocedure')].join(',')}])), 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename) FROM pg_policies p WHERE policyname='desktop_owned_resource'), 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid))) FROM pg_trigger WHERE tgname='aaa_desktop_parent_ownership'))`))
 fs.writeFileSync(path.join(dir,'target-meta.json'),JSON.stringify(targetMeta,null,2)+'\n')
 require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'desktop-account-ownership-rollback.cjs')])
 const rollback=fs.readFileSync(path.join(root,'migrations/rollback_desktop_account_campaign_ownership.sql'),'utf8')
 assert.throws(()=>sql("BEGIN; ALTER POLICY desktop_owned_resource ON auto_accounts USING(false);"+rollback+'ROLLBACK;'),/rollback policy drift/)
 assert.throws(()=>sql("BEGIN; ALTER FUNCTION public.append_auto_campaign_log(bigint,bigint,text) SET lock_timeout='9s';"+rollback+'ROLLBACK;'),/rollback function drift/)
 sql('BEGIN;'+rollback+'COMMIT;')
 for(const fn of plan.functions)assert.equal(sql(`SELECT md5(pg_get_functiondef(${q(f.sig(fn))}::regprocedure))`),fn.checksum)
 pass('guarded rollback restores exact live definitions and refuses policy/function drift')
 // Load distribution-only local data with all production indexes. Runtime triggers were tested above.
 sql(`ALTER TABLE auto_campaign_input_data DISABLE TRIGGER USER;
 INSERT INTO auto_campaign_input_data(id,campaign_id,input_id,name) SELECT 1000000+i,201+(i%2),301+(i%2),'bulk fixture' FROM generate_series(1,100000) i;
 ALTER TABLE auto_campaign_input_data ENABLE TRIGGER USER;
 ANALYZE auto_campaign_input_data; ANALYZE auto_campaigns; ANALYZE auto_campaign_inputs; ANALYZE auto_accounts;`)
 const workloads=["SELECT id,name FROM auto_campaign_input_data WHERE campaign_id=201 AND is_delete=false ORDER BY id LIMIT 100","SELECT count(*) FROM auto_campaign_input_data WHERE campaign_id=201 AND is_delete=false","SELECT * FROM auto_campaign_input_data WHERE id IN(1000002,1000004,1000006)","SELECT id,name FROM auto_campaigns WHERE staff_id=1 AND is_delete=false ORDER BY id LIMIT 100"]
 const perfBefore=workloads.map(query=>json(desktop('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query))[0])
 sql('BEGIN;'+migration+'COMMIT;')
 const perfAfter=workloads.map(query=>json(desktop('SET LOCAL statement_timeout=\'10s\'; EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query))[0])
 const performance=workloads.map((query,i)=>({query,beforeMs:perfBefore[i]['Execution Time'],afterMs:perfAfter[i]['Execution Time'],beforeRows:perfBefore[i].Plan['Actual Rows'],afterRows:perfAfter[i].Plan['Actual Rows']}))
 for(const p of performance){assert.equal(p.afterRows,p.beforeRows);assert(p.afterMs<2000,JSON.stringify(p))}
 fs.writeFileSync(path.join(dir,'local-performance.json'),JSON.stringify({at:new Date().toISOString(),inputRows:100000,indexes:'current production',performance,plans:perfAfter},null,2)+'\n')
 pass('100k-input indexed local workloads retain results and finish within 2 seconds')
 sql('BEGIN;'+rollback+'COMMIT;')
 require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'desktop-account-ownership-trial.cjs')])
 assert.equal(sql(fs.readFileSync(path.join(dir,'production-trial.sql'),'utf8')),'t')
 pass('exact production transaction/role-emulation/rollback script passes locally')
 const report={at:new Date().toISOString(),status:'passed',checks,functions:target}
 fs.writeFileSync(path.join(dir,'local-test.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({status:'passed',checks:checks.length}))
}finally{f.close()}
