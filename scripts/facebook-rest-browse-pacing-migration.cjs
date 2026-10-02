// Existing linked CLI path; data/history DML without schema setup.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
if (fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== 'cgjbsmqtfhqvttudyjzq') throw Error('Wrong linked production ref')
const name = 'migration_v338_facebook_rest_browse_pacing'
const migration = fs.readFileSync(path.join(root, 'migrations', `${name}.sql`), 'utf8')
const body = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const expected = createHash('md5').update(migration.match(/\$browse\$([\s\S]*?)\$browse\$/)[1]).digest('hex')
const verify = `DO $verify$ BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id=2830 AND name='fb_rest_browse_feed') IS DISTINCT FROM '${expected}'
    OR (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=2831 AND name='fb_rest_browse_rest') IS DISTINCT FROM 'bba6a863421285ba260484df54aa9f0d'
    OR (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=314 AND name='fb_campaign_rest_browse') IS DISTINCT FROM 'bd8d1fbe0a450e1549fe5e74c62c7c80' THEN
    RAISE EXCEPTION 'v338 verification: browse checksum or unchanged rest/workflow mismatch';
  END IF;
END $verify$;`
const report = `SELECT jsonb_build_object('block',(SELECT jsonb_build_object('id',id,'name',name,'code_checksum',md5(code)) FROM public.auto_blocks WHERE name='fb_rest_browse_feed'),
  'history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name='${name}')) AS verification;`
const mode = process.argv[2]
let sql
if (mode === 'smoke') {
  const preflight = migration.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)[0]
  sql = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
DO $conflict$ BEGIN
  BEGIN
    UPDATE public.auto_blocks SET code=code || ' ' WHERE id=2830 AND name='fb_rest_browse_feed';
    EXECUTE $check$${preflight}$check$;
    RAISE EXCEPTION 'stale checksum accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'v338 preflight:%' THEN RAISE; END IF;
  END;
END $conflict$;
${body}
${verify}
DO $replay$ BEGIN
  BEGIN
    EXECUTE $check$${preflight}$check$;
    RAISE EXCEPTION 'duplicate migration accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'v338 preflight:%' THEN RAISE; END IF;
  END;
END $replay$;
ROLLBACK;
SELECT 'PASS v338 stale checksum, duplicate apply, target checksum and unchanged rest/workflow; rolled back' AS result;`
} else if (mode === 'apply') {
  sql = `BEGIN;
DO $history$ BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='${name}') THEN
    RAISE EXCEPTION 'v338 already recorded; do not reapply';
  END IF;
END $history$;
${body}
${verify}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}',ARRAY[$migration$${migration}$migration$]);
COMMIT;
${report}`
} else if (mode === 'verify') sql = `${verify}\n${report}`
else throw Error('Usage: node scripts/facebook-rest-browse-pacing-migration.cjs smoke|apply|verify')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-rest-browse-pacing-'))
try {
  const file = path.join(directory, 'query.sql'); fs.writeFileSync(file, sql)
  const output = execFileSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  console.log(JSON.stringify(result.rows, null, 2))
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
