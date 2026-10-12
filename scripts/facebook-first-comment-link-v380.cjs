// DML only. Patch exact linked-production rows captured in before.json.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'migrations/snapshots/facebook-first-comment-link-v380')
const name = 'migration_v380_facebook_first_comment_link'
const elementName = 'fb_comment_permalink'
// User tested this exact selector and requested the first match in DOM order.
const xpath = "(//*[@role='dialog' and not(@aria-label='Thông báo') and not(@aria-label='Messenger')])[1]//*[@role='article' and .//*[@class='xt0psk2']]//a[contains(@href,'comment_id=') or contains(@href,'reply_comment_id=')]"
const migrationPath = path.join(root, 'migrations', name + '.sql')
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex')
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const save = (file, value, exclusive = false) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))

function backup() {
  const body = fs.readFileSync(path.join(directory, 'before.json'))
  assert.equal(hash(body), load('manifest.json').before_sha256)
  const b = JSON.parse(body)
  assert.equal(b.project_ref, 'cgjbsmqtfhqvttudyjzq')
  assert.deepEqual(b.producers.map(row => row.id), [34, 2616, 2710])
  assert.equal(b.tables.auto_elements.length, 1)
  for (const rows of Object.values(b.tables)) for (const entry of rows) {
    assert.equal(hash(entry.canonical, 'md5'), entry.md5)
    assert.deepEqual(JSON.parse(entry.canonical), entry.row)
  }
  for (const w of b.workflows) for (const node of w.nodes.filter(n => [34, 2616, 2710].includes(n.blockId))) {
    assert(!node.codeOverride, `workflow ${w.id} overrides comment code`)
  }
  return b
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one source fragment: ${before}`)
  return source.replace(before, after)
}

const collector = `// Read only after comment submit/settle and the existing frequency-limit check.
// Missing links do not retry the comment or change its successful result.
async function getFirstCommentUrl() {
  try {
    const selector = await helpers.element('fb_comment_permalink')
    return await page.evaluate(\`
      const link = document.evaluate(__args[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      return link ? String(link.href || link.getAttribute('href') || '').trim() : '';
    \`, selector)
  } catch (error) {
    if (signal.aborted) throw error
    return ''
  }
}
`

function desired() {
  const b = backup()
  const { id, created_at, updated_at, ...template } = b.tables.auto_elements[0].row
  const element = { ...template, name: elementName, xpath,
    description: 'Link bình luận trong dialog bài viết; sau khi gửi comment lấy href đầu tiên theo thứ tự DOM.' }
  const blocks = b.tables.auto_blocks.map(({ row }) => {
    assert(!row.output_schema.some(field => field.name === 'commentUrl'))
    let code = collector + row.code
    if (row.id === 2710) {
      code = replaceOnce(code, 'state.remainingComment = Math.max', 'const commentUrl = await getFirstCommentUrl()\nstate.remainingComment = Math.max')
      code = replaceOnce(code, '  commented: true,\n', '  commented: true,\n  commentUrl,\n')
    } else {
      const indent = row.id === 34 ? '  ' : ''
      code = replaceOnce(code, indent + 'await throwIfCommentFrequencyLimited()\n',
        indent + 'await throwIfCommentFrequencyLimited()\n' + indent + 'const commentUrl = await getFirstCommentUrl()\n')
      code = replaceOnce(code, 'return { commented: true,', 'return { commented: true, commentUrl,')
    }
    return { ...row, code, output_schema: [...row.output_schema, { name: 'commentUrl', type: 'string', label: 'Link comment' }] }
  })
  return { element, blocks }
}

function guards() {
  const b = backup()
  return [
    ...Object.entries(b.tables).flatMap(([table, rows]) => rows.map(entry =>
      `IF (SELECT md5(to_jsonb(t)::text) FROM public.${table} t WHERE id=${entry.row.id}) IS DISTINCT FROM '${entry.md5}' THEN RAISE EXCEPTION 'v380: ${table}/${entry.row.id} drift'; END IF;`)),
    ...b.workflows.map(w => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=${w.id}) IS DISTINCT FROM '${w.md5}' THEN RAISE EXCEPTION 'v380: workflow/${w.id} drift'; END IF;`)
  ].join('\n')
}

function sql() {
  const d = desired()
  const fields = Object.keys(d.element)
  const value = v => v == null ? 'NULL' : typeof v === 'string' ? quote(v) : typeof v === 'object' ? json(v) : String(v)
  return `-- Source: migrations/snapshots/facebook-first-comment-link-v380/before.json.
-- Data only: no RPC/schema changes, reload, historical detail edits or new connection source.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN (34,2616,2710) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_elements WHERE id=1517 FOR SHARE;
SELECT id FROM public.auto_workflows WHERE id IN (${backup().workflows.map(w => w.id).join(',')}) ORDER BY id FOR SHARE;
DO $v380$
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v380_%') THEN RAISE EXCEPTION 'v380 already applied'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_elements WHERE name=${quote(elementName)}) THEN RAISE EXCEPTION 'v380 element already exists'; END IF;
${guards()}
INSERT INTO public.auto_elements (${fields.join(',')}) VALUES (${fields.map(k => value(d.element[k])).join(',')});
${d.blocks.map(row => `UPDATE public.auto_blocks SET code=${quote(row.code)},output_schema=${json(row.output_schema)},updated_at=clock_timestamp() WHERE id=${row.id};`).join('\n')}
IF (SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' FROM public.auto_elements t WHERE name=${quote(elementName)}) IS DISTINCT FROM ${json(d.element)} THEN RAISE EXCEPTION 'v380 element postflight'; END IF;
${d.blocks.map(row => `IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=${row.id}) IS DISTINCT FROM (${json(row)}-'updated_at') THEN RAISE EXCEPTION 'v380 block/${row.id} postflight'; END IF;`).join('\n')}
END $v380$;
COMMIT;
`
}

function rollbackSQL() {
  const b = backup(), d = desired()
  return `-- Restore only changed block fields; retain the XPath and migration history.
-- Existing comment links and run-step output remain unchanged.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN (34,2616,2710) ORDER BY id FOR UPDATE;
DO $rollback$
BEGIN
${d.blocks.map(row => `IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=${row.id}) IS DISTINCT FROM (${json(row)}-'updated_at') THEN RAISE EXCEPTION 'v380 rollback: block/${row.id} drift'; END IF;`).join('\n')}
${b.tables.auto_blocks.map(({ row }) => `UPDATE public.auto_blocks SET code=${quote(row.code)},output_schema=${json(row.output_schema)},updated_at=${quote(row.updated_at)} WHERE id=${row.id};`).join('\n')}
END $rollback$;
COMMIT;
`
}

function build() {
  assert(!fs.existsSync(path.join(directory, 'apply-intent.json')), 'Do not rebuild an applied migration')
  const content = sql(), rollback = rollbackSQL()
  fs.writeFileSync(migrationPath, content)
  fs.writeFileSync(path.join(directory, 'rollback.sql'), rollback)
  save('prepared.json', { project_ref: backup().project_ref, migration_sha256: hash(content), rollback_sha256: hash(rollback) })
  console.log('Built ' + path.relative(root, migrationPath))
}

function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='8s';
  SELECT clock_timestamp() AS captured_at,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_blocks t WHERE id IN(34,2616,2710)) AS blocks,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_elements t WHERE id=1517 OR name=${quote(elementName)}) AS elements,
    (SELECT jsonb_agg(jsonb_build_object('id',w.id,'md5',md5(to_jsonb(w)::text)) ORDER BY id) FROM public.auto_workflows w WHERE id IN(${backup().workflows.map(w => w.id).join(',')})) AS workflows,
    (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v380_%') AS history;
  ROLLBACK;`)[0]
}

function unchangedDependencies(current) {
  const b = backup()
  assert.deepEqual(current.elements.find(row => row.id === 1517), b.tables.auto_elements[0].row)
  assert.deepEqual(current.workflows, b.workflows.map(({ id, md5 }) => ({ id, md5 })))
}

function preflight() {
  const current = snapshot()
  assert.deepEqual(current.blocks, backup().tables.auto_blocks.map(entry => entry.row))
  assert.equal(current.elements.length, 1, 'element already exists')
  assert(!current.history?.length, 'v380 already applied')
  unchangedDependencies(current)
  save('preflight.json', { ...current, passed: true })
  console.log('Live preflight passed')
}

function verify() {
  const current = snapshot(), d = desired()
  const strip = row => { const copy = { ...row }; delete copy.updated_at; return copy }
  assert.deepEqual(current.blocks.map(strip), d.blocks.map(strip))
  assert.equal(current.elements.length, 2)
  const element = current.elements.find(row => row.name === elementName)
  assert(element)
  for (const [key, value] of Object.entries(d.element)) assert.deepEqual(element[key], value, key)
  unchangedDependencies(current)
  assert.equal(current.history?.length, 1)
  assert.equal(current.history[0].name, name)
  save('after.json', current)
  save('receipt.json', { project_ref: backup().project_ref, verified_at: current.captured_at, history: current.history,
    element_id: element.id, block_ids: d.blocks.map(row => row.id),
    ...load('prepared.json'), after_sha256: hash(fs.readFileSync(path.join(directory, 'after.json'))) })
  console.log(JSON.stringify({ verified: true, element_id: element.id, history: current.history }))
}

function apply() {
  const content = fs.readFileSync(migrationPath, 'utf8'), prepared = load('prepared.json')
  assert.equal(content, sql())
  assert.equal(hash(content), prepared.migration_sha256)
  assert.equal(hash(fs.readFileSync(path.join(directory, 'rollback.sql'))), prepared.rollback_sha256)
  preflight()
  const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const applySQL = content.replace(/COMMIT;\s*$/, () =>
    `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},${quote(name)},ARRAY[${quote(content)}]); COMMIT;`)
  save('apply-intent.json', { version, name, migration_sha256: hash(content) }, true)
  query(applySQL)
  verify()
}

if (require.main === module) {
  const command = { build, preflight, apply, verify }[process.argv[2]]
  assert(command, 'Usage: node scripts/facebook-first-comment-link-v380.cjs build|preflight|apply|verify')
  command()
}
module.exports = { backup, desired, collector, sql, rollbackSQL, quote, json, directory, migrationPath, name, elementName, xpath }
