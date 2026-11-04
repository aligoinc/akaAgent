// Synthetic PostgreSQL 17 only, no production data/credentials/connections.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const c=require('./config.cjs'),q=c.quote
const f=require('./fixture.cjs')(),{sql,desktop,claims}=f
const migration=fs.readFileSync(c.migration,'utf8'),meta=require('./metadata.cjs')
const checks=[],pass=s=>{checks.push(s);console.log('PASS',s)}
const bad=(s,pattern=/denied|permission|row-level security|required/)=>assert.throws(()=>desktop(s),pattern)
const count=(table,where)=>desktop(`SELECT count(*) FROM ${table} WHERE ${where}`)
const sharing=(action,data={},staff=1)=>`public.aka_agent_group_sharing(${staff},10,${q(staff===1?'alice':'bob')},'fixture-only',${q(action)},${q(JSON.stringify(data))}::jsonb)`
const runSharing=(action,data)=>JSON.parse(desktop('SELECT '+sharing(action,data)))
const ownerHash=()=>sql("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text) FROM auto_content_templates t")
try{
 console.log('Fixture ready')
 // Only fixture seeding bypasses triggers. Actual tests below use live triggers,
 // constraints, defaults, policies and grants. No external HTTP/cron extension.
 sql(`SET session_replication_role=replica;
 INSERT INTO org_staff(id,organization_id,name,username,password,is_active,is_policy_accepted,is_admin_akabiz)
 VALUES(1,10,'Alice','alice','fixture-only',true,true,false),(2,10,'Bob','bob','fixture-only',true,true,false),(3,20,'Outside','outside','fixture-only',true,true,false),(4,1,'Admin','admin','fixture-only',true,true,true);
 INSERT INTO aka_customer(id) VALUES(1);
 INSERT INTO org_organization(id,customer_id,name,phone,staff_id_created,staff_id_owner,is_admin_akabiz,staff_admin_id)
 VALUES(1,1,'System','test',4,4,true,4),(10,1,'Own org','test',1,1,false,1),(20,1,'Other org','test',3,3,false,3);
 INSERT INTO auth.users(id) VALUES('${claims.sub}'),('44444444-4444-4444-8444-444444444444');
 INSERT INTO private.aka_agent_desktop_users(staff_id,auth_user_id) VALUES(1,'${claims.sub}'),(4,'44444444-4444-4444-8444-444444444444');
 INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_active,is_delete,is_zalo_server,is_zalo_show_web) VALUES(101,1,10,'Own','facebook',true,false,false,false),(102,2,10,'Other','facebook',true,false,false,false),(103,3,20,'Foreign','facebook',true,false,false,false);
 INSERT INTO auto_account_contacts(id,staff_id,organization_id,account_id,contact_type,flatform_type,name,uid,is_delete,extra_data) VALUES(1001,1,10,101,'friend','facebook','Own','own',false,'{}'),(1002,2,10,102,'friend','facebook','Shared','shared',false,'{"info1":"Keep","private":"Hide"}'),(1003,3,20,103,'friend','facebook','Foreign','foreign',false,'{}');
 INSERT INTO auto_account_contact_groups(id,name,staff_id,organization_id,purpose,sharing_scope) VALUES(1101,'Own data',1,10,'data_group','private'),(1102,'Shared data',2,10,'data_group','selected'),(1103,'Foreign data',3,20,'data_group','organization');
 INSERT INTO auto_account_contact_group_members(id,group_id,contact_id) VALUES(1151,1101,1001),(1152,1102,1002),(1153,1103,1003);
 INSERT INTO auto_data_group_recipients(group_id,staff_id) VALUES(1102,1);
 INSERT INTO auto_content_groups(id,name,staff_id,organization_id,is_active,is_delete,sharing_scope,sharing_revision) VALUES(1201,'Own content',1,10,true,false,'private',0),(1202,'Shared selected',2,10,true,false,'selected',0),(1203,'Shared organization',2,10,true,false,'organization',0),(1204,'Private content',2,10,true,false,'private',0),(1205,'Foreign content',3,20,true,false,'organization',0),(1206,'Own secondary',1,10,true,false,'private',0);
 INSERT INTO auto_content_group_recipients(group_id,staff_id) VALUES(1202,1);
 INSERT INTO auto_content_templates(id,name,content,group_id,staff_id,organization_id) VALUES(1301,'Own template','Hello',1201,1,10),(1302,'Selected template','Shared',1202,2,10),(1303,'Org template','Shared',1203,2,10),(1304,'Private template','Private',1204,2,10),(1305,'Foreign template','Foreign',1205,3,20);
 INSERT INTO auto_media_files(id,original_name,cloud_url,staff_id,organization_id) VALUES(1401,'Own','https://example.invalid/own',1,10),(1402,'Other','https://example.invalid/other',2,10);
 INSERT INTO auto_media_groups(id,name,staff_id,organization_id) VALUES(1501,'Own',1,10),(1502,'Other',2,10);
 INSERT INTO auto_media_group_items(group_id,media_file_id) VALUES(1501,1401),(1502,1402);
 INSERT INTO auto_contact_tags(id,name,staff_id,organization_id,auto_account_id) VALUES(1601,'Own',1,10,101),(1602,'Other',2,10,102);
 INSERT INTO auto_elements(id,name,xpath,is_builtin,staff_id,organization_id) VALUES(1701,'own_element','//div',false,1,10),(1702,'other_element','//span',false,2,10),(1703,'builtin_element','//button',true,NULL,NULL);
 INSERT INTO auto_system_settings(id,key,value,is_secret) VALUES(1801,'media.storage.bucket','fixture',false),(1802,'media.storage.secret_access_key','fixture-only-secret',true),(1803,'ai.deepseek.api_key','fixture-only-ai',true);
 INSERT INTO org_organization_product(id,organization_id,product_package_id) VALUES(1901,10,1),(1902,20,1);
 SET session_replication_role=origin;`)
 const before=JSON.parse(sql(meta)),sourceRows=ownerHash()
 const baseline={}
 for(const action of ['content_groups','content_templates','data_groups'])baseline[action]=runSharing(action)
 for(const action of ['get','data_members','data_panel'])baseline[action]=runSharing(action,{kind:'data',groupId:1102})
 assert.equal(count('auto_account_contacts','staff_id=3'),'1')
 assert.equal(desktop("WITH x AS (UPDATE auto_system_settings SET value='before' WHERE id=1801 RETURNING id) SELECT count(*) FROM x"),'1')
 pass('baseline reproduces cross-staff raw reads and unrestricted settings write; captures sharing JSON')
 for(const edit of ["ALTER FUNCTION public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb) SET statement_timeout='59s';","GRANT SELECT ON auto_account_contacts TO anon;","ALTER TABLE auto_media_files DISABLE ROW LEVEL SECURITY;"])
  assert.throws(()=>sql('BEGIN;'+edit+migration+'ROLLBACK;'),/V436 .*drift/)
 sql('BEGIN;'+migration+'ROLLBACK;');assert.deepEqual(JSON.parse(sql(meta)),before)
 pass('preflight rejects function/ACL/RLS drift; transactional rehearsal restores all metadata')
 sql('BEGIN;'+migration+'COMMIT;')
 const after=JSON.parse(sql(meta));fs.writeFileSync(c.dir+'/target.json',JSON.stringify({functions:after.functions.filter(x=>f.plan.newFunctions.some(s=>x.signature.endsWith(s))),relations:after.relations.filter(r=>r.schema==='public'&&c.tables.includes(r.name)),policies:after.policies.filter(p=>p.policyname.startsWith('v436_')),triggers:after.triggers.filter(t=>t.name==='aaa_v436_desktop_data_owner')},null,2)+'\n')
 const existingAfter=after.functions.filter(x=>!f.plan.newFunctions.some(s=>x.signature.endsWith(s)))
 assert.deepEqual(existingAfter,before.functions)
 assert.deepEqual(after.relations.filter(r=>r.name!=='org_organization'),before.relations.filter(r=>r.name!=='org_organization'))
 assert.equal(after.policies.length-before.policies.length,23);assert.equal(after.triggers.length-before.triggers.length,11)
 const rollback=require('./rollback.cjs')(after)
 pass('all existing function bodies/config/ACL and all other relation ACL/RLS remain byte-exact')
 for(const [t,owned,other] of [['auto_account_contacts',1001,1002],['auto_account_contact_groups',1101,1102],['auto_contact_tags',1601,1602],['auto_media_files',1401,1402],['auto_media_groups',1501,1502]]){
  assert.equal(count(t,`id=${owned}`),'1');assert.equal(count(t,`id=${other}`),'0')
  assert.equal(desktop(`WITH x AS (UPDATE ${t} SET is_delete=true WHERE id=${other} RETURNING id) SELECT count(*) FROM x`),'0')
 }
 assert.equal(count('auto_account_contact_group_members','group_id=1102'),'0');assert.equal(count('auto_media_group_items','group_id=1502'),'0')
 assert.equal(count('auto_content_groups','id IN (1201,1202,1203)'),'3');assert.equal(count('auto_content_groups','id IN (1204,1205)'),'0')
 assert.equal(count('auto_content_templates','id IN (1301,1302,1303)'),'3');assert.equal(count('auto_content_templates','id IN (1304,1305)'),'0')
 assert.equal(desktop("WITH x AS (UPDATE auto_content_templates SET content='attack' WHERE id=1302 RETURNING id) SELECT count(*) FROM x"),'0')
 for(const action of ['content_groups','content_templates','data_groups'])assert.deepEqual(runSharing(action),baseline[action])
 for(const action of ['get','data_members','data_panel'])assert.deepEqual(runSharing(action,{kind:'data',groupId:1102}),baseline[action])
 assert.equal(runSharing('validate_content_selection',{kind:'content',groupId:1202}).allowed,true)
 bad('SELECT '+sharing('save',{kind:'content',groupId:1202,scope:'private',recipientIds:[],expectedRevision:'0'}))
 bad('SELECT '+sharing('content_templates',{},2),/access_denied/)
 pass('private cross-staff reads/writes denied; selected and organization sharing/export/panel JSON stay identical')
 const copied=runSharing('copy',{kind:'content',groupId:1202,targetGroupId:1201,requestId:'content-copy-1'})
 assert.equal(copied.count,1);assert.equal(copied.groupId,1201)
 const copiedData=runSharing('copy',{kind:'data',groupId:1102,targetGroupId:1101,requestId:'data-copy-1'})
 assert.equal(copiedData.count,1);assert.equal(copiedData.groupId,1101)
 assert.equal(ownerHash(),sourceRows)
 pass('real SECURITY DEFINER content/data copy remains usable and creates only recipient-owned snapshots')
 const shareOwn=runSharing('save',{kind:'content',groupId:1201,scope:'selected',recipientIds:[2],expectedRevision:'0'})
 assert.deepEqual(shareOwn.recipientIds,[2])
 sql("INSERT INTO auto_campaign_data_group_sources(id,group_id,campaign_id,staff_id,organization_id,status) VALUES(9991,1101,9992,2,10,'active');")
 const revoked=JSON.parse(desktop(`DO $$BEGIN PERFORM ${sharing('save',{kind:'data',groupId:1101,scope:'private',recipientIds:[],expectedRevision:'0'})}; END$$; RESET ROLE; SELECT jsonb_build_object('status',status,'reason',stop_reason) FROM auto_campaign_data_group_sources WHERE id=9991`))
 assert.deepEqual(revoked,{status:'stopped',reason:'sharing_revoked'})
 sql('DELETE FROM auto_campaign_data_group_sources WHERE id=9991;')
 pass('saving selected sharing and revoking recipient campaign sources preserve the latest live fix')
 for(const attack of [
 "UPDATE auto_content_templates SET staff_id=2 WHERE id=1301", "UPDATE auto_content_templates SET organization_id=20 WHERE id=1301", "UPDATE auto_content_templates SET group_id=1202 WHERE id=1301", "UPDATE auto_content_templates SET secondary_group_ids=ARRAY[1202]::bigint[] WHERE id=1301",
 "UPDATE auto_account_contacts SET account_id=102 WHERE id=1001", "UPDATE auto_account_contacts SET akabiz_tag_ids=ARRAY[1602]::bigint[] WHERE id=1001",
 "INSERT INTO auto_account_contact_group_members(group_id,contact_id) VALUES(1101,1002)","INSERT INTO auto_media_group_items(group_id,media_file_id) VALUES(1501,1402)",
 "INSERT INTO auto_content_templates(id,name,staff_id,organization_id) VALUES(9991,'Attack',2,10)"] ) bad(attack)
 // Exercise trigger even when a definer bypasses RLS, without publishing a test RPC.
 sql("CREATE FUNCTION private.fixture_definer_attack() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$UPDATE public.auto_content_templates SET content='attack' WHERE id=1302$$; GRANT EXECUTE ON FUNCTION private.fixture_definer_attack() TO aka_agent_desktop;")
 bad('SELECT private.fixture_definer_attack()');sql('DROP FUNCTION private.fixture_definer_attack();')
 for(const malformed of [{},'{bad}',{role:'aka_agent_desktop',sub:'00000000-0000-4000-8000-000000000000'},{role:'anon',sub:claims.sub}])assert.equal(desktop('SELECT count(*) FROM auto_account_contacts',malformed),'0')
 pass('owner/org/reference/tag/member manipulation and definer bypass blocked; malformed/unmapped claims fail closed')
 assert.equal(desktop("UPDATE auto_content_templates SET secondary_group_ids=ARRAY[1206]::bigint[] WHERE id=1301; UPDATE auto_content_groups SET is_delete=true WHERE id=1206; SELECT cardinality(secondary_group_ids) FROM auto_content_templates WHERE id=1301"),'0')
 assert.equal(desktop("DO $$BEGIN PERFORM public.aka_agent_mutate_contact_tags(1,10,ARRAY[1001]::bigint[],ARRAY[1601]::bigint[],'alice','fixture-only','add'); END$$; SELECT akabiz_tag_ids::text FROM auto_account_contacts WHERE id=1001"),'{1601}')
 sql('UPDATE auto_content_templates SET organization_id=20 WHERE id=1301;')
 assert.equal(desktop("UPDATE auto_content_templates SET content='legacy edit' WHERE id=1301; SELECT content FROM auto_content_templates WHERE id=1301"),'legacy edit')
 sql('UPDATE auto_content_templates SET organization_id=10 WHERE id=1301;')
 pass('owned edits, tag synchronization, secondary-group cleanup and unchanged legacy org values remain usable')
 desktop(`INSERT INTO auto_account_contacts(account_id,contact_type,name,uid,staff_id,organization_id) VALUES(101,'person','Create','new-own',1,10) ON CONFLICT(account_id,contact_type,uid) DO UPDATE SET name=EXCLUDED.name;
 INSERT INTO auto_account_contact_groups(name,staff_id,organization_id) VALUES('Created group',1,10);
 INSERT INTO auto_contact_tags(name,staff_id,organization_id) VALUES('Created tag',1,10);
 INSERT INTO auto_content_groups(name,staff_id,organization_id) VALUES('Created content group',1,10);
 INSERT INTO auto_content_templates(name,content,group_id,staff_id,organization_id) VALUES('Created template','Text',1201,1,10);
 INSERT INTO auto_media_files(original_name,cloud_url,staff_id,organization_id) VALUES('new.png','https://example.invalid/new',1,10);
 INSERT INTO auto_media_groups(name,staff_id,organization_id) VALUES('Created media group',1,10);
 INSERT INTO auto_media_group_items(group_id,media_file_id) VALUES(1501,1401) ON CONFLICT(group_id,media_file_id) DO UPDATE SET sort_order=1;
 INSERT INTO auto_elements(name,xpath,is_builtin,staff_id,organization_id) VALUES('own_element','//upsert',false,1,10) ON CONFLICT(name) DO UPDATE SET xpath=EXCLUDED.xpath;`)
 pass('unchanged direct payloads can create all owned libraries and upsert contacts/media memberships/elements')
 assert.equal(count('auto_elements','true'),'3')
 assert.equal(desktop("UPDATE auto_elements SET xpath='//section' WHERE id=1701; SELECT xpath FROM auto_elements WHERE id=1701"),'//section')
 assert.equal(desktop("WITH x AS (UPDATE auto_elements SET xpath='attack' WHERE id IN (1702,1703) RETURNING id) SELECT count(*) FROM x"),'0')
 bad("UPDATE auto_elements SET is_builtin=true WHERE id=1701")
 assert.equal(desktop("WITH x AS (UPDATE auto_system_settings SET value='attack' WHERE id=1801 RETURNING id) SELECT count(*) FROM x"),'0')
 bad("INSERT INTO auto_system_settings(key,value) VALUES('new.setting','attack')")
 const adminClaims={...claims,sub:'44444444-4444-4444-8444-444444444444'}
 assert.equal(desktop("UPDATE auto_system_settings SET value='admin' WHERE id=1801; SELECT value FROM auto_system_settings WHERE id=1801",adminClaims),'admin')
 assert.equal(desktop("UPDATE auto_elements SET xpath='//admin' WHERE id=1703; SELECT xpath FROM auto_elements WHERE id=1703",adminClaims),'//admin')
 assert.equal(count('auto_system_settings',"key='ai.deepseek.api_key'"),'0');assert.equal(count('auto_system_settings',"key='media.storage.secret_access_key'"),'1')
 pass('runtime XPath reads and legitimate element/admin settings edits preserved; ordinary global edits and AI keys denied')
 assert.equal(desktop('SELECT string_agg(id::text,\',\' ORDER BY id) FROM org_organization'),'1,10')
 assert.equal(desktop('SELECT id FROM org_organization_product'),'1901')
 bad('SELECT phone FROM org_organization')
 assert.equal(f.runAs('service_role','SELECT count(*) FROM auto_account_contacts'),'3')
 assert.equal(f.runAs('service_role',"WITH x AS (UPDATE auto_content_templates SET content='backend' WHERE id=1302 RETURNING id) SELECT count(*) FROM x"),'1')
 assert.throws(()=>f.runAs('anon','SELECT count(*) FROM org_organization_product'),/permission denied/)
 pass('organization/product scope and backend bypass preserved')
 sql(`SET session_replication_role=replica; INSERT INTO auto_account_contacts(id,staff_id,organization_id,account_id,contact_type,name,uid,is_delete) SELECT 10000+i,CASE WHEN i%2=0 THEN 1 ELSE 2 END,10,CASE WHEN i%2=0 THEN 101 ELSE 102 END,'friend','Load '||i,'load-'||i,false FROM generate_series(1,100000) i; SET session_replication_role=origin; ANALYZE auto_account_contacts;`)
 const started=Date.now();assert.equal(desktop("SET LOCAL statement_timeout='2s'; SELECT count(*) FROM auto_account_contacts WHERE staff_id=1"),'50001');
 assert.equal(JSON.parse(desktop("SET LOCAL statement_timeout='2s'; SELECT jsonb_agg(c.id) FROM (SELECT id FROM auto_account_contacts WHERE staff_id=1 ORDER BY id LIMIT 100) c")).length,100)
 const loadMs=Date.now()-started;
 const writeStarted=Date.now();assert.equal(desktop("SET LOCAL statement_timeout='5s'; WITH x AS (UPDATE auto_account_contacts SET name='Load changed' WHERE staff_id=1 AND id BETWEEN 10000 AND 30000 RETURNING id) SELECT count(*) FROM x"),'10000');
 const writeMs=Date.now()-writeStarted;
 pass('100k contact count and first-page workload completes within unchanged 2s test budget')
 assert.throws(()=>sql('BEGIN;'+rollback+'ROLLBACK;'),/requires approval/)
 assert.throws(()=>sql("BEGIN; SET LOCAL aka_agent.data_privacy_rollback='approved'; ALTER FUNCTION private.aka_agent_desktop_data_context() SET statement_timeout='59s';"+rollback+'ROLLBACK;'),/rollback drift/)
 sql("BEGIN; SET LOCAL aka_agent.data_privacy_rollback='approved';"+rollback+'COMMIT;')
 assert.deepEqual(JSON.parse(sql(meta)),before)
 pass('explicit rollback refuses drift and restores all original metadata exactly')
 fs.writeFileSync(c.dir+'/local-test.json',JSON.stringify({at:new Date().toISOString(),status:'passed',checks,loadRows:100000,loadMs,writeRows:10000,writeMs,migrationSha256:crypto.createHash('sha256').update(migration).digest('hex'),productionWrites:0},null,2)+'\n')
} finally {f.close()}
