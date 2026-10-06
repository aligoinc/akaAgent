// Isolated PostgreSQL (PGlite), never connects to production.
// AKA_CHAT_REPO=/path/to/akaAgentChatApi node scripts/campaign-content-rpc-smoke-test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const { PGlite } = require(require.resolve('@electric-sql/pglite', {
  paths: [root, process.env.AKA_CHAT_REPO || path.resolve(root, '../akaAgentChatApi')]
}))
const source = JSON.parse(fs.readFileSync(path.join(root, 'migrations/snapshots/campaign-content-v350/source.json'), 'utf8'))
const migration = name => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')
  .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const schemaSql = migration('migration_v350_campaign_content_rotation.sql')
const blocksSql = migration('migration_v351_campaign_content_blocks.sql')
const signature = 'public.aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)'
const claim = '10000000-0000-4000-8000-000000000001'
const unit = '20000000-0000-4000-8000-000000000002'
async function main() {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;
      CREATE TABLE org_staff(id bigint PRIMARY KEY,organization_id bigint,is_active boolean);`)
    for (const table of ['auto_campaigns','auto_accounts','auto_campaign_input_data']) {
      const columns = source.columns.filter(c => c.table === table).map(c =>
        `"${c.column}" ${c.type === 'ARRAY' ? 'bigint[]' : c.type}${c.column === 'id' ? ' PRIMARY KEY' : ''}`)
      await db.exec(`CREATE TABLE public.${table}(${columns.join(',')})`)
    }
    for (const fn of source.functions.filter(f => /lock_campaign_input_serialization|guard_canonical_campaign_input_payload|campaign_config_version/.test(f.signature))) {
      await db.exec(fn.definition)
    }
    await db.exec(`CREATE TRIGGER canonical_guard BEFORE UPDATE ON auto_campaign_input_data
      FOR EACH ROW EXECUTE FUNCTION aka_agent_guard_canonical_campaign_input_payload();
      CREATE TABLE auto_blocks(id bigint PRIMARY KEY,name text,code text,config_schema jsonb,output_schema jsonb,default_config jsonb,updated_at timestamptz);
      CREATE TABLE auto_workflows(id bigint PRIMARY KEY,nodes jsonb,edges jsonb,variables_schema jsonb,default_variables jsonb,updated_at timestamptz);`)
    for (const b of source.blocks) await db.query('INSERT INTO auto_blocks VALUES($1,$2,$3,$4,$5,$6,NULL)',
      [b.id,b.name,b.code,JSON.stringify(b.config_schema),JSON.stringify(b.output_schema),JSON.stringify(b.default_config)])
    for (const w of source.workflows) await db.query('INSERT INTO auto_workflows VALUES($1,$2,$3,$4,$5,NULL)',
      [w.id,JSON.stringify(w.nodes),JSON.stringify(w.edges),JSON.stringify(w.variables_schema),JSON.stringify(w.default_variables)])
    await db.exec('BEGIN')
    await db.exec(schemaSql)
    await db.exec(blocksSql)
    const failures = async (fn, message) => {
      await db.exec('SAVEPOINT rejected')
      try { await assert.rejects(fn, message) } finally { await db.exec('ROLLBACK TO rejected; RELEASE rejected') }
    }
    await failures(() => db.exec(schemaSql), /already exists/)
    await failures(() => db.exec(blocksSql), /live block changed/)
    const targets = JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/campaign-content-v350/targets.json'),'utf8'))
    for (const target of Object.values(targets)) {
      assert.equal((await db.query('SELECT md5(code) hash FROM auto_blocks WHERE id=$1',[target.id])).rows[0].hash,target.code_md5)
    }
    assert.equal((await db.query("SELECT count(*)::integer n FROM auto_workflows WHERE default_variables->>'campaignContentPreparationVersion'='1'")).rows[0].n,36)
    await db.exec(`INSERT INTO org_staff VALUES(3,1,true),(4,2,true);
      INSERT INTO auto_accounts(id,staff_id,organization_id,status,login_status,is_active,is_delete)
        VALUES(2,3,1,'đang chạy','đã đăng nhập',true,false);
      INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,status,action_id,extra_settings,
        runtime_claim_token,runtime_claim_target,runtime_unit_token,runtime_unit_claimed_at,runtime_unit_input_data_ids,updated_at)
      VALUES(1,2,3,1,'đang chạy','facebook_group_post','{}','${claim}','desktop','${unit}',now(),ARRAY[11,12,13,14],now());
      INSERT INTO auto_campaign_input_data(id,campaign_id,status,canonical_target_key,is_delete,uid)
        VALUES(11,1,'đang chạy','uid:a',false,'a'),(12,1,'đang chạy','uid:b',false,'b'),(13,1,'đang chạy','uid:c',false,'c'),
        (14,1,'đang chạy','uid:d',false,'d'),(15,1,'đang chạy','uid:e',false,'e');`)
    let currentClaim = claim, currentUnit = unit
    const take = async (id, action='fb_post_group', count=3, overrides={}) => {
      const p={campaign:1,account:2,staff:3,target:'desktop',claim:currentClaim,unit:currentUnit,...overrides}
      return (await db.query(`SELECT ${signature.split('(')[0]}($1,$2,$3,$4,$5,$6,$7,$8,$9) AS index`,
        [p.campaign,p.account,p.staff,p.target,p.claim,p.unit,id,action,count])).rows[0].index
    }
    const configBefore = (await db.query('SELECT aka_agent_campaign_config_version(c) AS version, updated_at FROM auto_campaigns c WHERE id=1')).rows[0]
    assert.deepEqual(await Promise.all([11,12,13].map(id=>take(id))),[0,1,2])
    // Different order, skip row 12, then return to it. Other rows do not move it.
    assert.deepEqual(await Promise.all([13,11].map(id=>take(id))),[0,1])
    assert.equal(await take(12),2)
    assert.deepEqual(await Promise.all([12,13,11].map(id=>take(id))),[0,1,2])
    assert.equal(await take(11,'fb_comment'),0)
    assert.equal(await take(11,'fb_comment'),1)
    assert.equal(await take(14),0,'new row receives shared pointer; existing rows do not advance it')
    assert.deepEqual(await Promise.all([null,null,null].map(id=>take(id,'zalo_message_friend'))),[0,1,2],'batch/global rotation')
    const snapshot = async () => (await db.query(`SELECT (SELECT content_rotation_indexes FROM auto_campaigns WHERE id=1) c,
      (SELECT content_rotation_indexes FROM auto_campaign_input_data WHERE id=11) d`)).rows[0]
    const beforeSingle = await snapshot()
    assert.equal(await take(11,'only_one',1),0)
    assert.deepEqual(await snapshot(),beforeSingle)
    for (const overrides of [{claim:unit},{unit:claim},{account:9},{staff:4},{target:'server'},{campaign:9}]) {
      await failures(()=>take(11,'fb_post_group',3,overrides),/not_own/)
    }
    await failures(()=>take(15),/input_not_in_unit/)
    await failures(()=>take(999),/input_not_owned/)
    assert.deepEqual(await snapshot(),beforeSingle,'ownership failures do not mutate cursors')
    // Server soft-pause is a boundary request: its owned unit may finish.
    await db.exec("UPDATE auto_campaigns SET runtime_claim_target='server',status='tạm dừng' WHERE id=1; UPDATE auto_accounts SET status='tạm dừng' WHERE id=2")
    assert.equal(await take(11,'server_pause',3,{target:'server'}),0)
    await db.exec("UPDATE auto_campaigns SET runtime_claim_target='desktop',status='đang chạy' WHERE id=1; UPDATE auto_accounts SET status='đang chạy' WHERE id=2")
    const saved = await snapshot()
    await db.exec("UPDATE auto_campaign_input_data SET status='chờ xử lý',note='reset' WHERE id=11; UPDATE auto_campaign_input_data SET status='đang chạy' WHERE id=11")
    assert.deepEqual(await snapshot(),saved,'reset keeps cursor')
    currentClaim = '30000000-0000-4000-8000-000000000003'
    currentUnit = '40000000-0000-4000-8000-000000000004'
    await db.query('UPDATE auto_campaigns SET runtime_claim_token=$1,runtime_unit_token=$2 WHERE id=1',[currentClaim,currentUnit])
    await failures(()=>take(11,'fb_post_group',3,{claim,unit}),/not_owner/)
    assert.equal(await take(11),0,'restart/new owner unit continues persisted cursor')
    await db.exec("UPDATE auto_campaigns SET action_id='facebook_timeline_post',extra_settings='{\"contentRotationIndex\":41}' WHERE id=1")
    assert.equal(await take(null,'fb_post_my_profile',42),41,'inherit profile cursor')
    assert.equal(await take(null,'fb_post_my_profile',42),0)
    await db.exec("UPDATE auto_campaigns SET action_id='facebook_page_post' WHERE id=1")
    assert.equal(await take(11,'fb_post_page',42),41,'inherit Page cursor')
    assert.equal(await take(11,'fb_post_page',3),0,'modulo changed template count')
    await db.exec("UPDATE auto_campaigns SET action_id='facebook_group_post',extra_settings='{}' WHERE id=1")
    assert.deepEqual((await db.query('SELECT aka_agent_campaign_config_version(c) AS version, updated_at FROM auto_campaigns c WHERE id=1')).rows[0],configBefore,'rotation does not invalidate config/updated_at')
    await db.exec('SET LOCAL ROLE aka_agent_chat_api')
    assert.equal(await take(11),1,'Chat SQL role can execute without new table grants')
    await db.exec('RESET ROLE')
    const receipt=(await db.query(`SELECT md5(pg_get_functiondef(p.oid)) AS md5, pg_get_userbyid(proowner) AS owner,
      prosecdef AS security_definer, provolatile AS volatility, proconfig AS config, proacl::text AS acl
      FROM pg_proc p WHERE p.oid=$1::regprocedure`,[signature])).rows[0]
    assert.equal(receipt.owner,'postgres'); assert.equal(receipt.security_definer,true)
    assert.equal(receipt.volatility,'v'); assert(!/(?:^|[,{])=X/.test(receipt.acl),'no PUBLIC execute')
    await db.exec('ROLLBACK')
    assert.equal((await db.query('SELECT to_regprocedure($1) AS signature',[signature])).rows[0].signature,null)
    assert.equal((await db.query("SELECT count(*)::integer n FROM information_schema.columns WHERE column_name='content_rotation_indexes'")).rows[0].n,0)
    fs.writeFileSync(path.join(root,'migrations/snapshots/campaign-content-v350/isolated-receipt.json'),JSON.stringify({signature,...receipt,validation:'PGlite transaction rolled back; production unchanged'},null,2)+'\n')
    console.log('PASS: isolated v350/v351, live checksums, 3×3/reorder/skip, action isolation, global/batch, seed/modulo/reset, ownership, canonical guard, config stability, Chat role and ROLLBACK')
  } finally { await db.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
