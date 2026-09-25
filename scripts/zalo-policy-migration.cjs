// Uses the existing linked CLI connection mechanism. No pool, RPC or DDL setup.
// Set ZALO_POLICY_LINKED_ROOT to the linked saved repo when this checkout is not linked.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const {execFileSync} = require('node:child_process')
const {createHash} = require('node:crypto')
const mode = process.argv[2]
const root = path.resolve(__dirname, '..')
const linkedRoot = process.env.ZALO_POLICY_LINKED_ROOT || root
const expectedRef = 'cgjbsmqtfhqvttudyjzq'
const linkedRef = fs.readFileSync(path.join(linkedRoot,'supabase/.temp/project-ref'),'utf8').trim()
if (linkedRef !== expectedRef) throw Error('Wrong linked production ref')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const transactionBody = sql => sql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')
const migration = read('migrations/migration_v323_zalo_scoped_policies.sql')
const verify = read('migrations/tests/migration_v323_zalo_scoped_policies_verify.sql')
const rollback = read('migrations/tests/migration_v323_zalo_scoped_policies_rollback.sql')
const fixtureMigration = migration
  .replace('INSERT INTO public.auto_error (error_code,','INSERT INTO public.auto_error (id, error_code,')
  .replace('SELECT error_code,','SELECT -323000 - row_number() OVER (), error_code,')
let sql
if (mode === 'smoke') {
  const preflight=migration.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/)[0]
  const conflictSmoke=`DO $conflict$
BEGIN
  BEGIN
    UPDATE public.auto_error SET error_desc='__v323_conflict_fixture__' WHERE id=12;
    EXECUTE $conflict_sql$${preflight}$conflict_sql$;
    RAISE EXCEPTION 'stale checksum was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'v323 preflight:%' THEN RAISE; END IF;
  END;
END $conflict$;`
  sql = 'BEGIN;\nSET LOCAL lock_timeout=\'3s\';\nSET LOCAL statement_timeout=\'30s\';\n' + conflictSmoke + transactionBody(fixtureMigration)
    + read('migrations/tests/migration_v322_auto_error_days_at_time_smoke.sql')
    + transactionBody(rollback) + "\nROLLBACK;\nSELECT 'v322/v323 apply + rollback smoke passed; no persistent writes' AS result;"
} else if (mode === 'verify') {
  sql = verify
} else if (mode === 'apply-after-runtime-release') {
  // Explicit command name records the release prerequisite; do not use before publishing runtime.
  const checksum=createHash('sha256').update(migration).digest('hex')
  const name='migration_v323_zalo_scoped_policies'
  const history="INSERT INTO supabase_migrations.schema_migrations(version,name,statements,rollback) VALUES " +
    "(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'" + name + "',ARRAY[$migration$" + migration + "$migration$],ARRAY[$rollback$" + rollback + "$rollback$]);\n"
  sql=transactionBody(migration)
  sql='BEGIN;\n'+sql+history+'COMMIT;\n'+verify
  console.log('Applying v323, sha256='+checksum)
} else {
  throw Error('Usage: node scripts/zalo-policy-migration.cjs smoke|verify|apply-after-runtime-release')
}
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'zalo-policy-migration-'))
try {
  const file=path.join(directory,'query.sql');fs.writeFileSync(file,sql)
  const output=execFileSync('supabase',['db','query','--linked','--file',file],{cwd:linkedRoot,encoding:'utf8',maxBuffer:10*1024*1024})
  const result=JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1))
  console.log(JSON.stringify(result.rows,null,2))
} finally {
  fs.rmSync(directory,{recursive:true,force:true})
}
