// Isolated PostgreSQL; no production writes or external messages.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: [resolve(__dirname, '../../akaAgentChatApi')] }))
const directory = resolve(__dirname, '../migrations/snapshots/staff-delivery-cooldown-v424')
const source = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'))
const migration = readFileSync(resolve(__dirname, '../migrations/migration_v424_staff_delivery_cooldown.sql'), 'utf8')
const signature = source[0].signature
const quote = text => "'" + text.replaceAll("'", "''") + "'"

async function main() {
  const db = new PGlite()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const metadata = async () => (await db.query(`SELECT p.oid::regprocedure::text AS signature,
    md5(pg_get_functiondef(p.oid)) AS checksum,pg_get_userbyid(proowner) AS owner,
    prosecdef AS security_definer,provolatile AS volatility,proconfig AS config,proacl::text AS acl
    FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[]) ORDER BY proname`, [source.map(f => f.signature)])).rows
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;')
    await db.exec(readFileSync(resolve(__dirname, 'fixtures/send-exclusion-schema.sql'), 'utf8'))
    await db.exec(`ALTER TABLE auto_campaign_details ADD COLUMN policy_snapshot jsonb;
      CREATE TABLE auto_campaign_actions(id text PRIMARY KEY);
      INSERT INTO auto_campaign_actions VALUES ('zalo_message_phone'),('zalo_message_friend'),('sms_send');`)
    for (const fn of require('./fixtures/send-exclusion-normalizers.json')) await db.exec(fn.definition)
    // Helpers before the wrapper; restore the captured ACL in its original order.
    for (const fn of [...source.slice(1), source[0]]) {
      await db.exec(fn.definition)
      await db.exec(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM PUBLIC;`)
      for (const grant of fn.acl.slice(1, -1).split(',')) {
        const role = grant.split('=')[0]
        if (role !== 'postgres') await db.exec(`GRANT EXECUTE ON FUNCTION public.${fn.signature} TO ${role};`)
      }
    }
    assert.deepEqual(await metadata(), source.map(({ definition, ...rest }) => rest))
    await db.exec(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await metadata(), source.map(({ definition, ...rest }) => rest))
    assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='auto_campaign_actions' AND column_name='show_staff_delivery_cooldown'")).rows[0].n, 0)
    pass('candidate rollback leaves source and catalog unchanged')
    await db.exec(migration)
    assert.deepEqual((await db.query('SELECT id,show_staff_delivery_cooldown AS shown FROM auto_campaign_actions ORDER BY id')).rows,
      [{ id: 'sms_send', shown: false }, { id: 'zalo_message_friend', shown: false }, { id: 'zalo_message_phone', shown: true }])
    const target = await metadata()
    assert.deepEqual(target.slice(1), source.slice(1).map(({ definition, ...rest }) => rest))
    assert.deepEqual({ ...target[0], checksum: source[0].checksum }, source.map(({ definition, ...rest }) => rest)[0])
    pass('one boolean catalog column; unchanged helper checksums and all function attributes')
    await db.exec(source[0].definition.replace('public.aka_agent_apply_campaign_delivery_cooldown(', 'public.fixture_original_cooldown('))
    await db.exec(`INSERT INTO org_staff(id,organization_id,is_active) VALUES(1,10,true),(2,10,true),(3,20,true);
      INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active) VALUES
        (100,1,10,'zalo',true),(101,1,10,'zalo',true),(200,2,10,'zalo',true),(300,1,20,'zalo',true);
      INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,status) VALUES
        (10,100,1,10,'Current','zalo_message_phone','đang chạy'),
        (20,101,1,10,'Other account','zalo_message_friend','tạm dừng'),
        (21,200,2,10,'Other staff','zalo_message_phone','tạm dừng'),
        (22,300,1,20,'Other org','zalo_message_phone','tạm dừng');
      INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,email,status) VALUES
        (11,10,'same-uid','0901234567','','chờ xử lý'),(12,10,'same-uid','0901234567','','chờ xử lý'),
        (21,20,'same-uid','+84901234567','','hoàn thành');`)
    const settings = async (extra = {}) => db.query('UPDATE auto_campaigns SET extra_settings=$1 WHERE id=10', [JSON.stringify({ enableMessage: true, recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 3, ...extra })])
    const history = async ({ account = 101, campaign = 20, days = 0, status = 'đã gửi', policy = null } = {}) => {
      await db.exec('DELETE FROM auto_campaign_details;')
      await db.query(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        VALUES(21,21,$1,$2,'zalo_message_friend',$3,$4,(timezone('Asia/Ho_Chi_Minh',now())::date-$5::int)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`, [campaign, account, status, policy, days])
    }
    const run = async (fn = 'aka_agent_apply_campaign_delivery_cooldown', ids = [11], role = 'anon') => {
      await db.exec('BEGIN;')
      try {
        await db.exec(`SET LOCAL ROLE ${role};`)
        return (await db.query(`SELECT * FROM public.${fn}(10,100,1,$1::bigint[])`, [ids])).rows
      } finally { await db.exec('ROLLBACK;') }
    }
    const decision = async () => (await run())[0].decision
    await settings(); await history()
    assert.equal(await decision(), 'allowed')
    await settings({ recentDeliveryCooldownAllAccounts: false })
    assert.deepEqual(await run(), await run('fixture_original_cooldown'))
    pass('missing/false option retains account-only behavior')
    await settings({ recentDeliveryCooldownAllAccounts: true })
    assert.equal(await decision(), 'paused_recent_delivery')
    assert.equal((await run())[0].source_campaign_id, 20)
    assert.equal((await run('aka_agent_apply_campaign_delivery_cooldown', [11], 'aka_agent_chat_api'))[0].decision, 'paused_recent_delivery')
    pass('same RPC works for Desktop/legacy Server and Chat roles across accounts')
    for (const [account, campaign] of [[200, 21], [300, 22]]) {
      await history({ account, campaign }); assert.equal(await decision(), 'allowed')
    }
    pass('other staff and organization histories excluded')
    await history()
    await db.exec("UPDATE auto_campaign_actions SET show_staff_delivery_cooldown=false WHERE id='zalo_message_phone';")
    assert.equal(await decision(), 'paused_recent_delivery')
    pass('visibility flag does not revoke the saved choice')
    for (const extra of [{ enableMessage: false }, { recentDeliveryCooldownEnabled: false }, { recentDeliveryCooldownAllAccounts: 'true' }]) {
      await settings({ recentDeliveryCooldownAllAccounts: true, ...extra }); assert.equal(await decision(), 'allowed')
    }
    await settings({ recentDeliveryCooldownAllAccounts: true })
    await db.exec("UPDATE auto_campaigns SET action_id='zalo_message_friend' WHERE id=10;")
    assert.equal(await decision(), 'allowed')
    await db.exec("UPDATE auto_campaigns SET action_id='zalo_message_phone' WHERE id=10;")
    pass('main toggle, message-only support, strict boolean and action scope')
    for (const [days, expected] of [[0, 'paused_recent_delivery'], [2, 'paused_recent_delivery'], [3, 'allowed'], [4, 'allowed']]) {
      await history({ days }); assert.equal(await decision(), expected)
    }
    pass('existing Vietnam calendar boundary')
    for (const [status, policy, expected] of [
      ['thất bại', null, 'allowed'], ['đã xem', null, 'paused_recent_delivery'],
      ['thất bại', { operationState: 'committed' }, 'paused_recent_delivery'],
      ['thành công', { operationState: 'unknown' }, 'allowed']
    ]) {
      await history({ status, policy }); assert.equal(await decision(), expected)
    }
    pass('V367 committed/legacy/unknown evidence unchanged')
    await history()
    await db.exec("UPDATE auto_campaign_input_data SET uid='different-uid' WHERE id=21;")
    assert.equal(await decision(), 'paused_recent_delivery')
    await db.exec("UPDATE auto_campaign_input_data SET uid='same-uid',phone='0999999999' WHERE id=21;")
    assert.equal(await decision(), 'paused_recent_delivery')
    pass('existing phone normalization and UID-or-phone matching unchanged')
    for (const all of [false, undefined]) {
      await settings({ recentDeliveryCooldownAllAccounts: all }); await history({ account: 100, campaign: 10 })
      assert.deepEqual(await run(), await run('fixture_original_cooldown'))
    }
    pass('same-account result is identical to captured live RPC')
    await settings({ recentDeliveryCooldownAllAccounts: true }); await history()
    assert.deepEqual((await run('aka_agent_apply_campaign_delivery_cooldown', [11, 12])).map(r => r.decision), ['paused_recent_delivery', 'deferred_batch_duplicate'])
    await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành',note='keep' WHERE id=11;")
    assert.equal(await decision(), 'not_pending')
    await db.exec("UPDATE auto_campaign_input_data SET status='chờ xử lý' WHERE id=11;")
    await assert.rejects(db.query('SELECT * FROM aka_agent_apply_campaign_delivery_cooldown(10,100,2,ARRAY[11]::bigint[])'), /scope_not_found/)
    await assert.rejects(run('aka_agent_apply_campaign_delivery_cooldown', [21]), /input_scope_mismatch/)
    await assert.rejects(run('aka_agent_apply_campaign_delivery_cooldown', []), /batch_size/)
    pass('pending CAS, batch duplicates and scope/batch guards unchanged')
    await db.exec('BEGIN; SET LOCAL ROLE anon;')
    await db.query('SELECT * FROM aka_agent_apply_campaign_delivery_cooldown(10,100,1,ARRAY[11]::bigint[])')
    await db.exec('RESET ROLE;')
    assert.equal((await db.query('SELECT status FROM auto_campaign_input_data WHERE id=11')).rows[0].status, 'tạm dừng')
    assert.equal((await db.query('SELECT count(*)::int n FROM auto_campaign_details')).rows[0].n, 1)
    assert.equal((await db.query('SELECT status FROM auto_campaigns WHERE id=10')).rows[0].status, 'đang chạy')
    await db.exec('ROLLBACK;')
    pass('only input paused; no detail inserted or campaign status change')
    const rollback = `-- Candidate rollback: handle staff-wide campaigns before reverting production.\nBEGIN;\nDO $guard$ BEGIN\n  IF to_regprocedure(${quote(signature)}) IS NULL\n    OR md5(pg_get_functiondef(to_regprocedure(${quote(signature)}))) <> ${quote(target[0].checksum)} THEN\n    RAISE EXCEPTION 'v424 rollback target drift';\n  END IF;\nEND; $guard$;\n${source[0].definition};\nALTER TABLE auto_campaign_actions DROP COLUMN show_staff_delivery_cooldown;\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`
    await db.exec(rollback.replace(/COMMIT;\s*$/, ''))
    assert.deepEqual(await metadata(), source.map(({ definition, ...rest }) => rest))
    assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='auto_campaign_actions' AND column_name='show_staff_delivery_cooldown'")).rows[0].n, 0)
    await db.exec('ROLLBACK;')
    assert.deepEqual(await metadata(), target)
    pass('guarded rollback restores source/attributes/catalog and rolls back cleanly')
    await assert.rejects(db.exec(migration), /source drift/); await db.exec('ROLLBACK;')
    pass('reapply refuses unexpected source')
    writeFileSync(resolve(directory, 'target.json'), JSON.stringify(target, null, 2) + '\n')
    writeFileSync(resolve(directory, 'rollback.sql'), rollback)
    console.log(`PASS ${checks} SQL scenarios; source ${source[0].checksum}; target ${target[0].checksum}`)
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
