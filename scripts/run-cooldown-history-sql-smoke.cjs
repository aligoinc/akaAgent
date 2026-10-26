// Isolated PostgreSQL tests only; no network, production data or external actions.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { PGlite } = require(require.resolve('@electric-sql/pglite', {
  paths: [process.env.CHAT_REPO || resolve(__dirname, '../../akaAgentChatApi')]
}))
const directory = resolve(__dirname, '../migrations/snapshots/cooldown-history-v431')
const source = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'))
const phone = JSON.parse(readFileSync(resolve(directory, 'phone-dependency.json'), 'utf8'))[0]
const migration = readFileSync(resolve(__dirname, '../migrations/migration_v431_cooldown_history_lookup.sql'), 'utf8')
const signature = source[0].signature
const quote = text => "'" + text.replaceAll("'", "''") + "'"

async function main() {
  const db = new PGlite()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const metadata = async () => (await db.query(`SELECT p.oid::regprocedure::text AS signature,
    pg_get_userbyid(proowner) AS owner,prosecdef AS security_definer,provolatile AS volatility,
    proconfig AS config,proacl::text AS acl,md5(pg_get_functiondef(p.oid)) AS checksum
    FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY proname`, [source.map(f => f.signature)])).rows
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;')
    await db.exec(readFileSync(resolve(__dirname, 'fixtures/send-exclusion-schema.sql'), 'utf8'))
    await db.exec('ALTER TABLE auto_campaign_details ADD COLUMN policy_snapshot jsonb;')
    await db.exec(phone.definition)
    const order = ['aka_agent_internal_normalize_facebook_identity', 'aka_agent_internal_normalize_phone',
      'aka_agent_internal_delivery_cooldown_target_keys', 'aka_agent_internal_send_delivery_history',
      'aka_agent_apply_campaign_delivery_cooldown']
    for (const name of order) {
      const fn = source.find(f => f.signature.startsWith(name + '('))
      await db.exec(fn.definition)
      await db.exec(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM PUBLIC;`)
      for (const grant of fn.acl.slice(1, -1).split(',')) {
        const role = grant.split('=')[0]
        if (role !== 'postgres') await db.exec(`GRANT EXECUTE ON FUNCTION public.${fn.signature} TO ${role};`)
      }
    }
    const sourceMetadata = source.map(({ definition, ...rest }) => rest)
    assert.deepEqual(await metadata(), sourceMetadata)
    await db.exec(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await metadata(), sourceMetadata)
    pass('migration executes and rolls back without metadata drift')
    await db.exec(migration)
    const target = await metadata()
    assert.deepEqual(target.slice(1), sourceMetadata.slice(1))
    assert.deepEqual({ ...target[0], checksum: source[0].checksum }, sourceMetadata[0])
    await db.exec(source[0].definition.replace('public.aka_agent_apply_campaign_delivery_cooldown(', 'public.fixture_original_cooldown('))
    pass('only wrapper body changes; signatures, grants, attributes and helpers preserved')
    await db.exec(`INSERT INTO org_staff(id,organization_id,is_active) VALUES(1,10,true),(2,10,true),(3,20,true);
      INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active) VALUES
        (100,1,10,'zalo',true),(101,1,10,'zalo',true),(200,2,10,'zalo',true),(300,1,20,'zalo',true);
      INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,status) VALUES
        (10,100,1,10,'Current','zalo_message_phone','đang chạy'),
        (20,101,1,10,'Other account','zalo_message_friend','tạm dừng'),
        (21,200,2,10,'Other staff','zalo_message_phone','tạm dừng'),
        (22,300,1,20,'Other org','zalo_message_phone','tạm dừng');
      INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,email,status) VALUES
        (11,10,'target-uid','0901234567','user@example.test','chờ xử lý'),
        (12,10,'target-uid','0901234567','user@example.test','chờ xử lý'),
        (21,20,'target-uid','+84901234567','USER@EXAMPLE.TEST','hoàn thành');`)
    const settings = async (action = 'zalo_message_phone', extra = {}) => db.query(
      'UPDATE auto_campaigns SET action_id=$1,extra_settings=$2 WHERE id=10',
      [action, JSON.stringify({ enableMessage: true, recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 3, ...extra })])
    const history = async ({ account = 100, campaign = 20, code = 'zalo_message_friend', days = 0,
      status = 'đã gửi', policy = null } = {}) => {
      await db.exec('DELETE FROM auto_campaign_details;')
      await db.query(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        VALUES(21,21,$1,$2,$3,$4,$5,(timezone('Asia/Ho_Chi_Minh',now())::date-$6::int)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
        [campaign, account, code, status, policy, days])
    }
    const run = async (fn, ids = [11], role = 'anon', scope = [10,100,1]) => {
      await db.exec('BEGIN;')
      try {
        await db.exec(`SET LOCAL ROLE ${role};`)
        const rows = (await db.query(`SELECT * FROM public.${fn}($1,$2,$3,$4::bigint[])`, [...scope, ids])).rows
        await db.exec('RESET ROLE;')
        const state = (await db.query('SELECT id,status,note FROM auto_campaign_input_data ORDER BY id')).rows
        return { rows, state }
      } finally { await db.exec('ROLLBACK;') }
    }
    const parity = async (label, expected, ids = [11], role = 'anon') => {
      const original = await run('fixture_original_cooldown', ids, role)
      const candidate = await run('aka_agent_apply_campaign_delivery_cooldown', ids, role)
      assert.deepEqual(candidate, original, label)
      if (expected) assert.deepEqual(candidate.rows.map(r => r.decision), expected, label)
      pass(label)
    }
    // Every supported action, namespace, phone/email/UID canonicalization path.
    for (const [action,code] of [
      ['facebook_group_post','fb_post_group'],['facebook_page_post','fb_post_page'],
      ['facebook_message_friend','fb_message_friend'],['facebook_message_uid','fb_message_stranger'],
      ['facebook_page_to_message','fb_message_page_inbox_customer'],
      ['zalo_message_friend','zalo_message_friend'],['zalo_message_birthday','zalo_message_stranger'],
      ['zalo_message_group','zalo_message_group'],['zalo_message_phone','zalo_message_stranger'],
      ['zalo_message_group_member','zalo_message_friend'],['zalo_message_group_realtime','zalo_message_friend'],
      ['zalo_message_remarketing_customer','zalo_message_friend'],['zalo_message_friend_recommendation','zalo_message_friend'],
      ['sms_send','sms_send'],['email_send','email_send']
    ]) {
      await settings(action); await history({ code })
      await parity(action, ['paused_recent_delivery'])
    }
    await settings('facebook_group_post'); await history({ code: 'fb_post_page' })
    await parity('same FB identity in another namespace does not match', ['allowed'])
    await db.exec("UPDATE auto_campaign_input_data SET uid=CASE WHEN id=21 THEN 'https://www.facebook.com/profile.php?id=12345' ELSE '12345' END;")
    await history({ code: 'fb_post_group' })
    await parity('Facebook URL and numeric identity', ['paused_recent_delivery'])
    await db.exec("UPDATE auto_campaign_input_data SET uid=CASE WHEN id=21 THEN ' Target-UID ' ELSE 'target-uid' END;")
    await settings(); await history()
    await parity('Zalo UID case and whitespace', ['paused_recent_delivery'])
    await db.exec("UPDATE auto_campaign_input_data SET uid=NULL WHERE id=21;")
    await parity('Zalo phone-only match with international prefix', ['paused_recent_delivery'])
    await db.exec("UPDATE auto_campaign_input_data SET phone='invalid' WHERE id=21;")
    await parity('invalid phone and missing UID do not match', ['allowed'])
    await db.exec("UPDATE auto_campaign_input_data SET uid='',phone='',email='' WHERE id=11;")
    await parity('unidentifiable recipient', ['paused_unidentifiable'])
    await db.exec("UPDATE auto_campaign_input_data SET uid='target-uid',phone='0901234567',email='user@example.test' WHERE id IN (11,12,21);")
    for (const [policy,status,expected] of [
      [null,'đã gửi','paused_recent_delivery'],[null,'lỗi','allowed'],
      [{operationState:'committed'},'custom-result','paused_recent_delivery'],
      [{operationState:'unknown'},'đã gửi','allowed'],
      [{operationState:'not_started'},'đã xem','allowed'],
      [{operationState:null},'thành công','paused_recent_delivery']
    ]) {
      await history({policy,status}); await parity(`delivery evidence ${JSON.stringify(policy)} / ${status}`, [expected])
    }
    await history({account:101}); await settings()
    await parity('default current-account scope', ['allowed'])
    await settings('zalo_message_phone',{recentDeliveryCooldownAllAccounts:true})
    await parity('all accounts of same staff', ['paused_recent_delivery'])
    await parity('Chat SQL role uses unchanged public contract', ['paused_recent_delivery'], [11], 'aka_agent_chat_api')
    await history({account:200,campaign:21}); await parity('other staff excluded', ['allowed'])
    await history({account:300,campaign:22}); await parity('other organization excluded', ['allowed'])
    await history({account:101}); await db.exec('UPDATE auto_accounts SET is_delete=true,is_active=false WHERE id=101; UPDATE auto_campaigns SET is_delete=true WHERE id=20; UPDATE auto_campaign_input_data SET is_delete=true WHERE id=21; UPDATE auto_campaign_details SET is_delete=true;')
    await parity('historical deletion/inactive flags retain prior semantics', ['paused_recent_delivery'])
    await db.exec('UPDATE auto_accounts SET is_delete=false,is_active=true WHERE id=101; UPDATE auto_campaigns SET is_delete=false WHERE id=20; UPDATE auto_campaign_input_data SET is_delete=false WHERE id=21;')
    for(const [days,expected] of [[2,'paused_recent_delivery'],[3,'allowed']]) {
      await history({days}); await parity(`Vietnam day boundary ${days}`, [expected])
    }
    await history(); await db.exec("UPDATE auto_campaign_details SET created_at=now()+interval '1 day';")
    await parity('future deliveries excluded', ['allowed'])
    await history(); await settings('zalo_message_phone',{recentDeliveryCooldownEnabled:false})
    await parity('disabled cooldown', ['allowed'])
    await settings('zalo_message_phone',{enableMessage:false})
    await parity('message-disabled campaign', ['allowed'])
    await settings('unsupported_action'); await parity('unsupported action', ['allowed'])
    await settings(); await parity('duplicate input ids removed; batch order retained', ['paused_recent_delivery','deferred_batch_duplicate'],[12,11,12])
    await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành',note='keep' WHERE id=11;")
    await parity('non-pending input and note unchanged', ['not_pending'])
    await db.exec("UPDATE auto_campaign_input_data SET status='chờ xử lý' WHERE id=11;")
    for(const [ids,scope,pattern] of [[[],[10,100,1],/batch_size/],[[21],[10,100,1],/input_scope_mismatch/],[[11],[10,100,2],/scope_not_found/]]) {
      await assert.rejects(run('aka_agent_apply_campaign_delivery_cooldown',ids,'anon',scope),pattern)
      pass(`guard ${pattern}`)
    }
    // Several matching history rows: tie breaks, nullable campaign name and latest timestamp.
    await history(); await db.exec(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,created_at)
      VALUES(22,21,999,100,'zalo_message_friend','đã gửi',now()-interval '1 minute'),
        (23,21,20,100,'zalo_message_friend','đã gửi',now()-interval '1 minute');`)
    await parity('latest delivery and descending detail ID tie break', ['paused_recent_delivery'])
    // Batch maximum with unrelated history; compare all decisions and input updates.
    await db.exec(`INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status)
      SELECT 1000+n,10,'batch-'||n,NULL,'chờ xử lý' FROM generate_series(1,500) n;
      INSERT INTO auto_campaign_input_data(id,campaign_id,uid,status)
      SELECT 10000+n,20,CASE WHEN n<=100 THEN 'batch-'||n ELSE 'other-'||n END,'hoàn thành' FROM generate_series(1,3000) n;
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,created_at)
      SELECT 10000+n,10000+n,20,100,'zalo_message_friend','đã gửi',now()-interval '1 minute' FROM generate_series(1,3000) n;`)
    await parity('500 input batch against 3000 unrelated/matching historical rows', null, Array.from({length:500},(_,i)=>1001+i))
    for (const mode of ['force_generic_plan','force_custom_plan','auto']) {
      await db.exec(`SET plan_cache_mode=${mode};`)
      await parity(`prepared plan mode ${mode}`, ['paused_recent_delivery'], [1001])
    }
    // Raw phone variants must retain the shared helper's normalization exactly.
    await settings('sms_send'); await history({code:'sms_send'})
    for(const [requested,historical] of [
      ['0901234567','0084901234567'],['0901234567','901234567'],
      ['0321234567','01621234567'],['0901234567','(+84) 901-234-567']
    ]) {
      await db.query('UPDATE auto_campaign_input_data SET phone=CASE WHEN id=21 THEN $2 ELSE $1 END WHERE id IN (11,21)',[requested,historical])
      await parity(`phone normalization ${historical}`,['paused_recent_delivery'])
    }
    await settings('email_send'); await history({code:'email_send'})
    for(const [requested,historical,expected] of [
      [' User@Example.Test ','user@example.test','paused_recent_delivery'],
      ['user@example.test','user@exampleXtest','allowed'],
      ['user@example.test','user name@example.test','allowed']
    ]) {
      await db.query('UPDATE auto_campaign_input_data SET email=CASE WHEN id=21 THEN $2 ELSE $1 END WHERE id IN (11,21)',[requested,historical])
      await parity(`email normalization ${historical}`,[expected])
    }
    const rollback = `BEGIN;\nSET LOCAL lock_timeout='5s';\nDO $guard$ BEGIN\nIF md5(pg_get_functiondef(to_regprocedure(${quote(signature)}))) IS DISTINCT FROM ${quote(target[0].checksum)} THEN RAISE EXCEPTION 'v431 rollback drift'; END IF;\nEND; $guard$;\n${source[0].definition};\nCOMMIT;\n`
    await db.exec(rollback.replace(/COMMIT;\s*$/, ''))
    assert.deepEqual(await metadata(), sourceMetadata)
    await db.exec('ROLLBACK;'); assert.deepEqual(await metadata(),target)
    pass('guarded rollback restores source then transaction rollback restores candidate')
    await assert.rejects(db.exec(migration), /source drift/); await db.exec('ROLLBACK;')
    pass('reapply fails closed on unexpected target')
    writeFileSync(resolve(directory,'target.json'),JSON.stringify(target,null,2)+'\n')
    writeFileSync(resolve(directory,'rollback.sql'),rollback)
    writeFileSync(resolve(directory,'local-verification.json'),JSON.stringify({checks,targetChecksum:target[0].checksum,productionChanges:false},null,2)+'\n')
    console.log(`PASS ${checks} scenarios; source ${source[0].checksum}; target ${target[0].checksum}`)
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode=1 })
