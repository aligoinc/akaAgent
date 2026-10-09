const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { createFixture } = require('./action-status-compatibility-fixture.cjs')
const v = require('./action-status-compatibility-v367.cjs')
let checks = 0
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
async function main() {
  const db = await createFixture()
  try {
    // Test the actual migration guards, transaction and reversible bodies.
    await db.exec(`CREATE INDEX ${v.indexName} ON auto_campaign_details(id)`);
    await assert.rejects(db.exec(v.migration()), /committed delivery index required/); await db.exec('ROLLBACK'); checks++;
    await db.exec(`DROP INDEX ${v.indexName}`);
    await db.exec(v.indexSQL)
    const indexDefinition = (await db.query(`SELECT pg_get_indexdef('${v.indexName}'::regclass) definition`)).rows[0].definition
    await db.exec(v.migration())
    for (const f of v.targets) {
      equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) md5',[f.signature])).rows[0].md5,f.md5,f.signature)
    }
    await assert.rejects(db.exec(v.migration()), /function drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(v.rollback())
    for (const f of v.functions.filter(f => v.targets.some(t => t.signature===f.signature))) {
      equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) md5',[f.signature])).rows[0].md5,f.md5,'rollback exact source')
    }
    await db.exec(v.migration())
    let nextRule = 9000
    const rules = async (status, sub = null, action = 'email_send', source = 1) => {
      const ids = [nextRule++,nextRule++]
      for (let i=0;i<2;i++) {
        await db.query(`INSERT INTO auto_automation(id,name,source_campaign_id,target_campaign_id,target_data_group_id,data_type_code,is_active,staff_id,organization_id,activated_at)
          VALUES($1,'offline rule',$2,$3,$4,'review_email',true,1,1,now()-interval '1 day')`,[ids[i],source,i===0?3:null,i===0?null:9000])
        await db.query(`INSERT INTO auto_automation_trigger_statuses(automation_id,status_mapping_id,action_code,status_value,sub_status_ids) VALUES($1,$1,$2,$3,$4)`,[ids[i],action,status,sub])
      }
      return ids
    }
    const events = async (detail, ids) => (await db.query(`SELECT automation_id FROM auto_automation_detail WHERE source_campaign_detail_id=$1 AND automation_id=ANY($2::bigint[]) ORDER BY automation_id`,[detail,ids])).rows.map(r=>Number(r.automation_id))
    const detail = async ({action='email_send',managed=true,status='thành công',sub=null,input=1,group='success',snapshot=null}={}) => (await db.query(`INSERT INTO auto_campaign_details(input_data_id,campaign_id,account_id,action_code,action_name,status,status_id,sub_status_id,report_group,policy_snapshot,log)
      VALUES($1,$2,1,$3,'offline test',$4,$5,$6,$7,$8,'unchanged log') RETURNING id`,[input,input===4?4:1,action,status,managed?20:null,sub,managed?group:null,snapshot])).rows[0].id
    const open = async id => {
      const t=(await db.query(`INSERT INTO auto_email_message_trackings(campaign_id,campaign_detail_id,account_id,input_data_id,recipient_email) VALUES(1,$1,1,1,'review@example.invalid') RETURNING id,open_token`,[id])).rows[0]
      const l=(await db.query(`INSERT INTO auto_email_link_trackings(message_tracking_id,original_url,link_index) VALUES($1,'https://example.invalid/',0) RETURNING click_token`,[t.id])).rows[0]
      const observe = kind => db.query(`SELECT * FROM aka_agent_mark_email_${kind}($1::text,'offline-test')`,[kind==='open'?t.open_token:l.click_token])
      await observe('open'); return observe
    }
    const viewed=await rules('đã xem'),clicked=await rules('đã click'),success=await rules('thành công')
    const secondary=await rules('thành công',[34]),restricted=await rules('đã xem',[34])
    for (const managed of [false,true]) {
      const d=await detail({managed})
      equal(await events(d,viewed),[],'viewed must not fire before observation')
      equal(await events(d,success),success,'main success still fires once')
      const observe=await open(d)
      equal(await events(d,viewed),viewed,'legacy opened conditions fire for both formats')
      equal(await events(d,secondary),managed?secondary:[],'explicit secondary filter remains exact')
      equal(await events(d,restricted),[],'do not reinterpret explicitly constrained main conditions')
      await observe('open'); await observe('click'); await observe('open')
      equal(await events(d,viewed),viewed,'opened replay deduplicated')
      equal(await events(d,clicked),clicked,'clicked event supported')
      equal(await events(d,success),success,'secondary event never repeats main-only success')
      const row=(await db.query('SELECT status,sub_status_id,log FROM auto_campaign_details WHERE id=$1',[d])).rows[0]
      equal(row,{status:managed?'thành công':'đã click',sub_status_id:managed?23:null,log:'unchanged log'},'historical main/log retained')
    }
    // Existing observation is not replayed when a new rule is created afterwards.
    const observed=await detail({sub:34}),late=await rules('đã xem')
    await db.query(`UPDATE auto_campaign_details SET sub_status_id=34 WHERE id=$1`,[observed])
    equal(await events(observed,late),[],'no backfill on unchanged observation')
    await db.query(`UPDATE auto_campaign_details SET status='custom main',sub_status_id=34 WHERE id=$1`,[observed])
    equal(await events(observed,late),[],'main rename is not a new opened edge')
    const wrong=await detail({action:'zalo_message_friend',sub:34})
    equal(await events(wrong,viewed),[],'no legacy Email alias on another action')
    const foreign=await rules('đã xem')
    await db.query('UPDATE auto_automation SET organization_id=2 WHERE id=ANY($1::bigint[])',[foreign])
    const scoped=await detail(); await open(scoped)
    equal(await events(scoped,foreign),[],'tenant guards remain')
    // SMS uses the real observation RPC and never increments send quota again.
    for (const [status,code] of [['đã gửi','campaign_detail_sent'],['đã nhận','campaign_detail_received'],['thất bại','campaign_detail_failed']]) {
      const ids=await rules(status,null,'sms_send',4)
      const d=await detail({action:'sms_send',input:4})
      const beforeCount=(await db.query('SELECT coalesce(sum(count_action_in_day),0) n FROM auto_account_action_status')).rows[0].n
      const result=(await db.query(`SELECT * FROM aka_agent_record_sms_message_status(4,1,$1,'unchanged log','{}',NULL)`,[status])).rows[0]
      equal(result.counted,false,'SMS observation does not count again')
      equal(await events(d,ids),ids,'legacy SMS condition supported: '+status)
      equal((await db.query('SELECT coalesce(sum(count_action_in_day),0) n FROM auto_account_action_status')).rows[0].n,beforeCount,'SMS quota retained')
      const state=(await db.query('SELECT s.code FROM auto_campaign_details d JOIN auto_status s ON s.id=d.sub_status_id WHERE d.id=$1',[d])).rows[0]
      equal(state.code,code,'SMS secondary stored')
      await db.query(`SELECT * FROM aka_agent_record_sms_message_status(4,1,$1,'unchanged log','{}',NULL)`,[status])
      equal(await events(d,ids),ids,'SMS observation replay deduplicated')
    }
    equal((await db.query("SELECT last_error FROM auto_automation_enqueue_failures WHERE status='pending'")).rows,[],'trigger failures must not be swallowed')
    // Filter/search real v1/v2 page bodies, including old clients and empty pages.
    const pending=await detail({sub:52})
    for (const version of ['', '_v2']) {
      const page = async (status=null, search=null, offset=0, staff=1) => (await db.query(`SELECT aka_agent_list_campaign_details_page${version}($4,1,1,$2,$1,NULL,NULL,$3,100,'created_desc',NULL,NULL${version?',NULL':''}) value`,[status,search,offset,staff])).rows[0].value
      equal((await page('chờ duyệt bài')).items.some(r=>Number(r.id)===Number(pending)),true,'sub value filter '+version)
      equal((await page('Chờ duyệt bài')).items.some(r=>Number(r.id)===Number(pending)),true,'sub label fallback '+version)
      equal((await page(null,'Chờ duyệt bài')).items.some(r=>Number(r.id)===Number(pending)),true,'search visible secondary '+version)
      const result=await page('đã click')
      equal(result.items.some(r=>r.status_id!=null),true,'managed clicks visible '+version)
      equal(result.items.some(r=>r.status_id==null),true,'legacy clicks visible '+version)
      equal(result.items.find(r=>r.status_id!=null).sub_status_presentation.statusValue,'đã click','stable filter value '+version)
      equal((await page('chờ duyệt bài',null,99999)).items,[],'offset beyond last page '+version)
      equal((await page('chờ duyệt bài',null,99999)).total,1,'empty page retains count '+version)
      await assert.rejects(page(null,null,0,2),/campaign_not_found/); checks++
      equal((await page("' OR true --")).total,0,'bound filter value '+version)
    }
    // History includes committed custom/partial outcomes, excludes attempts with
    // explicit non-commit/unknown evidence, and preserves legacy results exactly.
    await db.exec('DELETE FROM auto_campaign_details')
    const expected=[]
    for(const status of ['thành công','đã gửi','đã nhận','đã xem','đã click'])expected.push(await detail({managed:false,status}))
    expected.push(await detail({status:'custom delivered',snapshot:{operationState:'committed'}}))
    expected.push(await detail({status:'thất bại',group:'failure',snapshot:{operationState:'committed',partialDelivery:true}}))
    await detail({status:'thành công',snapshot:{operationState:'not_committed'}})
    await detail({status:'thành công',snapshot:{operationState:'unknown'}})
    await detail({managed:false,status:'thất bại'})
    const history=(await db.query("SELECT detail_id FROM aka_agent_internal_send_delivery_history(1,ARRAY['email_send'],now()-interval '1 day',now()+interval '1 day') ORDER BY detail_id")).rows.map(r=>Number(r.detail_id))
    equal(history,expected.map(Number),'committed and legacy history without duplicate rows')
    equal((await db.query("SELECT * FROM aka_agent_internal_send_delivery_history(2,ARRAY['email_send'],now()-interval '1 day',now()+interval '1 day')")).rows,[],'account history scope')
    equal((await db.query("SELECT * FROM aka_agent_internal_send_delivery_history(1,ARRAY['fb_post_group'],now()-interval '1 day',now()+interval '1 day')")).rows,[],'action history scope')
    // A confirmed custom result must pause the next pending delivery too.
    await db.exec(`UPDATE auto_campaigns SET extra_settings='{"recentDeliveryCooldownEnabled":true,"recentDeliveryCooldownDays":3}' WHERE id=1; UPDATE auto_campaign_input_data SET status='chờ xử lý' WHERE id=2; DELETE FROM auto_campaign_details WHERE status<>'custom delivered'`);
    equal((await db.query('SELECT decision FROM aka_agent_apply_campaign_delivery_cooldown(1,1,1,ARRAY[2]::bigint[])')).rows,[{decision:'paused_recent_delivery'}],'custom committed result pauses repeat');
    await assert.rejects(db.query('SELECT * FROM aka_agent_apply_campaign_delivery_cooldown(1,1,2,ARRAY[2]::bigint[])'), /scope_not_found/); checks++;
    const historyBody=v.targets.find(f=>f.signature.startsWith('aka_agent_internal_send_delivery_history(')).definition.split('AS $function$')[1].split('$function$')[0]
      .replaceAll('p_account_id','1').replaceAll('p_action_codes',"ARRAY['email_send']").replaceAll('p_since',"now()-interval '1 day'").replaceAll('p_now',"now()+interval '1 day'")
    await db.exec('SET enable_seqscan=off')
    const plan=JSON.stringify((await db.query('EXPLAIN (FORMAT JSON) '+historyBody)).rows)
    equal(plan.includes(v.indexName),true,'committed branch index eligible')
    equal(plan.includes('idx_campaign_details_delivery_cooldown'),true,'legacy branch index preserved')
    const receipt={at:new Date().toISOString(),checks,production_touched:false,migration_sha256:v.m.hash(v.migration()),indexDefinition}
    if(process.argv.includes('--receipt'))fs.writeFileSync(path.join(v.dir,'local-smoke.json'),JSON.stringify(receipt,null,2)+'\n')
    console.log(JSON.stringify(receipt,null,2))
  } finally { await db.close() }
}
main().catch(e=>{console.error(e);process.exitCode=1})
