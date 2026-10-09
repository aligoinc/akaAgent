// One policy correction through the existing linked Management API; no DDL/reload.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const { query } = require('./campaign-status-catalog-migration.cjs')
const name = 'migration_v378_zalo_222_accepted'
const dir = path.join(m.root, 'migrations/snapshots/zalo-222-accepted-v378')
const migration = path.join(m.root, 'migrations', name + '.sql')
const code = 'err_zalo_friend_request_sent', id = 31
const patch = {
  error_name: 'Đã chấp nhận lời mời kết bạn',
  error_desc: 'Zalo trả mã 222 “Tự động kết bạn”: đối phương đã gửi lời mời đến, thao tác kết bạn được xử lý thành chấp nhận lời mời.',
  noti_running_process: 'Đã chấp nhận lời mời kết bạn',
  noti_campaign: 'Đã chấp nhận lời mời kết bạn',
  detail_status: 'thành công',
  counts_toward_limit: true,
  zalo_action_codes: ['zalo_add_friend']
}
const schema = `(${m.schemaSQL('auto_error')} #- '{sequence,last_value}')::text`
const tableHash = `(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e)`
const otherHash = `(SELECT md5(coalesce(string_agg(to_jsonb(e)::text,'|' ORDER BY id),'')) FROM public.auto_error e WHERE id<>${id})`
const rowHash = `(SELECT md5(to_jsonb(e)::text) FROM public.auto_error e WHERE id=${id})`
const dependencySQL = `jsonb_build_object(
  'success_status',(SELECT to_jsonb(s) FROM public.auto_status s WHERE id=20),
  'success_policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.auto_account_action_status_policies p WHERE status_id=20 AND (action_code IS NULL OR action_code='zalo_add_friend')),
  'action',(SELECT to_jsonb(a) FROM public.auto_account_actions a WHERE code='zalo_add_friend'))`
const historicalSQL = `(SELECT jsonb_agg(jsonb_build_object('id',d.id,'md5',md5(to_jsonb(d)::text)) ORDER BY d.id)
  FROM public.auto_campaign_details d WHERE d.id IN (4849598,4849599,4849600,4849603,4849604,4849605,4849624,4849625,4849631,4849637,4849640))`
