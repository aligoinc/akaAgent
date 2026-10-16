// Isolated local PostgreSQL only: never connects to the production database.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const assert = require('node:assert/strict')
const { Client } = require(require.resolve('pg', { paths: [path.resolve(__dirname, '../../akaAgentChatApi')] }))
const root = path.resolve(__dirname, '..')
const bin = process.env.CAMPAIGN_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-history-pg-'))
const port = 55408
const run = (name, args) => cp.execFileSync(path.join(bin, name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const clients = []
const pools = []
const report = { checks: [], benchmark: [] }
let contentionClients
let started = false
function ok(name) { report.checks.push(name) }
async function connect() {
  const c = new Client({ host: dir, port, user: 'postgres', database: 'postgres' })
  await c.connect(); clients.push(c); return c
}
async function scalar(c, sql, args) { return Object.values((await c.query(sql, args)).rows[0])[0] }
function cpu(pid) {
  const text = cp.execFileSync('ps', ['-p', String(pid), '-o', 'time='], { encoding: 'utf8' }).trim()
  const parts = text.split(':').map(Number)
  return parts.reduce((seconds, part) => seconds * 60 + part, 0) * 1000
}
async function measure(c, label, count = 120) {
  const pid = await scalar(c, 'select pg_backend_pid()')
  const beforeCpu = cpu(pid), start = performance.now()
  await c.query(`DO $b$ BEGIN FOR i IN 1..${count} LOOP PERFORM public.append_auto_campaign_log(1,7,'12:00:00 16/10/2026 - benchmark'); END LOOP; END $b$`)
  const wallMs = performance.now() - start, cpuMs = cpu(pid) - beforeCpu
  const explained = await scalar(c, "EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) SELECT public.append_auto_campaign_log(1,7,'12:00:00 16/10/2026 - benchmark')")
  report.benchmark.push({ label, appends: count, wallMs, cpuMs, explain: explained })
  const workers = contentionClients ||= await Promise.all([connect(), connect()])
  const pids = await Promise.all(workers.map(worker => scalar(worker, 'select pg_backend_pid()')))
  let finished = false, samples = 0, lockWaitSamples = 0
  const latencies = [], concurrentStart = performance.now()
  const writing = Promise.all(workers.map(async worker => {
    for (let i = 0; i < 60; i++) {
      const start = performance.now()
      await worker.query("SELECT public.append_auto_campaign_log(1,7,'12:00:00 16/10/2026 - contention')")
      latencies.push(performance.now() - start)
    }
  })).finally(() => { finished = true })
  while (!finished) {
    const waiting = await scalar(c, "SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])
    samples++; lockWaitSamples += Number(waiting)
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  await writing
  latencies.sort((a, b) => a-b)
  report.benchmark.at(-1).contention = { writers: 2, appends: 120, wallMs: performance.now()-concurrentStart,
    p95Ms: latencies[Math.floor(latencies.length*.95)], samples, lockWaitSamples, sampleIntervalMs: 2 }
}
;(async () => {
  run('initdb', ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'])
  run('pg_ctl', ['-D', path.join(dir, 'data'), '-l', path.join(dir, 'server.log'), '-o', `-k ${dir} -p ${port} -c listen_addresses='' -c max_connections=8 -c shared_buffers=16MB`, '-w', 'start'])
  started = true
  const c = await connect()
  await c.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE aka_agent_chat_api;
    CREATE SCHEMA private;
    CREATE TABLE auto_campaigns(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,account_id bigint,action_id text,log text,status text,note text,is_delete boolean DEFAULT false,updated_at timestamptz);
    CREATE TABLE auto_accounts(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,flatform_type text,is_delete boolean DEFAULT false,is_zalo_server boolean,is_zalo_show_web boolean);
    CREATE TABLE auto_campaign_actions(id text PRIMARY KEY);
    CREATE FUNCTION auto_assert_automation_identity(bigint,bigint,text,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF $1<>7 OR $2<>9 OR $3<>'test' OR $4<>'test' THEN RAISE EXCEPTION 'access denied'; END IF; END $$;
    INSERT INTO auto_accounts VALUES(11,7,9,'sms',false,false,false),(12,7,9,'zalo',false,true,false),(13,8,10,'sms',false,false,false);
    INSERT INTO auto_campaigns VALUES(1,7,9,11,'sms_send','legacy frozen','chờ xử lý','note',false,now()),(2,7,9,12,'zalo_message_phone','','chờ xử lý','note',false,now()),(3,8,10,13,'sms_send','','chờ xử lý','note',false,now()),(4,7,9,11,'sms_send','','chờ xử lý','note',true,now());
    GRANT SELECT,UPDATE ON auto_campaigns TO anon,authenticated,service_role,aka_agent_chat_api;
  `)
  const before = JSON.parse(fs.readFileSync(path.join(root, 'migrations/snapshots/campaign-logs-v408/before.json'), 'utf8'))
  for (const f of before) await c.query(f.definition)
  for (const entries of [0, 2000]) {
    await c.query("UPDATE auto_campaigns SET log=(SELECT coalesce(string_agg('12:00:00 16/10/2026 - '||repeat('x',80),E'\n'),'') FROM generate_series(1,$1)) WHERE id=1", [entries])
    await measure(c, `legacy-${entries}`)
  }
  await c.query("UPDATE auto_campaigns SET log='legacy frozen' WHERE id=1")
  await c.query(fs.readFileSync(path.join(root, 'migrations/migration_v408_campaign_logs.sql'), 'utf8'))
  const original = await scalar(c, 'SELECT to_jsonb(c) FROM auto_campaigns c WHERE id=1')
  for (const role of ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api']) {
    await c.query(`SET ROLE ${role}`)
    assert.equal(await scalar(c, "SELECT append_auto_campaign_log(1,7,'12:00:00 16/10/2026 - Xin chào 😀' || E'\n' || 'continued <!-- screenshotEventId:91 -->')"), true)
    await assert.rejects(c.query('SELECT * FROM auto_campaign_logs'), /permission denied/)
    await assert.rejects(c.query("INSERT INTO auto_campaign_logs(campaign_id,log) VALUES(1,'bypass')"), /permission denied/)
    await c.query('RESET ROLE')
    ok(`${role}: RPC append allowed; table denied`)
  }
  assert.deepEqual(await scalar(c, 'SELECT to_jsonb(c) FROM auto_campaigns c WHERE id=1'), original)
  ok('append leaves every campaign field and timestamp unchanged; old log not backfilled')
  assert.equal(Number(await scalar(c, 'SELECT count(*) FROM auto_campaign_logs')), 4)
  await c.query("SELECT append_auto_campaign_log(1,7,repeat('😀',20000))")
  assert.equal(await scalar(c, 'SELECT char_length(log) FROM auto_campaign_logs ORDER BY id DESC LIMIT 1'), 16000)
  ok('UTF-8 safe 16000 character cap')
  for (const sql of ["SELECT append_auto_campaign_log(1,8,'wrong staff')", "SELECT append_auto_campaign_log(4,7,'deleted')", "SELECT append_auto_campaign_log(1,7,'  ')", "SELECT append_auto_campaign_log(-1,7,'invalid')"])
    await assert.rejects(c.query(sql))
  ok('writer ownership, deletion and argument guards')
  const read = async options => scalar(c, 'SELECT aka_agent_control_campaign_logs(7,9,1,ARRAY[\'sms\'],$1)', [JSON.stringify(options)])
  const page1 = await read({ limit: 2 })
  assert.equal(page1.items.length, 2); assert.equal(page1.hasMore, true)
  assert.equal(typeof page1.items[0].id, 'string')
  const page2 = await read({ beforeId: page1.nextCursor, limit: 2 })
  assert.ok(BigInt(page2.items[0].id) < BigInt(page1.items[1].id))
  assert.equal(await scalar(c, "SELECT aka_agent_control_campaign_logs(8,9,1,ARRAY['sms'])"), null)
  assert.equal(await scalar(c, "SELECT aka_agent_control_campaign_logs(7,10,1,ARRAY['sms'])"), null)
  assert.equal(await scalar(c, "SELECT aka_agent_control_campaign_logs(7,9,1,ARRAY['zalo'])"), null)
  await c.query('SET ROLE anon')
  await assert.rejects(c.query("SELECT aka_agent_control_campaign_logs(7,9,1,ARRAY['sms'])"), /permission denied/)
  const desktop = await scalar(c, "SELECT aka_agent_desktop_campaign_logs(7,9,'test','test','{\"sms\":true}',1)")
  assert.equal(desktop.items.length, 5)
  assert.equal(await scalar(c, "SELECT aka_agent_desktop_campaign_logs(7,9,'test','test','{}',1)"), null)
  await assert.rejects(c.query("SELECT aka_agent_desktop_campaign_logs(7,9,'test','wrong','{\"sms\":true}',1)"))
  await c.query('RESET ROLE')
  ok('keyset pages, string IDs, tenant/platform/session and role guards')
  for (const query of [{ limit: 501 }, { beforeId: '1', afterId: '0' }, { afterId: '-1' }, { afterId: '9223372036854775808' }]) await assert.rejects(read(query))
  const legacy = await read({ legacy: true }); assert.ok(!legacy.log.includes('legacy frozen')); assert.ok(legacy.log.includes('Xin chào'))
  ok('legacy reads use new history only; invalid cursors rejected')
  const a = await connect(), b = await connect()
  await a.query('BEGIN'); await a.query("SELECT append_auto_campaign_log(1,7,'transaction A')")
  let settled = false
  const pending = b.query("SELECT append_auto_campaign_log(1,7,'transaction B')").then(() => { settled = true })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(settled, false)
  const visible = await read({ afterId: page1.items[0].id })
  assert.equal(visible.items.length, 0)
  await a.query('COMMIT'); await pending
  const committed = await read({ afterId: page1.items[0].id })
  assert.deepEqual(committed.items.map(x => x.log), ['transaction A', 'transaction B'])
  await a.query('BEGIN'); await a.query("SELECT append_auto_campaign_log(1,7,'rolled back')"); await a.query('ROLLBACK')
  assert.equal(Number(await scalar(c, "SELECT count(*) FROM auto_campaign_logs WHERE log='rolled back'")), 0)
  ok('concurrent commit ordering, cursor visibility and rollback')
  // Run the unchanged Chat writer against this same local database and its
  // existing transaction/NOTIFY contract; no production connection is opened.
  await c.query('ALTER TABLE auto_campaigns ADD COLUMN schedule timestamptz, ADD COLUMN last_run_at timestamptz')
  const chat = path.resolve(__dirname, '../../akaAgentChatApi')
  const ts = require('typescript'), kysely = require(require.resolve('kysely', { paths: [chat] }))
  const load = (file, imports) => {
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(path.join(chat, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', code)(id => { if (id in imports) return imports[id]; throw Error(id) }, module, module.exports)
    return module.exports
  }
  const writer = load('packages/database/src/campaignLogRealtime.ts', { kysely,
    './accountLog.js': {}, './campaignLogFormat.js': load('packages/database/src/campaignLogFormat.ts', {}) })
  const { Pool } = require(require.resolve('pg', { paths: [chat] }))
  const pool = new Pool({ host: dir, port, user: 'postgres', database: 'postgres', max: 1, options: '-c role=aka_agent_chat_api' })
  pools.push(pool)
  const database = new kysely.Kysely({ dialect: new kysely.PostgresDialect({ pool }) })
  const notifications = []
  c.on('notification', event => notifications.push(JSON.parse(event.payload)))
  await c.query('LISTEN aka_agent_chat_campaign_log')
  const stamp = await scalar(c, 'SELECT updated_at::text FROM auto_campaigns WHERE id=1')
  const cursorBeforeWriters = await scalar(c, 'SELECT max(id)::text FROM auto_campaign_logs WHERE campaign_id=1')
  await a.query('BEGIN'); await a.query('SET LOCAL ROLE anon')
  await a.query("SELECT append_auto_campaign_log(1,7,'Desktop concurrent entry')")
  await b.query('BEGIN'); await b.query('SET LOCAL ROLE service_role')
  let serverDone = false, chatDone = false
  const serverWrite = b.query("SELECT append_auto_campaign_log(1,7,'Server concurrent entry')")
    .then(() => b.query('COMMIT')).then(() => { serverDone = true })
  const chatWrite = writer.appendCampaignLogWithRealtime(database, { campaignId: 1, staffId: 7, organizationId: 9, accountId: 11,
    accountName: 'Fixture', campaignName: 'Fixture', message: 'Chat committed log 😀' }).then(() => { chatDone = true })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(serverDone, false); assert.equal(chatDone, false)
  assert.equal((await read({ afterId: cursorBeforeWriters })).items.length, 0)
  await a.query('COMMIT'); await Promise.all([serverWrite, chatWrite])
  assert.equal((await read({ afterId: cursorBeforeWriters })).items.length, 3)
  await c.query('SELECT 1')
  assert.equal(notifications.length, 1); assert.equal(notifications[0].kind, 'log')
  assert.equal(notifications[0].campaign.updatedAt, new Date(stamp).toISOString())
  assert.equal(Number(await scalar(c, "SELECT count(*) FROM auto_campaign_logs WHERE campaign_id=1 AND log LIKE '%Chat committed log 😀%'")), 1)
  ok('concurrent Desktop/Server/Chat roles; unchanged Chat runtime RPC + commit NOTIFY and campaign updatedAt')
  for (const count of [0, 2000, 100000]) {
    await c.query('TRUNCATE auto_campaign_logs')
    await c.query("INSERT INTO auto_campaign_logs(campaign_id,log) SELECT 1, '12:00:00 16/10/2026 - '||repeat('x',80) FROM generate_series(1,$1)", [count])
    await c.query('ANALYZE auto_campaign_logs')
    await measure(c, `new-${count}`)
  }
  await c.query("INSERT INTO auto_campaign_logs(campaign_id,log) SELECT 2, 'other campaign' FROM generate_series(1,200000)")
  await c.query('ANALYZE auto_campaign_logs')
  report.readPlan = await scalar(c, 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,log,created_at FROM auto_campaign_logs WHERE campaign_id=1 AND id<90000 ORDER BY id DESC LIMIT 101')
  assert.match(JSON.stringify(report.readPlan), /Index Scan/)
  await c.query("INSERT INTO auto_campaign_logs(campaign_id,log) SELECT 3,'sparse campaign' FROM generate_series(1,1000)")
  await c.query('ANALYZE auto_campaign_logs')
  report.sparseReadPlan = await scalar(c, 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,log,created_at FROM auto_campaign_logs WHERE campaign_id=3 ORDER BY id DESC LIMIT 101')
  assert.match(JSON.stringify(report.sparseReadPlan), /idx_auto_campaign_logs_campaign_id_id/)
  await c.query('SET plan_cache_mode=force_custom_plan')
  await c.query('PREPARE history_page(bigint,bigint,integer) AS SELECT id,log,created_at FROM auto_campaign_logs WHERE campaign_id=$1 AND id<=coalesce($2-1,9223372036854775807::bigint) ORDER BY id DESC LIMIT $3')
  report.preparedReadPlan = await scalar(c, 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) EXECUTE history_page(3,90000,101)')
  assert.match(JSON.stringify(report.preparedReadPlan), /Index Cond.*campaign_id.*id <=/)
  await c.query('RESET plan_cache_mode')
  ok('100000-row history page uses campaign/id index')
  report.functions = (await c.query("SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef security,p.proconfig config,p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND (p.proname IN ('append_auto_campaign_log','aka_agent_desktop_campaign_detail','aka_agent_campaign_diagnostics_evidence','campaign_log_page','campaign_log_legacy','aka_agent_desktop_campaign_logs','aka_agent_control_campaign_logs')) ORDER BY 1")).rows
  const retained = await scalar(c, 'SELECT count(*) FROM auto_campaign_logs')
  await c.query(fs.readFileSync(path.join(root, 'migrations/snapshots/campaign-logs-v408/rollback.sql'), 'utf8'))
  assert.equal(await scalar(c, 'SELECT count(*) FROM auto_campaign_logs'), retained)
  for (const f of before) assert.equal(await scalar(c, 'SELECT md5(pg_get_functiondef(to_regprocedure($1)))', [f.signature]), f.md5)
  ok('rollback restores exact source RPC checksums and retains every new log')
  const output = path.join(root, 'docs/audits/campaign-logs-v408/local-sql.json')
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)+'\n')
  console.log(JSON.stringify({ checks: report.checks, benchmark: report.benchmark.map(({ explain, ...row }) => row), output }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  await Promise.allSettled(clients.map(c => c.end()))
  await Promise.allSettled(pools.map(pool => pool.end()))
  if (started) run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop'])
  fs.rmSync(dir, { recursive: true, force: true })
})
