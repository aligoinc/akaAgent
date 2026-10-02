// Explicit linked-project migration runner; uses existing Supabase CLI HTTP path.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const ref = 'cgjbsmqtfhqvttudyjzq'
const fixture = path.join(__dirname, 'fixtures/browser-run-limits')
const sources = JSON.parse(fs.readFileSync(path.join(fixture, 'live-source.json')))
const target = JSON.parse(fs.readFileSync(path.join(fixture, 'expected-target.json')))
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v340_browser_run_limits.sql'), 'utf8')
const names = ['claim_campaign_runtime', 'aka_agent_claim_campaign_runtime_v2', 'aka_agent_claim_campaign_runtime_checked', 'aka_agent_browser_run_limits']
const metadata = `SELECT oid::regprocedure::text AS signature,md5(pg_get_functiondef(oid)) AS checksum,pg_get_userbyid(proowner) AS owner,prosecdef,provolatile::text,proconfig,proacl::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (${names.map(x => `'${x}'`).join(',')}) ORDER BY 1;`
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const text = execFileSync('supabase', ['db', 'query', '--linked', sql], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000, stdio: ['ignore','pipe','pipe'] })
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).rows
}
const attributes = row => Object.fromEntries(['signature','checksum','owner','prosecdef','provolatile','proconfig','proacl'].map(key => [key, row[key]]))
function compare(rows, expected) {
  assert.equal(rows.length, expected.length)
  for (const row of expected) assert.deepEqual(attributes(rows.find(x => x.signature === row.signature) || {}), attributes(row), row.signature)
}
const smoke = `DO $smoke$
DECLARE r record;
BEGIN
  IF public.claim_campaign_runtime(9000000340001,9000000340001,9000000340001,'desktop') THEN RAISE EXCEPTION 'v340_invalid_owner_claimed'; END IF;
  SELECT * INTO r FROM public.aka_agent_claim_campaign_runtime_v2(9000000340001,9000000340001,9000000340001,'desktop','34000000-0000-4000-8000-000000000099');
  IF r.ok OR r.reason <> 'not_found' THEN RAISE EXCEPTION 'v340_invalid_owner_v2'; END IF;
  BEGIN
    PERFORM public.aka_agent_browser_run_limits(9000000340001,9000000340001,NULL,NULL,'get');
    RAISE EXCEPTION 'v340_missing_credentials_accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT IN ('automation_auth_required','automation_auth_invalid','browser_run_limits_access_denied') THEN RAISE; END IF;
  END;
END;
$smoke$;`
async function apiVerify() {
  const source = fs.readFileSync(path.join(root, 'src/main/data/supabaseClient.ts'), 'utf8')
  const key = source.match(/const SUPABASE_ANON_KEY = [^\n]*\|\| '([^']+)'/)[1]
  const request = async (rpc, body) => {
    const response = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    return { status: response.status, data: await response.json() }
  }
  const settings = await request('aka_agent_browser_run_limits', { p_staff_id: 9000000340001, p_organization_id: 9000000340001, p_auth_username: null, p_auth_password: null, p_action: 'get' })
  assert.equal(settings.data.code, 'P0001', `settings RPC schema/auth: HTTP ${settings.status}, ${settings.data.code}`)
  assert.equal(settings.data.message, 'automation_auth_required')
  const claim = await request('aka_agent_claim_campaign_runtime_v2', { p_campaign_id: 9000000340001, p_account_id: 9000000340001, p_staff_id: 9000000340001, p_runtime_target: 'desktop', p_runtime_claim_token: '34000000-0000-4000-8000-000000000099' })
  assert.equal(claim.status, 200); assert.equal(claim.data[0].ok, false); assert.equal(claim.data[0].reason, 'not_found')
  console.log('PASS PostgREST: new settings RPC rejects missing credentials; v2 RPC returns not_found without writes')
}
async function main() {
  const mode = process.argv[2]
  if (mode === 'api') {
    await apiVerify()
  } else if (mode === 'smoke') {
    compare(query(metadata), sources.filter(x => names.includes(x.signature.split('(')[0])))
    const result = query(migration.replace(/COMMIT;\s*$/, `${smoke}\n${metadata}\nROLLBACK;`))
    compare(result, target)
    compare(query(metadata), sources.filter(x => names.includes(x.signature.split('(')[0])))
    console.log('PASS production rollback: v340 compiled, target checksums/attributes match, invalid identities rejected, original definitions restored')
  } else if (mode === 'apply') {
    const existing = query("SELECT version FROM supabase_migrations.schema_migrations WHERE name='migration_v340_browser_run_limits';")
    assert.equal(existing.length, 0, 'v340 already applied; use verify')
    const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(to_char(timezone('UTC',clock_timestamp()),'YYYYMMDDHH24MISS'),'migration_v340_browser_run_limits',ARRAY[$history_v340$${migration}$history_v340$]::text[]);`
    const result = query(migration.replace(/COMMIT;\s*$/, `${smoke}\n${history}\n${metadata}\nCOMMIT;`))
    compare(result, target)
    console.log('Applied v340 to linked akachat; checksums/attributes match')
    await apiVerify()
  } else if (mode === 'verify') {
    compare(query(metadata), target)
    const rows = query(`BEGIN; SET LOCAL statement_timeout='10s'; ${smoke}\nSELECT version,name FROM supabase_migrations.schema_migrations WHERE name='migration_v340_browser_run_limits'; ROLLBACK;`)
    console.log(JSON.stringify(rows)); await apiVerify()
  } else throw Error('Use smoke | apply | verify | api')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
