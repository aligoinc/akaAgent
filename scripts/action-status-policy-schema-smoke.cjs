const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const m = require('./action-status-policy-migration.cjs')
const seed = require('./action-status-policy-seed.cjs')

async function main() {
  const b = m.checkedBackup()
  const db = new PGlite()
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;')
  for (const s of b.schema.filter(x => x.exists)) {
    const maxId = Math.max(0, ...(b.tables[s.table]?.rows || []).map(x => Number(x.row.id)))
    if (s.columns.some(c => c.default?.startsWith('nextval('))) await db.exec(`CREATE SEQUENCE public.${s.table}_id_seq START ${maxId+1}`)
    const columns = s.columns.map(c => `${c.name} ${c.type}${c.not_null ? ' NOT NULL' : ''}${c.default ? ' DEFAULT '+c.default : ''}`)
    columns.push('PRIMARY KEY(id)')
    if (['auto_status','auto_account_actions'].includes(s.table)) columns.push('UNIQUE(code)')
    await db.exec(`CREATE TABLE public.${s.table} (${columns.join(',')})`)
    for (const x of b.tables[s.table]?.rows || []) await db.query(`INSERT INTO public.${s.table} SELECT * FROM jsonb_populate_record(NULL::public.${s.table},$1::jsonb)`,[JSON.stringify(x.row)])
  }
  const localBefore={...b,tables:{}}
  for(const table of Object.keys(b.tables)) {
    const rows=(await db.query(`SELECT to_jsonb(t) AS row,to_jsonb(t)::text AS canonical,md5(to_jsonb(t)::text) AS md5 FROM public.${table} t`)).rows
    localBefore.tables[table]={count:rows.length,rows}
  }
  const sql = fs.readFileSync(path.join(m.root,'migrations',m.name+'.sql'),'utf8')
    .replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/, '-- Live drift guards are separately tested on linked production in ROLLBACK.')
  await db.exec(sql)
  let tests = 0
  const expectError = async (sql, pattern) => {
    await assert.rejects(db.exec(sql), pattern); tests++
  }
  const result = await db.query(`SELECT * FROM public.${m.newTable}`)
  assert.equal(result.rows.length, seed.rows.length); tests++
  const successId = 20
  const defaultId = result.rows.find(x=>x.status_id===successId && x.action_code===null).id
  await expectError(`INSERT INTO public.${m.newTable}(action_code,status_id,report_group,counts_toward_limit,bad_target_effect,reset_error_streak,input_effect,description) SELECT action_code,status_id,report_group,counts_toward_limit,bad_target_effect,reset_error_streak,input_effect,description FROM public.${m.newTable} WHERE id=${defaultId}`, /duplicate key/)
  await db.exec(`UPDATE public.${m.newTable} SET is_active=false,is_delete=true WHERE id=${defaultId}`)
  await expectError(`INSERT INTO public.${m.newTable}(action_code,status_id,report_group,counts_toward_limit,bad_target_effect,reset_error_streak,input_effect,description) SELECT action_code,status_id,report_group,counts_toward_limit,bad_target_effect,reset_error_streak,input_effect,description FROM public.${m.newTable} WHERE id=${defaultId}`, /duplicate key/)
  await db.exec(`UPDATE public.${m.newTable} SET is_active=true,is_delete=false WHERE id=${defaultId}`)
  await expectError(`UPDATE public.${m.newTable} SET status_id=1 WHERE id=${defaultId}`, /result_status_component_invalid/)
  await expectError(`UPDATE public.auto_error SET detail_mode='override' WHERE id=1`, /auto_error_detail_override_check/)
  await expectError(`UPDATE public.auto_error SET detail_mode='override',detail_status_id=1 WHERE id=1`, /result_status_component_invalid/)
  // Old INSERTs remain legal and every added result column stays NULL.
  await db.exec(`INSERT INTO public.auto_campaign_details(campaign_id,action_name,status) VALUES (1,'Existing action','thành công')`)
  const legacy = (await db.query('SELECT * FROM public.auto_campaign_details')).rows[0]
  for (const key of ['status_id','sub_status_id','action_status_policy_id','report_group','policy_snapshot','result_key']) assert.equal(legacy[key], null)
  tests++
  await expectError(`INSERT INTO public.auto_campaign_details(campaign_id,action_name,status,status_id,action_status_policy_id) VALUES (1,'Existing action','thất bại',21,${defaultId})`, /result_policy_identity_mismatch/)
  const override = result.rows.find(x=>x.action_code==='zalo_tag_contact' && x.status_id===20)
  await expectError(`INSERT INTO public.auto_campaign_details(campaign_id,action_name,status,status_id,action_code,action_status_policy_id) VALUES (1,'Existing action','thành công',20,'email_send',${override.id})`, /result_policy_identity_mismatch/)
  const triggerId = b.tables.auto_automation_trigger_statuses.rows[0].row.id
  await expectError(`UPDATE public.auto_automation_trigger_statuses SET sub_status_ids='{}' WHERE id=${triggerId}`, /auto_automation_sub_status_ids_check/)
  await expectError(`UPDATE public.auto_automation_trigger_statuses SET sub_status_ids=ARRAY[1::bigint] WHERE id=${triggerId}`, /result_status_component_invalid/)
  await db.exec(`UPDATE public.auto_automation_trigger_statuses SET sub_status_ids=ARRAY[23::bigint] WHERE id=${triggerId}`)
  await db.exec(`UPDATE public.auto_automation_trigger_statuses SET sub_status_ids=NULL WHERE id=${triggerId}`)
  await expectError(`UPDATE public.auto_status SET component_type='campaign' WHERE id=20`, /result_status_component_in_use/)
  for (const [table, data] of Object.entries(b.tables)) {
    const rows = (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t`)).rows
    for (const old of data.rows) {
      const current = rows.find(x=>x.row.id===old.row.id).row
      // PostgreSQL JSON timestamps have normalized zero timezone formatting.
      for (const [k,v] of Object.entries(old.row)) {
        if (k.endsWith('_at') && typeof v==='string') assert.equal(Date.parse(current[k]),Date.parse(v))
        else assert.deepEqual(current[k],v,`${table}/${old.row.id}/${k}`)
      }
    }
  }
  tests++
  await db.exec(`SET ROLE anon; SELECT * FROM public.${m.newTable}; RESET ROLE;`)
  await expectError(`SET ROLE anon; UPDATE public.${m.newTable} SET is_active=false`, /permission denied/)
  await db.exec('RESET ROLE')
  const after = {tables:{},functions:[]}
  for(const table of [...Object.keys(b.tables),m.newTable]) {
    const rows=(await db.query(`SELECT to_jsonb(t) AS row,to_jsonb(t)::text AS canonical,md5(to_jsonb(t)::text) AS md5 FROM public.${table} t`)).rows
    after.tables[table]={count:rows.length,rows}
  }
  after.functions=(await db.query("SELECT oid::regprocedure::text AS signature,md5(pg_get_functiondef(oid)) AS md5 FROM pg_proc WHERE proname IN ('aka_agent_guard_result_catalog_v361','aka_agent_guard_detail_result_v361','aka_agent_guard_result_status_v361')")).rows
  const rollback=require('./apply-action-status-policy-migration.cjs').buildRollback(after,false,{...localBefore,project_ref:"local-fixture"})
  await db.exec(rollback)
  assert.equal((await db.query(`SELECT to_regclass('public.${m.newTable}') AS table`)).rows[0].table,null)
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.auto_status')).rows[0].n),b.tables.auto_status.count)
  tests++
  await db.close()
  console.log(JSON.stringify({tests, policies:result.rows.length, legacy_insert:true, original_values_preserved:true}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
