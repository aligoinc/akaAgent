// Data-only migration from an immutable live snapshot. No RPC/schema changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'migrations/snapshots/comment-like-after-v410')
const name = 'migration_v410_comment_like_after'
const migrationPath = path.join(root, 'migrations', name + '.sql')
const elementName = 'fb_comment_post_like_button'
// Exact parent and button XPath tested and approved by the user.
const xpath = "(//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')])[1]//*[@role='button' and (@aria-label='Thích' or @aria-label='Like')]"
const blockIds = [2074, 2615]
const workflowIds = [157, 207, 244, 245]
const consumersSQL = `(SELECT jsonb_agg(jsonb_build_object(
  'workflow_id', w.id, 'node_id', n->>'id', 'block_id', n->>'blockId',
  'override', n->'codeOverride') ORDER BY w.id, n->>'id')
  FROM public.auto_workflows w CROSS JOIN LATERAL jsonb_array_elements(w.nodes) n
  WHERE n->>'blockId' IN ('2074','2615'))`
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex')
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
const save = (file, value, exclusive = false) => fs.writeFileSync(path.join(directory, file),
  JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })

function backup() {
  const content = fs.readFileSync(path.join(directory, 'before.json'))
  assert.equal(hash(content), load('manifest.json').before_sha256)
  const b = JSON.parse(content)
  assert.equal(b.project_ref, 'cgjbsmqtfhqvttudyjzq')
  assert.deepEqual(b.like_consumers.map(c => c.workflow_id), workflowIds)
  assert(b.like_consumers.every(c => !c.override))
  for (const entries of Object.values(b.tables)) for (const e of entries) {
    assert.equal(hash(e.canonical, 'md5'), e.md5)
    assert.deepEqual(JSON.parse(e.canonical), e.row)
  }
  return b
}

function likeCode(delayMs) {
  return `// Require the successful comment output from this same iteration.
// Old/cached workflow ordering cannot run this block before a comment.
const item = vars.loopItem || {}
const position = Number(input.position || item.position || 1)
if (vars.enablePostLike !== true || input.enabled === false || input.commented !== true || input.commentFailed === true) {
  return { liked: false, skipped: true, position }
}
if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }
let result = null
try {
  const selector = await helpers.element('${elementName}')
  if (signal.aborted) return { liked: false, skipped: true, cancelled: true, position }
  result = await page.evaluate(\`
    const button = document.evaluate(__args[0], document, null,
      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!button || !button.isConnected) return { liked: false, skipped: true };
    if (button.getAttribute('aria-pressed') === 'true') {
      return { liked: true, alreadyLiked: true };
    }
    button.scrollIntoView({ block: 'center', inline: 'center' });
    if (!button.isConnected) return { liked: false, skipped: true };
    button.click();
    return { liked: true, alreadyLiked: false };
  \`, selector)
  if (result && result.liked === true) {
    helpers.log(result.alreadyLiked ? 'ℹ️ Bài post đã được thích trước đó' : '👍 Đã thích bài post sau khi comment')
    await helpers.sleep(${delayMs}, signal)
  } else {
    helpers.log('ℹ️ Bỏ qua Like: không tìm thấy nút Thích trong dialog bài vừa comment')
  }
  return { ...(result || { liked: false }), position }
} catch (error) {
  // Like is best effort. Never fail or repeat an already-submitted comment.
  if (signal.aborted) return { ...(result || { liked: false }), cancelled: true, position }
  const message = String(error && error.message || error)
  helpers.log('ℹ️ Bỏ qua Like sau comment: ' + message)
  return { ...(result || { liked: false }), position, error: message }
}
`
}

