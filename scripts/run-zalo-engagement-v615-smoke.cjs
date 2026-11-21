// V615 smoke, on a private PostgreSQL 17 (LC_ALL=C):
//   V339 -> V341 -> V510 -> V524 (must equal production) -> the V524 body ignores 'friend_rejected' events without error
//   -> V615 -> reapply refused -> rollback to the exact V524 body (column dropped) -> second rollback refused -> V615 again;
//   only the six rejection lines differ from V524; the original engagement assertions still pass; V615 scenarios
//   (scripts/fixtures/zalo-engagement/friend_rejected_v615.sql).
// Usage: node scripts/run-zalo-engagement-v615-smoke.cjs   (PG_BIN overrides the PostgreSQL 17 bin dir)
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const pgBin = process.env.PG_BIN || ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(dir => fs.existsSync(path.join(dir, 'initdb')))
if (!pgBin) throw new Error('PostgreSQL 17 not found; set PG_BIN')
const bin = name => path.join(pgBin, name)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-v615-'))
const env = { ...process.env, LC_ALL: 'C' }
const run = (name, args, extra = {}) => { const r = spawnSync(name, args, { encoding: 'utf8', env, maxBuffer: 64 << 20, ...extra }); if (r.status !== 0) throw new Error(`${name} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r.stdout }
const MIGRATION = 'migrations/migration_v615_zalo_engagement_friend_rejected.sql'
const ROLLBACK = 'migrations/rollback_v615_zalo_engagement_friend_rejected.sql'
const build = require('./build-v615-sql.cjs')
const signature = "'public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'::regprocedure"
let started = false
try {
  run(bin('initdb'), ['-D', path.join(dir, 'db'), '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C'])
  run(bin('pg_ctl'), ['-D', path.join(dir, 'db'), '-l', path.join(dir, 'postgres.log'), '-o', `-h '' -k ${dir} -p 55491 -c max_connections=10`, '-w', 'start']); started = true
  const args = db => ['-X', '-q', '-h', dir, '-p', '55491', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1']
  const psqlFile = file => run(bin('psql'), [...args('postgres'), '-f', file])
  const psqlInput = sql => run(bin('psql'), [...args('postgres'), '-At', '-f', '-'], { input: sql })
  const psqlValue = sql => run(bin('psql'), [...args('postgres'), '-Atc', sql]).trim()
  const refused = (file, pattern) => {
    const r = spawnSync(bin('psql'), [...args('postgres'), '-f', file], { encoding: 'utf8', env })
    assert.notEqual(r.status, 0, `${file} must refuse to run here`); assert.match(r.stderr, pattern)
  }
  const fingerprint = () => psqlValue(`SELECT md5(prosrc)||' '||md5(pg_get_functiondef(${signature})) FROM pg_proc WHERE oid=${signature}`)
  const hasColumn = () => psqlValue(`SELECT count(*) FROM pg_attribute WHERE attrelid='public.auto_campaign_detail_zalo_engagement'::regclass AND attname='rejected_at' AND NOT attisdropped`)
  for (const file of ['scripts/fixtures/zalo-engagement/schema.sql', 'migrations/migration_v339_zalo_campaign_engagement.sql',
    'migrations/migration_v341_zalo_engagement_chat_registration.sql', 'migrations/migration_v510_zalo_engagement_id_driven_lookups.sql',
    'migrations/migration_v524_zalo_engagement_catalog_ordered_walk.sql']) psqlFile(file)
  assert.equal(fingerprint(), `${build.LIVE.src} ${build.LIVE.def}`, 'local V524 must match production before V615')

  // Runtime shipped before the DB: the V524 body ignores the new kind (no error, nothing updated).
  const oldBody = psqlInput(`BEGIN;
INSERT INTO org_staff VALUES(1,1,true,'owner','password'); INSERT INTO zalo_accounts VALUES(1,'sender');
INSERT INTO auto_accounts(id,staff_id,organization_id,zalo_account_id) VALUES(1,1,1,1); INSERT INTO auto_campaigns VALUES(1,1,1);
UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled';
INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,action_name,status,data) SELECT 1,1,1,'zalo_add_friend','Kết bạn','thành công',
  jsonb_build_object('zaloEngagementSource',jsonb_build_object('version',1,'revision',updated_at::text,'accountZaloUid','sender','targetZaloUid','r1','actionType','friend_request','sentAt','2026-01-01T00:00:00Z','messageIds','[]'::jsonb))
  FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled';
SELECT aka_agent_register_campaign_engagement(1,1,(SELECT updated_at::text FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled'),'[{"detailId":"1"}]','owner','password') IS NOT NULL;
SELECT aka_agent_record_campaign_engagement(1,1,(SELECT updated_at::text FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled'),
  '[{"accountId":"1","accountZaloUid":"sender","targetZaloUid":"r1","kind":"friend_rejected","occurredAt":"2026-01-01T01:00:00Z","messageIds":[]}]','owner','password')->>'updated';
ROLLBACK;`).trim().split('\n').filter(Boolean).pop()
  assert.equal(oldBody, '0', 'V524 body must ignore friend_rejected without error')
  console.log('PASS V524 body ignores friend_rejected events (updated 0, no error)')

  psqlFile(MIGRATION)
  assert.equal(fingerprint(), `${build.NEW.src} ${build.NEW.def}`); assert.equal(hasColumn(), '1')
  refused(MIGRATION, /v615 engagement batch drift \(expected V524 body\)/)
  psqlFile(ROLLBACK)
  assert.equal(fingerprint(), `${build.LIVE.src} ${build.LIVE.def}`, 'rollback must restore the exact V524 body'); assert.equal(hasColumn(), '0')
  refused(ROLLBACK, /rollback v615: function is not the V615 body/)
  psqlFile(MIGRATION)
  assert.equal(psqlValue(`SELECT pg_get_userbyid(proowner)||' '||prosecdef||' '||provolatile::text||' '||proconfig::text||' '||proacl::text FROM pg_proc WHERE oid=${signature}`),
    'postgres true v {"search_path=pg_catalog, public",statement_timeout=15s} {postgres=X/postgres}')
  // md5 above proves the body equals the generator output; every changed line is about the rejection mark.
  const body = psqlValue(`SELECT prosrc FROM pg_proc WHERE oid=${signature}`)
  const v524Body = /AS \$function\$([\s\S]*)\$function\$\n;\n$/.exec(build.oldBlock)[1]
  const oldLines = new Set(v524Body.split('\n').filter(Boolean)), newLines = new Set(body.split('\n').filter(Boolean))
  const added = [...newLines].filter(line => !oldLines.has(line)), removed = [...oldLines].filter(line => !newLines.has(line))
  for (const line of added) assert.match(line, /rejected|-- v615:|friended,$|friended_at IS NULL OR [^\n]*\) OR$/, `unexpected added line: ${line}`)
  for (const line of removed) assert.match(line, /friended/, `unexpected removed line: ${line}`)
  assert.equal(added.length, 13); assert.equal(removed.length, 6)
  console.log(`PASS V615 apply/refuse/rollback/refuse/apply; md5(prosrc) ${build.NEW.src}; only rejection lines added to V524`)

  psqlFile('scripts/fixtures/zalo-engagement/assertions.sql')
  console.log('PASS original engagement assertions (scripts/fixtures/zalo-engagement/assertions.sql)')
  psqlFile('scripts/fixtures/zalo-engagement/friend_rejected_v615.sql')
  console.log('PASS V615 scenarios: record, earliest wins, window, message watch untouched, friend unchanged, list page field, Chat reconciliation')
  console.log('V615 smoke OK')
} finally {
  if (started) spawnSync(bin('pg_ctl'), ['-D', path.join(dir, 'db'), '-m', 'immediate', 'stop'], { env })
  fs.rmSync(dir, { recursive: true, force: true })
}
