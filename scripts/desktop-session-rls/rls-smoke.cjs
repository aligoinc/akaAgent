// Authorization transport compatibility: same permitted data/operations after login.
// Real PostgreSQL and captured production functions/triggers; synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {createFixture}=require('./full-fixture.cjs'),{snapshot}=require('./rollback.cjs')
const f=createFixture(),{sql,quote:q}=f,root=f.root
const read=n=>JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/desktop-session-rls',n)))
const hash='a'.repeat(64),claims=q(JSON.stringify({role:'aka_agent_desktop',sub:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222'}))
let checks=0
const pass=s=>{checks++;console.log('PASS',s)}
const relations=read('relation-acls.json')
const aclSnapshot=role=>JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(c.relname,p,has_table_privilege('${role}',c.oid,p),(SELECT jsonb_agg(jsonb_build_array(a.attname,has_column_privilege('${role}',c.oid,a.attname,'SELECT'),has_column_privilege('${role}',c.oid,a.attname,'INSERT'),has_column_privilege('${role}',c.oid,a.attname,'UPDATE'),has_column_privilege('${role}',c.oid,a.attname,'REFERENCES')) ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname,p) FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE c.oid IN (${relations.map(t=>q('public.'+t.name)+'::regclass').join(',')});`))
const execute=(role,query)=>{try{return {data:sql(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claims=${role==='anon'?q('{}'):claims}; ${query}; ROLLBACK;`)}}catch(e){return {error:e.message.replaceAll(role,'request_role')}}}
try{
 sql(f.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027095004_desktop_session_identity.sql'),'utf8')))
 sql(`INSERT INTO org_organization(id,name,use_staff_expiration,is_admin_akabiz,staff_admin_id) VALUES(1,'Vendor',false,true,99),(10,'Alice org',false,false,1),(20,'Bob org',false,false,2);
 INSERT INTO org_staff(id,organization_id,username,password,is_active,deleted_at,is_policy_accepted,aka_agent_device_identity_version,aka_agent_device_fingerprint_hash,aka_agent_device_binding_revision,is_admin,is_admin_akabiz)
 VALUES(1,10,'alice','fixture-only',true,NULL,true,3,'${hash}',5,false,false),(2,20,'bob','fixture-bob',true,NULL,true,3,'${hash}',1,false,false),(3,10,'colleague','fixture-colleague',true,NULL,true,3,'${hash}',1,false,false);
`)
 for(const t of ['auto_proxies','auto_account_groups','auto_media_files','auto_media_groups','auto_content_groups','auto_contact_tags','auto_email_notification_settings','auto_account_contact_groups','auto_account_contacts','zalo_users','zalo_groups','zalo_group_members','auto_blocks','auto_workflows','auto_elements']){
  sql(`INSERT INTO public.${t}(id,staff_id,organization_id) VALUES(100,1,10),(200,2,20),(300,3,10);`)
 }
 sql(`INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active,is_delete,login_status,status,is_zalo_server,is_zalo_show_web) VALUES(100,1,10,'zalo',true,false,'đã đăng nhập','đang chạy',true,false),(200,2,20,'zalo',true,false,'đã đăng nhập','đang chạy',true,false),(300,3,10,'zalo',true,false,'đã đăng nhập','đang chạy',true,false);
 INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,action_id,is_delete,status) VALUES(100,1,10,100,'zalo_message_phone',false,'đang chạy'),(200,2,20,200,'zalo_message_phone',false,'đang chạy'),(300,3,10,300,'zalo_message_phone',false,'đang chạy');
 INSERT INTO auto_campaign_inputs(id,campaign_id) VALUES(100,100),(200,200);
 INSERT INTO auto_campaign_input_data(id,campaign_id,input_id) VALUES(100,100,100),(200,200,200);
 INSERT INTO auto_campaign_details(id,campaign_id,account_id,input_data_id) VALUES(100,100,100,100),(200,200,200,200);
 INSERT INTO auto_runs(id,account_id,campaign_id) VALUES(100,100,100),(200,200,200);
 INSERT INTO auto_run_steps(id,run_id) VALUES(100,100),(200,200);
 INSERT INTO auto_media_group_items(group_id,media_file_id) VALUES(100,100),(200,200);
 INSERT INTO auto_account_contact_group_members(id,group_id,contact_id) VALUES(100,100,100),(200,200,200);
 INSERT INTO auto_email_message_trackings(id,campaign_id,account_id) VALUES(100,100,100),(200,200,200);
 INSERT INTO auto_email_link_trackings(id,message_tracking_id) VALUES(100,100),(200,200);
 INSERT INTO auto_system_settings(id,key,value,is_active,is_secret) VALUES(100,'public.fixture','ok',true,false),(200,'secret.fixture','hidden',true,true),
 (301,'app.notification','Public login notice',true,false),(302,'akabiz.links.website','https://example.test/',true,false),
 (303,'akabiz.links.user_guide','secret guide',true,true),(304,'akabiz.links.contact_us','inactive contact',false,false);
 INSERT INTO org_organization_product(id,organization_id,product_id,is_deleted,package_type,is_zalo_show_web,is_zalo_server,is_chat_sync) VALUES(100,10,18,false,'unlimited',false,true,false),(200,20,18,false,'unlimited',false,true,false);`)

 // A legacy row with a stale organization must keep exactly the old behavior.
 sql("UPDATE auto_campaigns SET organization_id=1147 WHERE id=300;")
 f.installTriggers()
 assert.deepEqual(aclSnapshot('aka_agent_desktop'),aclSnapshot('anon'));pass('prepared token can run before anon is revoked')
 const stateBefore=snapshot(sql),oldAcl=aclSnapshot('anon'),backendRoles=['service_role','aka_agent_chat_api','crm_interest_worker']
 const backendBefore=backendRoles.map(aclSnapshot)
 const cases=[
  ...['auto_accounts','auto_proxies','auto_campaigns','org_organization','org_organization_product','auto_system_settings','auto_blocks','auto_workflows','auto_elements','ai_form_configs','ai_log','zalo_accounts','auto_account_logs'].map(t=>`SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY id),'[]') FROM public.${t} t`),
  "WITH changed AS (UPDATE auto_accounts SET name='fixture updated' WHERE id=200 RETURNING id) SELECT count(*) FROM changed",
  "SELECT organization_id FROM auto_campaigns WHERE id=300",
  "SELECT append_auto_campaign_log(100,1,'fixture log')",
  "SELECT append_auto_campaign_log(200,2,'fixture log')",
  "SELECT count(*) FROM get_staff_zalo_account_capabilities(1)",
  "SELECT row_to_json(t) FROM aka_agent_get_zalo_server_run_control_state(100,100,1) t",
  "SELECT count(*) FROM aka_agent_staff_runtime_scope(2,'share')",
  "INSERT INTO ai_log(id,block_name,created_at) VALUES(999,'fixture',now()) RETURNING id",
  "INSERT INTO ai_log(id,block_name,created_at) VALUES(999,'chat-followup-precreate-v2',now()) RETURNING id"
 ]
 const before=cases.map(query=>execute('anon',query))
 assert.deepEqual(cases.map(query=>execute('aka_agent_desktop',query)),before);pass('old and new clients have identical behavior during the preparation phase')
 assert.equal(before[0].error,undefined)
 assert.equal(before[cases.indexOf("SELECT organization_id FROM auto_campaigns WHERE id=300")].data,'1147')
 assert(before.at(-1).error?.includes('row-level security'),'existing AI guard must be exercised')
 const runtimeCases=[['valid',''],['inactive','UPDATE org_staff SET is_active=false WHERE id=1;'],['deleted','UPDATE auto_accounts SET is_delete=true WHERE id=100;'],['paused',"UPDATE auto_campaigns SET status='tạm dừng' WHERE id=100;"],['held-expired',"UPDATE org_organization SET use_staff_expiration=true WHERE id=10; UPDATE org_staff SET expiration_date=now()-interval '1 day' WHERE id=1; UPDATE auto_campaigns SET runtime_unit_token='11111111-1111-4111-8111-111111111111' WHERE id=100;"]]
 const runtimeSnapshot=role=>runtimeCases.map(([name,setup])=>({name,result:sql(`BEGIN; SET LOCAL session_replication_role=replica; ${setup} SET LOCAL session_replication_role=origin; SET LOCAL ROLE ${role}; SELECT jsonb_build_object('allow',allow_new_unit,'reason',reason,'campaign',campaign_status,'account',account_status,'dayChanged',day_changed) FROM aka_agent_check_campaign_daily_boundary(100,100,1,'server',timezone('Asia/Ho_Chi_Minh',now())::date); ROLLBACK;`)}))
 const runtimeBefore=runtimeSnapshot('anon')
 const loginContentBefore=execute('anon','SELECT public.aka_agent_desktop_login_content()')
 assert.deepEqual(JSON.parse(loginContentBefore.data).map(row=>row.key),['akabiz.links.website','app.notification'])
 sql("SET aka_agent.desktop_rls_cutover='approved-after-client-update';\n"+f.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027100931_desktop_data_rls_activation.sql'),'utf8')))
 assert.deepEqual(execute('anon','SELECT public.aka_agent_desktop_login_content()'),loginContentBefore)
 assert(execute('anon','SELECT * FROM auto_system_settings').error?.includes('permission denied'))
 pass('public login content remains readable after cutover while settings table stays blocked')
 assert.deepEqual(aclSnapshot('aka_agent_desktop'),oldAcl);pass('all 113 relation and column permissions match old anon exactly')
 assert.deepEqual(backendRoles.map(aclSnapshot),backendBefore);pass('existing trusted backend table/column privileges unchanged')
 const after=snapshot(sql)
 assert.deepEqual(after.functions.map(({acl,...f})=>f),stateBefore.functions.map(({acl,...f})=>f));pass('all captured RPC bodies, owners, security modes and local timeouts unchanged')
 const oldExec=new Map(stateBefore.functions.map(f=>[f.signature,f.acl.some(a=>['PUBLIC','anon'].includes(a[0])&&a[1]==='EXECUTE')]))
 for(const fn of after.functions.filter(f=>oldExec.has(f.signature)&&!f.signature.startsWith('aka_agent_desktop_'))){assert.equal(fn.acl.some(a=>['PUBLIC','aka_agent_desktop'].includes(a[0])&&a[1]==='EXECUTE'),oldExec.get(fn.signature),fn.signature)}
 pass('RPC execution permissions match the previous anon access')
 assert.deepEqual(cases.map(query=>execute('aka_agent_desktop',query)),before);checks+=cases.length;pass('reads/writes, existing AI restrictions, RPC results and stale-organization rows preserve prior behavior')
 assert.deepEqual(runtimeSnapshot('aka_agent_desktop'),runtimeBefore);checks+=runtimeCases.length;pass('runtime valid/inactive/deleted/paused/held-expiry boundary results unchanged')
 for(const role of ['anon','authenticated']){
  assert(aclSnapshot(role).every(row=>!row[2]&&row[3].every(col=>col.slice(1).every(v=>!v))))
  for(const query of ["SELECT password FROM org_staff","SELECT * FROM auto_accounts","UPDATE auto_accounts SET name='blocked' WHERE id=100","SELECT append_auto_campaign_log(100,1,'blocked')"]){assert(execute(role,query).error?.includes('permission denied'),role+query);checks++}
 }
 pass('old anon key and default authenticated role cannot read/write protected tables or invoke the tested data RPC')
 const retained=after.policies.filter(p=>!p.policyname.startsWith('desktop_legacy_'))
 assert.deepEqual(retained,stateBefore.policies.filter(p=>!p.policyname.startsWith('desktop_legacy_')));pass('all pre-existing policy predicates retained exactly')
 assert.equal(sql("SELECT count(*) FROM pg_attribute WHERE attrelid IN ('auto_runs'::regclass,'ai_log'::regclass) AND attname LIKE 'desktop_%'"),'0')
 assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='aka_agent_revoke_desktop_sessions'"),'0');pass('no new actor columns, customer data rewrite or staff revocation trigger')
 console.log(JSON.stringify({checks,status:'passed'}))
}finally{f.close()}
