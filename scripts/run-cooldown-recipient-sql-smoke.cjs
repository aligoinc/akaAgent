// Isolated PostgreSQL tests only; no network, production data or external actions.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { Client } = require(require.resolve('pg', {paths:[process.env.CHAT_REPO || resolve(__dirname, '../../akaAgentChatApi')]}))
const directory = process.env.COOLDOWN_AUDIT_DIR || resolve(process.env.HOME, '.codex/audits/akaAgent/cooldown-recipient-20261028')
const allSource = JSON.parse(readFileSync(resolve(directory,'source-all.json'),'utf8'))
const source = allSource.filter(f=>!f.signature.startsWith('private.')).map(f=>({
 signature:f.signature,definition:f.definition,owner:f.owner,security_definer:f.prosecdef,
 volatility:f.provolatile,config:f.proconfig,acl:f.proacl,checksum:f.md5
})).sort((a,b)=>a.signature<b.signature?-1:1)
const phone = source.find(f=>f.signature==='normalize_phone(text)')
const migration = readFileSync(resolve(__dirname,'../supabase/migrations/20261028051045_cooldown_recipient_query.sql'),'utf8')
const indexes = readFileSync(resolve(__dirname,'../supabase/migrations/20261028045419_cooldown_recipient_indexes.sql'),'utf8')
const temp = mkdtempSync(resolve(tmpdir(),'aka-cooldown-recipient-'))
const bin = process.env.PG17_BIN || '/opt/homebrew/opt/postgresql@17/bin'
const run = (command,args) => {
 const r=spawnSync(resolve(bin,command),args,{encoding:'utf8',maxBuffer:2*1024*1024})
 if(r.status!==0)throw Error(r.stderr||r.stdout); return r.stdout
}
const signature = source[0].signature
const quote = text => "'" + text.replaceAll("'", "''") + "'"