const save = (file, data) => fs.writeFileSync(path.join(dir, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const json = value => m.quote(JSON.stringify(value)) + '::jsonb'
const start = `BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='8s';\nSELECT id FROM public.auto_error WHERE id=${id} FOR UPDATE;\n`
function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL statement_timeout='8s';
    SELECT '${m.ref}' project_ref,clock_timestamp() captured_at,${schema} schema_canonical,
      ${tableHash} table_md5,${otherHash} other_rows_md5,(SELECT count(*) FROM public.auto_error) row_count,
      (SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(e),'canonical',to_jsonb(e)::text,'md5',md5(to_jsonb(e)::text)) ORDER BY id) FROM public.auto_error e) rows,
      ${dependencySQL} dependencies,${historicalSQL} historical_checksums,
      (SELECT jsonb_agg(to_jsonb(h)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 8) h) history;
    ROLLBACK;`)[0]
}
function validate(b) {
  assert.equal(b.project_ref, m.ref); assert.equal(b.row_count, b.rows.length)
  assert.equal(new Set(b.rows.map(r => r.row.id)).size, b.row_count)
  const columns = JSON.parse(b.schema_canonical).columns.map(x => x.name).sort()
  for (const r of b.rows) {
    assert.equal(m.hash(r.canonical, 'md5'), r.md5); assert.deepEqual(JSON.parse(r.canonical), r.row)
    assert.deepEqual(Object.keys(r.row).sort(), columns)
  }
  assert.equal(m.hash(b.rows.map(r => r.canonical).join('|'), 'md5'), b.table_md5)
  assert.equal(m.hash(b.rows.filter(r => r.row.id !== id).map(r => r.canonical).join('|'), 'md5'), b.other_rows_md5)
}
function backup() {
  const b = read('before.json'); validate(b)
  assert.equal(m.hash(fs.readFileSync(path.join(dir, 'before.json'))), read('manifest.json').before_sha256)
  return b
}
function oldRow(b) { return b.rows.find(r => r.row.id === id) }
function expectedRow(b) {
  return `(${json({ ...oldRow(b).row, ...patch })} || jsonb_build_object('updated_at',${m.quote(b.captured_at)}::timestamptz))`
}
function assignments(values) {
  return Object.entries(values).map(([k, value]) => `${k}=${Array.isArray(value)
    ? `ARRAY[${value.map(m.quote).join(',')}]::text[]`
    : value === null ? 'NULL' : m.quote(value)}`).join(',\n    ')
}
function makeSQL(b) {
  const old = oldRow(b)
  assert.equal(old.row.error_code, code); assert.deepEqual(old.row.zalo_error_codes, ['222'])
  assert.equal(old.row.detail_status, 'đã gửi lời mời'); assert.equal(old.row.counts_toward_limit, false)
  assert.deepEqual(old.row.zalo_action_codes, []); assert.equal(old.row.counts_toward_bad_target, false)
  assert.equal(old.row.update_status_campaign, null); assert.equal(old.row.detail_mode, null)
  assert.equal(b.dependencies.success_status.code, 'campaign_detail_success')
  assert(b.dependencies.success_policies.some(p => p.action_code === null && p.is_active && !p.is_delete && p.report_group === 'success'))
  return `${start}DO $preflight$ BEGIN
    IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v378_%') THEN RAISE EXCEPTION 'v378 already applied'; END IF;
    IF md5(${schema}) IS DISTINCT FROM '${m.hash(b.schema_canonical, 'md5')}' THEN RAISE EXCEPTION 'v378 schema drift'; END IF;
    IF ${tableHash} IS DISTINCT FROM '${b.table_md5}' OR ${rowHash} IS DISTINCT FROM '${old.md5}' THEN RAISE EXCEPTION 'v378 catalog drift'; END IF;
    IF ${dependencySQL} IS DISTINCT FROM ${json(b.dependencies)} THEN RAISE EXCEPTION 'v378 dependent policy drift'; END IF;
  END $preflight$;
  UPDATE public.auto_error SET ${assignments(patch)},updated_at=${m.quote(b.captured_at)}::timestamptz
    WHERE id=${id} AND error_code='${code}';
  DO $postflight$ BEGIN
    IF (SELECT to_jsonb(e) FROM public.auto_error e WHERE id=${id}) IS DISTINCT FROM ${expectedRow(b)} THEN RAISE EXCEPTION 'v378 unexpected target change'; END IF;
    IF ${otherHash} IS DISTINCT FROM '${b.other_rows_md5}' THEN RAISE EXCEPTION 'v378 unrelated policy change'; END IF;
  END $postflight$;
COMMIT;\n`
}
function rollbackSQL(b) {
  const old = oldRow(b).row
  return `${start}DO $guard$ BEGIN
    IF md5(${schema}) IS DISTINCT FROM '${m.hash(b.schema_canonical, 'md5')}'
      OR (SELECT to_jsonb(e) FROM public.auto_error e WHERE id=${id}) IS DISTINCT FROM ${expectedRow(b)} THEN
      RAISE EXCEPTION 'v378 rollback drift: inspect before restoring'; END IF;
  END $guard$;
  UPDATE public.auto_error SET ${assignments(Object.fromEntries(Object.keys(patch).map(k => [k, old[k]])))},updated_at=${m.quote(old.updated_at)}::timestamptz
    WHERE id=${id} AND error_code='${code}';
  DO $check$ BEGIN IF ${rowHash} IS DISTINCT FROM '${oldRow(b).md5}' THEN RAISE EXCEPTION 'v378 rollback mismatch'; END IF; END $check$;
  -- Restore configuration for future runs only. Preserve history, details, counters and logs.
