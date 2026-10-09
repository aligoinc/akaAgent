// One-off, explicitly authorized selective revert of v347/v349 mapping changes.
// Uses the existing linked Management API. No application/RPC/pool changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { query, hash, schemaSQL, fallback, root } = require('./campaign-status-catalog-migration.cjs')
const ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v369_selective_revert_automation_status_catalog'
const table = 'public.auto_campaign_action_detail_statuses'
const dir = path.join(root, 'migrations/snapshots/automation-status-selective-revert-v369')
const migrationFile = path.join(root, 'migrations', name + '.sql')
const undoFile = path.join(dir, 'undo-selective-revert.sql')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const load = file => read(path.join(dir, file))
const save = (file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const quote = x => "'" + String(x).replaceAll("'", "''") + "'"
const dollar = (s, tag) => { assert(!s.includes('$' + tag + '$')); return '$' + tag + '$' + s + '$' + tag + '$' }
const literal = (x, tag) => dollar(JSON.stringify(x), tag) + '::jsonb'
const oldFile = (version, file) => path.join(root, 'migrations/snapshots', version, file)
const old347 = 'campaign-status-catalog-v347'
const old349 = 'campaign-status-ids-v349'
const functionsSQL = `(SELECT coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl) ORDER BY p.oid::regprocedure::text),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND strpos(p.prosrc,'auto_campaign_action_detail_statuses')>0)`
const configs = ['auto_status', 'auto_account_action_status_policies', 'auto_error', 'auto_automation_trigger_statuses']
const rowsSQL = tableName => `(SELECT coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'canonical',to_jsonb(t)::text,'md5',md5(to_jsonb(t)::text)) ORDER BY id),'[]'::jsonb) FROM public.${tableName} t)`
const metadataSQL = `jsonb_build_object('table',${schemaSQL},'column_acls',(SELECT jsonb_object_agg(attname,attacl ORDER BY attname) FROM pg_attribute WHERE attrelid='${table}'::regclass AND attnum>0 AND NOT attisdropped))`
const configChecksumsSQL = `jsonb_build_object(${configs.map(t => `${quote(t)},(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM public.${t} t)`).join(',')})`
const captureSQL = `SELECT jsonb_build_object(
 'project_ref',${quote(ref)},'captured_at',clock_timestamp(),
 'row_count',(SELECT count(*) FROM ${table}),
 'rows',${rowsSQL('auto_campaign_action_detail_statuses')},
 'table_md5',(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM ${table} t),
 'schema',${metadataSQL},'schema_canonical',(${metadataSQL})::text,'schema_md5',md5((${metadataSQL})::text),
 'sequence',(SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_campaign_action_detail_statuses_id_seq),
 'functions',${functionsSQL},'config_checksums',${configChecksumsSQL},
 'configs',jsonb_build_object(${configs.map(t => `${quote(t)},${rowsSQL(t)}`).join(',')})) AS snapshot`
const start = `BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';\nLOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE;\n`
const captureSetting = which => `DO $capture_${which}$ BEGIN PERFORM set_config('aka.v369_${which}',(${captureSQL})::text,true); END $capture_${which}$;`
function validate(s) {
  assert.equal(s.project_ref, ref)
  assert.equal(s.row_count, s.rows.length)
  const checkRows = rows => {
    assert.equal(new Set(rows.map(r => r.row.id)).size, rows.length)
    for (const r of rows) { assert.deepEqual(JSON.parse(r.canonical), r.row); assert.equal(hash(r.canonical, 'md5'), r.md5) }
    return hash(rows.map(r => r.canonical).join('|'), 'md5')
  }
  assert.equal(checkRows(s.rows), s.table_md5)
  for (const r of s.rows) assert.equal(Object.keys(r.row).length, s.schema.table.columns.length)
  for (const t of configs) assert.equal(checkRows(s.configs[t]), s.config_checksums[t])
  assert.deepEqual(JSON.parse(s.schema_canonical), s.schema)
  assert.equal(hash(s.schema_canonical, 'md5'), s.schema_md5)
  for (const f of s.functions) assert.equal(hash(f.definition, 'md5'), f.md5)
}
function snapshot() { const s = query('BEGIN READ ONLY; SET LOCAL statement_timeout=\'15s\'; ' + captureSQL + '; COMMIT;')[0].snapshot; validate(s); return s }
function beforeChecked() {
  const s = load('before.json'); validate(s)
  assert.equal(hash(fs.readFileSync(path.join(dir, 'before.json'))), load('backup-manifest.json').before_sha256)
  return s
}
function classify(s) {
  const manifest347 = read(oldFile(old347, 'applied-manifest.json'))
  const manifest349 = read(oldFile(old349, 'applied-manifest.json'))
  const after349 = read(oldFile(old349, 'after.json')).mappings
  const before349 = read(oldFile(old349, 'before.json')).mappings
  assert.equal(hash(fs.readFileSync(oldFile(old349, 'after.json'))), manifest349.after_sha256)
  assert.equal(hash(fs.readFileSync(oldFile(old349, 'before.json'))), manifest349.before_sha256)
  const baseline = new Map(after349.rows.map(x => [x.row.id, x]))
  const previous = new Map(before349.rows.map(x => [x.row.id, x]))
  const seeds = new Set(manifest347.inserted_rows.map(x => x.id))
  const filled = new Set(manifest349.updated_mapping_ids)
  const referenced = new Set(s.configs.auto_automation_trigger_statuses.map(x => x.row.status_mapping_id))
  const plan = { project_ref: ref, delete_rows: [], restore_status_ids: [], preserved_seed_rows: [], preserved_filled_rows: [], independent_rows: [] }
  for (const item of s.rows) {
    const id = item.row.id, old = baseline.get(id)
    assert.equal(item.row.description, old?.row.description ?? fallback, 'Independently edited description: ' + id)
    const reason = referenced.has(id) ? 'saved Automation reference' : (!old || old.md5 !== item.md5 ? 'runtime or independent row change' : null)
    if (seeds.has(id)) {
      if (reason) plan.preserved_seed_rows.push({ id, reason })
      else plan.delete_rows.push(item)
    } else if (filled.has(id)) {
      if (reason) plan.preserved_filled_rows.push({ id, reason })
      else {
        assert.equal(previous.get(id).row.status_id, null)
        plan.restore_status_ids.push({ ...item, restore_status_id: null })
      }
    } else if (!old) plan.independent_rows.push(id)
  }
  // Missing seed rows require reconciliation; never manufacture them during revert.
  assert.equal(plan.delete_rows.length + plan.preserved_seed_rows.length, seeds.size)
  assert(s.schema.table.columns.some(c => c.name === 'description' && c.type === 'text' && c.not_null))
  assert.equal(s.schema.table.triggers, null, 'Unexpected table trigger')
  return plan
}
const schemaWithoutDescription = s => {
  const out = structuredClone(s)
  out.table.columns = out.table.columns.filter(x => x.name !== 'description')
  delete out.column_acls.description
  return out
}
function verifyChange(before, after, plan) {
  validate(before); validate(after)
  const deleted = new Set(plan.delete_rows.map(x => x.row.id))
  const reset = new Set(plan.restore_status_ids.map(x => x.row.id))
  const expected = before.rows.filter(x => !deleted.has(x.row.id)).map(x => {
    const r = { ...x.row }; delete r.description; if (reset.has(r.id)) r.status_id = null; return r
  })
  assert.deepEqual(after.rows.map(x => x.row), expected)
  assert.deepEqual(after.schema, schemaWithoutDescription(before.schema))
  assert.deepEqual(after.functions, before.functions)
  assert.deepEqual(after.configs, before.configs)
  assert.deepEqual(after.sequence, before.sequence)
}
function build(s, plan) {
  const targets = [...plan.delete_rows, ...plan.restore_status_ids].map(x => ({ id: x.row.id, md5: x.md5 }))
  const deleted = plan.delete_rows.map(x => x.row.id)
  const reset = plan.restore_status_ids.map(x => x.row.id)
  assert(deleted.length && reset.length)
  const ids = xs => xs.join(',')
  // Sequence metadata includes int64 max_value. Use PostgreSQL's canonical JSON,
  // never a JS-parsed/re-serialized object (which rounds integers above 2^53).
  const sourceSchema = dollar(s.schema_canonical, 'source_schema_canonical') + '::jsonb'
  const expectedSchema = `jsonb_set(jsonb_set(${sourceSchema},'{table,columns}',(SELECT jsonb_agg(c ORDER BY (c->>'position')::int) FROM jsonb_array_elements(${sourceSchema}->'table'->'columns') c WHERE c->>'name'<>'description')),'{column_acls}',(${sourceSchema}->'column_acls')-'description')`
  const functions = literal(s.functions, 'source_functions')
  const candidates = literal(targets, 'candidate_checksums')
  const oldDescriptions = literal(s.rows.map(x => ({ id: x.row.id, description: x.row.description })), 'source_descriptions')
  const preflight = `DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name ~ '^migration_v369(_|$)') THEN RAISE EXCEPTION 'v369: version already applied'; END IF;
 IF md5((${metadataSQL})::text)<>${quote(s.schema_md5)} THEN RAISE EXCEPTION 'v369: schema drift'; END IF;
 IF ${functionsSQL} IS DISTINCT FROM ${functions} THEN RAISE EXCEPTION 'v369: dependent RPC drift'; END IF;
 IF ${configChecksumsSQL} IS DISTINCT FROM ${literal(s.config_checksums, 'config_checksums')} THEN RAISE EXCEPTION 'v369: related configuration drift'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${candidates}) c(id bigint,md5 text) LEFT JOIN ${table} t ON t.id=c.id WHERE t.id IS NULL OR md5(to_jsonb(t)::text)<>c.md5) THEN RAISE EXCEPTION 'v369: candidate changed or used since backup'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE status_mapping_id IN (${ids([...deleted, ...reset])})) THEN RAISE EXCEPTION 'v369: candidate referenced by Automation'; END IF;
 IF EXISTS(SELECT 1 FROM ${table} t LEFT JOIN jsonb_to_recordset(${oldDescriptions}) d(id bigint,description text) ON t.id=d.id WHERE t.description IS DISTINCT FROM coalesce(d.description,${quote(fallback)})) THEN RAISE EXCEPTION 'v369: independently edited description'; END IF;
END $preflight$;`
  const mutation = `DELETE FROM ${table} WHERE id IN (${ids(deleted)});
UPDATE ${table} SET status_id=NULL WHERE id IN (${ids(reset)});
ALTER TABLE ${table} DROP COLUMN description;`
  const postflight = `DO $postflight$ DECLARE b jsonb:=current_setting('aka.v369_before')::jsonb; expected jsonb; BEGIN
 SELECT jsonb_agg(CASE WHEN (x->'row'->>'id')::bigint IN (${ids(reset)}) THEN jsonb_set((x->'row')-'description','{status_id}','null'::jsonb) ELSE (x->'row')-'description' END ORDER BY (x->'row'->>'id')::bigint) INTO expected FROM jsonb_array_elements(b->'rows') x WHERE (x->'row'->>'id')::bigint NOT IN (${ids(deleted)});
 IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM ${table} t) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'v369: unexpected row change'; END IF;
 IF ${metadataSQL} IS DISTINCT FROM ${expectedSchema} THEN RAISE EXCEPTION 'v369: unexpected schema change'; END IF;
 IF ${functionsSQL} IS DISTINCT FROM b->'functions' OR ${configChecksumsSQL} IS DISTINCT FROM b->'config_checksums' THEN RAISE EXCEPTION 'v369: related runtime/config changed'; END IF;
 IF (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_campaign_action_detail_statuses_id_seq) IS DISTINCT FROM b->'sequence' THEN RAISE EXCEPTION 'v369: sequence changed'; END IF;
END $postflight$;`
  const desc = s.schema.table.columns.find(x => x.name === 'description')
  const resetRows = plan.restore_status_ids.map(x => { const r = { ...x.row, status_id: null }; delete r.description; return r })
  const restoreRows = literal(plan.restore_status_ids.map(x => x.row), 'restore_status_rows')
  const deletedRows = literal(plan.delete_rows.map(x => x.row), 'restore_deleted_rows')
  const columns = s.schema.table.columns.map(c => c.name).join(',')
  // Undo is deliberately fail-closed if a removed identity was recreated or a reset row was used.
  // Unrelated retained rows may continue to evolve; only their agent documentation is restored.
  const undo = `DO $undo_preflight$ BEGIN
 IF ${metadataSQL} IS DISTINCT FROM ${expectedSchema} THEN RAISE EXCEPTION 'v369 undo: schema drift'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(${literal(resetRows, 'undo_expected_rows')}) x LEFT JOIN ${table} t ON t.id=(x->>'id')::bigint WHERE t.id IS NULL OR to_jsonb(t) IS DISTINCT FROM x) THEN RAISE EXCEPTION 'v369 undo: restored row changed or used'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(${deletedRows}) x JOIN ${table} t ON t.id=(x->>'id')::bigint OR (t.campaign_action_id=x->>'campaign_action_id' AND t.action_code IS NOT DISTINCT FROM x->>'action_code' AND lower(t.status_value)=lower(x->>'status_value') AND NOT t.is_delete)) THEN RAISE EXCEPTION 'v369 undo: removed identity recreated'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE status_mapping_id IN (${ids(reset)})) THEN RAISE EXCEPTION 'v369 undo: restored row now referenced'; END IF;
END $undo_preflight$;
ALTER TABLE ${table} ADD COLUMN description text NOT NULL DEFAULT ${desc.default};
COMMENT ON COLUMN ${table}.description IS ${quote(desc.comment)};
UPDATE ${table} t SET description=d.description FROM jsonb_to_recordset(${oldDescriptions}) d(id bigint,description text) WHERE t.id=d.id;
UPDATE ${table} t SET status_id=(x->>'status_id')::bigint FROM jsonb_array_elements(${restoreRows}) x WHERE t.id=(x->>'id')::bigint;
INSERT INTO ${table} (${columns}) OVERRIDING SYSTEM VALUE SELECT ${columns} FROM jsonb_populate_recordset(NULL::${table},${deletedRows});`
  const body = preflight + '\n' + captureSetting('before') + '\n' + mutation + '\n' + postflight + '\n' + captureSetting('after')
  const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements,rollback) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),${quote(name)},ARRAY[${dollar(body, 'migration_body')},'-- v369_before_json '||current_setting('aka.v369_before'),'-- v369_after_json '||current_setting('aka.v369_after')],ARRAY[${dollar(undo, 'undo_body')}]);`
  const migration = `-- Authorized selective revert of v347/v349 Automation catalog changes only.
