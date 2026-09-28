// Isolated PostgreSQL engine, no production writes or Zalo calls.
const assert = require('node:assert/strict')
const {readFileSync, writeFileSync} = require('node:fs')
const {resolve} = require('node:path')
const {PGlite} = require(require.resolve('@electric-sql/pglite', {paths: [resolve(__dirname, '../../akaAgentChatApi')]}))
const baseline = require('./fixtures/send-exclusion-live-baseline.json')
const migration = readFileSync(resolve(__dirname, '../migrations/migration_v330_campaign_send_exclusions.sql'), 'utf8')
async function main() {
 const db = new PGlite()
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;
    CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    CREATE TABLE org_organization(id bigint PRIMARY KEY);`)
  await db.exec(readFileSync(resolve(__dirname, 'fixtures/send-exclusion-schema.sql'), 'utf8'))
  for (const fn of require('./fixtures/send-exclusion-normalizers.json')) await db.exec(fn.definition)
  for (const fn of baseline) {
   await db.exec(fn.definition)
   await db.exec(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM PUBLIC;`)
   for (const grant of (fn.proacl || '{}').slice(1,-1).split(',')) {
    const role = grant.split('=')[0]
    if (role && role !== 'postgres') await db.exec(`GRANT EXECUTE ON FUNCTION public.${fn.signature} TO ${role};`)
   }
  }
  await db.exec(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
  assert.equal((await db.query("SELECT to_regclass('auto_filter_fields') AS table")).rows[0].table, null)
  await db.exec(migration)
  await db.exec(`INSERT INTO org_organization VALUES(10),(20);
   INSERT INTO org_staff(id,organization_id,username,password,is_active) VALUES(1,10,'one','secret',true),(2,10,'two','secret',true),(3,20,'three','secret',true);
   INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type) VALUES(100,1,10,'zalo'),(101,1,10,'zalo'),(200,2,10,'zalo'),(300,3,20,'zalo');
   INSERT INTO category_type(id,namespace,code) VALUES(1,'common','zalo_friend_status');
   INSERT INTO category_item(id,category_type_id,code,name,is_active) VALUES(1,1,'friend','Bạn bè',true),(2,1,'request_sent','Gửi lời mời kết bạn',true),(3,1,'request_received','Nhận kết bạn',true),(4,1,'stranger','Người lạ',true);
   INSERT INTO auto_account_contact_groups(id,account_id,staff_id,organization_id,name,purpose,contact_type) VALUES(4,100,1,10,'VIP','zalo_friend_blocklist','person'),(9,100,1,10,'B','zalo_friend_blocklist','person'),(8,200,2,10,'Other','zalo_friend_blocklist','person');
   INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,flatform_type,uid) SELECT n,100,1,10,'person','zalo','u'||n FROM generate_series(1,1005)n;
   INSERT INTO auto_account_contact_group_members(id,group_id,contact_id) SELECT n,4,n FROM generate_series(1,1005)n;
   SET ROLE anon; SET request.jwt.claim.role='anon';`)
  const call = async (operation, payload={}, account=100, staff=1, org=10, username='one', password='secret') => (await db.query('SELECT aka_agent_send_exclusion_groups($1,$2,$3,$4,$5,$6,$7) AS data',[staff,org,account,operation,JSON.stringify({requestId:require('node:crypto').randomUUID(),...payload}),username,password])).rows[0].data
  const page = await call('list')
  assert.equal(page.catalog.fields.length,4)
  assert.equal(page.options.filter(o=>o.fieldId===page.catalog.fields.find(f=>f.code==='zalo_friend_status').id).length,4)
  const field = page.catalog.fields.find(f=>f.code==='zalo_friend_status')
  const op = page.catalog.operators.find(o=>o.code==='equals')
  const rule = {fieldId:field.id,operatorId:op.id,value:'friend',isEnabled:true,sortOrder:0}
  const create={requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Bạn bè',matchMode:'or',rules:[rule]}
  const group = await call('save',create)
  assert.equal((await call('save',create)).id,group.id,'Retry replays the same group')
  await assert.rejects(call('save',{...create,name:'Changed before retry'}),/revision_conflict/)
  assert.equal(group.accountId,100); assert.equal(group.revision,1)
  const updated = await call('save',{...group,name:'Đã sửa'}); assert.equal(updated.revision,2)
  await assert.rejects(call('save',group),/revision_conflict/)
  await assert.rejects(call('save',{...updated,rules:[rule,rule]}),/duplicate_field/)
  await assert.rejects(call('save',{...updated,rules:[{...rule,value:['friend','stranger']}]}),/value_count/)
  await assert.rejects(call('save',{...updated,rules:[{...rule,operatorId:999}]}),/operator_unavailable/)
  await assert.rejects(call('save',{...updated,rules:[{...rule,value:'blocked'}]}),/option_unavailable/)
  await assert.rejects(call('list',{},200),/account_not_found/)
  await assert.rejects(call('list',{},100,1,10,'one','wrong'),/auth/)
  await assert.rejects(db.query('SELECT * FROM auto_filter_fields'),/permission denied/)
  await db.exec('RESET ROLE;')
  const token='11111111-1111-4111-8111-111111111111'
  const map={'100':{groupId:group.id,blocklistIds:[4,9]}}
  await db.query(`INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,extra_settings,runtime_claim_token,status)
    VALUES(10,100,1,10,'Campaign','zalo_message_friend',$1,$2,'đang chạy')`,[JSON.stringify({zaloSendExclusionsByAccountId:map}),token])
  await db.exec("INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,email,status) VALUES(11,10,'u1','','','chờ xử lý'),(12,10,'u2','','','chờ xử lý'); SET ROLE aka_agent_chat_api;")
  const runtime = async (operation,payload={},t=token) => (await db.query('SELECT aka_agent_campaign_send_exclusion_runtime(10,100,1,$1,$2,$3) AS data',[t,operation,JSON.stringify(payload)])).rows[0].data
  const snapshot = await runtime('snapshot'); assert.equal(snapshot.blocklistUids.length,1005); assert.equal(snapshot.group.name,'Đã sửa')
  await assert.rejects(runtime('snapshot',{},'22222222-2222-4222-8222-222222222222'),/claim_lost/)
  assert.equal((await runtime('pause',{inputId:11,expectedStatus:'chờ xử lý',note:'Loại trừ gửi'})).changed,true)
  assert.equal((await runtime('pause',{inputId:11,expectedStatus:'chờ xử lý',note:'overwrite'})).changed,false)
  assert.deepEqual((await runtime('facts',{inputId:12,uid:'u2',tags:true})).akabiz_contact,{ids:[],availableValues:[]})
  assert.equal((await runtime('facts',{inputId:12,days:7})).campaign_delivery.daysSince,3651)
  await db.exec('RESET ROLE;')
  await db.exec(`INSERT INTO auto_contact_tags(id,staff_id,organization_id,auto_account_id,name) VALUES(10,1,10,NULL,'Global'),(20,2,10,NULL,'Other staff'),(30,1,10,101,'Other account');
    UPDATE auto_account_contacts SET akabiz_tag_ids=ARRAY[10,20,30]::bigint[] WHERE uid='u2';`)
  assert.deepEqual((await runtime('facts',{inputId:12,tags:true})).akabiz_contact,{ids:['10'],availableValues:['10']})
  await db.exec(`INSERT INTO chat_zalo_account_organization(id,chat_zalo_account_id,auto_account_id,organization_id,is_active) VALUES(1,1,100,10,true);
    INSERT INTO chat_zalo_account_conversation(id,chat_zalo_account_id,zalo_id,conversation_type) VALUES(1,1,'u2','user');
    INSERT INTO chat_zalo_conversation(id,chat_zalo_account_organization_id,chat_zalo_account_conversation_id,organization_id) VALUES(1,1,1,10);`)
  assert.deepEqual((await runtime('facts',{inputId:12,tags:true})).akabiz_contact.ids,[],'Canonical empty must not use stale fallback')
  await db.exec(`INSERT INTO chat_zalo_conversation_system_tag(id,chat_zalo_conversation_id,auto_contact_tag_id,organization_id) VALUES(1,1,10,10);`)
  assert.deepEqual((await runtime('facts',{inputId:12,tags:true})).akabiz_contact.ids,['10'])
  await db.exec(`UPDATE auto_contact_tags SET is_delete=true WHERE id=10;`)
  assert.deepEqual((await runtime('facts',{inputId:12,tags:true})).akabiz_contact,{ids:[],availableValues:[]})
  // Immutable semantics: live groups cannot silently change the meaning of existing metadata.
  await assert.rejects(db.query('UPDATE auto_campaigns SET extra_settings=$1 WHERE id=10',[JSON.stringify({zaloSendExclusionsByAccountId:{100:{groupId:group.id,blocklistIds:[8]}}})]),/blocklist_not_found/)
  await assert.rejects(db.exec("UPDATE auto_filter_fields SET source_config='{\"path\":[\"other\"]}' WHERE code='zalo_friend_status'"),/definition_in_use/)
  await db.exec(`INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,flatform_type,contact_type,uid,name) VALUES(2000,100,1,10,'zalo','zalo_tag','7','VIP'),(2001,100,1,10,'zalo','zalo_tag','8','Khách mới');
    INSERT INTO auto_filter_fields(code,name,data_type,source_key,source_config,options_source,sort_order)
    VALUES('fixture_gender','Giới tính','enum','zalo_profile','{"path":["gender"]}','static',50);
    INSERT INTO auto_filter_field_options(field_id,code,label,value) SELECT id,'male','Nam','0' FROM auto_filter_fields WHERE code='fixture_gender';
    INSERT INTO auto_filter_field_options(field_id,code,label,value) SELECT id,'female','Nữ','1' FROM auto_filter_fields WHERE code='fixture_gender';
    INSERT INTO auto_filter_field_operators(field_id,operator_id,value_type) SELECT f.id,o.id,'enum' FROM auto_filter_fields f CROSS JOIN auto_filter_operators o WHERE f.code='fixture_gender' AND o.code IN ('equals','not_equals');
    SET ROLE anon;`)
  const extended = await call('list')
  const gender = extended.catalog.fields.find(f=>f.code==='fixture_gender')
  const genderGroup = await call('save',{requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Giới tính nữ',matchMode:'and',rules:[{...rule,fieldId:gender.id,value:1}]})
  assert.equal(extended.catalog.fields.length,5)
  writeFileSync(resolve(__dirname,'fixtures/send-exclusion-ui-page.json'),JSON.stringify({...extended,groups:[updated,genderGroup]},null,2)+'\n')
  await db.exec('RESET ROLE;')
  // A stale backup selection must not stop a valid primary account snapshot.
  await db.exec('BEGIN;')
  try {
   const backupGroup=await call('save',{name:'Backup group',matchMode:'or',rules:[rule]},101)
   await db.exec("INSERT INTO auto_account_contact_groups(id,account_id,staff_id,organization_id,name,purpose,contact_type) VALUES(14,101,1,10,'Backup list','zalo_friend_blocklist','person');")
   const accountMap={...map,'101':{groupId:backupGroup.id,blocklistIds:[14]}}
   await db.query('UPDATE auto_campaigns SET secondary_account_id=101,extra_settings=$1 WHERE id=10',[JSON.stringify({zaloSendExclusionsByAccountId:accountMap})])
   await db.query(`INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,extra_settings,runtime_claim_token,status)
    VALUES(30,101,1,10,'Backup campaign','zalo_message_friend',$1,$2,'đang chạy'),
     (31,100,1,10,'Missing configuration','zalo_message_friend','{}',$2,'đang chạy')`,[JSON.stringify({zaloSendExclusionsByAccountId:accountMap}),token])
   const scopedSnapshot=async(campaignId,accountId)=>(await db.query("SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,1,$3,'snapshot') AS data",[campaignId,accountId,token])).rows[0].data
   const rejectsInTransaction=async(operation,expected)=>{
    await db.exec('SAVEPOINT expected_rejection;')
    await assert.rejects(operation,expected)
    await db.exec('ROLLBACK TO SAVEPOINT expected_rejection; RELEASE SAVEPOINT expected_rejection;')
   }
   const primarySnapshot=await runtime('snapshot')
   assert.deepEqual(primarySnapshot.group,snapshot.group)
   assert.deepEqual(primarySnapshot.blocklistUids,snapshot.blocklistUids)
   assert.equal((await scopedSnapshot(30,101)).group.id,backupGroup.id)
   await rejectsInTransaction(()=>scopedSnapshot(31,100),/account_configuration_missing/)
   await rejectsInTransaction(()=>scopedSnapshot(10,101),/claim_lost/)
   for (const [table,backupId,primaryId,error] of [
    ['auto_account_contact_groups',14,4,/blocklist_not_found/],
    ['auto_campaign_send_exclusion_groups',backupGroup.id,group.id,/group_not_found/]
   ]) {
    await db.exec('SAVEPOINT stale_selection;')
    await db.query(`UPDATE ${table} SET is_delete=true WHERE id=$1`,[backupId])
    assert.deepEqual(await runtime('snapshot'),primarySnapshot,'Unrelated deleted selections must not affect the active account')
    await rejectsInTransaction(()=>scopedSnapshot(30,101),error)
    const changedMap={...accountMap,'100':{groupId:group.id,blocklistIds:[4]}}
    await rejectsInTransaction(()=>db.query('UPDATE auto_campaigns SET extra_settings=$1 WHERE id=10',[JSON.stringify({zaloSendExclusionsByAccountId:changedMap})]),error)
    await db.query(`UPDATE ${table} SET is_delete=true WHERE id=$1`,[primaryId])
    await rejectsInTransaction(()=>runtime('snapshot'),error)
    await db.exec('ROLLBACK TO SAVEPOINT stale_selection; RELEASE SAVEPOINT stale_selection;')
   }
  } finally { await db.exec('ROLLBACK;') }
  // Compare the refactored cooldown to the exact captured body at Vietnam day boundaries.
  const oldCooldown=baseline.find(fn=>fn.signature.startsWith('aka_agent_apply_campaign_delivery_cooldown(')).definition.replace('public.aka_agent_apply_campaign_delivery_cooldown(', 'public.fixture_original_cooldown(')
  await db.exec(oldCooldown)
  await db.exec(`UPDATE auto_campaigns SET extra_settings=extra_settings || '{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":7}'::jsonb WHERE id=10;
    INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id) VALUES(20,100,1,10,'History','zalo_message_friend');
    INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,email,status) VALUES(21,20,'u2','','','hoàn thành');`)
  for (const days of [0,6,7,8]) {
    await db.exec(`DELETE FROM auto_campaign_details; INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,created_at)
      VALUES(21,21,20,100,'zalo_message_friend','đã nhận',(timezone('Asia/Ho_Chi_Minh',now())::date-${days})::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');`)
    const runCooldown = async fn => {
      await db.exec("BEGIN; UPDATE auto_campaign_input_data SET status='chờ xử lý' WHERE id=12;")
      const data=(await db.query(`SELECT * FROM public.${fn}(10,100,1,ARRAY[12]::bigint[])`)).rows
      await db.exec('ROLLBACK;'); return data
    }
    assert.deepEqual(await runCooldown('aka_agent_apply_campaign_delivery_cooldown'),await runCooldown('fixture_original_cooldown'))
    const facts=await runtime('facts',{inputId:12,days:7})
    assert.equal(facts.campaign_delivery.daysSince,days<=7?days:3651)
  }
  await db.exec("UPDATE auto_filter_fields SET is_active=false WHERE code='zalo_friend_status'; SET ROLE anon;")
  await assert.rejects(call('save',{...updated,name:'Inactive'}),/field_unavailable/)
  await db.exec('RESET ROLE;')
  const checks = (await db.query(`SELECT p.oid::regprocedure::text AS signature,md5(pg_get_functiondef(p.oid)) AS checksum,prosecdef,provolatile,proconfig,proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (proname LIKE '%send_exclusion%' OR proname='aka_agent_internal_send_delivery_history' OR proname='aka_agent_apply_campaign_delivery_cooldown') ORDER BY 1`)).rows
  writeFileSync(resolve(__dirname,'fixtures/send-exclusion-target-checksums.json'),JSON.stringify(checks,null,2)+'\n')
  for (const fn of baseline.filter(f=>!f.signature.startsWith('aka_agent_apply_campaign_delivery_cooldown('))) assert.equal((await db.query('SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS checksum',[fn.signature])).rows[0].checksum,fn.checksum)
  await assert.rejects(db.exec(migration),/source drift|already exists/); await db.exec('ROLLBACK;')
  console.log('PASS: transaction rollback, catalog, group/rule CAS, auth/tenant/account, valid pairs/options, 1005 UIDs, account-isolated snapshots with full save validation, token ownership, pause CAS, canonical facts, no history.')
 } finally { await db.close() }
}
main().catch(error=>{console.error(error.message, error.position, error.query?.slice(Math.max(0,Number(error.position)-120), Number(error.position)+100));process.exitCode=1})
