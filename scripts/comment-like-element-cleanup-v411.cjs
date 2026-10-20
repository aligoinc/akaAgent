// Remove only the two unused Like elements superseded by V410.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const dir = path.resolve(__dirname, '../migrations/snapshots/comment-like-element-cleanup-v411')
const migration = path.resolve(__dirname, '../migrations/migration_v411_comment_like_element_cleanup.sql')
const name = 'migration_v411_comment_like_element_cleanup'
const version = '20261020075650'
const removed = [1132, 1456]
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const hash = value => createHash('sha256').update(value).digest('hex')
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
function before() {
  const content = fs.readFileSync(path.join(dir, 'before.json'))
  assert.equal(hash(content), load('manifest.json').before_sha256)
  const b = JSON.parse(content)
  assert.equal(b.project_ref, 'cgjbsmqtfhqvttudyjzq')
  assert.equal(b.elements.length, 6)
  assert.deepEqual(b.incoming_fks, [])
  for (const id of removed) {
    const refs = b.references.find(r => r.id === id)
    for (const key of ['blocks', 'workflows', 'errors']) assert.deepEqual(refs[key], [])
  }
  assert.deepEqual(b.references.find(r => r.id === 1787).blocks, [2074, 2615])
  return b
}
function sql() {
  const b = before()
  return `-- Data-only cleanup after V410. Keep combined 1787 and shared parent/newsfeed elements.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
-- Briefly exclude concurrent definition edits while checking named consumers.
LOCK TABLE public.auto_blocks,public.auto_workflows,public.auto_error IN SHARE MODE;
SELECT id FROM public.auto_elements WHERE id IN(${b.elements.map(e => e.row.id)}) ORDER BY id FOR UPDATE;
DO $cleanup$
DECLARE deleted_count integer;
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v411_%') THEN RAISE EXCEPTION 'v411 already applied'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='public.auto_elements'::regclass) THEN RAISE EXCEPTION 'v411 new element foreign key'; END IF;
${b.elements.map(e => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=${e.row.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v411 element ${e.row.id} drift'; END IF;`).join('\n')}
${b.blocks.map(e => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=${e.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v411 block ${e.id} drift'; END IF;`).join('\n')}
${['auto_blocks', 'auto_workflows', 'auto_error'].map(table => `IF EXISTS(SELECT 1 FROM public.${table} t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v411 element still used by ${table}'; END IF;`).join('\n')}
DELETE FROM public.auto_elements WHERE id IN(1132,1456) AND is_builtin IS TRUE;
GET DIAGNOSTICS deleted_count = ROW_COUNT;
IF deleted_count <> 2 THEN RAISE EXCEPTION 'v411 unexpected deleted count %',deleted_count; END IF;
${b.elements.filter(e => !removed.includes(e.row.id)).map(e => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=${e.row.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v411 retained element ${e.row.id} changed'; END IF;`).join('\n')}
END $cleanup$;
COMMIT;
`
}
function rollback() {
  return `-- Run this before a V410 rollback; the old Like block needs element 1456.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
DO $restore$
BEGIN
${before().elements.filter(e => removed.includes(e.row.id)).map(e => `IF EXISTS(SELECT 1 FROM public.auto_elements WHERE id=${e.row.id} OR name=${quote(e.row.name)}) THEN RAISE EXCEPTION 'v411 rollback element ${e.row.id} already exists'; END IF;
INSERT INTO public.auto_elements OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.auto_elements,${json(e.row)});
IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_elements t WHERE id=${e.row.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v411 rollback element ${e.row.id} mismatch'; END IF;`).join('\n')}
END $restore$;
COMMIT;
`
}
function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL timezone='UTC'; SELECT clock_timestamp() AS captured_at,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_elements t WHERE id IN(${before().elements.map(e => e.row.id)})) AS elements,
  (SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'md5',md5(to_jsonb(t)::text)) ORDER BY id) FROM public.auto_blocks t WHERE id IN(${before().blocks.map(e => e.id)})) AS blocks,
  (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) AS history; ROLLBACK;`)[0]
}
function verify() {
  const current = snapshot()
  assert.deepEqual(current.elements, before().elements.filter(e => !removed.includes(e.row.id)).map(e => e.row))
  assert.deepEqual(current.blocks, before().blocks)
  assert.deepEqual(current.history, [{ version, name }])
  return current
}
const command = process.argv[2]
if (require.main === module) {
  if (command === 'build') {
    assert(!fs.existsSync(path.join(dir, 'apply-intent.json')))
    fs.writeFileSync(migration, sql())
    fs.writeFileSync(path.join(dir, 'rollback.sql'), rollback())
    console.log('Built V411 cleanup and rollback')
  } else if (command === 'test') {
    // Execute actual guarded DML and exact restoration in one rolled-back transaction.
    // All statements are still rolled back if any assertion fails.
    const pre = snapshot()
    assert.deepEqual(pre.elements, before().elements.map(e => e.row))
    assert.equal(pre.history, null)
    const restoreBody = rollback().slice(rollback().indexOf('DO $restore$')).replace(/COMMIT;\s*$/, '')
    query(sql().replace(/COMMIT;\s*$/, () => restoreBody + '\nROLLBACK;'))
    const post = snapshot()
    assert.deepEqual(post.elements, pre.elements)
    assert.deepEqual(post.blocks, pre.blocks)
    assert.equal(post.history, null)
    save('validation.json', { tested_at: post.captured_at, live_delete_restore_rolled_back: true, removed_ids: removed, kept_combined_id: 1787 })
    console.log('Live delete/restore rollback passed; database unchanged')
  } else if (command === 'apply') {
    assert.equal(fs.readFileSync(migration, 'utf8'), sql())
    assert.equal(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8'), rollback())
    assert.equal(load('validation.json').live_delete_restore_rolled_back, true)
    save('apply-intent.json', { version, name, migration_sha256: hash(sql()) })
    query(sql().replace(/COMMIT;\s*$/, () => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql())}]); COMMIT;`))
    const current = verify()
    save('after.json', current)
    save('receipt.json', { version, name, verified_at: current.captured_at, removed_ids: removed,
      retained_ids: current.elements.map(e => e.id), migration_sha256: hash(sql()), rollback_sha256: hash(rollback()) })
    console.log(JSON.stringify({ applied: true, version, removed, retained: current.elements.map(e => e.id) }))
  } else if (command === 'verify') {
    console.log(JSON.stringify({ verified: true, captured_at: verify().captured_at }))
  } else throw new Error('Usage: build|test|apply|verify')
}
module.exports = { before, sql, rollback, verify }
