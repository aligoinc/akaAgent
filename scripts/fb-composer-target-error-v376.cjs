// Data-only correction through the existing linked Management API; no DDL/reload.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const { query } = require('./campaign-status-catalog-migration.cjs')
const name = 'migration_v376_fb_composer_target_error'
const dir = path.join(m.root, 'migrations/snapshots/fb-composer-target-error-v376')
const migration = path.join(m.root, 'migrations', name + '.sql')
const code = 'err_fb_composer_editor_not_found'
const schema = `(${m.schemaSQL('auto_error')} #- '{sequence,last_value}')::text`
const tableHash = `(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e)`
const unchangedHash = `(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e WHERE id<>94)`
const rowHash = `(SELECT md5(to_jsonb(e)::text) FROM public.auto_error e WHERE id=94)`
const save = (file, data) => fs.writeFileSync(path.join(dir, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const json = value => m.quote(JSON.stringify(value)) + '::jsonb'
function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL statement_timeout='8s';
    SELECT '${m.ref}' project_ref, clock_timestamp() captured_at,
      ${schema} schema_canonical, ${tableHash} table_md5, ${unchangedHash} other_rows_md5,
      (SELECT count(*) FROM auto_error) row_count,
      (SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(e),'canonical',to_jsonb(e)::text,'md5',md5(to_jsonb(e)::text)) ORDER BY id) FROM auto_error e) rows,
      (SELECT jsonb_agg(jsonb_build_object('table',x.kind,'id',x.id,'md5',x.md5) ORDER BY x.kind,x.id) FROM (
        SELECT 'auto_blocks' kind,id,md5(to_jsonb(b)::text) md5 FROM auto_blocks b WHERE id=27
        UNION ALL SELECT 'auto_workflows',id,md5(to_jsonb(w)::text) FROM auto_workflows w WHERE id IN(1,2,251,252))x) producer_checksums,
      (SELECT jsonb_agg(to_jsonb(h)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6)h) history;
    ROLLBACK;`)[0]
}
function validate(b) {
  assert.equal(b.project_ref, m.ref); assert.equal(b.row_count, b.rows.length)
  const columns = JSON.parse(b.schema_canonical).columns.map(x => x.name).sort()
  for (const r of b.rows) {
    assert.equal(m.hash(r.canonical, 'md5'), r.md5); assert.deepEqual(JSON.parse(r.canonical), r.row)
    assert.deepEqual(Object.keys(r.row).sort(), columns)
  }
  assert.equal(m.hash(b.rows.map(r => r.canonical).join('|'), 'md5'), b.table_md5)
}
function backup() {
  const b = read('before.json'); validate(b)
  assert.equal(m.hash(fs.readFileSync(path.join(dir, 'before.json'))), read('manifest.json').before_sha256)
  return b
}
const start = "BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='8s';\nSELECT id FROM public.auto_error WHERE id=94 FOR UPDATE;\n"
function makeSQL(b) {
  const row = b.rows.find(r => r.row.id === 94)
  assert.equal(row.row.error_code, code); assert.equal(row.row.update_status_campaign, 'chờ xử lý')
  return `${start}DO $preflight$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v376_%') THEN RAISE EXCEPTION 'v376 already applied'; END IF;
    IF md5(${schema}) IS DISTINCT FROM '${m.hash(b.schema_canonical, 'md5')}' THEN RAISE EXCEPTION 'v376 schema drift'; END IF;
    IF ${tableHash} IS DISTINCT FROM '${b.table_md5}' OR ${rowHash} IS DISTINCT FROM '${row.md5}' THEN RAISE EXCEPTION 'v376 catalog drift'; END IF;
  END $preflight$;
  UPDATE public.auto_error SET update_status_campaign=NULL,updated_at=clock_timestamp()
    WHERE id=94 AND error_code='${code}';
  DO $postflight$ BEGIN
    IF (SELECT to_jsonb(e)-'updated_at' FROM public.auto_error e WHERE id=94) IS DISTINCT FROM (${json({ ...row.row, update_status_campaign: null })}-'updated_at') THEN RAISE EXCEPTION 'v376 unexpected target change'; END IF;
    IF ${unchangedHash} IS DISTINCT FROM '${b.other_rows_md5}' THEN RAISE EXCEPTION 'v376 unrelated policy change'; END IF;
  END $postflight$;