COMMIT;\n`
}
function prepare() {
  fs.mkdirSync(dir, { recursive: true }); const b = snapshot(); validate(b)
  save('before.json', b); save('manifest.json', { project_ref: m.ref, captured_at: b.captured_at, row_count: b.row_count,
    before_sha256: m.hash(fs.readFileSync(path.join(dir, 'before.json'))), table_md5: b.table_md5, schema_sha256: m.hash(b.schema_canonical) })
  const checked = backup(), sql = makeSQL(checked), undo = rollbackSQL(checked)
  fs.writeFileSync(migration, sql, { flag: 'wx' }); save('rollback.sql', undo)
  save('prepared.json', { migration_sha256: m.hash(sql), rollback_sha256: m.hash(undo), changed_fields: [...Object.keys(patch), 'updated_at'], id, code, before: oldRow(b).row, patch })
  console.log({ backup_verified: true, rows: b.row_count, prepared: name })
}
function checkedSQL() {
  const b = backup(), sql = fs.readFileSync(migration, 'utf8'), undo = fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8')
  assert.equal(sql, makeSQL(b)); assert.equal(m.hash(sql), read('prepared.json').migration_sha256)
  assert.equal(undo, rollbackSQL(b)); assert.equal(m.hash(undo), read('prepared.json').rollback_sha256)
  return sql
}
function unchanged(b, a) {
  validate(a); assert.equal(a.schema_canonical, b.schema_canonical); assert.equal(a.row_count, b.row_count)
  assert.equal(a.other_rows_md5, b.other_rows_md5); assert.deepEqual(a.dependencies, b.dependencies)
  assert.deepEqual(a.historical_checksums, b.historical_checksums)
}
function smoke() {
  const b = backup(), sql = checkedSQL(); query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
  const a = snapshot(); unchanged(b, a); assert.equal(a.table_md5, b.table_md5)
  save('apply-smoke.json', { at: new Date().toISOString(), migration_sha256: m.hash(sql), rolled_back: true })
  console.log({ apply_smoke: 'passed', unchanged_after_rollback: true })
}
function apply() {
  const sql = checkedSQL(); assert.equal(read('apply-smoke.json').migration_sha256, m.hash(sql))
  assert.equal(read('runtime-smoke.json').passed, true)
  assert.equal(read('rollback-rehearsal.json').passed, true)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  save('apply-intent.json', { version, name, at: new Date().toISOString() })
  query(sql.replace(/COMMIT;\s*$/, () => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${m.quote(sql)}]); COMMIT;`))
  verify()
}
function verify() {
  const b = backup(), a = snapshot(); unchanged(b, a)
  const old = oldRow(b).row, current = oldRow(a)
  assert.deepEqual({ ...current.row, updated_at: old.updated_at }, { ...old, ...patch })
  assert.equal(new Date(current.row.updated_at).getTime(), new Date(b.captured_at).getTime())
  const intent = read('apply-intent.json'); assert(a.history.some(h => h.version === intent.version && h.name === name))
  save('after.json', a)
  save('apply.json', { ...intent, id, code, md5: current.md5, after_sha256: m.hash(fs.readFileSync(path.join(dir, 'after.json'))), verified_at: new Date().toISOString(), other_rows_unchanged: true, schema_dependencies_and_historical_details_unchanged: true })
  console.log({ applied: name, version: intent.version, other_rows_unchanged: a.row_count - 1 })
}
function rollbackSmoke() {
  const b = backup(), current = snapshot(), sql = fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8')
  assert.equal(m.hash(sql), read('prepared.json').rollback_sha256)
  query(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
  const a = snapshot(); unchanged(current, a); assert.equal(a.table_md5, current.table_md5)
  save('rollback-smoke.json', { at: new Date().toISOString(), passed: true, restored_row_md5: oldRow(b).md5, transaction_rolled_back: true })
  console.log({ rollback_smoke: 'passed', correction_still_applied: true })
}
module.exports = { dir, code, id, patch, read, save, backup }
if (require.main === module) {
  const commands = { prepare, smoke, apply, verify, 'rollback-smoke': rollbackSmoke }
  assert(commands[process.argv[2]]); commands[process.argv[2]]()
}
