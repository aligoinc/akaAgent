const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const legacy = require('./comment-like-after-v410.cjs')
const dir = path.resolve(__dirname, '../migrations/snapshots/comment-like-separate-elements-v412')
const migration = path.resolve(__dirname, '../migrations/migration_v412_comment_like_separate_elements.sql')
const name = 'migration_v412_comment_like_separate_elements'
const version = '20261020080439'
const parentName = 'fb_dialog'
const elementName = 'fb_like_button'
const xpath = ".//*[@role='button' and (@aria-label='Thích' or @aria-label='Like')]"
const quote = legacy.quote, json = legacy.json, stripTime = legacy.stripTime
const hash = value => createHash('sha256').update(value).digest('hex')
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
function before() {
  const raw = fs.readFileSync(path.join(dir, 'before.json'))
  assert.equal(hash(raw), load('manifest.json').before_sha256)
  const b = JSON.parse(raw)
  assert.equal(b.project_ref, 'cgjbsmqtfhqvttudyjzq')
  assert.equal(b.history_count, 0)
  assert.equal(b.restored_name_conflicts, 0)
  assert.deepEqual(b.elements.map(e => e.row.id), [1492, 1691, 1696, 1787])
  assert.deepEqual(b.incoming_fks, [])
  return b
}
function desired() {
  const b = before()
  const deleted = require('./comment-like-element-cleanup-v411.cjs').before()
    .elements.filter(e => [1132, 1456].includes(e.row.id)).map(e => structuredClone(e.row))
  const button = deleted.find(e => e.id === 1132)
  button.xpath = xpath
  button.description = 'Nút Thích tìm tương đối bên trong parent được truyền vào; lấy kết quả đầu tiên.'
  const blocks = b.blocks.filter(e => [2074, 2615].includes(e.row.id)).map(({ row }) => {
    const old = legacy.likeCode(row.id === 2074 ? 1500 : 1200)
    assert.equal(row.code, old, 'Only patch the exact V410 Like code')
    const code = old.replace("const selector = await helpers.element('fb_comment_post_like_button')",
      `const parentSelector = await helpers.element('${parentName}')
  const selector = await helpers.element('${elementName}')
  // An already-open app may still cache the former absolute selector.
  if (typeof selector !== 'string' || !selector.trim().startsWith('.//')) {
    helpers.log('ℹ️ Bỏ qua Like: cần khởi động lại ứng dụng để nạp XPath nút Like tương đối')
    return { liked: false, skipped: true, reason: 'stale_like_selector', position }
  }`)
      .replace('const button = document.evaluate(__args[0], document, null,',
        `const parent = document.evaluate(__args[0], document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!parent || !parent.isConnected) return { liked: false, skipped: true };
    const button = document.evaluate(__args[1], parent, null,`)
      .replace('if (!button || !button.isConnected)', 'if (!button || !button.isConnected || !parent.contains(button))')
      .replace('`, selector)', '`, parentSelector, selector)')
    assert(!code.includes('fb_comment_post_like_button'))
    return { ...row, code }
  })
  const elements = [...b.elements.filter(e => e.row.id !== 1787).map(e => e.row), ...deleted]
    .sort((a, c) => a.id - c.id)
  return { blocks, elements }
}
const elementCheck = (row, ignoreTime = false) =>
  `IF (SELECT to_jsonb(t)${ignoreTime ? "-'updated_at'" : ''} FROM public.auto_elements t WHERE id=${row.id}) IS DISTINCT FROM ${json(ignoreTime ? stripTime(row) : row)} THEN RAISE EXCEPTION 'v412 element ${row.id} mismatch'; END IF;`
