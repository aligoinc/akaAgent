// Disposable local PostgreSQL only; never reads production connection settings.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const root = path.resolve(__dirname, '..')
const pgBin = process.env.AKA_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const dir = fs.mkdtempSync('/tmp/akabiz-sms-pg-')
const data = path.join(dir, 'data')
const socket = path.join(dir, 'sock')
fs.mkdirSync(socket)
const run = (name, args, options = {}) => execFileSync(path.join(pgBin, name), args, { encoding: 'utf8', ...options })
const connection = ['-h', socket, '-p', '55487', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
const sql = input => run('psql', [...connection, '-At'], { input, stdio: ['pipe', 'pipe', 'pipe'] })
const signature = 'public.aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)'
const checksumSql = `SELECT md5(pg_get_functiondef('${signature}'::regprocedure));`
const v318 = process.argv.includes('--v318')
const version = v318 ? 'v318' : 'v317'
const source = v318 ? '2efe388f627258da23e79842b271a16f' : 'c901687095ea440ca53c90c9fe25b041'
const target = v318 ? '6ed7c94a13aa8d1644fa9bbb401f10b2' : '2efe388f627258da23e79842b271a16f'
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read(v318 ? 'migrations/migration_v318_sms_status_accept_existing_input.sql' : 'migrations/migration_v317_sms_deleted_campaign_status.sql')
const body = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const smoke = read(`migrations/tests/migration_${version}_sms_deleted_campaign_status_smoke.sql`).replace(/^BEGIN;$/m, '')
let started = false
async function main() {
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale'])
    run('pg_ctl', ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-p 55487 -k ${socket} -c listen_addresses=`, 'start'])
    started = true
    sql(read('scripts/fixtures/sms-deleted-campaign-postgres.sql'))
    sql(read('scripts/fixtures/sms-deleted-campaign-source.sql'))
    sql(read('scripts/fixtures/sms-due-input-source.sql'))
    sql(`GRANT EXECUTE ON FUNCTION ${signature} TO anon,authenticated,service_role;
      REVOKE ALL ON FUNCTION aka_agent_enqueue_group_only_automations() FROM PUBLIC;
      CREATE TRIGGER test_group_automation AFTER INSERT OR UPDATE OF status,action_code,is_delete
      ON auto_campaign_details FOR EACH ROW EXECUTE FUNCTION aka_agent_enqueue_group_only_automations();`)
    if (v318) sql(read('migrations/migration_v317_sms_deleted_campaign_status.sql'))
    assert.equal(sql(checksumSql).trim(), source, 'fixture matches production source')
    const catalog = `SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'owner',proowner,'security',prosecdef,'volatility',provolatile,'config',proconfig,'acl',proacl) ORDER BY oid::regprocedure::text) FROM pg_proc WHERE oid IN ('${signature}'::regprocedure,'aka_agent_enqueue_group_only_automations()'::regprocedure);`
    const before = sql(catalog).trim()
    const result = sql(`BEGIN;\n${body}\n${body}\n${smoke}`)
    assert.ok(result.includes(`${version} SMS status smoke PASS`))
    assert.equal(sql(checksumSql).trim(), source, 'DDL rollback restores source')
    assert.equal(sql('SELECT count(*) FROM auto_campaigns;').trim(), '0', 'fixtures rolled back')
    let rejected = false
    try { sql(`BEGIN;\n${body.replaceAll(source, '00000000000000000000000000000000')}\nROLLBACK;`) }
    catch (error) { rejected = String(error.stderr).includes(`${version}_definition_changed`) }
    assert.ok(rejected, 'unexpected source checksum rejected')
    rejected = false
    try { sql(`BEGIN; DROP FUNCTION ${signature};\n${body}\nROLLBACK;`) }
    catch (error) { rejected = String(error.stderr).includes(`${version}_definition_changed`) }
    assert.ok(rejected, 'missing source signature rejected')

    sql(migration)
    assert.equal(sql(checksumSql).trim(), target)
    assert.equal(sql(catalog).trim(), before, 'function owner/ACL/config/security preserved')
    assert.equal(sql("SELECT md5(pg_get_functiondef('aka_agent_enqueue_group_only_automations()'::regprocedure));").trim(), 'c6611cee9b1c40772bdb9e41234049de')
    sql(`INSERT INTO auto_campaigns(id,account_id,is_delete) VALUES(100,10,true),(101,11,false);
      INSERT INTO auto_campaign_input_data(id,campaign_id,status,phone,content) VALUES
      (100,100,'hoàn thành','0900000100','fixture'),(101,101,'chờ xử lý','0900000101','fixture');
      INSERT INTO auto_campaign_details(input_data_id,campaign_id,account_id,action_code,status,data)
      VALUES(100,100,10,'sms_send','đã gửi','{}');`)
    const execAsync = promisify(execFile)
    const invoke = (id, account, status) => execAsync(path.join(pgBin, 'psql'), [...connection, '-At', '-c',
      `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SELECT accepted FROM ${signature.split('(')[0]}(${id},${account},'${status}'); COMMIT;`], { encoding: 'utf8' })
    const results = await Promise.all([
      invoke(100,v318 ? 20 : 10,'đã nhận'), invoke(100,v318 ? 30 : 10,'thất bại'), invoke(100,10,'đã gửi'), invoke(100,v318 ? 40 : 10,'đã nhận'),
      invoke(101,11,'đã gửi'), invoke(101,11,'đã gửi'), invoke(101,11,'đã gửi')
    ])
    for (const result of results) assert.match(result.stdout, /\nt\n/)
    assert.equal(sql("SELECT status FROM auto_campaign_details WHERE input_data_id=100;").trim(), 'đã nhận')
    assert.equal(sql('SELECT count(*) FROM auto_campaign_details WHERE input_data_id=101;').trim(), '1')
    assert.equal(sql('SELECT value FROM test_counts WHERE account_id=11;').trim(), '1')
    assert.equal(sql('SELECT count(*) FROM test_counts WHERE account_id=10;').trim(), '0')
    console.log(`PASS ${version}: rollback + idempotent apply + checksum/missing guards + late sent/delivered/failed + account policy + quota + no resurrection + deleted fetch + automation isolation + normal flow + 7 concurrent calls`)
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop'])
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.stderr || error); process.exitCode = 1 })