function desired() {
  const b = backup()
  const template = b.tables.auto_elements.find(e => e.row.id === 1784).row
  const { id, created_at, updated_at, ...element } = template
  Object.assign(element, { name: elementName, xpath,
    description: 'Nút Thích đầu tiên trong dialog bài vừa comment thành công; không tìm trên feed.' })
  const blocks = b.tables.auto_blocks.filter(e => blockIds.includes(e.row.id))
    .map(({ row }) => ({ ...row, code: likeCode(row.id === 2074 ? 1500 : 1200) }))
  const workflows = b.tables.auto_workflows.filter(e => workflowIds.includes(e.row.id)).map(({ row }) => {
    const w = structuredClone(row)
    const comment = w.nodes.find(n => [34, 2616].includes(n.blockId))
    const like = w.nodes.find(n => blockIds.includes(n.blockId))
    const gate = w.nodes.find(n => n.id === 'if_like')
    assert(comment && like && gate)
    assert.equal(gate.config.condition, 'vars.enablePostLike === true')
    assert(w.edges.some(e => e.source === 'loop_comment' && e.target === 'if_like' && e.sourceHandle === 'body'))
    assert(w.edges.some(e => e.source === 'merge_like' && e.target === comment.id))
    gate.config.condition = 'vars.enablePostLike === true && input.commented === true && input.commentFailed !== true'
    // Preserve every label/config except the condition. Reuse the existing branch.
    w.edges = w.edges.filter(e => !(e.source === 'loop_comment' && e.target === 'if_like')
      && !(e.source === 'merge_like' && e.target === comment.id))
    w.edges.push(
      { id: `e-loop_comment-${comment.id}-body`, source: 'loop_comment', sourceHandle: 'body', target: comment.id },
      { id: `e-${comment.id}-if_like`, source: comment.id, target: 'if_like' },
      // if_else returns only branch/conditionResult; this edge carries the comment receipt.
      { id: `e-${comment.id}-${like.id}-result`, source: comment.id, target: like.id },
      // Keep the comment output available at the end of either branch.
      { id: `e-${comment.id}-merge_like-result`, source: comment.id, target: 'merge_like' }
    )
    return w
  })
  return { element, blocks, workflows }
}

const stripTime = row => { const copy = { ...row }; delete copy.updated_at; return copy }
function changed(table, id) {
  return table === 'auto_blocks' ? blockIds.includes(id) : table === 'auto_workflows' && workflowIds.includes(id)
}
function guards() {
  return Object.entries(backup().tables).flatMap(([table, entries]) => entries.map(e =>
    `IF (SELECT md5(to_jsonb(t)::text) FROM public.${table} t WHERE id=${e.row.id}) IS DISTINCT FROM '${e.md5}' THEN RAISE EXCEPTION 'v410: ${table}/${e.row.id} drift'; END IF;`)).join('\n')
}
function sql() {
  const b = backup(), d = desired()
  const fields = Object.keys(d.element)
  const value = v => v == null ? 'NULL' : typeof v === 'boolean' ? String(v) : typeof v === 'string' ? quote(v) : json(v)
  return `-- Exact live source: migrations/snapshots/comment-like-after-v410/before.json.
-- Only 2 Like blocks, 4 seeding workflows and 1 new element; preserve comment blocks/UI labels.
-- DML only: no RPC, schema reload, connection source or historical campaign changes.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
${Object.entries(b.tables).map(([table, entries]) => `SELECT id FROM public.${table} WHERE id IN(${entries.map(e => e.row.id).join(',')}) ORDER BY id FOR UPDATE;`).join('\n')}
DO $v410$
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v410_%') THEN RAISE EXCEPTION 'v410 already applied'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE name=${quote(elementName)}) THEN RAISE EXCEPTION 'v410 element already exists'; END IF;
IF ${consumersSQL} IS DISTINCT FROM ${json(b.like_consumers)} THEN RAISE EXCEPTION 'v410 Like consumers drift'; END IF;
${guards()}
INSERT INTO public.auto_elements (${fields.join(',')}) VALUES (${fields.map(k => value(d.element[k])).join(',')});
${d.blocks.map(row => `UPDATE public.auto_blocks SET code=${quote(row.code)},updated_at=clock_timestamp() WHERE id=${row.id};`).join('\n')}
${d.workflows.map(row => `UPDATE public.auto_workflows SET nodes=${json(row.nodes)},edges=${json(row.edges)},updated_at=clock_timestamp() WHERE id=${row.id};`).join('\n')}
IF (SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.auto_elements t WHERE name=${quote(elementName)}) IS DISTINCT FROM ${json(d.element)} THEN RAISE EXCEPTION 'v410 element postflight'; END IF;
${[['auto_blocks', d.blocks], ['auto_workflows', d.workflows]].flatMap(([table, rows]) => rows.map(row =>
    `IF (SELECT to_jsonb(t)-'updated_at' FROM public.${table} t WHERE id=${row.id}) IS DISTINCT FROM ${json(stripTime(row))} THEN RAISE EXCEPTION 'v410 ${table}/${row.id} postflight'; END IF;`)).join('\n')}
END $v410$;
COMMIT;
`
}

