// DML only, based on the captured linked-production rows. No RPC/schema changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'migrations/snapshots/facebook-top-post-link-v379')
const name = 'migration_v379_facebook_top_post_link'
const blockName = 'fb_get_first_profile_post_link'
const hash = (s, algorithm = 'sha256') => createHash(algorithm).update(s).digest('hex')
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const json = s => quote(JSON.stringify(s)) + '::jsonb'
const migrationPath = path.join(root, 'migrations', name + '.sql')

function backup() {
  const body = fs.readFileSync(path.join(directory, 'before.json'))
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')))
  assert.equal(hash(body), manifest.before_sha256)
  const b = JSON.parse(body)
  assert.equal(b.project_ref, 'cgjbsmqtfhqvttudyjzq')
  for (const rows of Object.values(b.tables)) for (const r of rows) {
    assert.equal(hash(r.canonical, 'md5'), r.md5)
    assert.deepEqual(JSON.parse(r.canonical), r.row)
  }
  return b
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected exactly one source fragment: ${before}`)
  return source.replace(before, after)
}

function desired() {
  const b = backup()
  const group = b.tables.auto_blocks.find(x => x.row.id === 2626).row
  const page = b.tables.auto_blocks.find(x => x.row.id === 2672).row
  let code = replaceOnce(group.code, "helpers.element('GroupPostRawPostLink')", "helpers.element('FbComposerRawPostLink')")
  code = replaceOnce(code, "helpers.element('GroupPostPostLink')", "helpers.element('FbComposerPostLink')")
  code = replaceOnce(code, 'vars.groupPostRawPostLink = rawPostLink;\nvars.groupPostPostUrl = postUrl;\n', '')
  code = replaceOnce(code, 'ok: postUrl.length > 0,', 'ok: true,\n  linkFound: postUrl.length > 0,')
  code = `// Run only after a confirmed ordinary timeline publish; keep missing links best effort.
if (input.posted !== true) return { ok: true, linkFound: false, postUrl: '', link: '' };
try {
await helpers.sleep(3000, signal);
${code}
} catch (error) {
  if (signal.aborted) throw error;
  helpers.log('Chưa lấy được link bài post sau khi đăng');
  return { ok: true, linkFound: false, postUrl: '', link: '' };
}
`
  const { id, created_at, updated_at, ...block } = group
  Object.assign(block, { name: blockName, code,
    description: 'Lấy link bài trên cùng sau khi đăng trang cá nhân thành công bằng raw link + focusin.',
    output_schema: [...block.output_schema.map(field => field.name === 'ok'
      ? { ...field, label: 'Hoàn tất bước lấy link' } : field), { name: 'linkFound', type: 'boolean', label: 'Đã lấy được link' }] })
  let pageCode = replaceOnce(page.code,
    '      try { raw.focus(); } catch {}\n',
    '      try { raw.focus(); } catch {}\n      await new Promise(resolve => setTimeout(resolve, 700));\n')
  pageCode = replaceOnce(pageCode, "const postUrl = String(await getPostUrl() || '').trim()",
    "const postUrl = String(await getPostUrl().catch(() => '') || '').trim()")
  const workflows = b.tables.auto_workflows.filter(x => [2, 251].includes(x.row.id)).map(({ row: w }) => {
    const publish = w.nodes.find(n => n.id === 'click_post')
    assert.equal(publish.blockId, 30)
    assert.equal(publish.config.verifyPostAfterClick, true)
    assert.equal(publish.codeOverride, undefined)
    assert(!w.nodes.some(n => n.id === 'get_post_link'))
    assert(!w.nodes.some(n => n.id === 'nav_profile'))
    assert.deepEqual(w.edges.filter(e => e.source === publish.id),
      [{ id: 'e-click_post-merge_all', source: 'click_post', target: 'merge_all' }])
    assert.deepEqual(w.edges.filter(e => e.target === 'open_composer'),
      [{ id: 'e-merge_compose-open_composer', source: 'merge_compose', target: 'open_composer' }])
    // Both ordinary and copy-source posts converge here; Reels/share keep their existing route.
    const nodes = w.nodes.concat({ id: 'nav_profile', blockId: 5, blockName: 'nav_to_url',
      label: 'Mở trang cá nhân', config: { url: 'https://www.facebook.com/profile.php' },
      position: { x: 300, y: 780 } })
    return { id: w.id, nodes, linkNode: { id: 'get_post_link', blockName,
      label: 'Lấy link bài trên cùng', config: {}, position: { x: publish.position.x, y: publish.position.y + 60 } },
      edges: w.edges.map(e => e.source === publish.id
        ? { ...e, id: 'e-click_post-get_post_link', target: 'get_post_link' }
        : e.target === 'open_composer' ? { ...e, id: 'e-merge_compose-nav_profile', target: 'nav_profile' } : e)
        .concat({ id: 'e-nav_profile-open_composer', source: 'nav_profile', target: 'open_composer' },
          { id: 'e-get_post_link-merge_all', source: 'get_post_link', target: 'merge_all' }) }
  })
  assert.equal(workflows.length, 2)
  return { block, pageCode, workflows }
}

function guards() {
  return Object.entries(backup().tables).flatMap(([table, rows]) => rows.map(r =>
    `IF (SELECT md5(to_jsonb(t)::text) FROM public.${table} t WHERE id=${r.row.id}) IS DISTINCT FROM '${r.md5}' THEN RAISE EXCEPTION 'v379: ${table}/${r.row.id} drift'; END IF;`)).join('\n')
}

function sql() {
  const d = desired()
  const b = backup()
  const fields = Object.keys(d.block)
  const value = v => v == null ? 'NULL' : typeof v === 'string' ? quote(v) : typeof v === 'object' ? json(v) : String(v)
  const checks = d.workflows.map(w => `IF NOT EXISTS(SELECT 1 FROM public.auto_workflows WHERE id=${w.id}
    AND nodes=${json(w.nodes)} || jsonb_build_array(${json(w.linkNode)} || jsonb_build_object('blockId',new_block_id))
    AND edges=${json(w.edges)}) THEN RAISE EXCEPTION 'v379: workflow ${w.id} postflight'; END IF;`).join('\n')
  return `-- Captured live source and rollback: migrations/snapshots/facebook-top-post-link-v379/.
-- Only block/workflow data changes: no DDL, RPC, schema reload, or historical detail writes.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN (5,20,30,2626,2672) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_workflows WHERE id IN (2,226,250,251) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_elements WHERE id IN (1551,1552) ORDER BY id FOR SHARE;
DO $v379$
DECLARE new_block_id bigint;
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v379_%') THEN RAISE EXCEPTION 'v379 already applied'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_blocks WHERE name=${quote(blockName)}) THEN RAISE EXCEPTION 'v379 block already exists'; END IF;
${guards()}
IF (SELECT jsonb_agg(jsonb_build_object('id',id,'workflow_id',workflow_id,'test_workflow_id',test_workflow_id) ORDER BY id) FROM public.auto_campaign_actions WHERE id IN ('facebook_timeline_post','facebook_page_post')) IS DISTINCT FROM ${json(b.actions)} THEN RAISE EXCEPTION 'v379 action mapping drift'; END IF;
INSERT INTO public.auto_blocks (${fields.join(',')}) VALUES (${fields.map(k => value(d.block[k])).join(',')}) RETURNING id INTO new_block_id;
UPDATE public.auto_blocks SET code=${quote(d.pageCode)},updated_at=clock_timestamp() WHERE id=2672;
${d.workflows.map(w => `UPDATE public.auto_workflows SET nodes=${json(w.nodes)} || jsonb_build_array(${json(w.linkNode)} || jsonb_build_object('blockId',new_block_id)),edges=${json(w.edges)},updated_at=clock_timestamp() WHERE id=${w.id};`).join('\n')}
IF (SELECT code FROM public.auto_blocks WHERE id=2672) IS DISTINCT FROM ${quote(d.pageCode)} THEN RAISE EXCEPTION 'v379 page postflight'; END IF;
${checks}
END $v379$;
COMMIT;
`
}

function build() {
  const content = sql(), rollback = rollbackSQL()
  fs.writeFileSync(migrationPath, content)
  fs.writeFileSync(path.join(directory, 'rollback.sql'), rollback)
  fs.writeFileSync(path.join(directory, 'prepared.json'), JSON.stringify({
    project_ref: backup().project_ref, migration_sha256: hash(content), rollback_sha256: hash(rollback)
  }, null, 2) + '\n')
  console.log('Built ' + path.relative(root, migrationPath))
}

function rollbackSQL() {
  const b = backup(), d = desired()
  const oldPage = b.tables.auto_blocks.find(x => x.row.id === 2672).row
  return `-- Restore only v379 changes. Keep the added block for persisted run-step references.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id=2672 FOR UPDATE;
SELECT id FROM public.auto_workflows WHERE id IN (2,251) ORDER BY id FOR UPDATE;
DO $rollback$
DECLARE new_block_id bigint;
BEGIN
SELECT id INTO STRICT new_block_id FROM public.auto_blocks WHERE name=${quote(blockName)};
IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=2672) IS DISTINCT FROM (${json({ ...oldPage, code: d.pageCode })}-'updated_at') THEN RAISE EXCEPTION 'v379 rollback: page drift'; END IF;
${d.workflows.map(w => {
  const old = b.tables.auto_workflows.find(x => x.row.id === w.id).row
  return `IF (SELECT to_jsonb(t)-'updated_at'-'nodes' FROM public.auto_workflows t WHERE id=${w.id}) IS DISTINCT FROM (${json({ ...old, edges: w.edges })}-'updated_at'-'nodes')
OR (SELECT nodes FROM public.auto_workflows WHERE id=${w.id}) IS DISTINCT FROM (${json(w.nodes)} || jsonb_build_array(${json(w.linkNode)} || jsonb_build_object('blockId',new_block_id))) THEN RAISE EXCEPTION 'v379 rollback: workflow ${w.id} drift'; END IF;
UPDATE public.auto_workflows SET nodes=${json(old.nodes)},edges=${json(old.edges)},updated_at=${quote(old.updated_at)} WHERE id=${w.id};`
}).join('\n')}
UPDATE public.auto_blocks SET code=${quote(oldPage.code)},updated_at=${quote(oldPage.updated_at)} WHERE id=2672;
END $rollback$;
COMMIT;
`
}

function snapshot() {
  const scopes = { auto_blocks: `id IN (5,20,30,2626,2672) OR name=${quote(blockName)}`,
    auto_workflows: 'id IN (2,226,250,251)', auto_elements: 'id IN (1551,1552)' }
  return query(`BEGIN READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='8s';
    SELECT jsonb_build_object(${Object.entries(scopes).map(([table, scope]) =>
      `${quote(table)},(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.${table} t WHERE ${scope})`).join(',')}) AS tables,
    (SELECT jsonb_agg(jsonb_build_object('id',id,'workflow_id',workflow_id,'test_workflow_id',test_workflow_id) ORDER BY id) FROM public.auto_campaign_actions WHERE id IN ('facebook_timeline_post','facebook_page_post')) AS actions,
    (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) AS history;
    ROLLBACK;`)[0]
}

function verify() {
  const b = backup(), d = desired(), after = snapshot()
  const block = after.tables.auto_blocks.find(row => row.name === blockName)
  assert(block, 'new link block missing')
  const strip = row => { const copy = { ...row }; delete copy.updated_at; return copy }
  for (const [table, rows] of Object.entries(b.tables)) {
    assert.equal(after.tables[table].length, rows.length + (table === 'auto_blocks' ? 1 : 0))
    for (const { row: original } of rows) {
      let expected = original
      if (table === 'auto_blocks' && original.id === 2672) expected = { ...original, code: d.pageCode }
      const w = table === 'auto_workflows' && d.workflows.find(x => x.id === original.id)
      if (w) expected = { ...original, nodes: w.nodes.concat({ ...w.linkNode, blockId: block.id }), edges: w.edges }
      const actual = after.tables[table].find(row => row.id === original.id)
      assert.deepEqual(strip(actual), strip(expected), `${table}/${original.id}`)
      if (expected === original) assert.deepEqual(actual, original)
    }
  }
  for (const [key, value] of Object.entries(d.block)) assert.deepEqual(block[key], value, key)
  assert.deepEqual(after.actions, b.actions)
  assert.equal(after.history?.length, 1, 'migration history missing/duplicated')
  fs.writeFileSync(path.join(directory, 'after.json'), JSON.stringify(after, null, 2) + '\n')
  console.log({ verified: true, history: after.history, block_id: block.id })
}

function apply() {
  const content = fs.readFileSync(migrationPath, 'utf8')
  const prepared = JSON.parse(fs.readFileSync(path.join(directory, 'prepared.json')))
  assert.equal(content, sql())
  assert.equal(hash(content), prepared.migration_sha256)
  assert.equal(hash(fs.readFileSync(path.join(directory, 'rollback.sql'))), prepared.rollback_sha256)
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  // History is written in the same transaction, without CLI migration-table DDL.
  const applySQL = content.replace(/COMMIT;\s*$/, () =>
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(content)}]); COMMIT;`)
  fs.writeFileSync(path.join(directory, 'apply-intent.json'), JSON.stringify({ version, name, migration_sha256: hash(content) }, null, 2) + '\n', { flag: 'wx' })
  query(applySQL)
  verify()
}

if (require.main === module) {
  const command = { build, apply, verify }[process.argv[2]]
  assert(command, 'Usage: node scripts/facebook-top-post-link-v379.cjs build|apply|verify')
  command()
}
module.exports = { backup, desired, sql, rollbackSQL, query, quote, json, directory, migrationPath, name, blockName, hash }
