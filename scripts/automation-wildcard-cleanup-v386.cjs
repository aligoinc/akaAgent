// One-off authorized cleanup. Reuses the existing linked Management API client.
// No application/RPC/schema/policy changes and no new connection source.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { query, hash, root, schemaSQL } = require('./campaign-status-catalog-migration.cjs')
const ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v386_automation_wildcard_cleanup'
const dir = path.join(root, 'migrations/snapshots/automation-wildcard-cleanup-v386')
const migration = path.join(root, 'migrations', name + '.sql')
const table = 'public.auto_campaign_action_detail_statuses'
const statuses = ['đã gửi tin nhắn', 'đã gửi lời mời kết bạn', 'đã là bạn bè', 'đã tham gia', 'đã gắn tag', 'đã đổi tên']
const ids = Array.from({ length: 11 }, (_, group) => Array.from({ length: 6 }, (_, status) => 84 + group * 7 + status)).flat()
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const dollar = (value, tag) => { assert(!value.includes('$' + tag + '$')); return '$' + tag + '$' + value + '$' + tag + '$' }
const literal = (value, tag) => dollar(JSON.stringify(value), tag) + '::jsonb'
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const targetWhere = `id IN (${ids.join(',')})`
const functionsSQL = `(SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl) ORDER BY p.oid::regprocedure::text),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND strpos(p.prosrc,'auto_campaign_action_detail_statuses')>0)`
const rowsSQL = (tableName, where = 'true') => `(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.${tableName} t WHERE ${where})`
const controlsSQL = `jsonb_build_object(${['auto_status', 'auto_error', 'auto_account_action_status_policies'].map(t => `${quote(t)},(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.${t} t)`).join(',')})`
const captureSQL = `SELECT jsonb_build_object(
 'project_ref',${quote(ref)},'captured_at',clock_timestamp(),
 'catalog',${rowsSQL('auto_campaign_action_detail_statuses')},
 'triggers',${rowsSQL('auto_automation_trigger_statuses')},
 'automation',(SELECT to_jsonb(a) FROM public.auto_automation a WHERE id=84),
 'source_action',(SELECT action_id FROM public.auto_campaigns WHERE id=20618),
 'other_automations_md5',(SELECT md5(coalesce(string_agg(to_jsonb(a)::text,'|' ORDER BY id),'')) FROM public.auto_automation a WHERE id<>84),
 'schema_canonical',(${schemaSQL})::text,
 'functions',${functionsSQL},'controls',${controlsSQL},
 'sequence',(SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_campaign_action_detail_statuses_id_seq)
) AS snapshot`
const begin = `BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='20s';\nLOCK TABLE public.auto_automation IN SHARE ROW EXCLUSIVE MODE;\nLOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE;\nLOCK TABLE public.auto_automation_trigger_statuses IN SHARE ROW EXCLUSIVE MODE;\n`
const capture = key => `DO $capture_${key}$ BEGIN PERFORM set_config('aka.v386_${key}',(${captureSQL})::text,true); END $capture_${key}$;`
function validate(s) {
  assert.equal(s.project_ref, ref)
  assert.equal(new Set(s.catalog.map(r => r.id)).size, s.catalog.length)
  for (const f of s.functions) assert.equal(hash(f.definition, 'md5'), f.md5)
  assert.equal(s.source_action, 'zalo_message_phone')
}
function snapshot() { const s = query(`BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; ${captureSQL}; COMMIT;`)[0].snapshot; validate(s); return s }
function checkedBefore() {
  const before = load('before.json')
  assert.equal(hash(fs.readFileSync(path.join(dir, 'before.json'))), load('backup-manifest.json').before_sha256)
  validate(before)
  return before
}
function verify(before, after) {
  validate(before); validate(after)
  assert.deepEqual(after.catalog, before.catalog.filter(r => !ids.includes(r.id)))
  assert.deepEqual(after.triggers, before.triggers.map(r => r.id === 78 ? { ...r, status_mapping_id: 91258, action_code: 'zalo_add_friend' } : r))
  assert.deepEqual({ ...after.automation, updated_at: before.automation.updated_at, config_version: before.automation.config_version }, before.automation)
  assert.equal(after.automation.config_version, before.automation.config_version + 1)
  assert.equal(after.automation.is_active, false)
  for (const key of ['schema_canonical', 'functions', 'controls', 'sequence', 'other_automations_md5']) assert.deepEqual(after[key], before[key])
}
function build(s) {
  const candidates = s.catalog.filter(r => ids.includes(r.id))
  assert.equal(candidates.length, 66)
  assert(candidates.every(r => r.action_code === null && statuses.includes(r.status_value) && r.is_active && !r.is_delete && r.campaign_action_id.startsWith('zalo_')))
  for (const status of statuses) assert.equal(candidates.filter(r => r.status_value === status).length, 11)
  const target = s.catalog.find(r => r.id === 91258)
  assert.equal(target.action_code, 'zalo_add_friend')
  assert.equal(target.campaign_action_id, 'zalo_message_phone')
  assert.equal(target.status_value, 'đã là bạn bè')
  assert(target.is_active && !target.is_delete)
  const condition = s.triggers.find(r => r.id === 78)
  assert.equal(condition.automation_id, 84)
  assert.equal(condition.status_mapping_id, 149)
  assert.equal(condition.action_code, null)
  assert.equal(condition.status_value, 'đã là bạn bè')
  assert.equal(condition.sub_status_ids, null)
  assert.deepEqual(s.triggers.filter(r => ids.includes(r.status_mapping_id)), [condition])
  assert.equal(s.automation.name, 'fr')
  assert.equal(s.automation.is_active, false)
  assert.equal(s.automation.is_delete, false)
  assert.equal(s.automation.source_campaign_id, 20618)
  const sourceRows = literal(candidates, 'source_rows')
  const sourceCondition = literal(condition, 'source_condition')
  const targetCondition = literal({ ...condition, status_mapping_id: 91258, action_code: 'zalo_add_friend' }, 'target_condition')
  const targetStable = { ...target }; delete targetStable.updated_at
  const schema = dollar(s.schema_canonical, 'source_schema')
  const preflight = `DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name ~ '^migration_v386(_|$)') THEN RAISE EXCEPTION 'v386 already applied; inspect receipt, do not reapply'; END IF;
 IF (${schemaSQL})::text IS DISTINCT FROM ${schema} THEN RAISE EXCEPTION 'v386 catalog schema drift'; END IF;
 IF ${functionsSQL} IS DISTINCT FROM ${literal(s.functions, 'source_functions')} THEN RAISE EXCEPTION 'v386 dependent RPC drift'; END IF;
 IF ${rowsSQL('auto_campaign_action_detail_statuses', targetWhere)} IS DISTINCT FROM ${sourceRows} THEN RAISE EXCEPTION 'v386 candidates changed since backup'; END IF;
 IF (SELECT to_jsonb(t)-'updated_at' FROM ${table} t WHERE id=91258) IS DISTINCT FROM ${literal(targetStable, 'target_mapping')} THEN RAISE EXCEPTION 'v386 replacement mapping drift'; END IF;
 IF (SELECT to_jsonb(a) FROM public.auto_automation a WHERE id=84) IS DISTINCT FROM ${literal(s.automation, 'source_automation')} THEN RAISE EXCEPTION 'v386 automation changed since backup'; END IF;
 IF (SELECT action_id FROM public.auto_campaigns WHERE id=20618) IS DISTINCT FROM 'zalo_message_phone' THEN RAISE EXCEPTION 'v386 source campaign scope changed'; END IF;
 IF (SELECT to_jsonb(t) FROM public.auto_automation_trigger_statuses t WHERE id=78) IS DISTINCT FROM ${sourceCondition} THEN RAISE EXCEPTION 'v386 condition changed since backup'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE status_mapping_id IN (${ids.join(',')}) AND id<>78) THEN RAISE EXCEPTION 'v386 new reference to candidate'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE automation_id=84 AND id<>78) THEN RAISE EXCEPTION 'v386 fr gained another condition'; END IF;
END $preflight$;`
  const mutate = `DO $mutate$ DECLARE n int; BEGIN
 UPDATE public.auto_automation_trigger_statuses SET status_mapping_id=91258,action_code='zalo_add_friend' WHERE id=78 AND automation_id=84 AND status_mapping_id=149 AND action_code IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'v386 expected one updated condition, got %',n; END IF;
 UPDATE public.auto_automation SET config_version=config_version+1,updated_at=clock_timestamp() WHERE id=84 AND is_active=false AND is_delete=false;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'v386 expected one automation, got %',n; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE status_mapping_id IN (${ids.join(',')})) THEN RAISE EXCEPTION 'v386 candidate still referenced'; END IF;
 DELETE FROM ${table} WHERE ${targetWhere};
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>66 THEN RAISE EXCEPTION 'v386 expected 66 deleted mappings, got %',n; END IF;
END $mutate$;`
  const verifySQL = `DO $verify$ DECLARE b jsonb:=current_setting('aka.v386_before')::jsonb; a jsonb:=current_setting('aka.v386_after')::jsonb; expected jsonb; BEGIN
 SELECT jsonb_agg(r ORDER BY (r->>'id')::bigint) INTO expected FROM jsonb_array_elements(b->'catalog') r WHERE (r->>'id')::bigint NOT IN (${ids.join(',')});
 IF a->'catalog' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'v386 unexpected catalog change'; END IF;
 SELECT jsonb_agg(CASE WHEN (r->>'id')::bigint=78 THEN ${targetCondition} ELSE r END ORDER BY (r->>'id')::bigint) INTO expected FROM jsonb_array_elements(b->'triggers') r;
 IF a->'triggers' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'v386 unexpected trigger condition change'; END IF;
 IF (a->'automation')-ARRAY['updated_at','config_version'] IS DISTINCT FROM (b->'automation')-ARRAY['updated_at','config_version'] OR (a->'automation'->>'config_version')::int IS DISTINCT FROM (b->'automation'->>'config_version')::int+1 THEN RAISE EXCEPTION 'v386 unexpected automation change'; END IF;
 IF a->'source_action' IS DISTINCT FROM b->'source_action' OR a->'schema_canonical' IS DISTINCT FROM b->'schema_canonical' OR a->'functions' IS DISTINCT FROM b->'functions' OR a->'controls' IS DISTINCT FROM b->'controls' OR a->'sequence' IS DISTINCT FROM b->'sequence' OR a->'other_automations_md5' IS DISTINCT FROM b->'other_automations_md5' THEN RAISE EXCEPTION 'v386 unrelated state changed'; END IF;
END $verify$;`
  const columns = Object.keys(candidates[0]).join(',')
  const undo = `DO $undo_preflight$ DECLARE expected_automation jsonb; BEGIN
 IF (${schemaSQL})::text IS DISTINCT FROM ${schema} THEN RAISE EXCEPTION 'v386 undo schema drift'; END IF;
 IF ${functionsSQL} IS DISTINCT FROM ${literal(s.functions, 'undo_functions')} THEN RAISE EXCEPTION 'v386 undo dependent RPC drift'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(${sourceRows}) r JOIN ${table} t ON t.id=(r->>'id')::bigint OR (t.campaign_action_id=r->>'campaign_action_id' AND t.action_code IS NULL AND lower(t.status_value)=lower(r->>'status_value') AND NOT t.is_delete)) THEN RAISE EXCEPTION 'v386 undo candidate identity recreated'; END IF;
 IF (SELECT to_jsonb(t) FROM public.auto_automation_trigger_statuses t WHERE id=78) IS DISTINCT FROM ${targetCondition} THEN RAISE EXCEPTION 'v386 undo condition changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE automation_id=84 AND id<>78) THEN RAISE EXCEPTION 'v386 undo fr gained another condition'; END IF;
 expected_automation := (nullif(current_setting('aka.v386_after',true),'')::jsonb)->'automation';
 IF expected_automation IS NULL THEN
   SELECT (substr(statement,length('-- v386_after_json ')+1)::jsonb)->'automation' INTO expected_automation
   FROM supabase_migrations.schema_migrations h CROSS JOIN LATERAL unnest(h.statements) statement
   WHERE h.name=${quote(name)} AND statement LIKE '-- v386_after_json %';
 END IF;
 IF expected_automation IS NULL OR (SELECT to_jsonb(a) FROM public.auto_automation a WHERE id=84) IS DISTINCT FROM expected_automation THEN RAISE EXCEPTION 'v386 undo automation changed'; END IF;
 IF (SELECT action_id FROM public.auto_campaigns WHERE id=20618) IS DISTINCT FROM 'zalo_message_phone' THEN RAISE EXCEPTION 'v386 undo source scope changed'; END IF;
END $undo_preflight$;
INSERT INTO ${table} (${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM jsonb_populate_recordset(NULL::${table},${sourceRows});
UPDATE public.auto_automation_trigger_statuses SET status_mapping_id=149,action_code=NULL WHERE id=78;
UPDATE public.auto_automation SET config_version=${s.automation.config_version},updated_at=${quote(s.automation.updated_at)}::timestamptz WHERE id=84;
DO $undo_verify$ BEGIN
 IF ${rowsSQL('auto_campaign_action_detail_statuses', targetWhere)} IS DISTINCT FROM ${sourceRows} OR (SELECT to_jsonb(t) FROM public.auto_automation_trigger_statuses t WHERE id=78) IS DISTINCT FROM ${sourceCondition} OR (SELECT to_jsonb(a) FROM public.auto_automation a WHERE id=84) IS DISTINCT FROM ${literal(s.automation, 'restored_automation')} THEN RAISE EXCEPTION 'v386 undo restore mismatch'; END IF;
END $undo_verify$;`
  const body = [preflight, capture('before'), mutate, capture('after'), verifySQL].join('\n')
  const receipt = `SELECT version,name FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`
  const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements,rollback) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),${quote(name)},ARRAY[${dollar(body, 'migration_body')},'-- v386_before_json '||current_setting('aka.v386_before'),'-- v386_after_json '||current_setting('aka.v386_after')],ARRAY[${dollar(undo, 'undo_body')}]);`
  const sql = `-- Authorized: remap fr condition 78 from 149 to 91258; delete exactly 66 stale wildcard mappings.\n-- Data only. Keep fr disabled, specific mappings, shared statuses, policies and history.\n-- No schema reload/history-setup DDL/new connection. Fail closed on drift.\n${begin}${body}\n${history}\nCOMMIT;\n${receipt}\n`
  const smoke = `${begin}${body}\n${undo}\n${capture('restored')}\nDO $roundtrip$ BEGIN IF (current_setting('aka.v386_before')::jsonb)-'captured_at' IS DISTINCT FROM (current_setting('aka.v386_restored')::jsonb)-'captured_at' THEN RAISE EXCEPTION 'v386 roundtrip mismatch'; END IF; END $roundtrip$;\nSELECT jsonb_build_object('before',current_setting('aka.v386_before')::jsonb,'after',current_setting('aka.v386_after')::jsonb,'restored',current_setting('aka.v386_restored')::jsonb) AS smoke;\nROLLBACK;\n`
  const undoTransaction = `${begin}${undo}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),${quote(name+'_undo')},ARRAY[${dollar(undo, 'undo_history')}]);\nCOMMIT;\n`
  return { sql, smoke, undoTransaction }
}
function prepared() {
  const before = checkedBefore(), sql = build(before), manifest = load('prepared-manifest.json')
  assert.equal(hash(sql.sql), manifest.migration_sha256)
  assert.equal(hash(fs.readFileSync(migration)), manifest.migration_sha256)
  assert.equal(hash(sql.smoke), manifest.smoke_sha256)
  assert.equal(hash(sql.undoTransaction), manifest.undo_sha256)
  assert.equal(hash(fs.readFileSync(path.join(dir, 'smoke.sql'))), manifest.smoke_sha256)
  assert.equal(hash(fs.readFileSync(path.join(dir, 'undo.sql'))), manifest.undo_sha256)
  return { before, sql, manifest }
}
function recover() {
  const rows = query(`SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
  assert.equal(rows.length, 1, 'Exactly one apply receipt required; do not blindly reapply')
  const receipt = rows[0]
  const before = JSON.parse(receipt.statements.find(x => x.startsWith('-- v386_before_json ')).slice('-- v386_before_json '.length))
  const after = JSON.parse(receipt.statements.find(x => x.startsWith('-- v386_after_json ')).slice('-- v386_after_json '.length))
  verify(before, after)
  save('apply-before.json', before); save('after.json', after)
  save('applied-manifest.json', { project_ref: ref, version: receipt.version, name, deleted_ids: ids, changed_trigger_id: 78, automation_id: 84, automation_active: after.automation.is_active, before_sha256: hash(fs.readFileSync(path.join(dir, 'apply-before.json'))), after_sha256: hash(fs.readFileSync(path.join(dir, 'after.json'))), migration_sha256: hash(fs.readFileSync(migration)) })
  console.log(JSON.stringify({ version: receipt.version, name, deleted: before.catalog.length-after.catalog.length, automation_active: after.automation.is_active }))
}
const mode = process.argv[2]
if (mode === 'prepare') {
  fs.mkdirSync(dir, { recursive: true })
  const before = snapshot()
  save('before.json', before)
  save('backup-manifest.json', { project_ref: ref, captured_at: before.captured_at, before_sha256: hash(fs.readFileSync(path.join(dir, 'before.json'))) })
  const sql = build(checkedBefore())
  fs.writeFileSync(migration, sql.sql, { flag: 'wx' })
  fs.writeFileSync(path.join(dir, 'smoke.sql'), sql.smoke, { flag: 'wx' })
  fs.writeFileSync(path.join(dir, 'undo.sql'), sql.undoTransaction, { flag: 'wx' })
  save('prepared-manifest.json', { migration_sha256: hash(sql.sql), smoke_sha256: hash(sql.smoke), undo_sha256: hash(sql.undoTransaction) })
  console.log(JSON.stringify({ backed_up: before.catalog.length, delete_count: ids.length, candidate_ids: ids, changed_trigger_id: 78 }))
} else if (mode === 'build') {
  const manifest = load('prepared-manifest.json')
  for (const [file, checksum] of [[migration,manifest.migration_sha256],[path.join(dir,'smoke.sql'),manifest.smoke_sha256],[path.join(dir,'undo.sql'),manifest.undo_sha256]]) assert.equal(hash(fs.readFileSync(file)),checksum)
  const sql = build(checkedBefore())
  fs.writeFileSync(migration,sql.sql)
  fs.writeFileSync(path.join(dir,'smoke.sql'),sql.smoke)
  fs.writeFileSync(path.join(dir,'undo.sql'),sql.undoTransaction)
  fs.writeFileSync(path.join(dir,'prepared-manifest.json'),JSON.stringify({ migration_sha256:hash(sql.sql),smoke_sha256:hash(sql.smoke),undo_sha256:hash(sql.undoTransaction) },null,2)+'\n')
  console.log('Rebuilt verified v386 artifacts from the original backup')
} else if (mode === 'smoke') {
  const { sql, manifest } = prepared()
  const result = query(sql.smoke)[0].smoke
  verify(result.before, result.after)
  assert.deepEqual({ ...result.restored, captured_at: result.before.captured_at }, result.before)
  save('smoke.json', { passed: true, checked_at: new Date().toISOString(), ...manifest, result })
  console.log(JSON.stringify({ smoke: 'passed', delete_count: 66, roundtrip: 'exact', committed: false }))
} else if (mode === 'apply') {
  const { sql, manifest } = prepared(), smoke = load('smoke.json')
  assert.equal(smoke.passed, true)
  assert.equal(smoke.migration_sha256, manifest.migration_sha256)
  query(sql.sql)
  recover()
} else if (mode === 'recover') {
  recover()
} else if (mode === 'verify') {
  const live = snapshot(), after = load('after.json'), before = load('apply-before.json')
  assert.equal(live.catalog.filter(r => ids.includes(r.id)).length, 0)
  assert.equal(live.catalog.filter(r => r.action_code === null && statuses.includes(r.status_value)).length, 0)
  assert.deepEqual(live.triggers, after.triggers)
  assert.deepEqual(live.automation, after.automation)
  for (const key of ['schema_canonical', 'functions', 'controls', 'other_automations_md5']) assert.deepEqual(live[key], before[key])
  const stable = rows => rows.map(r => { const out = { ...r }; delete out.updated_at; return out })
  assert.deepEqual(stable(live.catalog), stable(after.catalog))
  save('live-verification.json', { passed: true, captured_at: live.captured_at, catalog_rows: live.catalog.length, deleted_rows: 66, remaining_wildcard_statuses: [...new Set(live.catalog.filter(r => r.action_code === null).map(r => r.status_value))].sort(), trigger: live.triggers.find(r => r.id===78), automation_active: live.automation.is_active, preserved_schema_and_functions: true, preserved_status_error_policies: true })
  console.log(fs.readFileSync(path.join(dir, 'live-verification.json'), 'utf8'))
} else {
  throw new Error('Use prepare, build, smoke, apply, recover, or verify')
}
