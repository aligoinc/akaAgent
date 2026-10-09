// Two read RPC bodies only. Reuses the linked Management API; no SQL pool.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { query, hash } = require('./campaign-status-catalog-migration.cjs')
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const root = path.resolve(__dirname, '..'), ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v372_detail_status_query'
const dir = path.join(root, 'migrations/snapshots/detail-status-query-v372')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const before = read('before.json'), manifest = read('backup-manifest.json')
assert.equal(before.project_ref, ref)
assert.equal(hash(fs.readFileSync(path.join(dir, 'before.json'))), manifest.before_sha256)
assert.equal(before.functions.length, 2)
for (const f of before.functions) assert.equal(hash(f.definition, 'md5'), f.md5)
// Verify the captured current live body against the latest repository patch,
// without using that historical migration as the replacement source.
const prior = require('./action-status-compatibility-v367.cjs')
for (const f of before.functions) assert.equal(prior.targets.find(t => t.signature === f.signature)?.definition, f.definition)
function replace(source, old, value) {
  assert.equal(source.split(old).length, 2, 'Expected one fragment: ' + old)
  return source.replace(old, () => value)
}
function patch(definition) {
  let sql = replace(definition, '  v_direction text;', `  v_direction text;
  v_status_ids bigint[];
  v_search_ids bigint[];
  v_count_sql text;
  v_page_sql text;
  v_branch_order text;`)
  sql = replace(sql, `  IF v_status IS NOT NULL THEN
    v_where := v_where || ' AND (d.status = $2 OR EXISTS (
      SELECT 1 FROM public.auto_status filter_status
      WHERE filter_status.id IN (d.status_id,d.sub_status_id)
        AND (filter_status.status_value=$2 OR lower(filter_status.name)=lower($2))))';
  END IF;`, `  -- Resolve the small catalog once, not once per matching detail. STABLE
  -- keeps these reads in the caller's snapshot, including the payload below.
  -- Keep historical/inactive catalog entries and the exact legacy comparisons.
  IF v_status IS NOT NULL THEN
    v_status_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.status_value=v_status OR lower(s.name)=lower(v_status));
  END IF;`)
  sql = replace(sql, `  IF v_search IS NOT NULL THEN
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5
      OR EXISTS (SELECT 1 FROM public.auto_status search_status
        WHERE search_status.id IN (d.status_id,d.sub_status_id)
          AND (search_status.name ILIKE $5 OR search_status.status_value ILIKE $5)))';
  END IF;`, `  IF v_search IS NOT NULL THEN
    v_search_ids := ARRAY(SELECT s.id FROM public.auto_status s
      WHERE s.name ILIKE '%' || v_search || '%' OR s.status_value ILIKE '%' || v_search || '%');
    v_where := v_where || ' AND (d.action_name ILIKE $5 OR d.action_code ILIKE $5
      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5';
    IF cardinality(v_search_ids)>0 THEN
      v_where := v_where || ' OR d.status_id=ANY($9) OR d.sub_status_id=ANY($9)';
    END IF;
    v_where := v_where || ')';
  END IF;`)
  sql = replace(sql, "  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;", `  v_direction := CASE WHEN v_sort = 'created_asc' THEN 'ASC' ELSE 'DESC' END;
  -- Count text matches with the existing covering status index. The second
  -- branch only counts additional main/sub-status matches: no double counting,
  -- even when both IDs match, or when the legacy text is NULL.
  v_count_sql := 'SELECT count(*) FROM public.auto_campaign_details AS d WHERE ' || v_where;
  v_page_sql := 'SELECT d.id, d.created_at FROM public.auto_campaign_details AS d WHERE ' || v_where;
  IF v_status IS NOT NULL THEN
    v_count_sql := 'SELECT (' || v_count_sql || ' AND d.status = $2)';
    v_page_sql := v_page_sql || ' AND d.status = $2';
    IF cardinality(v_status_ids)>0 THEN
      v_count_sql := v_count_sql || ' + (SELECT count(*) FROM public.auto_campaign_details AS d WHERE '
        || v_where || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8)))';
      -- The same disjoint branches avoid a full campaign scan when a status
      -- has no matches. Each ordered prefix is sufficient for the final page;
      -- only the outer query applies OFFSET. bigint prevents integer overflow.
      v_branch_order := ' ORDER BY d.created_at ' || v_direction || ', d.id ' || v_direction
        || ' LIMIT ($6::bigint + $7::bigint)';
      v_page_sql := '(' || v_page_sql || v_branch_order || ') UNION ALL (SELECT d.id, d.created_at'
        || ' FROM public.auto_campaign_details AS d WHERE ' || v_where
        || ' AND d.status IS DISTINCT FROM $2 AND (d.status_id=ANY($8) OR d.sub_status_id=ANY($8))'
        || v_branch_order || ')';
    END IF;
  END IF;`)
  sql = replace(sql, `      FROM public.auto_campaign_details AS d
      WHERE %1$s`, '      FROM (%1$s) AS d')
  sql = replace(sql, "'total', (SELECT count(*) FROM public.auto_campaign_details AS d WHERE %1$s)", "'total', (%3$s)")
  sql = replace(sql, '$query$, v_where, v_direction)', '$query$, v_page_sql, v_direction, v_count_sql)')
  sql = replace(sql, "'%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0);", "'%' || v_search || '%', COALESCE(p_limit,100), COALESCE(p_offset,0), v_status_ids, v_search_ids;")
  return sql
}
const targets = before.functions.map(f => {
  const definition = patch(f.definition)
  return { ...f, definition, md5: hash(definition, 'md5'), source_md5: f.md5 }
})
function guards(expected) {
  return expected.map(f => {
    const reg = `to_regprocedure(${quote('public.' + f.signature)})`
    return `IF ${reg} IS NULL OR md5(pg_get_functiondef(${reg}))<>${quote(f.md5)}
      OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=${reg}
        AND pg_get_userbyid(p.proowner)=${quote(f.owner)} AND p.prosecdef=${f.security_definer}
        AND p.provolatile=${quote(f.volatility)} AND p.proconfig IS NOT DISTINCT FROM ARRAY[${f.settings.map(quote)}]::text[]
        AND p.proacl::text IS NOT DISTINCT FROM ${f.acl === null ? 'NULL' : quote(f.acl)})
    THEN RAISE EXCEPTION 'v372 RPC drift: ${f.signature}'; END IF;`
  }).join('\n')
}
const migration = `-- Live definitions captured and verified in snapshots/detail-status-query-v372.
-- Body-only optimization: no new index, grants, connection, or schema reload.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
${guards(before.functions)}
END $guard$;
${targets.map(f => f.definition + ';').join('\n\n')}
DO $guard$ BEGIN
${guards(targets)}
END $guard$;
COMMIT;
`
const rollback = `-- Restore only these two RPCs; fail if either was independently changed.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
${guards(targets)}
END $guard$;
${before.functions.map(f => f.definition + ';').join('\n\n')}
DO $guard$ BEGIN
${guards(before.functions)}
END $guard$;
COMMIT;
`
function functionRows() {
  return `(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (${targets.map(f => `to_regprocedure(${quote('public.' + f.signature)})`)}))`
}
function check(actual, expected) {
  assert.equal(actual.length, expected.length)
  for (const f of expected) for (const k of ['definition','md5','owner','security_definer','volatility','settings','acl']) {
    assert.deepEqual(actual.find(x => x.signature === f.signature)?.[k], f[k], f.signature + ': ' + k)
  }
}
function build() {
  fs.writeFileSync(path.join(root, 'migrations', name + '.sql'), migration, { flag: 'wx' })
  fs.writeFileSync(path.join(dir, 'rollback.sql'), rollback, { flag: 'wx' })
  for (const f of targets) fs.writeFileSync(path.join(dir, f.signature.split('(')[0] + '.after.sql'), f.definition, { flag: 'wx' })
  save('build-manifest.json', { at: new Date().toISOString(), project_ref: ref, migration_sha256: hash(migration), rollback_sha256: hash(rollback), functions: targets.map(({signature,md5,source_md5}) => ({signature,md5,source_md5})), latest_repository_source: 'migration_v367_action_status_compatibility', live_matches_repository: true })
  console.log({ built: name, targets: targets.map(({signature,md5}) => ({signature,md5})) })
}
if (require.main === module) {
  assert.equal(process.argv[2], 'build')
  build()
}
module.exports = { root, ref, name, dir, read, save, before, targets, migration, rollback, guards, functionRows, check, query, hash, quote }