async function main() {
  run('initdb',['-D',resolve(temp,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
  run('pg_ctl',['-D',resolve(temp,'db'),'-l',resolve(temp,'pg.log'),'-o',`-h '' -k ${temp} -p 55483 -c max_connections=10`,'-w','start'])
  const client = new Client({host:temp,port:55483,user:'postgres',database:'postgres'})
  await client.connect()
  const db = {exec: text=>client.query(text),query:(text,values)=>client.query(text,values),close:()=>client.end()}
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const metadata = async () => (await db.query(`SELECT p.oid::regprocedure::text AS signature,
    pg_get_userbyid(proowner) AS owner,prosecdef AS security_definer,provolatile AS volatility,
    proconfig AS config,proacl::text AS acl,md5(pg_get_functiondef(p.oid)) AS checksum
    FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY p.oid::regprocedure::text`, [source.map(f => f.signature)])).rows
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api; CREATE ROLE aka_agent_desktop; CREATE SCHEMA private;')
    await db.exec(readFileSync(resolve(__dirname, 'fixtures/send-exclusion-schema.sql'), 'utf8'))
    await db.exec('ALTER TABLE auto_campaign_details ADD COLUMN policy_snapshot jsonb;')
    await db.exec(`CREATE INDEX idx_campaign_details_input_data_id ON auto_campaign_details(input_data_id);
      CREATE INDEX auto_detail_committed_delivery_v367 ON auto_campaign_details(account_id,action_code,created_at DESC,input_data_id) WHERE policy_snapshot->>'operationState'='committed';
      CREATE INDEX idx_campaign_details_delivery_cooldown ON auto_campaign_details(account_id,action_code,created_at DESC,input_data_id) WHERE status IN ('thành công','đã gửi','đã nhận','đã xem','đã click');`)
    await db.exec(phone.definition)
    await db.exec(`CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.desktop_staff_id',true),'')::bigint $$;`)
    await db.exec(allSource.find(f=>f.signature.startsWith('private.aka_agent_assert_request_ownership')).definition)
    await db.exec("REVOKE ALL ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) FROM PUBLIC; GRANT EXECUTE ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) TO aka_agent_desktop,service_role,aka_agent_chat_api;")
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
    for(const grant of phone.acl.slice(1,-1).split(',')) await db.exec(`GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO ${grant.split('=')[0]||'PUBLIC'};`)
    const indexBuilds = [...indexes.matchAll(/CREATE INDEX CONCURRENTLY [^;]+;/g)].map(m=>m[0].replace(' CONCURRENTLY',''))
    for(const build of indexBuilds) await db.exec(build)
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
    const run = async (fn, ids = [11], role = 'service_role', scope = [10,100,1]) => {
      await db.exec('BEGIN;')
      try {
        await db.exec(`SET LOCAL ROLE ${role};`)
        const rows = (await db.query(`SELECT * FROM public.${fn}($1,$2,$3,$4::bigint[])`, [...scope, ids])).rows
        await db.exec('RESET ROLE;')
        const state = (await db.query('SELECT id,status,note FROM auto_campaign_input_data ORDER BY id')).rows
        return { rows, state }
      } finally { await db.exec('ROLLBACK;') }
    }
    const parity = async (label, expected, ids = [11], role = 'service_role') => {
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
      await assert.rejects(run('aka_agent_apply_campaign_delivery_cooldown',ids,'service_role',scope),pattern)
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
    await db.exec("SET test.desktop_staff_id='2';")
    await assert.rejects(run('aka_agent_apply_campaign_delivery_cooldown',[11],'aka_agent_desktop'),/desktop_staff_scope_denied/)
    await db.exec("SET test.desktop_staff_id='1';")
    await parity('Desktop token self scope preserved',null,[11],'aka_agent_desktop')
    await db.exec("RESET test.desktop_staff_id;")
    await assert.rejects(run('aka_agent_apply_campaign_delivery_cooldown',[11],'anon'),/permission denied/)
    pass('Desktop cross-staff guard and revoked anon remain enforced')
    await settings('zalo_message_phone',{recentDeliveryCooldownAllAccounts:true})
    await history({account:101})
    await db.exec("UPDATE auto_campaign_input_data SET uid=repeat('x',12000),phone=repeat('9',12000) WHERE id IN (11,21);")
    await parity('long historical UID/phone remain writable and exact-match correctly',['paused_recent_delivery'])
    await db.exec("UPDATE auto_campaign_input_data SET uid='long-value-distinct',phone='invalid' WHERE id=11;")
    await parity('long values never introduce false matches',['allowed'])
    await db.exec("UPDATE auto_campaign_input_data SET uid='target-uid',phone='0901234567' WHERE id IN (11,21);")
    await db.exec('GRANT INSERT ON auto_campaign_input_data TO aka_agent_desktop,aka_agent_chat_api,service_role;')
    for(const role of ['aka_agent_desktop','aka_agent_chat_api','service_role']) {
      await db.exec(`BEGIN; SET LOCAL ROLE ${role}; INSERT INTO auto_campaign_input_data(id,uid,phone) VALUES(990000,'probe','+84901234567'); ROLLBACK;`)
    }
    pass('expression indexes preserve Desktop, Chat and service insert permissions')
    const concurrentClient=new Client({host:temp,port:55483,user:'postgres',database:'postgres'})
    await concurrentClient.connect()
    try {
      await db.exec("UPDATE auto_campaign_input_data SET status='chờ xử lý',note=NULL WHERE id=11; BEGIN; UPDATE auto_campaign_input_data SET status='hoàn thành',note='concurrent owner' WHERE id=11;")
      const waiting=concurrentClient.query('SELECT * FROM public.aka_agent_apply_campaign_delivery_cooldown(10,100,1,ARRAY[11]::bigint[])')
      let lockSeen=false
      for(let n=0;n<40;n++){
        const state=(await db.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[concurrentClient.processID])).rows[0]
        if(state?.wait_event_type==='Lock'){lockSeen=true;break}
        await new Promise(resolve=>setTimeout(resolve,25))
      }
      assert(lockSeen,'concurrent call must wait for the existing input lock')
      await db.exec('COMMIT;')
      assert.equal((await waiting).rows[0].decision,'not_pending')
      assert.equal((await db.query('SELECT note FROM auto_campaign_input_data WHERE id=11')).rows[0].note,'concurrent owner')
      await db.exec("UPDATE auto_campaign_input_data SET status='chờ xử lý',note=NULL WHERE id=11;")
      pass('concurrent input owner wins; pending CAS preserves the committed status/note')
    } finally {await db.exec('ROLLBACK;');await concurrentClient.end()}
    if (process.env.COOLDOWN_BENCHMARK === '1') {
      await settings('zalo_message_phone',{recentDeliveryCooldownDays:90,recentDeliveryCooldownAllAccounts:true})
      await db.exec(`INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active)
        SELECT 1000+n,1,10,'zalo',true FROM generate_series(1,78)n;
        INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status)
        SELECT 100000+n,20,'noise-'||n,'09'||lpad(n::text,8,'0'),'hoàn thành' FROM generate_series(1,300000)n;
        INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        SELECT 100000+n,100000+n,20,1001+(n%78),'zalo_message_friend','đã gửi',
          CASE WHEN n%2=0 THEN '{"operationState":"committed"}'::jsonb ELSE NULL END,now()-interval '1 hour'
        FROM generate_series(1,300000)n;
        ANALYZE auto_accounts; ANALYZE auto_campaign_input_data; ANALYZE auto_campaign_details;`)
      const plans=[]
      for(const mode of ['force_custom_plan','force_generic_plan']) {
        await db.exec(`SET plan_cache_mode=${mode};`)
        for(const fn of ['fixture_original_cooldown','aka_agent_apply_campaign_delivery_cooldown']) {
          for(let iteration=0;iteration<2;iteration++) {
            await db.exec('BEGIN;')
            try {
              const plan=(await db.query(`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM public.${fn}(10,100,1,ARRAY[11]::bigint[])`)).rows[0]['QUERY PLAN'][0]
              plans.push({mode,fn,iteration,ms:plan['Execution Time'],hit:plan.Plan['Shared Hit Blocks'],read:plan.Plan['Shared Read Blocks']})
            } finally {await db.exec('ROLLBACK;')}
          }
        }
      }
      writeFileSync(resolve(directory,'benchmark.json'),JSON.stringify(plans,null,2)+'\n')
      console.log(JSON.stringify(plans))
      for(const mode of ['force_custom_plan','force_generic_plan']) {
        const old=plans.find(p=>p.mode===mode&&p.fn==='fixture_original_cooldown'&&p.iteration===1)
        const current=plans.find(p=>p.mode===mode&&p.fn==='aka_agent_apply_campaign_delivery_cooldown'&&p.iteration===1)
        assert(current.hit+current.read<(old.hit+old.read)/10,'recipient lookup must reduce block reads by at least 90%')
      }
      pass('300k history / 80-account indexed lookup benchmark passes custom and generic plans')
    }
    const rollback = `BEGIN;\nSET LOCAL lock_timeout='5s';\nDO $guard$ BEGIN\nIF md5(pg_get_functiondef(to_regprocedure(${quote(signature)}))) IS DISTINCT FROM ${quote(target[0].checksum)} THEN RAISE EXCEPTION 'recipient rollback drift'; END IF;\nEND; $guard$;\n${source[0].definition};\nCOMMIT;\n`
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
  } finally {
    await db.close()
    run('pg_ctl',['-D',resolve(temp,'db'),'-m','immediate','-w','stop'])
    rmSync(temp,{recursive:true,force:true})
  }
}
main().catch(error => { console.error(error); process.exitCode=1 })
