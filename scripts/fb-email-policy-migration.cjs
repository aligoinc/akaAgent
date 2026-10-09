// v346 data-only maintenance through the existing linked Management API.
// No application dependency, SQL pool, RPC, DDL setup or schema reload.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const ref = 'cgjbsmqtfhqvttudyjzq'
const version = 346
const name = 'migration_v346_fb_email_error_policies'
const directory = path.join(root, 'migrations/snapshots/fb-email-policies-v346')
const migrationPath = path.join(root, 'migrations', name + '.sql')
const rollbackPath = path.join(root, 'migrations/tests', name + '_rollback.sql')
const digest = (text, algorithm = 'sha256') => createHash(algorithm).update(text).digest('hex')
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
const save = (file, data, exclusive = false) => fs.writeFileSync(path.join(directory, file), JSON.stringify(data, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })
const quote = text => "'" + String(text).replaceAll("'", "''") + "'"
const dollar = (text, tag) => {
  assert(!text.includes('$' + tag + '$'), 'SQL dollar delimiter collision')
  return '$' + tag + '$' + text + '$' + tag + '$'
}
const jsonSQL = (data, tag) => dollar(JSON.stringify(data), tag) + '::jsonb'

function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-email-policy-'))
  try {
    const file = path.join(temp, 'query.sql')
    fs.writeFileSync(file, sql)
    const output = execFileSync('supabase', ['db', 'query', '--linked', '--file', file], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const parsed = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
    assert(Array.isArray(parsed.rows), 'No SQL rows returned')
    return parsed.rows
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

const schemaSQL = `jsonb_build_object(
  'columns', (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.auto_error'::regclass AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.auto_error'::regclass),
  'incoming_foreign_keys', (SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text,conname) FROM pg_constraint WHERE confrelid='public.auto_error'::regclass),
  'indexes', (SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='auto_error'),
  'triggers', (SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='public.auto_error'::regclass AND NOT tgisinternal),
  'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_error'),
  'access', (SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid='public.auto_error'::regclass),
  'sequence_definition', (SELECT to_jsonb(s) FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_error_id_seq') - 'last_value'
)`

function snapshot() {
  return query(`WITH meta AS (SELECT ${schemaSQL} AS data)
SELECT '${ref}' AS project_ref, clock_timestamp() AS captured_at,
 (SELECT count(*) FROM public.auto_error) AS row_count,
 (SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e) AS table_md5,
 (SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(e),'canonical',to_jsonb(e)::text,'md5',md5(to_jsonb(e)::text)) ORDER BY id) FROM public.auto_error e) AS rows,
 meta.data AS schema, meta.data::text AS schema_canonical, md5(meta.data::text) AS schema_md5,
 (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_error_id_seq) AS sequence_state
FROM meta;`)[0]
}

function validateSnapshot(value) {
  assert.equal(value.project_ref, ref)
  assert.equal(value.row_count, value.rows.length)
  assert.equal(new Set(value.rows.map(item => item.row.id)).size, value.row_count)
  const sorted = [...value.rows].sort((a, b) => a.row.id - b.row.id)
  for (const item of sorted) {
    assert.deepEqual(JSON.parse(item.canonical), item.row)
    assert.equal(digest(item.canonical, 'md5'), item.md5)
    assert.equal(Object.keys(item.row).length, value.schema.columns.length)
  }
  assert.equal(digest(sorted.map(item => item.canonical).join('|'), 'md5'), value.table_md5)
  assert.deepEqual(JSON.parse(value.schema_canonical), value.schema)
  assert.equal(digest(value.schema_canonical, 'md5'), value.schema_md5)
}

function checkOriginalRows(before, after) {
  assert.equal(before.schema_md5, after.schema_md5, 'Policy schema changed')
  const current = new Map(after.rows.map(item => [item.row.id, item]))
  for (const old of before.rows) assert.equal(current.get(old.row.id)?.md5, old.md5, 'Existing policy changed: ' + old.row.error_code)
}

function checkedInputs() {
  const backupFile = fs.existsSync(path.join(directory, 'before-apply.json')) ? 'before-apply.json' : 'before.json'
  const before = load(backupFile)
  const manifest = load(backupFile === 'before.json' ? 'backup-manifest.json' : 'before-apply-manifest.json')
  validateSnapshot(before)
  assert.equal(digest(fs.readFileSync(path.join(directory, backupFile))), manifest.before_sha256, 'Backup file changed')
  const desired = load('desired.json')
  const oldCodes = new Set(before.rows.map(item => item.row.error_code))
  assert.equal(new Set(desired.map(row => row.error_code)).size, desired.length)
  const fields = before.schema.columns.map(column => column.name).filter(key => !['id', 'created_at', 'updated_at'].includes(key))
  for (const row of desired) {
    assert(!oldCodes.has(row.error_code), 'Existing code in INSERT catalog: ' + row.error_code)
    assert.deepEqual(Object.keys(row).sort(), [...fields].sort())
    assert.equal(row.is_active, true)
    assert.equal(row.is_delete, false)
    assert.deepEqual(row.zalo_error_codes, [])
    assert.deepEqual(row.zalo_action_codes, [])
    assert(!row.disable_action_codes.length || row.disable_action_mode === 'indefinite' || row.time_disable_actions > 0,
      'Unspecified cooldown would accidentally lock indefinitely: ' + row.error_code)
  }
  return { before, desired, fields, backupFile }
}

function runtimeQuery(codes) {
  return `WITH candidates AS (SELECT jsonb_array_elements_text(${jsonSQL(codes, 'codes')}) AS code)
SELECT 'block' AS kind,b.id::text AS id,b.name,c.code,md5(to_jsonb(b)::text) AS md5
FROM public.auto_blocks b JOIN candidates c ON strpos(coalesce(b.code,'')||coalesce(b.config_schema::text,'')||coalesce(b.default_config::text,'')||coalesce(b.output_schema::text,''),c.code)>0
UNION ALL
SELECT 'workflow',w.id::text,w.name,c.code,md5(to_jsonb(w)::text)
FROM public.auto_workflows w JOIN candidates c ON strpos(coalesce(w.nodes::text,'')||coalesce(w.edges::text,'')||coalesce(w.variables_schema::text,'')||coalesce(w.default_variables::text,''),c.code)>0
UNION ALL
SELECT 'function',p.oid::text,p.oid::regprocedure::text,c.code,md5(p.prosrc)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN candidates c ON strpos(p.prosrc,c.code)>0
WHERE n.nspname='public' AND p.prokind='f'` // Read bodies only, no RPC changes.
}

function auditRuntime(desired) {
  const codes = desired.map(row => row.error_code)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-source-scan-'))
  let localMatches = ''
  try {
    const file = path.join(temp, 'codes.txt')
    fs.writeFileSync(file, codes.join('\n'))
    try {
      localMatches = execFileSync('rg', ['-n', '-F', '-f', file, 'src', 'supabase/functions'], { cwd: root, encoding: 'utf8' })
    } catch (error) {
      if (error.status !== 1) throw error
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
  const liveMatches = query(runtimeQuery(codes))
  const audit = { checked_at: new Date().toISOString(), codes, local_matches: localMatches, live_matches: liveMatches }
  save('runtime-audit.json', audit)
  assert.equal(localMatches, '', 'New code is referenced by current source; review before activating')
  assert.equal(liveMatches.length, 0, 'New code is referenced by live code/config; review before activating')
  return audit
}

const transactionStart = "BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '30s';\nLOCK TABLE public.auto_error IN SHARE ROW EXCLUSIVE MODE;\n"

function originalGuard(before, fullCount) {
  const hashes = Object.fromEntries(before.rows.map(item => [item.row.id, item.md5]))
  return `IF md5((${schemaSQL})::text) <> '${before.schema_md5}' THEN
    RAISE EXCEPTION 'v346 guard: auto_error schema/access/constraints changed'; END IF;
  ${fullCount ? `IF (SELECT count(*) FROM public.auto_error) <> ${before.row_count} THEN RAISE EXCEPTION 'v346 guard: existing row count changed'; END IF;` : ''}
  IF EXISTS (SELECT 1 FROM jsonb_each_text(${jsonSQL(hashes, 'old_hashes')}) h
    LEFT JOIN public.auto_error e ON e.id=h.key::bigint
    WHERE e.id IS NULL OR md5(to_jsonb(e)::text) <> h.value) THEN
    RAISE EXCEPTION 'v346 guard: original policy changed or missing'; END IF;`
}

function makeSQL(before, desired, fields) {
  const codes = desired.map(row => row.error_code)
  const desiredLiteral = jsonSQL(desired, 'desired')
  const expectedTypes = Object.fromEntries(before.schema.columns.map(column => [column.name, column.type]))
  const typed = fields.map(key => `${key} ${expectedTypes[key]}`).join(', ')
  const preflight = `DO $preflight$
BEGIN
  ${originalGuard(before, true)}
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name ~ '^migration_v346(_|$)') THEN
    RAISE EXCEPTION 'v346 guard: migration version already used'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code IN (SELECT jsonb_array_elements_text(${jsonSQL(codes, 'new_codes')}))) THEN
    RAISE EXCEPTION 'v346 guard: proposed code already exists'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(${desiredLiteral}) AS d(${typed}),unnest(d.disable_action_codes) a
    WHERE NOT EXISTS (SELECT 1 FROM public.auto_account_actions x WHERE x.code=a AND x.is_active AND NOT x.is_delete)) THEN
    RAISE EXCEPTION 'v346 guard: unknown or inactive action'; END IF;
  IF EXISTS (${runtimeQuery(codes)}) THEN
    RAISE EXCEPTION 'v346 guard: live runtime references a proposed code'; END IF;
END $preflight$;`
  const insert = `WITH inserted AS (
  INSERT INTO public.auto_error (${fields.join(', ')})
  SELECT ${fields.join(', ')} FROM jsonb_to_recordset(${desiredLiteral}) AS d(${typed})
  RETURNING *
) SELECT set_config('aka.v346_receipt',jsonb_agg(jsonb_build_object('id',id,'error_code',error_code,'md5',md5(to_jsonb(inserted)::text)) ORDER BY id)::text,true) FROM inserted;`
  const postflight = `DO $postflight$
BEGIN
  ${originalGuard(before, false)}
  IF (SELECT count(*) FROM public.auto_error) <> ${before.row_count + desired.length} THEN RAISE EXCEPTION 'v346 guard: wrong final count'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(${desiredLiteral}) d
    LEFT JOIN public.auto_error e ON e.error_code=d->>'error_code'
    WHERE e.id IS NULL OR (to_jsonb(e)-'id'-'created_at'-'updated_at') IS DISTINCT FROM d) THEN
    RAISE EXCEPTION 'v346 guard: inserted policy differs from catalog'; END IF;
END $postflight$;`

  // User explicitly waived the separate runtime-data reference scan on 2026-10-06.
  // PostgreSQL foreign keys remain enabled and protect DELETE, including races.
  // Non-FK diagnostic references are no longer scanned; see rollback-check-decision.json.
  const rollbackBody = `DO $rollback$
DECLARE
  expected jsonb := '__APPLIED_ROWS_JSON__'::jsonb;
  removed integer;
BEGIN
  ${originalGuard(before, false)}
  IF jsonb_array_length(expected) <> ${desired.length} THEN RAISE EXCEPTION 'v346 rollback: invalid receipt'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(expected) x
    LEFT JOIN public.auto_error e ON e.id=(x->>'id')::bigint AND e.error_code=x->>'error_code'
    WHERE e.id IS NULL OR md5(to_jsonb(e)::text) IS DISTINCT FROM x->>'md5') THEN
    RAISE EXCEPTION 'v346 rollback: new row changed or missing'; END IF;
  IF EXISTS (${runtimeQuery(codes)}) THEN
    RAISE EXCEPTION 'v346 rollback: live runtime now references these codes'; END IF;
  -- No separate runtime-data reference scan, as explicitly requested by the user.
  -- Keep all FK constraints/triggers enabled; never use CASCADE or bypass checks.
  DELETE FROM public.auto_error e USING jsonb_array_elements(expected) x
    WHERE e.id=(x->>'id')::bigint AND e.error_code=x->>'error_code' AND md5(to_jsonb(e)::text)=x->>'md5';
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> ${desired.length} THEN RAISE EXCEPTION 'v346 rollback: incomplete deletion'; END IF;
  ${originalGuard(before, false)}
  IF (SELECT count(*) FROM public.auto_error)=${before.row_count}
    AND (SELECT md5(string_agg(to_jsonb(e)::text,'|' ORDER BY id)) FROM public.auto_error e) <> '${before.table_md5}' THEN
    RAISE EXCEPTION 'v346 rollback: original table checksum not restored'; END IF;
END $rollback$;`
  const body = [preflight, insert, postflight].join('\n\n')
  const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements,rollback)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'), '${name}',
  ARRAY[${dollar(body, 'migration_body')}],
  ARRAY[replace(${dollar(rollbackBody, 'rollback_body')}, '__APPLIED_ROWS_JSON__', current_setting('aka.v346_receipt'))]);`
  const migration = `-- Data only. Existing rows immutable; new policies active, no runtime mappings added.
-- Production ${ref}. Run through scripts/fb-email-policy-migration.cjs.
-- Backup: migrations/snapshots/fb-email-policies-v346/before-apply.json
-- The original before.json is also retained; prepared-manifest.json identifies the baseline.
${transactionStart}${body}\n${history}\nCOMMIT;\n`
  return { preflight, insert, postflight, body, rollbackBody, migration }
}

function recoverReceipt(before, desired) {
  const histories = query(`SELECT version,name,rollback FROM supabase_migrations.schema_migrations WHERE name='${name}' ORDER BY version;`)
  assert.equal(histories.length, 1, 'Expected exactly one apply history; do not reapply after an unknown response')
  const history = histories[0]
  const body = history.rollback?.[0]
  assert(body, 'Applied history has no rollback receipt')
  const captured = body.match(/expected jsonb := '([^']+)'::jsonb;/)
  assert(captured, 'Could not recover applied-row receipt')
  const receipt = JSON.parse(captured[1])
  assert.equal(receipt.length, desired.length)
  assert.deepEqual(receipt.map(row => row.error_code).sort(), desired.map(row => row.error_code).sort())
  const after = snapshot()
  validateSnapshot(after)
  checkOriginalRows(before, after)
  const current = new Map(after.rows.map(row => [row.row.id, row]))
  for (const row of receipt) {
    assert.equal(current.get(row.id)?.md5, row.md5, 'Applied row drift: ' + row.error_code)
    assert.equal(current.get(row.id)?.row.error_code, row.error_code)
  }
  if (!fs.existsSync(path.join(directory, 'after.json'))) save('after.json', after, true)
  else validateSnapshot(load('after.json'))
  save('applied-manifest.json', { project_ref: ref, version: history.version, name, inserted_rows: receipt,
    original_rows_unchanged: true, verified_at: new Date().toISOString(), after_table_md5: after.table_md5,
    after_sha256: digest(fs.readFileSync(path.join(directory, 'after.json'))),
    migration_sha256: digest(fs.readFileSync(migrationPath)) })
  // Keep the original apply history. Rollback receives its own audit entry.
  const historySQL = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}_rollback',ARRAY[${dollar(body, 'rollback_audit')}]);`
  fs.writeFileSync(rollbackPath, `-- Only rows recorded by apply history ${history.version}. Never reset sequences.
${transactionStart}${body}\n${historySQL}\nCOMMIT;\n`)
  return { history: history.version, old_rows: before.row_count, added_rows: receipt.length, total_rows: after.row_count, checksum: after.table_md5 }
}

function main() {
const mode = process.argv[2]
fs.mkdirSync(directory, { recursive: true })
if (mode === 'capture' || mode === 'capture-apply') {
  const backupFile = mode === 'capture' ? 'before.json' : 'before-apply.json'
  assert(!fs.existsSync(path.join(directory, backupFile)), 'Immutable before snapshot already exists')
  assert.equal(query(`SELECT version FROM supabase_migrations.schema_migrations WHERE name='${name}'`).length, 0, 'Already applied')
  const current = snapshot()
  validateSnapshot(current)
  save(backupFile, current, true)
  validateSnapshot(load(backupFile))
  save(mode === 'capture' ? 'backup-manifest.json' : 'before-apply-manifest.json', { project_ref: ref, migration: name, captured_at: current.captured_at,
    row_count: current.row_count, table_md5: current.table_md5, schema_md5: current.schema_md5,
    before_sha256: digest(fs.readFileSync(path.join(directory, backupFile))),
    row_checksums: current.rows.map(item => ({ id: item.row.id, error_code: item.row.error_code, md5: item.md5 })) }, true)
  console.log(JSON.stringify({ saved: path.relative(root, path.join(directory, backupFile)), count: current.row_count, checksum: current.table_md5 }))
} else {
  const { before, desired, fields, backupFile } = checkedInputs()
  const sql = makeSQL(before, desired, fields)
  if (mode === 'prepare') {
    auditRuntime(desired)
    assert(!fs.existsSync(path.join(directory, 'applied-manifest.json')), 'Already applied; do not regenerate migration')
    fs.writeFileSync(migrationPath, sql.migration)
    fs.writeFileSync(path.join(directory, 'rollback-template.sql'),
      '-- Template only: apply history supplies the exact inserted ID/code/checksum receipt.\n' +
      '-- The unresolved receipt intentionally fails closed. Use the finalized migrations/tests rollback after apply.\n' +
      transactionStart + sql.rollbackBody + '\nCOMMIT;\n')
    save('prepared-manifest.json', { prepared_at: new Date().toISOString(), project_ref: ref,
      desired_count: desired.length, desired_sha256: digest(fs.readFileSync(path.join(directory, 'desired.json'))),
      migration_sha256: digest(sql.migration), backup_file: backupFile, before_sha256: digest(fs.readFileSync(path.join(directory, backupFile))) })
    console.log(JSON.stringify({ prepared: name, count: desired.length, runtime_matches: 0 }))
  } else if (mode === 'smoke' || mode === 'smoke-insert') {
    const initial = snapshot()
    assert.equal(initial.table_md5, before.table_md5)
    const fixtureInsert = sql.insert
      .replace('INSERT INTO public.auto_error (', 'INSERT INTO public.auto_error (id, ')
      .replace('SELECT ' + fields.join(', '), 'SELECT -346000-row_number() OVER (), ' + fields.join(', '))
    const staleGuard = sql.preflight.replace(before.rows[0].md5, '00000000000000000000000000000000')
    const staleTest = `DO $stale_test$ BEGIN
      BEGIN EXECUTE ${dollar(staleGuard, 'stale_sql')}; RAISE EXCEPTION 'TEST: stale checksum accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'v346 guard: original policy changed%' THEN RAISE; END IF; END;
    END $stale_test$;`
    const rollbackFixture = sql.rollbackBody.replace("'__APPLIED_ROWS_JSON__'::jsonb", "current_setting('aka.v346_receipt')::jsonb")
    const tamperedReceipt = rollbackFixture.replace("current_setting('aka.v346_receipt')::jsonb", "jsonb_set(current_setting('aka.v346_receipt')::jsonb,'{0,md5}','\"bad\"'::jsonb)")
    const driftTest = `DO $drift_test$ BEGIN
      BEGIN EXECUTE ${dollar(tamperedReceipt, 'bad_receipt_sql')}; RAISE EXCEPTION 'TEST: changed receipt accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'v346 rollback: new row changed%' THEN RAISE; END IF; END;
    END $drift_test$;`
    const rollbackTest = mode === 'smoke' ? '\n' + rollbackFixture +
      `\nDO $restored$ BEGIN IF (SELECT md5(string_agg(to_jsonb(e)::text,'|' ORDER BY id)) FROM public.auto_error e) <> '${before.table_md5}' THEN RAISE EXCEPTION 'TEST: rollback did not restore snapshot'; END IF; END $restored$;` : ''
    const testSQL = transactionStart + staleTest + '\n' + sql.preflight + '\n' + fixtureInsert + '\n' + sql.postflight + '\n' + driftTest + rollbackTest +
      `\nROLLBACK;\nSELECT '${mode}: insert, unchanged originals, checksum guards passed; no committed changes' AS result;`
    const result = query(testSQL)
    const after = snapshot()
    validateSnapshot(after)
    assert.equal(after.table_md5, before.table_md5)
    assert.deepEqual(after.sequence_state, initial.sequence_state, 'Smoke consumed sequence values')
    save(mode === 'smoke' ? 'smoke.json' : 'insert-smoke.json', { checked_at: new Date().toISOString(), result, original_rows_unchanged: true,
      transaction_rollback_verified: true, delete_rollback_verified: mode === 'smoke', rollback_receipt_guard_verified: true,
      sequence_unchanged: true, schema_unchanged: after.schema_md5 === before.schema_md5,
      migration_sha256: digest(sql.migration), desired_sha256: digest(fs.readFileSync(path.join(directory, 'desired.json'))) })
    console.log(JSON.stringify(result))
  } else if (mode === 'apply') {
    const prepared = load('prepared-manifest.json')
    // The requested pre-apply test is INSERT followed by transaction ROLLBACK.
    // The optional smoke mode also exercises DELETE; its FK scan currently times out.
    // Never claim that an INSERT/ROLLBACK test verifies hard DELETE performance.
    const smoke = load('insert-smoke.json')
    assert.equal(smoke.transaction_rollback_verified, true)
    assert.equal(smoke.rollback_receipt_guard_verified, true)
    assert.equal(digest(sql.migration), prepared.migration_sha256)
    assert.equal(digest(sql.migration), smoke.migration_sha256)
    assert.equal(digest(fs.readFileSync(migrationPath)), smoke.migration_sha256)
    assert.equal(digest(fs.readFileSync(path.join(directory, 'desired.json'))), smoke.desired_sha256)
    auditRuntime(desired)
    console.log('Applying ' + name + '; verified backup + INSERT/ROLLBACK smoke; sha256=' + smoke.migration_sha256)
    query(sql.migration + `SELECT version,name FROM supabase_migrations.schema_migrations WHERE name='${name}';`)
    console.log(JSON.stringify(recoverReceipt(before, desired)))
  } else if (mode === 'verify' || mode === 'recover') {
    console.log(JSON.stringify(recoverReceipt(before, desired)))
  } else if (mode === 'rollback') {
    // Never auto-run this mode: it is for an explicit subsequent revert request.
    auditRuntime(desired)
    const manifest = load('applied-manifest.json')
    assert.equal(manifest.name, name)
    query(fs.readFileSync(rollbackPath, 'utf8') + `SELECT count(*) AS count FROM public.auto_error;`)
    const current = snapshot()
    validateSnapshot(current)
    checkOriginalRows(before, current)
    assert(!current.rows.some(item => manifest.inserted_rows.some(row => row.id === item.row.id)))
    save('reverted.json', current, true)
    console.log(JSON.stringify({ reverted: manifest.inserted_rows.length, table_md5: current.table_md5,
      matches_original_table: current.table_md5 === before.table_md5 }))
  } else throw Error('Usage: node scripts/fb-email-policy-migration.cjs capture|capture-apply|prepare|smoke-insert|smoke|apply|verify|recover|rollback')
}
}
module.exports = { snapshot, validateSnapshot, query, auditRuntime, checkedInputs, makeSQL }
if (require.main === module) main()
