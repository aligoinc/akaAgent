// Local PostgreSQL, real callbacks/Automation/writer; no outbound operation.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createFixture: baseFixture } = require('./action-status-compatibility-fixture.cjs')
const v = require('./email-status-observations-v368.cjs')
const { functionRows, checkFunctions } = require('./apply-action-status-compatibility-v367.cjs')
async function createFixture() {
  const db = await baseFixture()
  // Install the current Automation consumers, without applying old migrations.
  for (const f of v.before.functions.filter(f => ['aka_agent_enqueue_campaign_detail_automations()', 'aka_agent_enqueue_group_only_automations()'].includes(f.signature))) await db.exec(f.definition)
  for (const f of v.functions) {
    const file = f.signature.startsWith('aka_agent_project_')
      ? 'migration_v366_action_status_runtime_fixes.sql' : 'migration_v362_action_status_readers.sql'
    const sql = fs.readFileSync(path.join(v.m.root, 'migrations', file), 'utf8')
    const functionName = f.signature.split('(')[0]
    const start = sql.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.' + functionName + '\\('))
    assert(start >= 0, file)
    const end = sql.indexOf('$function$;', sql.indexOf('AS $function$', start))
    assert(end > start, file)
    await db.exec(sql.slice(start, end + '$function$;'.length).replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION'))
    assert.equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) md5', ['public.' + f.signature])).rows[0].md5, f.md5, 'newest repository body matches captured live source')
    await db.exec(`REVOKE ALL ON FUNCTION public.${f.signature} FROM PUBLIC,postgres,anon,authenticated,service_role,aka_agent_chat_api;`)
    for (const acl of f.acl.slice(1, -1).split(',')) {
      const role = acl.split('=')[0] || 'PUBLIC'
      await db.exec(`GRANT EXECUTE ON FUNCTION public.${f.signature} TO ${role};`)
    }
  }
  return db
}
async function main() {
  const db = await createFixture()
  let checks = 0
  const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++ }
  const functions = async expected => {
    checkFunctions((await db.query(`SELECT ${functionRows(expected)} functions`)).rows[0].functions, expected); checks++
  }
  try {
    await functions(v.functions)
    await db.exec(v.migration())
    await functions(v.targets)
    await assert.rejects(db.exec(v.migration()), /v368 function drift/); await db.exec('ROLLBACK'); checks++
    const beforeConfig = (await db.query(`SELECT jsonb_agg(to_jsonb(p) ORDER BY id) rows FROM auto_account_action_status_policies p`)).rows[0].rows
    const beforeQuota = (await db.query('SELECT coalesce(sum(count_action_in_day),0) n FROM auto_account_action_status')).rows[0].n
    let sequence = 0, ruleId = 9100
    const rules = async (status, sub) => {
      const ids = [ruleId++, ruleId++]
      for (let n=0; n<2; n++) {
        await db.query(`INSERT INTO auto_automation(id,name,source_campaign_id,target_campaign_id,target_data_group_id,data_type_code,is_active,staff_id,organization_id,activated_at)
          VALUES($1,'offline rule',1,$2,$3,'review_email',true,1,1,now()-interval '1 day')`, [ids[n], n===0?3:null, n===0?null:9000])
        await db.query(`INSERT INTO auto_automation_trigger_statuses(automation_id,status_mapping_id,action_code,status_value,sub_status_ids) VALUES($1,$1,'email_send',$2,$3)`, [ids[n],status,sub])
      }
      return ids
    }
    const viewed = await rules('thành công', [34]), clicked = await rules('đã click', null)
    const events = async (id, ids) => (await db.query('SELECT automation_id FROM auto_automation_detail WHERE source_campaign_detail_id=$1 AND automation_id=ANY($2::bigint[]) ORDER BY automation_id',[id,ids])).rows.map(r => Number(r.automation_id))
    const main = async id => (await db.query(`SELECT to_jsonb(d)-'sub_status_id' row FROM auto_campaign_details d WHERE id=$1`,[id])).rows[0].row
    const sub = async id => (await db.query('SELECT sub_status_id id FROM auto_campaign_details WHERE id=$1',[id])).rows[0].id
    const managed = async (group, state='committed', extra={}) => {
      const policy = (await db.query('SELECT id,status_id FROM auto_account_action_status_policies WHERE action_code IS NULL AND status_id=20')).rows[0]
      const payload = { input_data_id:1, action_code:'email_send', action_name:'offline', status:'thành công',
        status_id:policy.status_id, action_status_policy_id:policy.id, log:'preserved log',
        policy_snapshot:{reportGroup:group,countsTowardLimit:false,badTargetEffect:'ignore',resetErrorStreak:false,inputEffect:'complete',operationState:state}, ...extra }
      const result = (await db.query(`SELECT aka_agent_write_action_result_v1(1,1,1,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',$1,$2::jsonb) result`, ['v368:'+sequence++,JSON.stringify(payload)])).rows[0].result
      return Number(result.detail.id)
    }
    const tracking = async (detail, extra={}) => {
      const track = (await db.query(`INSERT INTO auto_email_message_trackings(campaign_id,campaign_detail_id,account_id,input_data_id,recipient_email) VALUES($1,$2,$3,$4,'offline@example.invalid') RETURNING id,open_token`, [extra.campaign??1,detail,extra.account??1,extra.input??1])).rows[0]
      const link = (await db.query(`INSERT INTO auto_email_link_trackings(message_tracking_id,original_url,link_index) VALUES($1,'https://example.invalid/',0) RETURNING click_token`,[track.id])).rows[0]
      return { id:track.id, observe:async kind => {
        await db.exec('SET ROLE anon')
        try { const result = (await db.query(`SELECT * FROM aka_agent_mark_email_${kind}($1::text,'offline')`,[kind==='open'?track.open_token:link.click_token])).rows[0]; equal(result.ok,true,'callback as anon succeeds') }
        finally { await db.exec('RESET ROLE') }
      } }
    }
    // Callback after link and observation before link, for every supported group.
    for (const group of ['success','pending','skipped','failure']) {
      for (const first of ['open','click']) for (const early of [false,true]) {
        const id = await managed(group), original = await main(id), t = await tracking(early?null:id)
        equal(await events(id,viewed),[],'no observation before event')
        await t.observe(first)
        if (early) {
          equal(await sub(id),null,'unlinked event cannot touch detail')
          await db.query('UPDATE auto_email_message_trackings SET campaign_detail_id=$1 WHERE id=$2',[id,t.id])
        }
        equal(await sub(id),first==='open'?34:23,'stored secondary independent of report group')
        equal(await events(id,first==='open'?viewed:clicked),first==='open'?viewed:clicked,'both Automation destinations receive event')
        await t.observe('click'); await t.observe('open'); await t.observe('click')
        equal(await sub(id),23,'click cannot downgrade to open')
        equal(await events(id,clicked),clicked,'callback replay cannot enqueue twice')
        equal(await main(id),original,'all primary decisions, data, timestamps and log preserved')
      }
    }
    // A report label alone is never evidence of a completed send.
    for (const state of ['unknown','not_committed']) for (const early of [false,true]) {
      const id = await managed('success',state), t = await tracking(early?null:id)
      await t.observe('open'); await t.observe('click')
      if (early) await db.query('UPDATE auto_email_message_trackings SET campaign_detail_id=$1 WHERE id=$2',[id,t.id])
      equal(await sub(id),null,'unconfirmed operation excluded')
      equal(await events(id,clicked),[],'unconfirmed operation cannot trigger secondary Automation')
    }
    for (const extra of [{action_code:'zalo_message_friend'},{is_delete:true}]) {
      const id = await managed('pending','committed',extra)
      if(extra.is_delete)await db.query('UPDATE auto_campaign_details SET is_delete=true WHERE id=$1',[id])
      const t = await tracking(id)
      await t.observe('click'); equal(await sub(id),null,'other action/deleted detail excluded')
    }
    const legacy = (await db.query(`INSERT INTO auto_campaign_details(campaign_id,account_id,input_data_id,action_code,action_name,status,log) VALUES(1,1,1,'email_send','legacy','thành công','legacy log') RETURNING id`)).rows[0].id
    const t = await tracking(legacy); await t.observe('open'); await t.observe('click'); await t.observe('open')
    equal((await db.query('SELECT status,status_id,sub_status_id,log FROM auto_campaign_details WHERE id=$1',[legacy])).rows[0],{status:'đã click',status_id:null,sub_status_id:null,log:'legacy log'},'legacy text path unchanged')
    equal((await db.query(`SELECT ok FROM aka_agent_mark_email_open('not-a-token')`)).rows[0].ok,false,'invalid token rejected')
    equal((await db.query('SELECT coalesce(sum(count_action_in_day),0) n FROM auto_account_action_status')).rows[0].n,beforeQuota,'observations never count sends')
    equal((await db.query(`SELECT jsonb_agg(to_jsonb(p) ORDER BY id) rows FROM auto_account_action_status_policies p`)).rows[0].rows,beforeConfig,'policy rows unchanged')
    equal((await db.query("SELECT last_error FROM auto_automation_enqueue_failures WHERE status='pending'")).rows,[],'no swallowed Automation failure')
    const rowsBeforeRollback = (await db.query('SELECT jsonb_agg(to_jsonb(d) ORDER BY id) rows FROM auto_campaign_details d')).rows[0].rows
    // Attribute and body drift each block rollback before any replacement.
    await db.exec('REVOKE EXECUTE ON FUNCTION aka_agent_mark_email_open(text,text) FROM service_role')
    await assert.rejects(db.exec(v.rollback()),/v368 attributes drift/); await db.exec('ROLLBACK'); checks++
    await db.exec('GRANT EXECUTE ON FUNCTION aka_agent_mark_email_open(text,text) TO service_role')
    const openFunction=v.targets.find(f=>f.signature.startsWith('aka_agent_mark_email_open('))
    await db.exec(openFunction.definition.replace('DECLARE','DECLARE\n  -- independent patch'))
    await assert.rejects(db.exec(v.rollback()),/v368 function drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(openFunction.definition)
    await db.exec(v.rollback()); await functions(v.functions)
    equal((await db.query('SELECT jsonb_agg(to_jsonb(d) ORDER BY id) rows FROM auto_campaign_details d')).rows[0].rows,rowsBeforeRollback,'rollback does not rewrite history')
    const receipt={at:new Date().toISOString(),checks,external_operations:0,production_touched:false,migration_sha256:v.m.hash(v.migration()),rollback_sha256:v.m.hash(v.rollback())}
    if(process.argv.includes('--receipt'))fs.writeFileSync(path.join(v.dir,'local-smoke.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
    console.log(JSON.stringify(receipt,null,2))
  } finally { await db.close() }
}
module.exports={createFixture}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
