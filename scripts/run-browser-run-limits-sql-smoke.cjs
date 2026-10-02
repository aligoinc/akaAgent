// Isolated local PostgreSQL only; never uses .env, Supabase or production pools.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const fixture = path.join(__dirname, 'fixtures/browser-run-limits')
const pgBin = process.env.AKA_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-browser-limits-pg-'))
const data = path.join(dir, 'data'), socket = path.join(dir, 'sock')
fs.mkdirSync(socket)
const connection = ['-h', socket, '-p', '55440', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
const run = (name, args, options = {}) => execFileSync(path.join(pgBin, name), args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options })
const query = sql => run('psql', connection, { input: sql })
const parallelQuery = sql => new Promise((resolve, reject) => {
  const child = spawn(path.join(pgBin, 'psql'), connection)
  let out = '', err = ''
  child.stdout.on('data', b => { out += b }); child.stderr.on('data', b => { err += b })
  child.on('error', reject)
  child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)))
  child.stdin.end(sql)
})
const sources = JSON.parse(fs.readFileSync(path.join(fixture, 'live-source.json')))
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v340_browser_run_limits.sql'), 'utf8')
const body = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const seed = fs.readFileSync(path.join(fixture, 'seed.sql'), 'utf8')
const assertions = fs.readFileSync(path.join(fixture, 'assertions.sql'), 'utf8')
let started = false
async function main() {
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale'])
    run('pg_ctl', ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-p 55440 -k ${socket} -c listen_addresses=`, 'start']); started = true
    query(fs.readFileSync(path.join(fixture, 'schema.sql'), 'utf8'))
    for (const row of sources) {
      const signature = `public.${row.signature}`
      const grants = row.proacl.slice(1, -1).split(',').map(acl => {
        const role = acl.split('=')[0] || 'PUBLIC'
        return `GRANT EXECUTE ON FUNCTION ${signature} TO ${role};`
      }).join('\n')
      query(`${row.definition}; REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,postgres,anon,authenticated,service_role,aka_agent_chat_api; ${grants}`)
    }
    query(`CREATE TRIGGER claim_metadata BEFORE UPDATE ON auto_campaigns FOR EACH ROW EXECUTE FUNCTION aka_agent_clear_campaign_runtime_claim_metadata();
      CREATE TRIGGER operation_metadata BEFORE UPDATE ON auto_accounts FOR EACH ROW EXECUTE FUNCTION guard_auto_account_runtime_operation_claim_token();`)
    query(`BEGIN; ${body} ${seed} ${assertions} ROLLBACK;`)
    assert.equal(query("SELECT to_regprocedure('public.aka_agent_browser_run_limits(bigint,bigint,text,text,text,jsonb)') IS NULL;").trim(), 't')
    assert.equal(query('SELECT count(*) FROM auto_accounts;').trim(), '0')
    let rejected = false
    try { query(`BEGIN; ${body.replace('02038a74bbd1238f276dee3109ae21cf', '00000000000000000000000000000000')} ROLLBACK;`) } catch (e) { rejected = /v340_source_drift/.test(String(e.stderr)) }
    assert(rejected, 'checksum drift must fail closed')
    query(migration)
    query(seed)
    query('UPDATE org_staff SET max_running_facebook_accounts=1 WHERE id=34001;')
    const a = "BEGIN; SET LOCAL ROLE anon; SELECT public.claim_campaign_runtime(1,1,34001,'desktop'); SELECT pg_sleep(0.15); COMMIT;"
    const b = "BEGIN; SET LOCAL ROLE anon; SELECT ok::text FROM public.aka_agent_claim_campaign_runtime_v2(2,2,34001,'desktop','34000000-0000-4000-8000-000000000002'); SELECT pg_sleep(0.15); COMMIT;"
    const results = await Promise.all([parallelQuery(a), parallelQuery(b)])
    assert.equal(results.filter(x => x === 't' || x === 'true').length, 1, `one winner: ${results}`)
    assert.equal(query("SELECT count(DISTINCT account_id) FROM auto_campaigns WHERE status='đang chạy';").trim(), '1')
    // Settings save cannot cross a claim's staff SHARE lock.
    const held = parallelQuery("BEGIN; SELECT id FROM org_staff WHERE id=34001 FOR SHARE; SELECT pg_sleep(0.3); COMMIT;")
    const saved = parallelQuery("SELECT public.aka_agent_browser_run_limits(34001,340,'fixture-a','fixture-password','save','{\"facebookMax\":2,\"zaloWebMax\":null,\"revision\":0}')->>'ok';")
    await held; assert.equal(await saved, 'true')
    const target = query("SELECT jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'checksum',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'prosecdef',prosecdef,'provolatile',provolatile,'proconfig',proconfig,'proacl',proacl::text)) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('claim_campaign_runtime','aka_agent_claim_campaign_runtime_v2','aka_agent_claim_campaign_runtime_checked','aka_agent_browser_run_limits');")
    fs.writeFileSync(path.join(fixture, 'expected-target.json'), JSON.stringify(JSON.parse(target), null, 2) + '\n')
    const plan = query("EXPLAIN SELECT count(DISTINCT c.account_id) FROM auto_campaigns c JOIN auto_accounts a ON a.id=c.account_id AND a.staff_id=c.staff_id WHERE c.staff_id=34001 AND a.flatform_type='facebook' AND (c.status='đang chạy' OR c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL);")
    assert.match(plan, /auto_campaigns_staff_id_idx/, 'existing tenant index used')
    console.log('PASS v340: rollback; auth/tenant/CAS/validation; independent caps; distinct accounts; legacy+v2; retry; pause/unit cleanup; lowering/unlimited; preserved guards; two concurrent sessions/one slot; existing staff index.')
  } catch (e) {
    if (e.stderr) console.error(String(e.stderr))
    throw e
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop'])
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