-- Read-back verified backup and successful rollback smoke required by the runner.
-- Preserve runtime/Automation-used mappings; no auto_status/policy/error/detail changes.
-- Existing DDL event trigger refreshes PostgREST; no extra NOTIFY or history-setup DDL.
${start}${body}\n${history}\nCOMMIT;\n`
  const undoHistory = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),${quote(name + '_undo')},ARRAY[${dollar(undo, 'undo_history')}]);`
  return { preflight, mutation, postflight, body, undo, migration, undoTransaction: start + undo + '\n' + undoHistory + '\nCOMMIT;\n' }
}
function prepared() {
  const before = beforeChecked(), plan = load('plan.json'), manifest = load('prepared-manifest.json')
  assert.equal(hash(fs.readFileSync(path.join(dir, 'plan.json'))), manifest.plan_sha256)
  const sql = build(before, plan)
  assert.equal(hash(sql.migration), manifest.migration_sha256)
  assert.equal(hash(fs.readFileSync(migrationFile)), manifest.migration_sha256)
  assert.equal(hash(fs.readFileSync(undoFile)), manifest.undo_sha256)
  return { before, plan, sql, manifest }
}
function recover() {
  const { plan, sql } = prepared()
  const rows = query(`SELECT version,name,statements[2] AS before_snapshot,statements[3] AS after_snapshot,rollback[1] AS undo FROM supabase_migrations.schema_migrations WHERE name=${quote(name)}`)
  assert.equal(rows.length, 1, 'Unknown apply outcome: inspect history; never blindly retry')
  const h = rows[0]
  assert.equal(h.undo, sql.undo)
  const before = JSON.parse(h.before_snapshot.replace(/^-- v369_before_json /, ''))
  const after = JSON.parse(h.after_snapshot.replace(/^-- v369_after_json /, ''))
  verifyChange(before, after, plan)
  for (const [file, data] of [['apply-before.json', before], ['after.json', after]]) {
    if (fs.existsSync(path.join(dir, file))) assert.deepEqual(load(file), data); else save(file, data)
  }
  const manifest = { project_ref: ref, version: h.version, name, checked_at: new Date().toISOString(), before_count: before.row_count, after_count: after.row_count, deleted_ids: plan.delete_rows.map(x => x.row.id), cleared_status_ids: plan.restore_status_ids.map(x => x.row.id), retained_seed_rows: plan.preserved_seed_rows, retained_filled_rows: plan.preserved_filled_rows, retained_independent_rows: plan.independent_rows, functions_and_configs_unchanged: true, sequence_unchanged: true, apply_before_sha256: hash(fs.readFileSync(path.join(dir, 'apply-before.json'))), after_sha256: hash(fs.readFileSync(path.join(dir, 'after.json'))), migration_sha256: hash(sql.migration), undo_sha256: hash(fs.readFileSync(undoFile)) }
  if (!fs.existsSync(path.join(dir, 'applied-manifest.json'))) save('applied-manifest.json', manifest)
  return { version: h.version, deleted: plan.delete_rows.length, cleared_status_id: plan.restore_status_ids.length, remaining: after.row_count }
}
function main() {
  fs.mkdirSync(dir, { recursive: true })
  const mode = process.argv[2]
  if (mode === 'capture') {
    assert(!fs.existsSync(path.join(dir, 'before.json')))
    const s = snapshot(); save('before.json', s); validate(load('before.json'))
    save('backup-manifest.json', { project_ref: ref, captured_at: s.captured_at, row_count: s.row_count, table_md5: s.table_md5, schema_md5: s.schema_md5, before_sha256: hash(fs.readFileSync(path.join(dir, 'before.json'))), row_checksums: s.rows.map(x => ({ id: x.row.id, md5: x.md5 })), source_manifests: [oldFile(old347, 'applied-manifest.json'), oldFile(old349, 'applied-manifest.json')].map(file => ({ file: path.relative(root, file), sha256: hash(fs.readFileSync(file)) })) })
    console.log(JSON.stringify({ backed_up_rows: s.row_count, table_md5: s.table_md5, functions: s.functions.length }))
  } else if (mode === 'prepare') {
    const before = beforeChecked(), plan = classify(before), sql = build(before, plan)
    save('plan.json', plan)
    fs.writeFileSync(migrationFile, sql.migration, { flag: 'wx' })
    fs.writeFileSync(undoFile, sql.undoTransaction, { flag: 'wx' })
    save('prepared-manifest.json', { before_sha256: hash(fs.readFileSync(path.join(dir, 'before.json'))), plan_sha256: hash(fs.readFileSync(path.join(dir, 'plan.json'))), migration_sha256: hash(sql.migration), undo_sha256: hash(sql.undoTransaction) })
    console.log(JSON.stringify({ delete: plan.delete_rows.length, clear_status_id: plan.restore_status_ids.length, preserved_seed: plan.preserved_seed_rows, preserved_filled: plan.preserved_filled_rows, independent: plan.independent_rows }))
  } else if (mode === 'smoke') {
    const { sql, manifest, plan, before } = prepared()
    const reject = (statement, message, tag) => `DO $${tag}$ BEGIN BEGIN EXECUTE ${dollar(statement, tag + '_statement')}; RAISE EXCEPTION 'TEST: expected failure missing'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>${quote(message)} THEN RAISE; END IF; END; END $${tag}$;`
    const candidate = plan.delete_rows[0].row.id
    const stale = reject(`UPDATE ${table} SET updated_at=updated_at+interval '1 microsecond' WHERE id=${candidate};\n${sql.preflight}`, 'v369: candidate changed or used since backup', 'stale_candidate')
    const reference = before.configs.auto_automation_trigger_statuses[0].row.status_mapping_id
    const referenceGuard = sql.preflight.replace(`status_mapping_id IN (${[...plan.delete_rows, ...plan.restore_status_ids].map(x => x.row.id).join(',')})`, `status_mapping_id IN (${reference})`)
    const refs = reject(referenceGuard, 'v369: candidate referenced by Automation', 'referenced_candidate')
    const undoDrift = reject(`UPDATE ${table} SET updated_at=updated_at+interval '1 microsecond' WHERE id=${plan.restore_status_ids[0].row.id};\n${sql.undo}`, 'v369 undo: restored row changed or used', 'undo_drift')
    const scope = plan.delete_rows[0].row
    const legacyWriter = `INSERT INTO ${table}(id,campaign_action_id,action_code,status_id,status_value,label,is_active,is_delete,updated_at) OVERRIDING SYSTEM VALUE VALUES(-369000,${quote(scope.campaign_action_id)},${quote(scope.action_code)},NULL,'__v369_compatibility_smoke__','smoke',true,false,clock_timestamp());
UPDATE ${table} SET label='smoke updated',status_id=coalesce(status_id,${scope.status_id ?? 'NULL'}),updated_at=clock_timestamp() WHERE id=-369000;
DELETE FROM ${table} WHERE id=-369000;`
    const smoke = start + stale + '\n' + refs + '\n' + sql.body + '\n' + legacyWriter + '\n' + undoDrift + '\n' + sql.undo + `
DO $roundtrip$ DECLARE b jsonb:=current_setting('aka.v369_before')::jsonb; BEGIN
 IF (SELECT md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) FROM ${table} t)<>b->>'table_md5' THEN RAISE EXCEPTION 'TEST: undo did not restore all row values'; END IF;
 IF ${functionsSQL} IS DISTINCT FROM b->'functions' OR ${configChecksumsSQL} IS DISTINCT FROM b->'config_checksums' THEN RAISE EXCEPTION 'TEST: undo changed other data/functions'; END IF;
 IF (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_campaign_action_detail_statuses_id_seq) IS DISTINCT FROM b->'sequence' THEN RAISE EXCEPTION 'TEST: sequence moved'; END IF;
END $roundtrip$;
ROLLBACK;
SELECT 'passed: selective delete, status restore, drop description, legacy writer, undo roundtrip, stale/reference guards, unchanged sequence/config/functions' AS result;`
    fs.writeFileSync(path.join(dir, 'smoke.sql'), smoke, { flag: 'wx' })
    const result = query(smoke)
    const current = snapshot()
    assert.deepEqual(current.schema, before.schema)
    save('smoke.json', { checked_at: new Date().toISOString(), migration_sha256: manifest.migration_sha256, result, no_committed_changes: true, schema_restored: true })
    console.log(JSON.stringify(result))
  } else if (mode === 'apply') {
    const { sql, manifest } = prepared()
    assert.equal(load('smoke.json').migration_sha256, manifest.migration_sha256)
    assert(!fs.existsSync(path.join(dir, 'applied-manifest.json')))
    query(sql.migration + `SELECT version,name FROM supabase_migrations.schema_migrations WHERE name=${quote(name)};`)
    console.log(JSON.stringify(recover()))
  } else if (mode === 'recover') console.log(JSON.stringify(recover()))
  else if (mode === 'verify') {
    const s = snapshot(), after = load('after.json'), plan = load('plan.json')
    assert.deepEqual(s.schema, after.schema)
    assert.deepEqual(s.functions, after.functions)
    assert.deepEqual(s.configs, after.configs)
    const current = new Map(s.rows.map(x => [x.row.id, x.row]))
    for (const x of plan.delete_rows) assert(!current.has(x.row.id), 'Deleted ID unexpectedly present')
    for (const x of plan.preserved_seed_rows) assert(current.has(x.id))
    for (const id of plan.independent_rows) assert(current.has(id))
    save('live-verification.json', s)
    console.log(JSON.stringify({ rows: s.row_count, description_absent: true, configs_and_functions_unchanged: true }))
  } else throw Error('Usage: capture|prepare|smoke|apply|recover|verify; undo SQL is manual and requires explicit user authorization')
}
module.exports = { snapshot, validate, classify, build, verifyChange }
if (require.main === module) main()