function sql() {
  const b = before(), d = desired()
  return `-- Separate reusable parent/button elements; keep the V410 comment -> Like graph.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
LOCK TABLE public.auto_blocks,public.auto_workflows,public.auto_error IN SHARE MODE;
SELECT id FROM public.auto_elements WHERE id IN(1132,1456,1492,1691,1696,1787) ORDER BY id FOR UPDATE;
DO $split$
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v412_%') THEN RAISE EXCEPTION 'v412 already applied'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE id IN(1132,1456) OR name IN('fb_like_button','fb_like_button_at_n')) THEN RAISE EXCEPTION 'v412 restore collision'; END IF;
IF EXISTS(SELECT 1 FROM pg_constraint WHERE confrelid='public.auto_elements'::regclass) THEN RAISE EXCEPTION 'v412 element foreign key changed'; END IF;
${b.elements.map(e => elementCheck(e.row)).join('\n')}
${b.blocks.map(e => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_blocks t WHERE id=${e.row.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v412 block ${e.row.id} drift'; END IF;`).join('\n')}
${b.workflows.map(e => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=${e.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v412 workflow ${e.id} drift'; END IF;`).join('\n')}
${d.elements.filter(e => [1132, 1456].includes(e.id)).map(row =>
    `INSERT INTO public.auto_elements OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.auto_elements,${json(row)});`).join('\n')}
UPDATE public.auto_elements SET updated_at=clock_timestamp() WHERE id=1132;
${d.blocks.map(row => `UPDATE public.auto_blocks SET code=${quote(row.code)},updated_at=clock_timestamp() WHERE id=${row.id};`).join('\n')}
${['auto_blocks', 'auto_workflows', 'auto_error'].map(table =>
    `IF EXISTS(SELECT 1 FROM public.${table} t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_comment_post_like_button([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v412 combined element still used by ${table}'; END IF;`).join('\n')}
DELETE FROM public.auto_elements WHERE id=1787 AND name='fb_comment_post_like_button';
${d.elements.map(e => elementCheck(e, e.id === 1132)).join('\n')}
${d.blocks.map(row =>
    `IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=${row.id}) IS DISTINCT FROM ${json(stripTime(row))} THEN RAISE EXCEPTION 'v412 block ${row.id} postflight'; END IF;`).join('\n')}
END $split$;
COMMIT;
`
}
function rollback() {
  const b = before(), d = desired()
  const combined = b.elements.find(e => e.row.id === 1787).row
  return `-- Restore the exact state after V411. Keep migration history.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
LOCK TABLE public.auto_blocks,public.auto_workflows,public.auto_error IN SHARE MODE;
SELECT id FROM public.auto_elements WHERE id IN(1132,1456,1787) ORDER BY id FOR UPDATE;
DO $restore$
BEGIN
${d.elements.filter(e => [1132, 1456].includes(e.id)).map(e => elementCheck(e, e.id === 1132)).join('\n')}
${d.blocks.map(row =>
    `IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=${row.id}) IS DISTINCT FROM ${json(stripTime(row))} THEN RAISE EXCEPTION 'v412 rollback block ${row.id} drift'; END IF;`).join('\n')}
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE id=1787 OR name='fb_comment_post_like_button') THEN RAISE EXCEPTION 'v412 rollback collision'; END IF;
INSERT INTO public.auto_elements OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_record(NULL::public.auto_elements,${json(combined)});
${b.blocks.filter(e => [2074, 2615].includes(e.row.id)).map(({ row }) =>
    `UPDATE public.auto_blocks SET code=${quote(row.code)},updated_at=${quote(row.updated_at)} WHERE id=${row.id};`).join('\n')}
${['auto_blocks', 'auto_workflows', 'auto_error'].map(table =>
    `IF EXISTS(SELECT 1 FROM public.${table} t WHERE to_jsonb(t)::text ~ '(^|[^a-zA-Z0-9_])fb_like_button(_at_n)?([^a-zA-Z0-9_]|$)') THEN RAISE EXCEPTION 'v412 rollback restored elements still used by ${table}'; END IF;`).join('\n')}
DELETE FROM public.auto_elements WHERE id IN(1132,1456);
END $restore$;
COMMIT;
`
}
function snapshot() {
  return query(`BEGIN READ ONLY;SET LOCAL timezone='UTC';SET LOCAL statement_timeout='8s';SELECT clock_timestamp() AS captured_at,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_elements t WHERE id IN(1132,1456,1492,1691,1696,1787)) AS elements,
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_blocks t WHERE id IN(34,2074,2615,2616)) AS blocks,
  (SELECT jsonb_agg(jsonb_build_object('id',id,'md5',md5(to_jsonb(t)::text)) ORDER BY id) FROM public.auto_workflows t WHERE id IN(1,2,157,207,226,238,244,245)) AS workflows,
  (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) AS history;ROLLBACK;`)[0]
}
function verify() {
  const current = snapshot(), b = before(), d = desired()
  assert.deepEqual(current.elements.map(stripTime), d.elements.map(stripTime))
  assert.deepEqual(current.blocks.map(stripTime),
    b.blocks.map(e => d.blocks.find(r => r.id === e.row.id) || e.row).map(stripTime))
  assert.deepEqual(current.workflows, b.workflows)
  assert.deepEqual(current.history, [{ version, name }])
  return current
}
if (require.main === module) {
  const command = process.argv[2]
  if (command === 'build') {
    assert(!fs.existsSync(path.join(dir, 'apply-intent.json')))
    fs.writeFileSync(migration, sql())
    fs.writeFileSync(path.join(dir, 'rollback.sql'), rollback())
    console.log('Built V412')
  } else if (command === 'test') {
    const pre = snapshot()
    assert.deepEqual(pre.elements, before().elements.map(e => e.row))
    assert.deepEqual(pre.blocks, before().blocks.map(e => e.row))
    assert.deepEqual(pre.workflows, before().workflows)
    assert.equal(pre.history, null)
    const restore = rollback().slice(rollback().indexOf('DO $restore$')).replace(/COMMIT;\s*$/, '')
    query(sql().replace(/COMMIT;\s*$/, () => restore + '\nROLLBACK;'))
    const post = snapshot()
    for (const key of ['elements', 'blocks', 'workflows', 'history']) assert.deepEqual(post[key], pre[key])
    save('validation.json', { tested_at: post.captured_at, live_apply_restore_rolled_back: true, migration_sha256: hash(sql()) })
    console.log('Live apply/restore rolled back; exact prior state preserved')
  } else if (command === 'apply') {
    assert.equal(fs.readFileSync(migration, 'utf8'), sql())
    assert.equal(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8'), rollback())
    assert.equal(load('validation.json').migration_sha256, hash(sql()))
    save('apply-intent.json', { version, name, migration_sha256: hash(sql()) })
    query(sql().replace(/COMMIT;\s*$/, () =>
      `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql())}]);COMMIT;`))
    const current = verify()
    save('after.json', current)
    save('receipt.json', { version, name, verified_at: current.captured_at,
      restored_ids: [1132, 1456], parent_id: 1492, button_id: 1132, removed_combined_id: 1787,
      migration_sha256: hash(sql()), rollback_sha256: hash(rollback()) })
    console.log(JSON.stringify({ applied: true, version, parent: 1492, button: 1132, restored: [1132, 1456], removed: 1787 }))
  } else if (command === 'verify') console.log(JSON.stringify({ verified: true, captured_at: verify().captured_at }))
  else throw new Error('Usage: build|test|apply|verify')
}
module.exports = { before, desired, parentName, elementName, xpath, dir }
