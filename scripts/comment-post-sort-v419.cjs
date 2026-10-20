// Scoped data migration through the repository's existing linked Management API.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { query } = require('./campaign-status-catalog-migration.cjs')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/comment-post-sort-v419')
const name = 'migration_v419_comment_post_sort'
const version = '20261020152744'
const migration = path.join(root, 'migrations', name + '.sql')
const workflowIds = [157, 245]
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const json = value => quote(JSON.stringify(value)) + '::jsonb'
const hash = value => createHash('sha256').update(value).digest('hex')
const stripTime = ({ updated_at, ...row }) => row
const save = (file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' })
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const elements = [
  {
    name: 'fb_feed_post_sort_button',
    xpath: "//*[@role='main']//*[@role='button' and not(ancestor::*[@role='article' or @role='dialog']) and (normalize-space(.)='Phù hợp nhất' or normalize-space(.)='Most relevant' or normalize-space(.)='Hoạt động mới đây' or normalize-space(.)='Recent activity' or normalize-space(.)='Bài viết mới' or normalize-space(.)='New posts')]",
    description: 'Nút sắp xếp feed trước khi tìm bài để comment; nhận cả ba trạng thái hiện tại, ngoài bài viết/dialog.'
  },
  {
    name: 'fb_feed_most_relevant_post_option',
    xpath: "//*[@role='menuitemradio' and (contains(.,'Phù hợp nhất') or contains(.,'Most relevant'))]",
    description: 'Lựa chọn Phù hợp nhất trong menu sắp xếp bài viết của feed.'
  }
].map(row => ({ ...row, category: 'facebook', is_builtin: true, staff_id: null, organization_id: null }))

function snapshot() {
  return query(`BEGIN READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='10s';
    SELECT 'cgjbsmqtfhqvttudyjzq' AS project_ref, clock_timestamp() AS captured_at,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_blocks t WHERE id IN(1,2,4,2554,2600)) AS blocks,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_workflows t WHERE id IN(157,206,239,245,246,247)) AS workflows,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_elements t WHERE name IN(
      'fb_most_relevant_btn','fb_recent_activity_post_btn','fb_new_post_btn',${elements.map(e => quote(e.name)).join(',')})) AS elements,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.auto_campaign_actions t
      WHERE id IN('facebook_comment_seeding','facebook_find_data_group','facebook_find_data_search')) AS actions,
    (SELECT jsonb_agg(id ORDER BY id) FROM public.auto_workflows WHERE nodes::text LIKE '%fb_sort_group_posts%') AS consumers,
    (SELECT jsonb_agg(jsonb_build_object('version',version,'name',name)) FROM supabase_migrations.schema_migrations
      WHERE name=${quote(name)}) AS history; ROLLBACK;`)[0]
}
function before() {
  const raw = fs.readFileSync(path.join(dir, 'before.json'))
  assert.equal(hash(raw), load('manifest.json').before_sha256)
  const value = JSON.parse(raw)
  assert.equal(value.project_ref, 'cgjbsmqtfhqvttudyjzq')
  assert.equal(value.history, null)
  assert.deepEqual(value.consumers, [206, 246])
  assert.equal(value.elements.length, 3)
  return value
}
function desired() {
  const b = before()
  const block = structuredClone(b.blocks.find(row => row.id === 2600))
  block.code = fs.readFileSync(path.join(dir, 'comment-sort-prefix.js'), 'utf8') + '\n' + block.code
  const workflows = b.workflows.filter(w => workflowIds.includes(w.id)).map(original => {
    const w = structuredClone(original)
    assert(!w.nodes.some(n => n.id === 'sort_posts'))
    const prepare = w.nodes.find(n => n.id === 'prepare_iters')
    w.nodes.splice(w.nodes.indexOf(prepare), 0, {
      id: 'sort_posts', blockId: 2600, blockName: 'fb_sort_group_posts',
      label: 'Sắp xếp bài viết', position: { x: prepare.position.x + 300, y: prepare.position.y - 50 },
      config: { commentFeedSort: true }
    })
    const edge = w.edges.find(e => e.source === 'sleep_after_nav' && e.target === 'prepare_iters')
    assert(edge)
    edge.id = 'e-sleep_after_nav-sort_posts'; edge.target = 'sort_posts'
    w.edges.push({ id: 'e-sort_posts-prepare_iters', source: 'sort_posts', target: 'prepare_iters' })
    w.default_variables.commentPostSort = 'recent_activity'
    w.variables_schema.push({ name: 'commentPostSort', type: 'string', label: 'Sắp xếp bài viết', default: 'recent_activity' })
    return w
  })
  return { block, workflows, elements }
}
function rowCheck(table, row) {
  return `IF (SELECT to_jsonb(t)-'updated_at' FROM public.${table} t WHERE id=${row.id}) IS DISTINCT FROM ${json(stripTime(row))}
    THEN RAISE EXCEPTION 'V419 drift: ${table} ${row.id}'; END IF;`
}
function checks(b, d, after = false) {
  return [
    ...b.blocks.map(row => rowCheck('auto_blocks', after && row.id === 2600 ? d.block : row)),
    ...b.workflows.map(row => rowCheck('auto_workflows', after ? d.workflows.find(w => w.id === row.id) || row : row)),
    ...b.elements.map(row => rowCheck('auto_elements', row)),
    ...b.actions.map(row => `IF (SELECT to_jsonb(t) FROM public.auto_campaign_actions t WHERE id=${quote(row.id)}) IS DISTINCT FROM ${json(row)}
      THEN RAISE EXCEPTION 'V419 action drift: ${row.id}'; END IF;`),
    `IF (SELECT jsonb_agg(id ORDER BY id) FROM public.auto_workflows WHERE nodes::text LIKE '%fb_sort_group_posts%') IS DISTINCT FROM
      ${json(after ? [157, 206, 245, 246] : b.consumers)} THEN RAISE EXCEPTION 'V419 consumer drift'; END IF;`,
    ...d.elements.map(e => after
      ? `IF (SELECT to_jsonb(t)-ARRAY['id','created_at','updated_at'] FROM public.auto_elements t WHERE name=${quote(e.name)})
          IS DISTINCT FROM ${json(e)} THEN RAISE EXCEPTION 'V419 element drift: ${e.name}'; END IF;`
      : `IF EXISTS(SELECT 1 FROM public.auto_elements WHERE name=${quote(e.name)}) THEN RAISE EXCEPTION 'V419 element collision: ${e.name}'; END IF;`)
  ].join('\n')
}
function sql(rollback = false) {
  const b = before(), d = desired(), block = rollback ? b.blocks.find(r => r.id === 2600) : d.block
  const workflows = rollback ? b.workflows.filter(w => workflowIds.includes(w.id)) : d.workflows
  return `-- V419: comment-feed post sorting. No RPC, schema, campaign or find-data workflow changes.
BEGIN;
SET LOCAL timezone='UTC';
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
LOCK TABLE public.auto_elements,public.auto_blocks,public.auto_workflows,public.auto_campaign_actions IN SHARE ROW EXCLUSIVE MODE;
DO $v419$
BEGIN
${checks(b, d, rollback)}
${rollback ? '' : d.elements.map(e => `INSERT INTO public.auto_elements(${Object.keys(e).join(',')})
  VALUES(${Object.values(e).map(v => v === null ? 'NULL' : typeof v === 'boolean' ? String(v) : quote(v)).join(',')});`).join('\n')}
UPDATE public.auto_blocks SET code=${quote(block.code)},updated_at=${rollback ? quote(block.updated_at) : 'now()'} WHERE id=2600;
${workflows.map(w => `UPDATE public.auto_workflows SET nodes=${json(w.nodes)},edges=${json(w.edges)},default_variables=${json(w.default_variables)},
variables_schema=${json(w.variables_schema)},updated_at=${rollback ? quote(w.updated_at) : 'now()'} WHERE id=${w.id};`).join('\n')}
${rollback ? `DELETE FROM public.auto_elements WHERE name IN(${d.elements.map(e => quote(e.name)).join(',')});` : ''}
${checks(b, d, !rollback)}
END $v419$;
COMMIT;
`
}
function verify() {
  const current = snapshot(), b = before(), d = desired()
  assert.deepEqual(current.blocks.map(stripTime), b.blocks.map(row => stripTime(row.id === 2600 ? d.block : row)))
  assert.deepEqual(current.workflows.map(stripTime), b.workflows.map(row => stripTime(d.workflows.find(w => w.id === row.id) || row)))
  assert.deepEqual(current.actions, b.actions)
  assert.deepEqual(current.elements.filter(e => b.elements.some(x => x.id === e.id)), b.elements)
  for (const element of d.elements) {
    const { id, created_at, updated_at, ...row } = current.elements.find(e => e.name === element.name)
    assert.deepEqual(row, element)
  }
  assert.deepEqual(current.consumers, [157, 206, 245, 246])
  assert.deepEqual(current.history, [{ version, name }])
  return current
}
if (require.main === module) {
  const command = process.argv[2]
  if (command === 'capture') {
    const current = snapshot()
    save('before.json', current)
    save('manifest.json', { project_ref: current.project_ref, captured_at: current.captured_at,
      before_sha256: hash(fs.readFileSync(path.join(dir, 'before.json'))), version, name })
    before()
    console.log('Captured live block/workflows/elements/actions and checksum')
  } else if (command === 'build') {
    assert(!fs.existsSync(path.join(dir, 'apply-intent.json')), 'Do not rebuild an applied migration')
    fs.writeFileSync(migration, sql())
    fs.writeFileSync(path.join(dir, 'rollback.sql'), sql(true))
    fs.writeFileSync(path.join(dir, 'desired.json'), JSON.stringify(desired(), null, 2) + '\n')
    console.log('Built V419 from captured live rows')
  } else if (command === 'test') {
    assert(!fs.existsSync(path.join(dir, 'apply-intent.json')), 'Use verify after apply')
    const pre = snapshot()
    const restore = sql(true).slice(sql(true).indexOf('DO $v419$')).replace(/COMMIT;\s*$/, '')
    query(sql().replace(/COMMIT;\s*$/, () => restore + '\nROLLBACK;'))
    const post = snapshot()
    for (const key of ['blocks', 'workflows', 'elements', 'actions', 'consumers', 'history']) assert.deepEqual(post[key], pre[key])
    fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify({
      checked_at: post.captured_at, apply_restore_rolled_back: true, migration_sha256: hash(sql())
    }, null, 2) + '\n')
    console.log('PASS SQL apply + restore in rollback; exact prior rows preserved')
  } else if (command === 'apply') {
    assert.equal(fs.readFileSync(migration, 'utf8'), sql())
    assert.equal(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8'), sql(true))
    assert.equal(load('validation.json').migration_sha256, hash(sql()))
    save('apply-intent.json', { version, name, migration_sha256: hash(sql()) })
    query(sql().replace(/COMMIT;\s*$/, () => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES(${quote(version)},${quote(name)},ARRAY[${quote(sql())}]); COMMIT;`))
    const current = verify()
    save('after.json', current)
    save('receipt.json', { version, name, verified_at: current.captured_at, migration_sha256: hash(sql()),
      rollback_sha256: hash(sql(true)), block_ids: [2600], workflow_ids: workflowIds })
    console.log('Applied and verified V419')
  } else if (command === 'verify') console.log(JSON.stringify({ verified_at: verify().captured_at, version, name }))
  else throw Error('Usage: capture|build|test|apply|verify')
}
module.exports = { before, desired, dir, elements }
