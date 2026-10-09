// v360 data-only patch/history through the existing linked Management API.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const baseline = require('./fixtures/facebook-friend-cancellation-live.json')
if (baseline.project_ref !== 'cgjbsmqtfhqvttudyjzq' ||
  fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== baseline.project_ref) {
  throw Error('Wrong linked production ref')
}
const name = 'migration_v360_facebook_friend_cancel_commit'
const migration = fs.readFileSync(path.join(root, 'migrations', name + '.sql'), 'utf8')
const body = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const mutation = migration.match(/DO \$friend_cancel\$[\s\S]*?END \$friend_cancel\$;/)[0]
const md5 = createHash('md5').update(migration.split('$friend_code$')[1]).digest('hex')
const unchangedChecks = [['auto_elements', baseline.elements], ['auto_workflows', baseline.workflows]]
  .flatMap(([table, rows]) => rows.map(entry => `IF (SELECT md5(to_jsonb(r)::text) FROM public.${table} r WHERE id=${entry.row.id}) IS DISTINCT FROM '${entry.md5}' THEN RAISE EXCEPTION 'v360 verification: ${table} ${entry.row.id} changed'; END IF;`)).join('\n')
const verify = `DO $verify$ BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id=39 AND name='fb_add_friend') IS DISTINCT FROM '${md5}' THEN RAISE EXCEPTION 'v360 verification: block code mismatch'; END IF;
  ${unchangedChecks}
END $verify$;`
const report = `SELECT jsonb_build_object('block_md5',(SELECT md5(code) FROM public.auto_blocks WHERE id=39),
  'policies',(SELECT jsonb_agg(jsonb_build_object('code',error_code,'counts_toward_limit',counts_toward_limit,'counts_toward_bad_target',counts_toward_bad_target)) FROM public.auto_error WHERE error_code IN ('err_fb_add_friend_unavailable','err_undefined')),
  'history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name='${name}')) AS verification;`
const mode = process.argv[2]
let sql
if (mode === 'smoke') {
  const conflicts = [
    "UPDATE public.auto_blocks SET code=code||' ' WHERE id=39;",
    "UPDATE public.auto_blocks SET description=coalesce(description,'')||' drift' WHERE id=39;",
    ...baseline.elements.map(e => `UPDATE public.auto_elements SET xpath=xpath||' ' WHERE id=${e.row.id};`),
    ...baseline.workflows.map(w => `UPDATE public.auto_workflows SET description=coalesce(description,'')||' drift' WHERE id=${w.row.id};`)
  ].map(change => `DO $conflict$ BEGIN BEGIN
${change}
${mutation}
RAISE EXCEPTION 'v360 stale baseline accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'v360 preflight:%' THEN RAISE; END IF;
END; END $conflict$;`).join('\n')
  sql = `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
${conflicts}
${body}
${verify}
DO $replay$ BEGIN BEGIN
${mutation}
RAISE EXCEPTION 'v360 duplicate apply accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'v360 preflight:%' THEN RAISE; END IF;
END; END $replay$;
ROLLBACK;
DO $baseline$ BEGIN
IF (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=39) IS DISTINCT FROM '${baseline.block_md5}' THEN RAISE EXCEPTION 'v360 rollback did not restore block'; END IF;
${unchangedChecks}
END $baseline$;
SELECT 'PASS v360 drift guards, duplicate apply, code/selectors/workflows, rollback' AS result;`
} else if (mode === 'apply') {
  sql = `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $history$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='${name}') THEN RAISE EXCEPTION 'v360 already recorded; do not reapply'; END IF; END $history$;
${body}
${verify}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}',ARRAY[$migration$${migration}$migration$]);
COMMIT;
${report}`
} else if (mode === 'verify') sql = verify + '\n' + report
else throw Error('Usage: node scripts/facebook-friend-cancellation-migration.cjs smoke|apply|verify [--sql]')
if (process.argv.includes('--sql')) { process.stdout.write(sql); process.exit(0) }
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-friend-cancel-migration-'))
try {
  const file = path.join(directory, 'query.sql'); fs.writeFileSync(file, sql)
  const output = execFileSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  console.log(JSON.stringify(result.rows, null, 2))
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