function rollbackSQL() {
  const d = desired()
  return `-- Restore only the Like block code and seeding graph; retain the new element/history.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN(${blockIds}) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_workflows WHERE id IN(${workflowIds}) ORDER BY id FOR UPDATE;
DO $rollback$
BEGIN
${[['auto_blocks', d.blocks], ['auto_workflows', d.workflows]].flatMap(([table, rows]) => rows.map(row =>
    `IF (SELECT to_jsonb(t)-'updated_at' FROM public.${table} t WHERE id=${row.id}) IS DISTINCT FROM ${json(stripTime(row))} THEN RAISE EXCEPTION 'v410 rollback: ${table}/${row.id} drift'; END IF;`)).join('\n')}
${Object.entries(backup().tables).flatMap(([table, entries]) => entries.filter(e => changed(table, e.row.id)).map(({ row }) =>
    `UPDATE public.${table} SET ${table === 'auto_blocks' ? `code=${quote(row.code)}` : `nodes=${json(row.nodes)},edges=${json(row.edges)}`},updated_at=${quote(row.updated_at)} WHERE id=${row.id};`)).join('\n')}
END $rollback$;
COMMIT;
`
}

function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='8s';
SELECT clock_timestamp() AS captured_at,
${Object.entries(backup().tables).map(([table, entries]) =>
    `(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.${table} t WHERE id IN(${entries.map(e => e.row.id)})) AS ${table}`).join(',')},
(SELECT to_jsonb(t) FROM public.auto_elements t WHERE name=${quote(elementName)}) AS element,
${consumersSQL} AS like_consumers,
(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}) AS history;
ROLLBACK;`)[0]
}
function build() {
  assert(!fs.existsSync(path.join(directory, 'apply-intent.json')), 'Already prepared for apply')
  fs.writeFileSync(migrationPath, sql())
  fs.writeFileSync(path.join(directory, 'rollback.sql'), rollbackSQL())
  save('prepared.json', { name, migration_sha256: hash(sql()), rollback_sha256: hash(rollbackSQL()) })
  console.log('Built', name)
}
function preflight() {
  const current = snapshot()
  assert.equal(current.element, null)
  assert.equal(current.history, null)
  assert.deepEqual(current.like_consumers, backup().like_consumers)
  for (const [table, entries] of Object.entries(backup().tables)) assert.deepEqual(current[table], entries.map(e => e.row), table)
  console.log('Live preflight passed')
}
function verify() {
  const current = snapshot(), d = desired()
  assert.deepEqual(current.like_consumers, backup().like_consumers)
  for (const [table, entries] of Object.entries(backup().tables)) for (const { row } of entries) {
    const actual = current[table].find(r => r.id === row.id)
    if (changed(table, row.id)) {
      const expected = (table === 'auto_blocks' ? d.blocks : d.workflows).find(r => r.id === row.id)
      assert.deepEqual(stripTime(actual), stripTime(expected))
    } else assert.deepEqual(actual, row, `unchanged ${table}/${row.id}`)
  }
  const { id, created_at, updated_at, ...element } = current.element
  assert.deepEqual(element, d.element)
  assert.equal(current.history.length, 1)
  save('after.json', current)
  save('receipt.json', { ...load('prepared.json'), verified_at: current.captured_at,
    history: current.history, element_id: id, block_ids: blockIds, workflow_ids: workflowIds,
    unchanged_comment_blocks: [34, 2616], unchanged_workflows: [1, 2, 226, 238],
    after_sha256: hash(fs.readFileSync(path.join(directory, 'after.json'))) })
  console.log(JSON.stringify({ verified: true, history: current.history, element_id: id }))
}
function apply() {
  const content = fs.readFileSync(migrationPath, 'utf8')
  assert.equal(content, sql())
  assert.equal(hash(content), load('prepared.json').migration_sha256)
  assert.equal(hash(fs.readFileSync(path.join(directory, 'rollback.sql'))), load('prepared.json').rollback_sha256)
  preflight()
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  save('apply-intent.json', { version, name, migration_sha256: hash(content) }, true)
  query(content.replace(/COMMIT;\s*$/, () =>
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(content)}]); COMMIT;`))
  verify()
}

module.exports = { backup, desired, sql, rollbackSQL, likeCode, xpath, elementName, blockIds, workflowIds,
  name, directory, migrationPath, quote, json, stripTime }
if (require.main === module) {
  const command = { build, preflight, verify, apply }[process.argv[2]]
  assert(command, 'Usage: build|preflight|verify|apply')
  command()
}
