// Data/history DML through the existing linked CLI; no schema setup/reload.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const baseline = require('./fixtures/facebook-message-waiting-limit-live.json')
if (fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim() !== baseline.project_ref) throw Error('Wrong linked production ref')
const name = 'migration_v355_facebook_message_waiting_limit'
const migration = fs.readFileSync(path.join(root, 'migrations', `${name}.sql`), 'utf8')
const body = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const mutation = migration.match(/DO \$message_limit\$[\s\S]*?END \$message_limit\$;/)[0]
const workflowChecks = baseline.workflows.map(w => `
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=${w.id}) IS DISTINCT FROM '${w.md5}' THEN
    RAISE EXCEPTION 'v355 verification: workflow ${w.id} changed';
  END IF;`).join('\n')
const originalPolicyCheck = `IF (SELECT md5(to_jsonb(p)::text) FROM public.auto_error p WHERE error_code='err_limit_waiting_message') IS DISTINCT FROM '${baseline.policy_md5}' THEN
    RAISE EXCEPTION 'v355 verification: policy changed';
  END IF;`
const makeVerify = policyCheck => `DO $verify$ BEGIN
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id=38 AND name='fb_send_message') IS DISTINCT FROM '${baseline.target_code_md5}' THEN
    RAISE EXCEPTION 'v355 verification: target code mismatch';
  END IF;
  ${policyCheck}
  ${workflowChecks}
END $verify$;`
const verify = makeVerify(originalPolicyCheck)
// Verify the recorded follow-up without weakening v355 apply/smoke guards.
const expected24h = JSON.stringify({ ...baseline.policy, time_disable_actions: 1440 }).replace(/'/g, "''")
const expectedNotices = JSON.stringify({
  ...baseline.policy, time_disable_actions: 1440,
  noti_running_process: 'Facebook đang hạn chế nhắn tin cho người lạ.',
  noti_campaign: 'Facebook đang hạn chế nhắn tin cho người lạ. Tạm nghỉ 24 giờ.'
}).replace(/'/g, "''")
const currentVerify = makeVerify(`IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v357_facebook_waiting_message_notices') THEN
    IF (SELECT to_jsonb(p) - 'updated_at' FROM public.auto_error p WHERE error_code='err_limit_waiting_message')
       IS DISTINCT FROM ('${expectedNotices}'::jsonb - 'updated_at') THEN
      RAISE EXCEPTION 'v357 verification: waiting-message policy changed';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v356_facebook_message_waiting_limit_24h') THEN
    IF (SELECT to_jsonb(p) - 'updated_at' FROM public.auto_error p WHERE error_code='err_limit_waiting_message')
       IS DISTINCT FROM ('${expected24h}'::jsonb - 'updated_at') THEN
      RAISE EXCEPTION 'v356 verification: 24-hour policy changed';
    END IF;
  ELSE
    ${originalPolicyCheck}
  END IF;`)
const report = `SELECT jsonb_build_object('block',(SELECT jsonb_build_object('id',id,'name',name,'code_md5',md5(code)) FROM public.auto_blocks WHERE id=38),
  'policy',(SELECT jsonb_build_object('error_code',error_code,'time_disable_actions',time_disable_actions,'noti_running_process',noti_running_process,'noti_campaign',noti_campaign,'policy_md5',md5(to_jsonb(p)::text)) FROM public.auto_error p WHERE error_code='err_limit_waiting_message'),
  'history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations WHERE name IN ('${name}','migration_v356_facebook_message_waiting_limit_24h','migration_v357_facebook_waiting_message_notices'))) AS verification;`
const mode = process.argv[2]
let sql
if (mode === 'smoke') {
  // Each expected preflight failure rolls its fixture write back in a subtransaction.
  const conflicts = [
    "UPDATE public.auto_blocks SET code=code || ' ' WHERE id=38;",
    "UPDATE public.auto_blocks SET description=coalesce(description,'') || ' drift' WHERE id=38;",
    "UPDATE public.auto_error SET time_disable_actions=61 WHERE error_code='err_limit_waiting_message';"
  ].map(change => `DO $conflict$ BEGIN
    BEGIN
      ${change}
      ${mutation}
      RAISE EXCEPTION 'v355 stale baseline accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'v355 preflight:%' THEN RAISE; END IF;
    END;
  END $conflict$;`).join('\n')
  sql = `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
${conflicts}
${body}
${verify}
DO $replay$ BEGIN
  BEGIN
    ${mutation}
    RAISE EXCEPTION 'v355 duplicate apply accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'v355 preflight:%' THEN RAISE; END IF;
  END;
END $replay$;
ROLLBACK;
DO $baseline$ BEGIN
  IF (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=38) IS DISTINCT FROM '${baseline.row_md5}' THEN
    RAISE EXCEPTION 'v355 smoke did not restore live baseline';
  END IF;
END $baseline$;
SELECT 'PASS v355 code/metadata/policy drift, duplicate apply, target checksum and unchanged policy/workflows; rolled back' AS result;`
} else if (mode === 'apply') {
  sql = `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
DO $history$ BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='${name}') THEN
    RAISE EXCEPTION 'v355 already recorded; do not reapply';
  END IF;
END $history$;
${body}
${verify}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}',ARRAY[$migration$${migration}$migration$]);
COMMIT;
${report}`
} else if (mode === 'verify') sql = `${currentVerify}\n${report}`
else throw Error('Usage: node scripts/facebook-message-waiting-limit-migration.cjs smoke|apply|verify')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-message-limit-migration-'))
try {
  const file = path.join(directory, 'query.sql')
  fs.writeFileSync(file, sql)
  const output = execFileSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  console.log(JSON.stringify(result.rows, null, 2))
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
