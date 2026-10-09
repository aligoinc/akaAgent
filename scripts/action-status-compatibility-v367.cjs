// Build only from the captured live definitions. No DB writes on import/build.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const name = 'migration_v367_action_status_compatibility'
const dir = path.join(m.root, 'migrations/snapshots/action-status-compatibility-v367')
const read = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const manifest = read('before-manifest.json')
assert.equal(manifest.project_ref, m.ref)
for (const [file, checksum] of Object.entries(manifest.files)) assert.equal(m.hash(fs.readFileSync(path.join(dir, file))), checksum, file)
const before = read('before.json'), functions = read('functions-before.json')
m.validateSnapshot(before)
for (const f of functions) assert.equal(m.hash(f.definition, 'md5'), f.md5, f.signature)
const indexName = 'auto_detail_committed_delivery_v367'
const indexDefinition = `CREATE INDEX ${indexName} ON public.auto_campaign_details USING btree (account_id, action_code, created_at DESC, input_data_id) WHERE ((policy_snapshot ->> 'operationState'::text) = 'committed'::text)`
const indexSQL = `CREATE INDEX ${indexName} ON public.auto_campaign_details (account_id,action_code,created_at DESC,input_data_id) WHERE policy_snapshot->>'operationState'='committed';`
function replace(source, old, replacement) {
  assert.equal(source.split(old).length, 2, 'Expected exactly one source fragment: ' + old.slice(0, 100))
  return source.replace(old, () => replacement)
}
function legacyObservation(record) {
  return `CASE WHEN ${record}.status_id IS NOT NULL THEN CASE ${record}.action_code
          WHEN 'email_send' THEN CASE s.code WHEN 'campaign_detail_viewed' THEN 'đã xem' WHEN 'campaign_detail_clicked' THEN 'đã click' END
          WHEN 'sms_send' THEN CASE s.code WHEN 'campaign_detail_sent' THEN 'đã gửi' WHEN 'campaign_detail_received' THEN 'đã nhận' WHEN 'campaign_detail_failed' THEN 'thất bại' END
        END END`
}
function patchEnqueue(definition) {
  let sql = replace(definition, '  v_enqueue_error text;', '  v_enqueue_error text;\n  v_observed_status text;\n  v_old_observed_status text;')
  const anchor = sql.includes('  SELECT campaign.action_id') ? '  SELECT campaign.action_id' : '  -- Serialize sole-group enqueue'
  sql = replace(sql, anchor, `  -- Preserve old Email/SMS main-only conditions without changing saved rules
  -- or historical details. Explicit secondary filters keep their exact meaning.
  IF NEW.action_code IN ('email_send','sms_send') AND NEW.status_id IS NOT NULL AND NEW.sub_status_id IS NOT NULL THEN
    SELECT ${legacyObservation('NEW')} INTO v_observed_status
    FROM public.auto_status s WHERE s.id=NEW.sub_status_id AND s.component_type='campaign_detail';
  END IF;
  IF TG_OP='UPDATE' AND OLD.action_code IN ('email_send','sms_send') AND OLD.status_id IS NOT NULL AND OLD.sub_status_id IS NOT NULL THEN
    SELECT ${legacyObservation('OLD')} INTO v_old_observed_status
    FROM public.auto_status s WHERE s.id=OLD.sub_status_id AND s.component_type='campaign_detail';
  END IF;

${anchor}`)
  const start = sql.indexOf('        AND lower(trigger_status.status_value) = lower(NEW.status)')
  const end = sql.indexOf('\n        AND (\n          trigger_status.action_code IS NULL', start)
  assert(start > 0 && end > start)
  const original = sql.slice(start, end).replace(/^        AND /, '          ')
  const compatibility = `        AND ((
${original}
        ) OR (
          trigger_status.sub_status_ids IS NULL
          AND v_observed_status IS NOT NULL
          AND lower(trigger_status.status_value)=v_observed_status
          AND (TG_OP<>'UPDATE' OR v_is_reconcile OR NOT COALESCE(
            NOT COALESCE(OLD.is_delete,false)
            AND (trigger_status.action_code IS NULL OR trigger_status.action_code IS NOT DISTINCT FROM OLD.action_code)
            AND (lower(trigger_status.status_value)=lower(OLD.status)
              OR lower(trigger_status.status_value)=v_old_observed_status),false))
        ))`
  return sql.slice(0, start) + compatibility + sql.slice(end)
}
function patchHistory(definition) {
  let sql = replace(definition, '    FROM public.auto_campaign_details AS d', `    FROM (
      -- Disjoint branches retain the existing legacy partial-index path.
      -- Evidence wins over names/report groups, including partial deliveries.
      SELECT id,created_at,campaign_id,input_data_id,action_code
      FROM public.auto_campaign_details
      WHERE account_id=p_account_id AND action_code=ANY(p_action_codes)
        AND created_at>=p_since AND created_at<=p_now
        AND policy_snapshot->>'operationState'='committed'
      UNION ALL
      SELECT id,created_at,campaign_id,input_data_id,action_code
      FROM public.auto_campaign_details
      WHERE account_id=p_account_id AND action_code=ANY(p_action_codes)
        AND created_at>=p_since AND created_at<=p_now
        AND policy_snapshot->>'operationState' IS NULL
        AND status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
    ) AS d`)
  sql = replace(sql, `    WHERE d.account_id = p_account_id
      AND d.action_code = ANY(p_action_codes)
      AND d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
      AND d.created_at >= p_since
      AND d.created_at <= p_now`, '')
  return sql
}
function patchPage(definition) {
  let sql = replace(definition, "  IF v_status IS NOT NULL THEN v_where := v_where || ' AND d.status = $2'; END IF;", `  IF v_status IS NOT NULL THEN
    v_where := v_where || ' AND (d.status = $2 OR EXISTS (
      SELECT 1 FROM public.auto_status filter_status
      WHERE filter_status.id IN (d.status_id,d.sub_status_id)
        AND (filter_status.status_value=$2 OR lower(filter_status.name)=lower($2))))';
  END IF;`)
  sql = replace(sql, "      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5)';", `      OR d.status ILIKE $5 OR d.error_code ILIKE $5 OR d.log ILIKE $5 OR d.post_url ILIKE $5
      OR EXISTS (SELECT 1 FROM public.auto_status search_status
        WHERE search_status.id IN (d.status_id,d.sub_status_id)
          AND (search_status.name ILIKE $5 OR search_status.status_value ILIKE $5)))';`)
  for (const table of ['main_status','sub_status']) {
    sql = replace(sql, `'name',${table}.name,'color',${table}.color`, `'name',${table}.name,'color',${table}.color,'statusValue',${table}.status_value`)
  }
  return sql
}
const targets = functions.flatMap(f => {
  const fn = f.signature.split('(')[0]
  const patch = fn === 'aka_agent_internal_send_delivery_history' ? patchHistory
    : ['aka_agent_enqueue_campaign_detail_automations','aka_agent_enqueue_group_only_automations'].includes(fn) ? patchEnqueue
      : fn.startsWith('aka_agent_list_campaign_details_page') ? patchPage : null
  if (!patch) return []
  const definition = patch(f.definition)
  return [{ ...f, definition, md5: m.hash(definition, 'md5'), source_md5: f.md5 }]
})
assert.equal(targets.length, 5)
function guards(expected) {
  return expected.map(f => {
    const reg = `to_regprocedure(${m.quote('public.' + f.signature)})`
    const attrs = Object.fromEntries(['owner','security_definer','volatility','settings','acl'].map(k => [k,f[k]]))
    return `IF ${reg} IS NULL OR md5(pg_get_functiondef(${reg}))<>${m.quote(f.md5)} THEN RAISE EXCEPTION 'v367 function drift: ${f.signature}'; END IF;
IF (SELECT jsonb_build_object('owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl::text) FROM pg_proc p WHERE p.oid=${reg}) IS DISTINCT FROM ${m.jsonSQL(attrs,'attrs')} THEN RAISE EXCEPTION 'v367 attributes drift: ${f.signature}'; END IF;`
  }).join('\n')
}
function migration() {
  return `-- Captured live definitions: migrations/snapshots/action-status-compatibility-v367.
-- Build the committed-delivery partial index CONCURRENTLY before applying.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
${guards(functions.filter(f => targets.some(t => t.signature === f.signature)))}
IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.${indexName}') AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)=${m.quote(indexDefinition)}) THEN RAISE EXCEPTION 'v367 committed delivery index required'; END IF;
END $preflight$;
${targets.map(f => f.definition + ';').join('\n\n')}
-- No explicit reload: the existing DDL event trigger may notify PostgREST.
COMMIT;
`
}
function rollback() {
  return `-- Restore these five bodies only. Does not rewrite any historical data.
-- Keep the compatibility reader if new runtime/results still need it.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
${guards(targets)}
END $guard$;
${functions.filter(f => targets.some(t => t.signature === f.signature)).map(f => f.definition + ';').join('\n\n')}
-- Retain the harmless partial index; no other schema or history is removed.
COMMIT;
`
}
function build() {
  fs.writeFileSync(path.join(m.root, 'migrations', name + '.sql'), migration())
  fs.writeFileSync(path.join(m.root, 'migrations/tests', name + '_rollback.sql'), rollback())
  fs.writeFileSync(path.join(m.root, 'migrations/tests', name + '_index_online.sql'), `-- Submit this ONE statement outside any transaction through the linked API.\n-- Use the existing Management API timeout; do not combine SET with this batch.\n${indexSQL.replace('CREATE INDEX ', 'CREATE INDEX CONCURRENTLY ')}\n`)
  fs.writeFileSync(path.join(dir, 'targets.json'), JSON.stringify(targets, null, 2) + '\n')
  console.log({ built: name, functions: targets.length })
}
module.exports = { m, name, dir, before, functions, targets, indexName, indexDefinition, indexSQL, guards, migration, rollback, read }
if (require.main === module) build()
