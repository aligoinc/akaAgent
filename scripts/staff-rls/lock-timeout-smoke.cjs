// Isolated PostgreSQL: reproduce the regression and compare caller timeout semantics.
// Never connects to Supabase or uses customer data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const receiptDir = path.join(root, 'migrations/snapshots/staff-runtime-lock-timeout')
const source = JSON.parse(fs.readFileSync(path.join(receiptDir, 'source.json'))).functions[0]
const target = JSON.parse(fs.readFileSync(path.join(receiptDir, 'target.json')))
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027083342_staff_runtime_inherit_lock_timeout.sql'), 'utf8')
const rollback = fs.readFileSync(path.join(receiptDir, 'rollback.sql'), 'utf8')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-lock-timeout-'))
const args = ['-X', '-h', tmp, '-p', '55479', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq']
const q = value => "'" + value.replaceAll("'", "''") + "'"
let started = false
let checks = 0
const observations = []
function run(command, parameters, input) {
  const result = spawnSync(command, parameters, { input, encoding: 'utf8', timeout: 20000 })
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || result.stdout)
  return result.stdout
}
const sql = input => run('psql', args, input)
const metadata = () => JSON.parse(sql(`SELECT json_build_object('signature',oid::regprocedure::text,'definition',pg_get_functiondef(oid),'checksum',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,'proconfig',proconfig,'proacl',proacl::text) FROM pg_proc WHERE oid='public.aka_agent_staff_runtime_scope(bigint,text)'::regprocedure;`))
function matches(expected) { assert.deepEqual(metadata(), expected); checks++ }
function rejected(input, expected) {
  const result = spawnSync('psql', args, { input, encoding: 'utf8', timeout: 20000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, expected)
  checks++
}
async function contested(mode, route, holdSeconds = 4.2, lockTimeout = '8s', statementTimeout = '8s') {
  const holder = spawn('psql', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = '', stdout = ''
  holder.stderr.on('data', data => { stderr += data })
  const done = new Promise((resolve, reject) => {
    holder.on('error', reject)
    holder.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)))
  })
  const ready = new Promise((resolve, reject) => {
    holder.stdout.on('data', data => { stdout += data; if (stdout.includes('LOCKED')) resolve() })
    holder.on('error', reject)
    holder.on('close', () => { if (!stdout.includes('LOCKED')) reject(new Error(stderr || 'holder exited before lock')) })
  })
  holder.stdin.end(`BEGIN; SELECT id FROM org_staff WHERE id=1 FOR UPDATE; SELECT 'LOCKED'; SELECT pg_sleep(${holdSeconds}); ROLLBACK;`)
  await ready
  const query = route === 'direct'
    ? `SELECT id FROM org_staff WHERE id=1 FOR ${mode.toUpperCase()};`
    : `SELECT id FROM aka_agent_staff_runtime_scope(1,${q(mode)});`
  const start = Date.now()
  const result = spawnSync('psql', args, {
    input: `SET ROLE anon; SET statement_timeout=${q(statementTimeout)}; SET lock_timeout=${q(lockTimeout)}; ${query}`,
    encoding: 'utf8', timeout: 15000
  })
  const observation = {
    mode, route, holdSeconds, lockTimeout, statementTimeout, elapsedMs: Date.now() - start,
    success: result.status === 0, lockError: /55P03/.test(result.stderr), statementError: /57014/.test(result.stderr)
  }
  await done
  observations.push(observation)
  return observation
}
async function main() {
  try {
    run('initdb', ['-D', path.join(tmp, 'db'), '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C'])
    run('pg_ctl', ['-D', path.join(tmp, 'db'), '-l', path.join(tmp, 'server.log'), '-o', `-h '' -k ${tmp} -p 55479`, '-w', 'start'])
    started = true
    const serverVersion = sql('SHOW server_version;').trim()
    const major = Math.floor(Number(sql('SHOW server_version_num;')) / 10000)
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE org_staff(id bigint PRIMARY KEY,organization_id bigint,name text,phone text,username text,is_active boolean,is_admin boolean,is_admin_akabiz boolean,use_test_workflow boolean,deleted_at timestamptz,expiration_date timestamptz,max_running_zalo_web_accounts integer,max_running_facebook_accounts integer);
      INSERT INTO org_staff(id,organization_id,name,is_active) VALUES(1,1,'local fixture',true);
      GRANT ALL ON org_staff TO anon,authenticated;
      CREATE VIEW aka_agent_staff_runtime_profile WITH (security_barrier=true) AS SELECT * FROM org_staff;
      GRANT SELECT ON aka_agent_staff_runtime_profile TO anon,authenticated,service_role;
      ${source.definition};
      REVOKE ALL ON FUNCTION aka_agent_staff_runtime_scope(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION aka_agent_staff_runtime_scope(bigint,text) TO anon,authenticated,service_role;`)
    matches(source)
    const protectionSql = "SELECT json_build_object('rls',relrowsecurity,'acl',relacl::text) FROM pg_class WHERE oid='org_staff'::regclass;"
    const beforeProtection = sql(protectionSql)
    const beforeProfile = sql("SET ROLE anon; SELECT row_to_json(x) FROM aka_agent_staff_runtime_scope(1,'share') x;")
    for (const alteration of [
      "ALTER FUNCTION aka_agent_staff_runtime_scope(bigint,text) SET lock_timeout='7s';",
      "REVOKE EXECUTE ON FUNCTION aka_agent_staff_runtime_scope(bigint,text) FROM anon;",
      source.definition.replace('staff_runtime_scope_invalid', 'changed_guard') + ';'
    ]) {
      rejected('BEGIN;\n' + alteration + '\n' + migration, /source drift/)
      matches(source)
    }
    rejected('BEGIN; DROP FUNCTION aka_agent_staff_runtime_scope(bigint,text);\n' + migration, /source drift/)
    matches(source)
    sql(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    matches(source)
    for (const mode of ['share', 'update']) {
      const direct = await contested(mode, 'direct')
      const oldHelper = await contested(mode, 'helper-before')
      assert(direct.success)
      assert(!oldHelper.success && oldHelper.lockError)
      checks += 2
    }
    sql(migration)
    matches(target)
    assert.equal(sql(protectionSql), beforeProtection)
    assert.equal(sql("SET ROLE anon; SELECT row_to_json(x) FROM aka_agent_staff_runtime_scope(1,'share') x;"), beforeProfile)
    checks += 2
    rejected(migration, /source drift/)
    for (const mode of ['share', 'update']) {
      assert((await contested(mode, 'helper-after')).success)
      checks++
      for (const route of ['direct', 'helper-after']) {
        const shortLock = await contested(mode, route, 0.4, '100ms')
        assert(!shortLock.success && shortLock.lockError)
        const shortStatement = await contested(mode, route, 0.4, '8s', '100ms')
        assert(!shortStatement.success && shortStatement.statementError)
        checks += 2
      }
    }
    rejected("SET ROLE anon; SELECT * FROM aka_agent_staff_runtime_scope(1,'invalid');", /staff_runtime_scope_invalid/)
    rejected("SET ROLE anon; SELECT * FROM aka_agent_staff_runtime_scope(NULL,'share');", /staff_runtime_scope_invalid/)
    assert.equal(sql("SET ROLE anon; SELECT count(*) FROM aka_agent_staff_runtime_scope(99,'share');").trim(), '0')
    checks++
    sql(rollback)
    matches(source)
    sql(migration)
    matches(target)
    const receipt = { serverVersion, checks, sourceChecksum: source.checksum, targetChecksum: target.checksum, productionChanged: false, observations }
    fs.writeFileSync(path.join(receiptDir, `timeout-verification-pg${major}.json`), JSON.stringify(receipt, null, 2) + '\n')
    console.log(JSON.stringify({ serverVersion, checks, sourceChecksum: source.checksum, targetChecksum: target.checksum, productionChanged: false }))
  } finally {
    if (started) run('pg_ctl', ['-D', path.join(tmp, 'db'), '-m', 'immediate', '-w', 'stop'])
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
