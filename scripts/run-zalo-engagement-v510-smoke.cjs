// V510 smoke: v339 -> v341 -> scale check (old body) -> V510 -> scale check (new body)
// -> original SQL assertions -> registration/ACK race smoke, on a private PostgreSQL 17.
// Usage: node scripts/run-zalo-engagement-v510-smoke.cjs   (PG_BIN overrides the PostgreSQL 17 bin dir)
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const pgBin = process.env.PG_BIN || ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(dir => fs.existsSync(path.join(dir, 'initdb')))
if (!pgBin) throw new Error('PostgreSQL 17 not found; set PG_BIN')
const bin = name => path.join(pgBin, name)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-pg-'))
// macOS: the postmaster refuses to start ("became multithreaded during startup") without a valid LC_ALL.
const env = { ...process.env, LC_ALL: 'C' }
const run = (name, args, extra = {}) => { const r = spawnSync(name, args, { encoding: 'utf8', env, ...extra }); if (r.status !== 0) throw new Error(`${name} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r.stdout }
const LIVE_V341_MD5 = '2bacb504c895ea6efd6a1d9b68d6e213'
let started = false
try {
  run(bin('initdb'), ['-D', path.join(dir, 'db'), '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C'])
  run(bin('pg_ctl'), ['-D', path.join(dir, 'db'), '-l', path.join(dir, 'postgres.log'), '-o', `-h '' -k ${dir} -p 55489 -c max_connections=10`, '-w', 'start']); started = true
  const args = ['-X', '-q', '-h', dir, '-p', '55489', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
  const psqlFile = file => run(bin('psql'), [...args, '-f', file])
  const psqlValue = sql => run(bin('psql'), [...args, '-Atc', sql]).trim()
  for (const file of ['scripts/fixtures/zalo-engagement/schema.sql', 'migrations/migration_v339_zalo_campaign_engagement.sql',
    'migrations/migration_v341_zalo_engagement_chat_registration.sql']) psqlFile(file)
  const signature = "'public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'::regprocedure"
  assert.equal(psqlValue(`SELECT md5(pg_get_functiondef(${signature}))`), LIVE_V341_MD5, 'local v341 body must match production before V510')

  const scale = () => JSON.parse(run(bin('psql'), [...args, '-At', '-f', 'scripts/fixtures/zalo-engagement/scale_v510.sql']).trim().split('\n').filter(Boolean).pop())
  const before = scale()
  psqlFile('migrations/migration_v510_zalo_engagement_id_driven_lookups.sql')
  const after = scale()
  // Reapplying must be refused by the preflight (body no longer the v341 one).
  const again = spawnSync(bin('psql'), [...args, '-f', 'migrations/migration_v510_zalo_engagement_id_driven_lookups.sql'], { encoding: 'utf8', env })
  assert.notEqual(again.status, 0, 'V510 must refuse to reapply'); assert.match(again.stderr, /v510 engagement batch drift/)
  // Rollback restores the exact v341 body and drops the statistics; then V510 applies again.
  psqlFile('migrations/rollback_v510_zalo_engagement_id_driven_lookups.sql')
  assert.equal(psqlValue(`SELECT md5(pg_get_functiondef(${signature}))`), LIVE_V341_MD5, 'rollback must restore the v341 body')
  assert.equal(psqlValue("SELECT count(*) FROM pg_statistic_ext WHERE stxname='auto_campaign_engagement_owner_stats'"), '0')
  const rollbackAgain = spawnSync(bin('psql'), [...args, '-f', 'migrations/rollback_v510_zalo_engagement_id_driven_lookups.sql'], { encoding: 'utf8', env })
  assert.notEqual(rollbackAgain.status, 0, 'rollback must refuse to run twice')
  psqlFile('migrations/migration_v510_zalo_engagement_id_driven_lookups.sql')

  const worst = (result, step, key) => Math.max(...result.calls.filter(c => c.step === step).map(c => c[key]))
  const summary = {}
  for (const step of ['register', 'events', 'recovery']) for (const key of ['details', 'watches', 'campaigns'])
    summary[`${step}.${key}`] = { v341: worst(before, step, key), v510: worst(after, step, key) }
  console.log(JSON.stringify({ v341Md5: before.function_md5, v510Md5: after.function_md5, worstRowsReadPerCall: summary }, null, 1))
  // One call touches a handful of rows, never the staff's 70k results / 50k watches / 40 campaigns.
  for (const [name, value] of Object.entries(summary)) assert.ok(value.v510 <= 50, `${name} read ${value.v510} rows per call after V510`)

  psqlFile('scripts/fixtures/zalo-engagement/assertions.sql')
  // The race smoke rewrites the v339 audit artifact; keep the committed copy untouched.
  const auditPlan = 'docs/audits/zalo-engagement/catalog-plan.json', auditPlanBefore = fs.readFileSync(auditPlan)
  try { console.log(run(process.execPath, ['scripts/zalo-campaign-engagement-race-smoke.cjs', dir], { timeout: 30000 }).trim()) }
  finally { fs.writeFileSync(auditPlan, auditPlanBefore) }
  console.log('V510 smoke OK')
} finally {
  if (started) run(bin('pg_ctl'), ['-D', path.join(dir, 'db'), '-m', 'immediate', 'stop'])
  fs.rmSync(dir, { recursive: true, force: true })
}
