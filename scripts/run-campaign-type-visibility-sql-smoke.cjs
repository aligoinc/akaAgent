// Isolated synthetic PostgreSQL. Never reads credentials or writes production.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const bin = process.env.AKA_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-visibility-pg-'))
const socket = path.join(dir, 'sock'), data = path.join(dir, 'data')
fs.mkdirSync(socket)
const conn = ['-X', '-h', socket, '-p', '55443', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
const run = (name, args, input) => execFileSync(path.join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] })
const query = sql => run('psql', conn, sql).trim()
const json = sql => JSON.parse(query(sql))
const parallel = (sql, onOutput) => new Promise((resolve, reject) => {
  const proc = spawn(path.join(bin, 'psql'), conn)
  let err = ''
  proc.stdout.on('data', b => onOutput?.(String(b)))
  proc.stderr.on('data', b => { err += b })
  proc.on('error', reject); proc.on('close', code => code ? reject(new Error(err)) : resolve())
  proc.stdin.end(sql)
})
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const source = JSON.parse(read('migrations/snapshots/campaign-type-visibility-v423/source.json'))
const migration = read('migrations/migration_v423_campaign_type_visibility.sql')
const body = migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
const access = JSON.stringify({ facebookCore:true,facebookFanpage:true,zalo:true,sms:true,email:true,qr:true,web:true,server:true })
const desktop = (filters={}, options='') => `public.aka_agent_desktop_campaign_page(11,1,'admin-a','fixture','${access}','${JSON.stringify(filters)}'${options})`
const web = (filters={}, options='') => `public.aka_agent_control_campaign_page(11,1,ARRAY['zalo','sms'],'${JSON.stringify(filters)}'${options})`
const settings = (op='get', changes=[], catalog=false, id=11, username='admin-a', org=1) => `public.aka_agent_campaign_type_visibility(${id},${org},'${username}','fixture','${access}','${op}','${JSON.stringify(changes)}',${catalog})`
let checks=0, started=false
const check = (name, fn) => { fn(); checks++; console.log('PASS',name) }
const rejected = (sql, pattern) => {
  let error
  try { query(sql) } catch (reason) { error = String(reason.stderr) }
  assert(error && pattern.test(error), `expected ${pattern}, got ${error}`)
}
async function main() {
  try {
    run('initdb',['-D',data,'-U','postgres','--auth=trust','--no-locale','-E','UTF8'])
    run('pg_ctl',['-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-p 55443 -k ${socket} -c listen_addresses=`,'start']);started=true
    query(read('scripts/fixtures/campaign-type-visibility/schema.sql'))
    for (const row of source) query(row.definition+';')
    // Restore source privileges; CREATE defaults grant PUBLIC, unrelated to the feature.
    for (const row of source) {
      query(`REVOKE ALL ON FUNCTION ${row.signature} FROM PUBLIC,anon,authenticated,service_role;` +
        row.proacl.slice(1,-1).split(',').map(acl=>`GRANT EXECUTE ON FUNCTION ${row.signature} TO ${acl.split('=')[0] || 'PUBLIC'};`).join('\n'))
    }
    query(read('scripts/fixtures/campaign-type-visibility/seed.sql'))
    const baselineD=json(`SELECT ${desktop()};`), baselineW=json(`SELECT ${web()};`)
    check('migration rolls back cleanly', () => {
      query('BEGIN;'+body+`SELECT ${settings()}; ROLLBACK;`)
      assert.equal(query("SELECT to_regclass('auto_campaign_type_visibility') IS NULL"),'t')
    })
    check('source drift fails closed', () => rejected('BEGIN;'+body.replace(source[0].checksum,'00000000000000000000000000000000')+'ROLLBACK;',/source drift/))
    query(migration)
    check('source function privileges/settings and dependency definitions are preserved',()=>{
      for(const row of source) {
        const current=json(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'proacl',proacl::text,'proconfig',proconfig,'prosecdef',prosecdef,'provolatile',provolatile) FROM pg_proc WHERE oid='${row.signature}'::regprocedure`)
        for(const key of ['owner','proacl','proconfig','prosecdef','provolatile']) assert.deepEqual(current[key],row[key],`${row.signature} ${key}`)
        if(!row.signature.includes('campaign_page(')) assert.equal(query(`SELECT md5(pg_get_functiondef('${row.signature}'::regprocedure))`),row.checksum)
      }
    })
    check('missing configuration defaults all on',()=>assert.deepEqual(json(`SELECT ${settings()};`).hiddenActionIds,[]))
    check('Desktop count includes QR and orphan, excludes deleted/other staff',()=> {
      const result=json(`SELECT ${settings('get',[],true)};`)
      assert.equal(result.catalog.find(a=>a.id==='zalo_message_phone').campaignCount,3)
    })
    check('Web catalog/count stays in Server and SMS scope',()=>{
      const result=json("SET ROLE service_role; SELECT public.aka_agent_control_campaign_type_visibility(11,1,ARRAY['zalo','sms'],'get','[]',true)")
      assert(result.catalog.every(a=>['zalo','sms'].includes(a.platform)))
      assert.equal(result.catalog.find(a=>a.id==='zalo_message_phone').campaignCount,2)
    })
    check('staff may read but not patch',()=>{
      assert.equal(json(`SET ROLE anon; SELECT ${settings('get',[],true,12,'staff')}`).canEdit,false)
      rejected(`SET ROLE anon; SELECT ${settings('patch',[{actionId:'sms_send',visible:false}],false,12,'staff')}`,/visibility_access_denied/)
    })
    check('forged tenant/credentials and inactive actor rejected',()=>{
      rejected(`SET ROLE anon; SELECT ${settings('get',[],false,11,'admin-a',2)}`,/automation_auth_invalid/)
      rejected(`SET ROLE anon; SELECT ${settings('get',[],false,11,'wrong')}`,/automation_auth_invalid/)
      rejected(`SELECT ${settings('get',[],false,14,'inactive')}`,/automation_auth_invalid/)
    })
    check('effective Web RPC/table ACL blocks anon and authenticated despite production default grants',()=>{
      for (const role of ['anon','authenticated']) {
        assert.equal(query(`SELECT has_function_privilege('${role}','public.aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)','EXECUTE')`),'f')
        rejected(`SET ROLE ${role}; SELECT * FROM auto_campaign_type_visibility`,/permission denied/)
        rejected(`SET ROLE ${role}; SELECT public.aka_agent_control_campaign_type_visibility(11,1,ARRAY['zalo'])`,/permission denied/)
        for (const [staff,org] of [[11,1],[21,2]]) rejected(`SET ROLE ${role}; SELECT public.aka_agent_control_campaign_type_visibility(${staff},${org},ARRAY['sms'],'patch','[{"actionId":"sms_send","visible":false}]')`,/permission denied/)
      }
      assert.equal(query("SELECT has_function_privilege('service_role','public.aka_agent_control_campaign_type_visibility(bigint,bigint,text[],text,jsonb,boolean)','EXECUTE')"),'t')
      assert.equal(query('SELECT count(*) FROM auto_campaign_type_visibility'),'0')
    })
    check('invalid and duplicate actions rejected before writes',()=>{
      for(const changes of [[{actionId:'missing',visible:false}],[{actionId:'sms_send',visible:false},{actionId:'sms_send',visible:true}]]) {
        rejected(`SELECT ${settings('patch',changes)}`,/visibility_invalid/)
      }
      assert.equal(query('SELECT count(*) FROM auto_campaign_type_visibility'),'0')
    })
    check('Web cannot change Desktop-only actions',()=>rejected("SET ROLE service_role; SELECT public.aka_agent_control_campaign_type_visibility(11,1,ARRAY['zalo','sms'],'patch','[{\"actionId\":\"facebook_group_post\",\"visible\":false}]')",/visibility_invalid_action/))
    query(`SELECT ${settings('patch',[{actionId:'facebook_group_post',visible:false},{actionId:'zalo_message_phone',visible:false}])}`)
    check('legacy readers are byte-for-byte compatible',()=>{
      assert.deepEqual(json(`SELECT ${desktop()}`),baselineD)
      assert.deepEqual(json(`SELECT ${web()}`),baselineW)
    })
    check('filter occurs before totals; running label and pinned detail survive',()=>{
      const page=json(`SELECT ${desktop({applyDisplaySettings:true},",1,'[]',1")}`)
      assert.deepEqual(page.ids,[4]);assert.equal(page.total,1)
      assert.equal(page.selectedId,1);assert.equal(page.runningCampaigns[0].id,1)
      assert(!page.actionOptions.some(a=>a.id==='facebook_group_post'))
    })
    check('draft anchors filtered by type together with campaigns',()=>{
      const anchors=JSON.stringify([{id:'d1',actionId:'zalo_message_phone',schedule:'2026-01-01'},{id:'d2',actionId:'sms_send',schedule:'2026-01-01'}])
      assert.equal(json(`SELECT ${desktop({applyDisplaySettings:true},`,1,'${anchors}'`)}`).total,2)
      assert.equal(json(`SELECT ${web({applyDisplaySettings:true},`,1,'${anchors}'`)}`).total,2)
    })
    check('selection respects hidden types including explicit IDs',()=>{
      assert.deepEqual(json(`SELECT ${desktop({applyDisplaySettings:true},",1,'[]',NULL,true,0,ARRAY[1,2,4]::bigint[]")}`).items.map(x=>x.id),[4])
      assert.deepEqual(json(`SELECT ${web({applyDisplaySettings:true},",1,'[]',NULL,true,0,ARRAY[2,4]::bigint[]")}`).items.map(x=>x.id),[4])
    })
    check('Web reset preserves Facebook configuration',()=>{
      query("SET ROLE service_role; SELECT public.aka_agent_control_campaign_type_visibility(11,1,ARRAY['zalo','sms'],'patch','[{\"actionId\":\"zalo_message_phone\",\"visible\":true},{\"actionId\":\"sms_send\",\"visible\":true}]')")
      assert.deepEqual(json(`SELECT ${settings()}`).hiddenActionIds,['facebook_group_post'])
    })
    await Promise.all([
      parallel(`BEGIN; SELECT ${settings('patch',[{actionId:'sms_send',visible:false}])}; SELECT pg_sleep(.15); COMMIT;`),
      parallel(`SELECT ${settings('patch',[{actionId:'email_send',visible:false}],false,13,'admin-b')};`)
    ])
    check('concurrent disjoint patches preserve both edits',()=>assert.deepEqual(json(`SELECT ${settings()}`).hiddenActionIds,['email_send','facebook_group_post','sms_send']))
    let locked
    const lockReady=new Promise(resolve=>{locked=resolve})
    const first=parallel(`BEGIN; SELECT ${settings('patch',[{actionId:'sms_send',visible:false}])}; SELECT 'visibility-lock-held'; SELECT pg_sleep(.2); COMMIT;`,chunk=>{if(chunk.includes('visibility-lock-held'))locked()})
    await lockReady
    await Promise.all([first,parallel(`SELECT ${settings('patch',[{actionId:'sms_send',visible:true}],false,13,'admin-b')}`)])
    check('same action concurrent edits follow the last committed patch',()=>{
      assert(!json(`SELECT ${settings()}`).hiddenActionIds.includes('sms_send'))
    })
    check('other tenant unchanged and new type visible by default',()=>{
      assert.deepEqual(json(`SELECT ${settings('get',[],false,21,'other',2)}`).hiddenActionIds,[])
      query("INSERT INTO auto_campaign_actions(id,name,flatform_type) VALUES('zalo_new_type','New','zalo')")
      assert(!json(`SELECT ${settings()}`).hiddenActionIds.includes('zalo_new_type'))
    })
    check('hiding does not mutate campaigns',()=> {
      assert.deepEqual(json(`SELECT ${desktop()}`),baselineD)
      assert.equal(query("SELECT status FROM auto_campaigns WHERE id=1"),'đang chạy')
    })
    query("INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,action_id,name,status,schedule) SELECT 1000+n,11,1,2,'zalo_message_phone','Load '||n,'chờ xử lý','2026-01-01'::timestamptz FROM generate_series(1,100000) n; ANALYZE auto_campaigns;")
    const timings={}
    for(const [name,sql] of Object.entries({desktop:desktop({applyDisplaySettings:true}),web:web({applyDisplaySettings:true}),counts:settings('get',[],true)})) {
      const start=performance.now();json(`SELECT ${sql}`);timings[name]=Math.round(performance.now()-start)
      assert(timings[name]<2000,`${name} exceeded local 2s gate`)
    }
    console.log('100k local timings (ms)',timings)
    const target=json("SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'proacl',p.proacl::text,'proconfig',p.proconfig,'prosecdef',p.prosecdef,'provolatile',p.provolatile)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN ('aka_agent_desktop_campaign_page','aka_agent_control_campaign_page','aka_agent_campaign_type_visibility','aka_agent_control_campaign_type_visibility','aka_agent_campaign_visibility_snapshot','aka_agent_campaign_visibility_actions')")
    fs.writeFileSync(path.join(root,'migrations/snapshots/campaign-type-visibility-v423/target.json'),JSON.stringify(target,null,2)+'\n')
    check('rollback refuses to overwrite a newer function patch',()=> {
      const rollback=read('migrations/snapshots/campaign-type-visibility-v423/rollback.sql').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'ROLLBACK;')
      rejected(`BEGIN; ALTER FUNCTION ${source[0].signature} SET statement_timeout='99s';`+rollback,/rollback refused/)
    })
    query(read('migrations/snapshots/campaign-type-visibility-v423/rollback.sql'))
    check('rollback restores live definitions',()=>{
      for(const row of source) assert.equal(query(`SELECT md5(pg_get_functiondef('${row.signature}'::regprocedure))`),row.checksum)
      assert.equal(query("SELECT to_regclass('auto_campaign_type_visibility') IS NULL"),'t')
    })
    fs.writeFileSync(path.join(root,'migrations/snapshots/campaign-type-visibility-v423/local-results.json'),JSON.stringify({checks,timings,fixtureRows:100000,productionApplied:false},null,2)+'\n')
    console.log(`PASS ${checks} SQL cases, concurrency, rollback, 100k local workload`)
  } finally {
    if(started)run('pg_ctl',['-D',data,'stop','-m','immediate'])
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error.stderr || error);process.exitCode=1})
