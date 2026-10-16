// Isolated PostgreSQL only: no .env, Supabase connection or Zalo requests.
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const root = path.resolve(__dirname, '..'), bin = process.env.AKA_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-phone-daily-')), socket = path.join(dir, 'sock'), data = path.join(dir, 'data')
fs.mkdirSync(socket)
const args = ['-h', socket, '-p', '55487', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
const run = (name, argv, options = {}) => execFileSync(path.join(bin, name), argv, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], ...options })
const sql = query => run('psql', args, { input: query })
const rpc = (consume = true, account = 71, target = 'desktop', token = "'00000000-0000-4000-8000-000000000001'", auth = "'fixture','fixture'") => `public.aka_agent_zalo_phone_check_usage(7,9,${account},'${target}',${token},${consume},${auth})`
const call = (consume = true, account = 71, target = 'desktop', token, auth) => JSON.parse(sql(`SET ROLE anon; SELECT ${rpc(consume, account, target, token, auth)};`).trim().split('\n').at(-1))
let started = false
async function main() {
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale'])
    run('pg_ctl', ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-p 55487 -k ${socket} -c listen_addresses=`, 'start']); started = true
    const deps = JSON.parse(fs.readFileSync(path.join(root, 'migrations/snapshots/zalo-phone-check-daily-v407/live-dependencies.json')))
    const identity = deps.dependencies.find(d => d.signature.startsWith('auto_assert_automation_identity('))
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
      CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text PRIMARY KEY,schedule text,command text);
      CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job VALUES($1,$2,$3); SELECT 1::bigint$$;
      CREATE TABLE org_staff(id bigint PRIMARY KEY,organization_id bigint,is_active boolean,username text,password text);
      CREATE FUNCTION aka_agent_staff_time_allowed(bigint) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE TABLE auto_accounts(id bigint PRIMARY KEY,staff_id bigint,organization_id bigint,flatform_type text,is_delete boolean,
        is_active boolean,is_zalo_server boolean,is_zalo_show_web boolean,status text,login_status text,runtime_operation_claim_token uuid,updated_at timestamptz DEFAULT now());
      CREATE TABLE auto_system_settings(key text PRIMARY KEY,value text,description text,is_secret boolean,is_active boolean);
      CREATE TABLE test_capabilities(qr_enabled boolean,web_enabled boolean,server_enabled boolean);
      INSERT INTO test_capabilities VALUES(true,true,true);
      CREATE FUNCTION resolve_organization_zalo_account_capabilities(bigint) RETURNS TABLE(qr_enabled boolean,web_enabled boolean,server_enabled boolean)
        LANGUAGE sql AS $$SELECT * FROM test_capabilities$$;
      ${identity.definition};
      REVOKE ALL ON FUNCTION auto_assert_automation_identity(bigint,bigint,text,text) FROM PUBLIC;
      INSERT INTO org_staff VALUES(7,9,true,'fixture','fixture');
      INSERT INTO auto_accounts VALUES(71,7,9,'zalo',false,true,false,false,'đang chạy','đã đăng nhập','00000000-0000-4000-8000-000000000001',now());
      INSERT INTO auto_accounts SELECT 72,staff_id,organization_id,flatform_type,is_delete,is_active,true,false,status,login_status,runtime_operation_claim_token,updated_at FROM auto_accounts;
      INSERT INTO auto_accounts SELECT 73,staff_id,organization_id,flatform_type,is_delete,is_active,false,true,status,login_status,runtime_operation_claim_token,updated_at FROM auto_accounts WHERE id=71;`)
    const resolverHash = sql("SELECT md5(pg_get_functiondef('resolve_organization_zalo_account_capabilities(bigint)'::regprocedure));").trim()
    // Only the test capability resolver differs from live. Identity is exact live SQL.
    const migration = fs.readFileSync(path.join(root, 'migrations/migration_v407_zalo_phone_check_daily_limit.sql'), 'utf8')
      .replace(deps.baseline.dep.checksum, resolverHash)
    assert.throws(() => sql(`BEGIN; SET LOCAL cron.timezone='GMT'; ${migration.replace(identity.checksum, '00000000000000000000000000000000')} COMMIT;`), /dependencies_changed/)
    sql(`BEGIN; SET LOCAL cron.timezone='GMT'; ${migration} COMMIT;`)
    assert.equal(call(false).count, 0)
    assert.equal(sql('SELECT zalo_phone_check_usage IS NULL FROM auto_accounts WHERE id=71;').trim(), 't', 'read is non-mutating')
    assert.equal(call().count, 1)
    assert.equal(call(true,72,'server',undefined,'NULL,NULL').count, 1)
    assert.equal(call(true,73).count, 1)
    for (const q of [rpc(true,71,'desktop',undefined,'NULL,NULL'), rpc(true,71,'desktop',undefined,"'bad','bad'"),
      rpc(true,71,'desktop',"'00000000-0000-4000-8000-000000000002'"),rpc(true,72,'desktop'), rpc(true,71).replace('(7,9,','(7,10,'),rpc(true,71).replace('(7,9,','(8,9,')]) {
      assert.throws(() => sql(`SET ROLE anon; SELECT ${q};`), /phone_check_|automation_auth_/)
    }
    sql("UPDATE test_capabilities SET qr_enabled=false;")
    assert.throws(() => call(), /runtime_not_owner/)
    sql("UPDATE test_capabilities SET qr_enabled=true; UPDATE auto_accounts SET status='tạm dừng' WHERE id=71;")
    assert.throws(() => call(), /claim_invalid/)
    sql("UPDATE auto_accounts SET status='đang chạy' WHERE id=71;")
    const setCount = (count, dayOffset=0, id=71) => sql(`UPDATE auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',timezone('Asia/Ho_Chi_Minh',now())::date+${dayOffset},'count',${count}) WHERE id=${id};`)
    setCount(599)
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => promisify(execFile)(path.join(bin, 'psql'), [...args, '-c', `SET ROLE anon; SELECT ${rpc()};`], { encoding: 'utf8' })))
    const results = concurrent.map(r => JSON.parse(r.stdout.trim().split('\n').at(-1)))
    assert.equal(results.filter(r=>r.allowed).length,1); assert.ok(results.every(r=>r.count===600))
    setCount(600,-1); assert.equal(call().count,1)
    setCount(1,1); assert.throws(()=>call(),/date_in_future/)
    setCount(599); sql("UPDATE auto_system_settings SET value='3' WHERE key='zalo.phone_check.daily_limit';")
    assert.equal(call().allowed,false); assert.equal(call(false).limit,3)
    for (const bad of ['0','-1','1.5','wat','2147483648','999999999999999999999999']) {
      sql(`UPDATE auto_system_settings SET value='${bad}';`); assert.equal(call(false).limit,600)
    }
    sql("UPDATE auto_system_settings SET value='600',is_active=false;"); assert.equal(call(false).limit,600)
    sql("UPDATE auto_system_settings SET is_active=true;")
    const reset = sql("SELECT command FROM cron.job WHERE jobname='zalo_phone_check_usage_reset_daily';").trim()
    setCount(7,-1); setCount(0,-1,72); setCount(2,0,73)
    sql(reset)
    assert.equal(call(false).count,0); assert.equal(call(false,73).count,2)
    assert.equal(sql("SELECT zalo_phone_check_usage->>'date'= (timezone('Asia/Ho_Chi_Minh',now())::date-1)::text FROM auto_accounts WHERE id=72;").trim(),'t','zero stale rows untouched')
    // Both orders at the midnight boundary: lazy rollover first, then late cron;
    // or cron first, then a new reservation. Neither may erase today's usage.
    setCount(600,-1); assert.equal(call().count,1); sql(reset); assert.equal(call(false).count,1)
    setCount(600,-1); sql(reset); assert.equal(call().count,1)
    // Concurrent cron and reservation, both starting from yesterday's usage.
    setCount(600,-1)
    await Promise.all([reset,`SELECT ${rpc()};`].map(query=>promisify(execFile)(path.join(bin,'psql'),[...args,'-c',query],{encoding:'utf8'})))
    assert.equal(call(false).count,1)
    for (const bad of ["'{}'",`'{"date":"2026-10-16","count":null}'`,`'{"date":"2026-10-16","count":-1}'`,`'{"date":"2026-99-16","count":1}'`,`'{"date":"2026-10-16","count":1,"extra":1}'`]) {
      assert.throws(()=>sql(`UPDATE auto_accounts SET zalo_phone_check_usage=${bad}::jsonb WHERE id=71;`), /constraint|date/)
    }
    // A rollback restores the usage exactly, with no hidden side effects.
    const before=call(false).count; sql(`BEGIN; SELECT ${rpc()}; ROLLBACK;`); assert.equal(call(false).count,before)
    sql("INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type) SELECT generate_series(1000,8139),7,9,'zalo'; ANALYZE auto_accounts;")
    const plan=sql("EXPLAIN (ANALYZE,BUFFERS) SELECT zalo_phone_check_usage FROM auto_accounts WHERE id=71;")
    assert.match(plan,/Index Scan/)
    console.log(plan.trim())
    console.log(sql(`BEGIN; EXPLAIN (ANALYZE,BUFFERS) ${reset} ROLLBACK;`).trim())
    sql("UPDATE auto_accounts SET zalo_phone_check_usage=jsonb_build_object('date',timezone('Asia/Ho_Chi_Minh',now())::date-1,'count',600) WHERE id BETWEEN 1000 AND 1499;")
    console.log(sql(`BEGIN; EXPLAIN (ANALYZE,BUFFERS) ${reset} ROLLBACK;`).trim())
    console.log('PASS daily SQL: actual RPC/roles/auth/claims/subtypes, concurrent 599→600, settings, lazy/cron rollover, validation, rollback, PK lookup and 7,143-row reset plan')
  } finally {
    if (started) run('pg_ctl',['-D',data,'-m','fast','stop'])
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
