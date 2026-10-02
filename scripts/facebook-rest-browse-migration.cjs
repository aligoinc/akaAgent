// Data-only linked execution: no pool, schema setup DDL, RPC changes or reload.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
if (fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== 'cgjbsmqtfhqvttudyjzq') throw Error('Wrong linked production ref')
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v337_facebook_rest_browse.sql'), 'utf8')
const body = sql => sql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const mode = process.argv[2]
const verify = `DO $verify$ BEGIN
  IF (SELECT count(*) FROM public.auto_workflows WHERE name='fb_campaign_rest_browse') <> 1
    OR (SELECT count(*) FROM public.auto_blocks WHERE name IN ('fb_rest_browse_feed','fb_rest_browse_rest')) <> 2
    OR (SELECT count(*) FROM public.auto_elements WHERE name LIKE 'fb_rest_browse%') <> 5 THEN
    RAISE EXCEPTION 'v337 verification: missing or unexpected definitions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_workflows w, jsonb_array_elements(w.nodes) n
    LEFT JOIN public.auto_blocks b ON b.id=(n->>'blockId')::bigint
    WHERE w.name='fb_campaign_rest_browse' AND (b.id IS NULL OR b.name <> n->>'blockName')) THEN
    RAISE EXCEPTION 'v337 verification: invalid node references';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaign_actions WHERE workflow_id=(SELECT id FROM public.auto_workflows WHERE name='fb_campaign_rest_browse')) THEN
    RAISE EXCEPTION 'v337 verification: auxiliary workflow must not be a campaign action';
  END IF;
END $verify$;
SELECT jsonb_build_object(
 'blocks',(SELECT jsonb_agg(jsonb_build_object('name',name,'checksum',md5(code))) FROM public.auto_blocks WHERE name IN ('fb_rest_browse_feed','fb_rest_browse_rest')),
 'workflow',(SELECT jsonb_build_object('id',id,'name',name,'checksum',md5((to_jsonb(w)-'created_at'-'updated_at')::text)) FROM public.auto_workflows w WHERE name='fb_campaign_rest_browse'),
 'history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name='migration_v337_facebook_rest_browse')
) as verification;`
let sql
if (mode === 'smoke') {
  const preflight = migration.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)[0]
  const fixture = migration
    .replaceAll('INSERT INTO public.auto_elements (name,', 'INSERT INTO public.auto_elements (id, name,')
    .replace('SELECT CASE name', 'SELECT -337000-row_number() OVER (), CASE name')
    .replace("('fb_rest_browse_photo',", "(-337004,'fb_rest_browse_photo',")
    .replace("('fb_rest_browse_notifications',", "(-337005,'fb_rest_browse_notifications',")
    .replace('INSERT INTO public.auto_blocks (name,', 'INSERT INTO public.auto_blocks (id, name,')
    .replace("VALUES ('fb_rest_browse_feed',", "VALUES (-337001,'fb_rest_browse_feed',")
    .replace("('fb_rest_browse_rest',", "(-337002,'fb_rest_browse_rest',")
    .replace('INSERT INTO public.auto_workflows (name,', 'INSERT INTO public.auto_workflows (id, name,')
    .replace("SELECT 'fb_campaign_rest_browse',", "SELECT -337001,'fb_campaign_rest_browse',")
  sql = `BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
DO $conflict$ BEGIN
  BEGIN
    UPDATE public.auto_elements SET xpath=xpath || ' ' WHERE name='fb_newsfeed_post';
    EXECUTE $check$${preflight}$check$;
    RAISE EXCEPTION 'stale checksum accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'v337 preflight:%' THEN RAISE; END IF;
  END;
END $conflict$;
${body(fixture)}
${verify}
DO $collision$ BEGIN
  BEGIN
    EXECUTE $check$${preflight}$check$;
    RAISE EXCEPTION 'name collision accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'v337 preflight: names%' THEN RAISE; END IF;
  END;
END $collision$;
ROLLBACK;
SELECT 'PASS v337 checksum conflict, name collision, seed and node references; rolled back, no sequence consumption' AS result;`
} else if (mode === 'apply') {
  const sha = createHash('sha256').update(migration).digest('hex')
  console.log('Applying data-only v337, sha256=' + sha)
  sql = `BEGIN;
DO $history$ BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v337_facebook_rest_browse') THEN
    RAISE EXCEPTION 'v337 already recorded; do not reapply';
  END IF;
END $history$;
${body(migration)}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'migration_v337_facebook_rest_browse',ARRAY[$migration$${migration}$migration$]);
COMMIT;
${verify}`
} else if (mode === 'verify') sql = verify
else throw Error('Usage: node scripts/facebook-rest-browse-migration.cjs smoke|apply|verify')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-rest-browse-migration-'))
try {
  const file = path.join(directory, 'query.sql'); fs.writeFileSync(file, sql)
  const output = execFileSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  console.log(JSON.stringify(result.rows, null, 2))
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
