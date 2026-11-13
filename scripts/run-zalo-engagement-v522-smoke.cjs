// V522 smoke, on a private PostgreSQL 17 (LC_ALL=C):
//   V339 -> V341 -> V510 (must equal the production body) -> V522 -> reapply refused -> rollback
//   to the exact V510 body -> second rollback refused -> V522 again; every branch except the
//   catalog SELECT byte-identical to V510; original SQL assertions + V510 scale check;
//   catalog equivalence V510 vs V522 page by page (catalog_v522_equivalence.sql); a
//   production-sized owner measured before/after, custom and generic plans (catalog_v522_*).
// Usage: node scripts/run-zalo-engagement-v522-smoke.cjs   (PG_BIN overrides the PostgreSQL 17 bin dir)
const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const assert = require('node:assert/strict')
const pgBin = process.env.PG_BIN || ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(dir => fs.existsSync(path.join(dir, 'initdb')))
if (!pgBin) throw new Error('PostgreSQL 17 not found; set PG_BIN')
const bin = name => path.join(pgBin, name)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-pg-'))
// macOS: the postmaster refuses to start ("became multithreaded during startup") without a valid LC_ALL.
const env = { ...process.env, LC_ALL: 'C' }
const run = (name, args, extra = {}) => { const r = spawnSync(name, args, { encoding: 'utf8', env, maxBuffer: 64 << 20, ...extra }); if (r.status !== 0) throw new Error(`${name} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r.stdout }
const MIGRATION = 'migrations/migration_v522_zalo_engagement_catalog_ordered_walk.sql'
const ROLLBACK = 'migrations/rollback_v522_zalo_engagement_catalog_ordered_walk.sql'
const V510 = 'migrations/migration_v510_zalo_engagement_id_driven_lookups.sql'
// Production (akachat) after V510, read 13/11/2026.
const LIVE_V510_PROSRC_MD5 = 'dd6cf2bd1f75998521d98ee46d8fff0e', LIVE_V510_DEF_MD5 = '6b40a8b7b51490287f7b39cb6b3c62ba'
const V522_PROSRC_MD5 = fs.readFileSync(MIGRATION, 'utf8').match(/md5\(prosrc\)='([0-9a-f]{32})'/)[1]
const signature = "'public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'::regprocedure"
// The V510 body under another name, so both bodies run in the same transaction (same now()).
const v510Text = fs.readFileSync(V510, 'utf8')
const fnStart = v510Text.indexOf('CREATE OR REPLACE FUNCTION public.aka_agent_campaign_engagement_batch(')
const fnEnd = v510Text.indexOf('$function$\n;\n', fnStart) + '$function$\n;\n'.length
const referenceFunction = v510Text.slice(fnStart, fnEnd).replace('FUNCTION public.aka_agent_campaign_engagement_batch(', 'FUNCTION public.zalo_engagement_batch_v510_ref(')
// PREPARE q510/q522 = the catalog SELECT of each migration, PL/pgSQL variables as parameters.
const prepare = (file, name) => {
  const text = fs.readFileSync(file, 'utf8'), branch = text.indexOf("p_items->0 ? 'catalog' THEN")
  const start = text.indexOf('   SELECT COALESCE(jsonb_agg(to_jsonb(w)', branch), end = text.indexOf('   ) w;', start) + '   ) w'.length
  assert.ok(branch > 0 && start > branch && end > start, `catalog SELECT not found in ${file}`)
  return `PREPARE ${name}(bigint,bigint,timestamptz,timestamptz,bigint) AS\n` + text.slice(start, end).replace(' INTO v_result', '')
    .replaceAll('p_staff_id', '$1').replaceAll('p_organization_id', '$2').replaceAll('v_catalog_from', '$3')
    .replaceAll('v_catalog_until', '$4').replaceAll('v_catalog_id', '$5') + ';\n'
}
let started = false
try {
  run(bin('initdb'), ['-D', path.join(dir, 'db'), '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--locale=C'])
  // Production planner costs (akachat: random_page_cost 1.1, effective_cache_size 24 GB, work_mem 20 MB, jit off).
  run(bin('pg_ctl'), ['-D', path.join(dir, 'db'), '-l', path.join(dir, 'postgres.log'), '-o',
    `-h '' -k ${dir} -p 55489 -c max_connections=10 -c shared_buffers=512MB -c random_page_cost=1.1 -c effective_cache_size=24GB -c work_mem=20MB -c jit=off`, '-w', 'start']); started = true
  const args = db => ['-X', '-q', '-h', dir, '-p', '55489', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1']
  const psqlFile = (file, db = 'postgres') => run(bin('psql'), [...args(db), '-f', file])
  const psqlInput = (sql, db = 'postgres') => run(bin('psql'), [...args(db), '-At', '-f', '-'], { input: sql })
  const psqlValue = (sql, db = 'postgres') => run(bin('psql'), [...args(db), '-Atc', sql]).trim()
  const lastJson = out => JSON.parse(out.trim().split('\n').filter(Boolean).pop())
  const refused = (file, pattern) => {
    const r = spawnSync(bin('psql'), [...args('postgres'), '-f', file], { encoding: 'utf8', env })
    assert.notEqual(r.status, 0, `${file} must refuse to run here`); assert.match(r.stderr, pattern)
  }
  const bodyOf = (fn, db = 'postgres') => psqlValue(`SELECT prosrc FROM pg_proc WHERE oid='${fn}'::regprocedure`, db)
  const schema = fs.readFileSync('scripts/fixtures/zalo-engagement/schema.sql', 'utf8')
  for (const file of ['scripts/fixtures/zalo-engagement/schema.sql', 'migrations/migration_v339_zalo_campaign_engagement.sql',
    'migrations/migration_v341_zalo_engagement_chat_registration.sql', V510]) psqlFile(file)
  assert.equal(psqlValue(`SELECT md5(prosrc)||' '||md5(pg_get_functiondef(${signature})) FROM pg_proc WHERE oid=${signature}`),
    `${LIVE_V510_PROSRC_MD5} ${LIVE_V510_DEF_MD5}`, 'local V510 body must match production before V522')
  psqlInput(referenceFunction)

  psqlFile(MIGRATION)
  assert.equal(psqlValue(`SELECT md5(prosrc) FROM pg_proc WHERE oid=${signature}`), V522_PROSRC_MD5)
  refused(MIGRATION, /v522 engagement batch drift \(expected V510 body\)/)
  psqlFile(ROLLBACK)
  assert.equal(psqlValue(`SELECT md5(prosrc)||' '||md5(pg_get_functiondef(${signature})) FROM pg_proc WHERE oid=${signature}`),
    `${LIVE_V510_PROSRC_MD5} ${LIVE_V510_DEF_MD5}`, 'rollback must restore the exact V510 body')
  refused(ROLLBACK, /rollback v522: function is not the V522 body/)
  psqlFile(MIGRATION)
  assert.equal(psqlValue(`SELECT pg_get_userbyid(proowner)||' '||prosecdef||' '||provolatile::text||' '||proconfig::text||' '||proacl::text FROM pg_proc WHERE oid=${signature}`),
    'postgres true v {"search_path=pg_catalog, public",statement_timeout=15s} {postgres=X/postgres}')
  // Only the catalog SELECT (and its comment) differs from the V510 body.
  const cut = body => {
    const a = body.indexOf("v_catalog_id:=COALESCE((p_items#>>'{0,catalog,id}')::bigint,0);\n") , b = body.indexOf("   RETURN jsonb_build_object('enabled',true,'revision',v_revision,'items',v_result,'updated',0,\n     'catalogCursor'")
    assert.ok(a > 0 && b > a); return [body.slice(0, a), body.slice(b)]
  }
  const [oldHead, oldTail] = cut(bodyOf('public.zalo_engagement_batch_v510_ref(bigint,bigint,text,jsonb,text,text,text)'))
  const [newHead, newTail] = cut(bodyOf('public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)'))
  assert.equal(newHead, oldHead, 'V522 must keep every byte before the catalog SELECT'); assert.equal(newTail, oldTail, 'V522 must keep every byte after the catalog SELECT')
  console.log(`PASS V522 apply/refuse/rollback/refuse/apply; md5(prosrc) ${V522_PROSRC_MD5}; other branches byte-identical to V510`)

  psqlFile('scripts/fixtures/zalo-engagement/assertions.sql')
  console.log('PASS original engagement assertions (scripts/fixtures/zalo-engagement/assertions.sql)')
  const scale = lastJson(run(bin('psql'), [...args('postgres'), '-At', '-f', 'scripts/fixtures/zalo-engagement/scale_v510.sql']))
  for (const call of scale.calls) for (const key of ['details', 'watches', 'campaigns']) assert.ok(call[key] <= 50, `${call.step} read ${call[key]} ${key} after V522`)
  console.log('PASS V510 scale check unchanged: register/events/recovery read <= 50 rows per call')
  const equivalence = lastJson(run(bin('psql'), [...args('postgres'), '-At', '-f', 'scripts/fixtures/zalo-engagement/catalog_v522_equivalence.sql']))
  const walks = equivalence.walks.filter(w => w.label !== 'single-page probes'), probes = equivalence.walks.find(w => w.label === 'single-page probes')
  console.log(`PASS catalog equivalence: ${walks.length} walks (${walks.reduce((s, w) => s + w.pages, 0)} pages, ${walks.reduce((s, w) => s + w.items, 0)} rows, ` +
    `${walks.reduce((s, w) => s + w.boundaryTies, 0)} ties across page boundaries) and ${probes.pages} single-page cursors identical to V510`)

  // Production-sized owner in its own database: committed data + VACUUM ANALYZE, like akachat after autovacuum.
  psqlValue('CREATE DATABASE catalog_bench')
  psqlInput(schema.split('\n').filter(line => !line.startsWith('CREATE ROLE')).join('\n'), 'catalog_bench')
  for (const file of ['migrations/migration_v339_zalo_campaign_engagement.sql', 'migrations/migration_v341_zalo_engagement_chat_registration.sql', V510]) psqlFile(file, 'catalog_bench')
  psqlInput(referenceFunction, 'catalog_bench')
  psqlFile(MIGRATION, 'catalog_bench')
  psqlFile('scripts/fixtures/zalo-engagement/catalog_v522_scale.sql', 'catalog_bench')
  psqlValue('VACUUM ANALYZE', 'catalog_bench')
  const measure = lastJson(psqlInput(prepare(V510, 'q510') + prepare(MIGRATION, 'q522') + fs.readFileSync('scripts/fixtures/zalo-engagement/catalog_v522_measure.sql', 'utf8'), 'catalog_bench'))
  console.log(JSON.stringify(measure, null, 1))
  for (const mode of ['force_custom_plan', 'force_generic_plan']) {
    const q522 = measure.explain[`q522 ${mode}`]
    assert.equal(q522.sortedPages, 0, `V522 ${mode} must not sort`); assert.equal(q522.watchIndexes, 'auto_campaign_engagement_catalog', `V522 ${mode} must walk the catalog index`)
    assert.ok(q522.maxPageWatchRows <= 1000, `V522 ${mode} read ${q522.maxPageWatchRows} watches for one page`)
    assert.ok(q522.buffers * 10 < measure.explain[`q510 ${mode}`].buffers, `V522 ${mode} should read far fewer buffers than V510`)
  }
  assert.ok(measure.sweep.v522.maxPageWatchRows <= 1000 && measure.sweep.v522.maxPageDetailRows <= 1000, 'V522 function reads ~one page of rows per call')
  assert.ok(measure.sweep.v522.watchRows <= measure.owner.live + measure.owner.pages, 'V522 reads each live watch once per sweep')
  console.log(`PASS catalog sweep of ${measure.owner.live} live watches (${measure.owner.returned} valid, ${measure.owner.pages} pages): ` +
    `V510 ${measure.sweep.v510.watchRows} watch / ${measure.sweep.v510.detailRows} detail rows read, V522 ${measure.sweep.v522.watchRows} / ${measure.sweep.v522.detailRows}`)

  // The race smoke needs a built akaAgentChatApi next to this checkout; V522 does not touch its paths.
  if (fs.existsSync(path.resolve('../akaAgentChatApi/packages/database/dist/campaignEngagementRepository.js'))) {
    const auditPlan = 'docs/audits/zalo-engagement/catalog-plan.json', auditPlanBefore = fs.readFileSync(auditPlan)
    try { console.log(run(process.execPath, ['scripts/zalo-campaign-engagement-race-smoke.cjs', dir], { timeout: 60000 }).trim()) }
    finally { fs.writeFileSync(auditPlan, auditPlanBefore) }
  } else console.log('SKIP race smoke: ../akaAgentChatApi (built) not found next to this checkout')
  console.log('V522 smoke OK')
} finally {
  if (started) run(bin('pg_ctl'), ['-D', path.join(dir, 'db'), '-m', 'immediate', 'stop'])
  fs.rmSync(dir, { recursive: true, force: true })
}
