// DML only, derived from the captured live V380 blocks, never from an old migration.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'migrations/snapshots/facebook-comment-link-tracking-v381')
const name = 'migration_v381_facebook_comment_link_tracking'
const migrationPath = path.join(root, 'migrations', name + '.sql')
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex')
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
const save = (file, value, exclusive = false) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })

function backup() {
  const body = fs.readFileSync(path.join(directory, 'before.json'))
  assert.equal(hash(body), load('manifest.json').before_sha256)
  const b = JSON.parse(body)
  assert.equal(b.project_ref, 'cgjbsmqtfhqvttudyjzq')
  assert.deepEqual(b.tables.auto_blocks.map(entry => entry.row.id), [34, 2616, 2710])
  assert.equal(b.tables.auto_elements.length, 1)
  assert.equal(b.tables.auto_elements[0].row.name, 'fb_comment_permalink')
  for (const entries of Object.values(b.tables)) for (const entry of entries) {
    assert.equal(hash(entry.canonical, 'md5'), entry.md5)
    assert.deepEqual(JSON.parse(entry.canonical), entry.row)
  }
  return b
}

function desired() {
  const before = "      return link ? String(link.href || link.getAttribute('href') || '').trim() : '';"
  const after = `      const raw = link ? String(link.href || link.getAttribute('href') || '').trim() : '';
      if (!raw) return '';
      try {
        const url = new URL(raw, 'https://www.facebook.com');
        // Keep comment/reply and post routing parameters; remove tracking only.
        for (const key of Array.from(url.searchParams.keys())) {
          if (key.startsWith('__') || key.startsWith('utm_') ||
              ['fbclid', 'mibextid', 'ref', 'refid', 'refsrc', 'locale'].includes(key)) {
            url.searchParams.delete(key);
          }
        }
        return url.toString();
      } catch {
        return raw;
      }`
  return backup().tables.auto_blocks.map(({ row }) => {
    assert.equal(row.code.split(before).length, 2, `block/${row.id}: expected one raw href return`)
    return { ...row, code: row.code.replace(before, after) }
  })
}

function sql() {
  const b = backup(), d = desired()
  return `-- Source: migrations/snapshots/facebook-comment-link-tracking-v381/before.json.
-- Data only; no RPC/DDL/schema reload, historical detail edits or new connection source.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN(34,2616,2710) ORDER BY id FOR UPDATE;
SELECT id FROM public.auto_elements WHERE id=1784 FOR SHARE;
SELECT id FROM public.auto_workflows WHERE id IN(${b.workflows.map(w => w.id).join(',')}) ORDER BY id FOR SHARE;
DO $v381$
BEGIN
IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v381_%') THEN RAISE EXCEPTION 'v381 already applied'; END IF;
IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261012220158' AND name='migration_v380_facebook_first_comment_link') THEN RAISE EXCEPTION 'v381: V380 history missing'; END IF;
${Object.entries(b.tables).flatMap(([table, rows]) => rows.map(entry => `IF (SELECT md5(to_jsonb(t)::text) FROM public.${table} t WHERE id=${entry.row.id}) IS DISTINCT FROM '${entry.md5}' THEN RAISE EXCEPTION 'v381: ${table}/${entry.row.id} drift'; END IF;`)).join('\n')}
${b.workflows.map(w => `IF (SELECT md5(to_jsonb(t)::text) FROM public.auto_workflows t WHERE id=${w.id}) IS DISTINCT FROM '${w.md5}' THEN RAISE EXCEPTION 'v381: workflow/${w.id} drift'; END IF;`).join('\n')}
${d.map(row => `UPDATE public.auto_blocks SET code=${quote(row.code)},updated_at=clock_timestamp() WHERE id=${row.id};`).join('\n')}
${d.map(row => `IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=${row.id}) IS DISTINCT FROM (${json(row)}-'updated_at') THEN RAISE EXCEPTION 'v381: block/${row.id} postflight'; END IF;`).join('\n')}
END $v381$;
COMMIT;
`
}

function rollbackSQL() {
  return `-- Restore V380 raw href collection before any V380 rollback. Retain history/details.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='8s';
SELECT id FROM public.auto_blocks WHERE id IN(34,2616,2710) ORDER BY id FOR UPDATE;
DO $rollback$
BEGIN
${desired().map(row => `IF (SELECT to_jsonb(t)-'updated_at' FROM public.auto_blocks t WHERE id=${row.id}) IS DISTINCT FROM (${json(row)}-'updated_at') THEN RAISE EXCEPTION 'v381 rollback: block/${row.id} drift'; END IF;`).join('\n')}
${backup().tables.auto_blocks.map(({ row }) => `UPDATE public.auto_blocks SET code=${quote(row.code)},updated_at=${quote(row.updated_at)} WHERE id=${row.id};`).join('\n')}
END $rollback$;
COMMIT;
`
}

function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='8s';
  SELECT clock_timestamp() AS captured_at,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_blocks t WHERE id IN(34,2616,2710)) AS blocks,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_elements t WHERE id=1784) AS elements,
    (SELECT jsonb_agg(jsonb_build_object('id',t.id,'md5',md5(to_jsonb(t)::text)) ORDER BY id) FROM public.auto_workflows t WHERE id IN(${backup().workflows.map(w => w.id).join(',')})) AS workflows,
    (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v380_%' OR name LIKE 'migration_v381_%') AS history;
  ROLLBACK;`)[0]
}

function unchangedDependencies(current) {
  assert.deepEqual(current.elements, backup().tables.auto_elements.map(entry => entry.row))
  assert.deepEqual(current.workflows, backup().workflows)
}

function build() {
  assert(!fs.existsSync(path.join(directory, 'apply-intent.json')), 'Do not rebuild after apply intent')
  const content = sql(), rollback = rollbackSQL()
  fs.writeFileSync(migrationPath, content)
  fs.writeFileSync(path.join(directory, 'rollback.sql'), rollback)
  save('prepared.json', { project_ref: backup().project_ref, migration_sha256: hash(content), rollback_sha256: hash(rollback) })
  console.log('Built ' + path.relative(root, migrationPath))
}

function preflight() {
  const current = snapshot()
  assert.deepEqual(current.blocks, backup().tables.auto_blocks.map(entry => entry.row))
  assert.deepEqual(current.history, backup().history)
  unchangedDependencies(current)
  save('preflight.json', { ...current, passed: true })
  console.log('Live preflight passed')
}

function verify() {
  const current = snapshot()
  const strip = row => { const copy = { ...row }; delete copy.updated_at; return copy }
  assert.deepEqual(current.blocks.map(strip), desired().map(strip))
  unchangedDependencies(current)
  assert.equal(current.history.length, 2)
  assert.deepEqual(current.history[0], backup().history[0])
  assert.equal(current.history[1].name, name)
  save('after.json', current)
  save('receipt.json', { ...load('prepared.json'), verified_at: current.captured_at, history: current.history,
    block_ids: desired().map(row => row.id), after_sha256: hash(fs.readFileSync(path.join(directory, 'after.json'))) })
  console.log(JSON.stringify({ verified: true, history: current.history, unchanged_element: 1784, unchanged_workflows: current.workflows.length }))
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
  assert(command, 'Usage: node scripts/facebook-comment-link-tracking-v381.cjs build|preflight|apply|verify')
  command()
}
module.exports = { backup, desired, sql, rollbackSQL, quote, json, migrationPath, name }