COMMIT;\n`
}
function prepare() {
  fs.mkdirSync(dir, { recursive: true }); const b = snapshot(); validate(b)
  save('before.json', b); save('manifest.json', { project_ref: m.ref, captured_at: b.captured_at, row_count: b.row_count,
    before_sha256: m.hash(fs.readFileSync(path.join(dir, 'before.json'))), table_md5: b.table_md5, schema_sha256: m.hash(b.schema_canonical) })
  const sql = makeSQL(backup()); fs.writeFileSync(migration, sql, { flag: 'wx' })
  save('prepared.json', { migration_sha256: m.hash(sql), changed_fields: ['update_status_campaign', 'updated_at'], id: 94, code })
  console.log({ backup_verified: true, rows: b.row_count, prepared: name })
}
function checkedSQL() {
  const sql = fs.readFileSync(migration, 'utf8'); assert.equal(sql, makeSQL(backup()))
  assert.equal(m.hash(sql), read('prepared.json').migration_sha256); return sql
}
function smoke() {
  const b = backup(), sql = checkedSQL(); query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
  assert.equal(snapshot().table_md5, b.table_md5)
  save('apply-smoke.json', { at: new Date().toISOString(), migration_sha256: m.hash(sql), rolled_back: true })
  console.log({ apply_smoke: 'passed', unchanged_after_rollback: true })
}
function apply() {
  const b = backup(), sql = checkedSQL(); assert.equal(read('apply-smoke.json').migration_sha256, m.hash(sql))
  assert.equal(read('runtime-smoke.json').passed, true)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  save('apply-intent.json', { version, name, at: new Date().toISOString() })
  query(sql.replace(/COMMIT;\s*$/, () => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${m.quote(sql)}]); COMMIT;`))
  const a = snapshot(); validate(a); save('after.json', a)
  assert.equal(a.schema_canonical, b.schema_canonical); assert.equal(a.row_count, b.row_count)
  assert.equal(a.other_rows_md5, b.other_rows_md5); assert.deepEqual(a.producer_checksums, b.producer_checksums)
  const old = b.rows.find(r => r.row.id === 94), current = a.rows.find(r => r.row.id === 94)
  assert.deepEqual({ ...current.row, updated_at: old.row.updated_at }, { ...old.row, update_status_campaign: null })
  save('apply.json', { version, name, id: 94, code, md5: current.md5, after_sha256: m.hash(fs.readFileSync(path.join(dir, 'after.json'))), verified_at: new Date().toISOString(), other_rows_unchanged: true, schema_and_producers_unchanged: true })
  save('rollback.sql', `${start}DO $guard$ BEGIN
    IF md5(${schema}) IS DISTINCT FROM '${m.hash(b.schema_canonical, 'md5')}' OR ${rowHash} IS DISTINCT FROM '${current.md5}' THEN RAISE EXCEPTION 'v376 rollback drift: inspect before restoring'; END IF;
  END $guard$;
  UPDATE public.auto_error SET update_status_campaign=${m.quote(old.row.update_status_campaign)},updated_at=${m.quote(old.row.updated_at)}::timestamptz WHERE id=94 AND error_code='${code}';
  -- Keep migration history and all campaign/detail/input/log records unchanged.
COMMIT;\n`)
  save('rollback-manifest.json', { sha256: m.hash(fs.readFileSync(path.join(dir, 'rollback.sql'))) })
  console.log({ applied: name, version, only_policy: code, update_status_campaign: null })
}
function rollbackSmoke() {
  const b = backup(), current = snapshot(), sql = fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8')
  assert.equal(m.hash(sql), read('rollback-manifest.json').sha256)
  const expected = b.rows.find(r => r.row.id === 94).md5
  query(sql.replace(/COMMIT;\s*$/, `DO $check$ BEGIN IF ${rowHash} IS DISTINCT FROM '${expected}' THEN RAISE EXCEPTION 'v376 rollback mismatch'; END IF; END $check$; ROLLBACK;`))
  assert.equal(snapshot().table_md5, current.table_md5)
  save('rollback-smoke.json', { at: new Date().toISOString(), passed: true, restored_row_matches_backup: true, transaction_rolled_back: true })
  console.log({ rollback_smoke: 'passed', correction_still_applied: true })
}
module.exports = { dir, code, read, save, backup }
if (require.main === module) {
  const commands = { prepare, smoke, apply, 'rollback-smoke': rollbackSmoke }
  assert(commands[process.argv[2]]); commands[process.argv[2]]()
}
