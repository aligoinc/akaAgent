// v349: data-only maintenance over the existing linked Management API.
// No RPC/DDL/schema reload or application runtime changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const previous = require('./campaign-status-catalog-migration.cjs')
const { query, hash, root } = previous
const ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v349_campaign_detail_status_ids'
const directory = path.join(root, 'migrations/snapshots/campaign-status-ids-v349')
const migrationPath = path.join(root, 'migrations', name + '.sql')
const rollbackPath = path.join(root, 'migrations/tests', name + '_rollback.sql')
const mapping = 'public.auto_campaign_action_detail_statuses'
const status = 'public.auto_status'
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const dollar = (s, tag) => { assert(!s.includes('$' + tag + '$')); return '$' + tag + '$' + s + '$' + tag + '$' }
const jsonSQL = (x, tag) => dollar(JSON.stringify(x), tag) + '::jsonb'
const save = (file, x, exclusive = false) => fs.writeFileSync(path.join(directory, file), JSON.stringify(x, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
const runtimeSQL = `(SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND (strpos(p.prosrc,'auto_status')>0 OR strpos(p.prosrc,'auto_campaign_action_detail_statuses')>0 OR strpos(p.prosrc,'semantic_status_id')>0))`
const tableSnapshot = (table, schema, sequence) => `(SELECT jsonb_build_object(
 'row_count',count(*),'rows',coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(t),'canonical',to_jsonb(t)::text,'md5',md5(to_jsonb(t)::text)) ORDER BY id),'[]'::jsonb),
 'table_md5',md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')),
 'schema',${schema},'schema_canonical',(${schema})::text,'schema_md5',md5((${schema})::text),
 'sequence_state',(SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.${sequence})) FROM ${table} t)`
const statusSchema = previous.schemaSQL.replaceAll('auto_campaign_action_detail_statuses', 'auto_status')
const snapshotSQL = `SELECT '${ref}' AS project_ref,clock_timestamp() AS captured_at,
 ${tableSnapshot(status, statusSchema, 'auto_status_id_seq')} AS statuses,
 ${tableSnapshot(mapping, previous.schemaSQL, 'auto_campaign_action_detail_statuses_id_seq')} AS mappings,
 ${runtimeSQL} AS runtime_checksums,${previous.referencesSQL} AS automation_conditions`
const snapshot = () => query(snapshotSQL)[0]
function validate(s) {
  assert.equal(s.project_ref, ref)
  for (const t of [s.statuses, s.mappings]) {
    assert.equal(t.row_count, t.rows.length)
    assert.equal(new Set(t.rows.map(x => x.row.id)).size, t.rows.length)
    for (const x of t.rows) {
      assert.deepEqual(JSON.parse(x.canonical), x.row)
      assert.equal(hash(x.canonical, 'md5'), x.md5)
      assert.equal(Object.keys(x.row).length, t.schema.columns.length)
    }
    assert.equal(hash(t.rows.map(x => x.canonical).join('|'), 'md5'), t.table_md5)
    assert.deepEqual(JSON.parse(t.schema_canonical), t.schema)
    assert.equal(hash(t.schema_canonical, 'md5'), t.schema_md5)
  }
}
function checkedBefore() {
  const s = load('before.json'); validate(s)
  assert.equal(hash(fs.readFileSync(path.join(directory, 'before.json'))), load('backup-manifest.json').before_sha256)
  return s
}
const definitions = [
 ['clicked','Đã click',false,'Email tracking ghi nhận click liên kết; không khẳng định người thật hoặc chuyển đổi.'],
 ['alias_changed','Đã đổi tên',true,'Chuỗi trạng thái đổi tên có trong danh mục lịch sử; giữ riêng, không gộp với Thành công.'],
 ['tag_applied','Đã gắn tag',true,'Chuỗi trạng thái gắn tag có trong danh mục lịch sử; giữ riêng, không gộp với Thành công.'],
 ['sent','Đã gửi',false,'SMS có tín hiệu đã gửi; có thể cập nhật tiếp thành đã nhận hoặc thất bại.'],
 ['invitation_sent','Đã gửi lời mời',true,'Đã có hoặc đã ghi nhận lời mời theo hành động; không xác nhận đã chấp nhận lời mời.'],
 ['friend_request_sent','Đã gửi lời mời kết bạn',true,'Chuỗi trạng thái kết bạn lịch sử; giữ riêng với Đã gửi lời mời và Đã là bạn bè.'],
 ['message_sent','Đã gửi tin nhắn',true,'Chuỗi trạng thái nhắn tin lịch sử; không suy ra đã nhận/đã xem hoặc đổi thành Thành công.'],
 ['already_friend','Đã là bạn bè',true,'Quan hệ bạn bè đã tồn tại; không có nghĩa vừa gửi một lời mời mới.'],
 ['already_member','Đã là thành viên',true,'Đối tượng đã là thành viên group; không chứng minh vừa thêm mới.'],
 ['received','Đã nhận',false,'SMS có tín hiệu nhận/phát theo tích hợp; không chứng minh đã đọc.'],
 ['joined','Đã tham gia',true,'Tài khoản đã tham gia group, có thể là kết quả kiểm tra trước thao tác.'],
 ['viewed','Đã xem',false,'Email tracking ghi nhận mở/xem; vẫn có thể ghi nhận click sau đó, không chứng minh người thật đã đọc.'],
 ['calling','Đang gọi',false,'Cuộc gọi đang quay số/thực hiện; là trạng thái trung gian trước kết quả cuộc gọi.'],
 ['not_found','Không tồn tại',true,'Không tìm thấy đối tượng theo phép kiểm tra của hành động; không suy ra đối tượng không tồn tại trên toàn nền tảng.'],
 ['tag_not_found','Tag không tồn tại',true,'Không tìm thấy tag Zalo cần gắn; không đồng nghĩa gắn tag thành công.'],
 ['invalid_parameter','Tham số không hợp lệ',true,'Với đổi tên Zalo: tên mới sau render template rỗng; không tự suy ra thành công từ helper ok=true.']
]
function build(before) {
  assert(!fs.existsSync(path.join(directory, 'applied-manifest.json')))
  const values = [...new Set(before.mappings.rows.filter(x => x.row.status_id == null).map(x => x.row.status_value.toLowerCase()))].sort()
  assert.deepEqual(values, definitions.map(x => x[1].toLowerCase()).sort(), 'Live missing values changed: review catalog')
  const desired = definitions.map(([key, label, terminal, meaning], i) => ({
    code: 'campaign_detail_' + key, name: label,
    description: `${meaning} Trạng thái chuẩn component_type=campaign_detail, liên kết theo tên không phân biệt hoa/thường. Mỗi giá trị có ID riêng; không gộp alias hoặc suy ra retry/khóa tài khoản. is_terminal chỉ mô tả kết quả milestone, không điều khiển scheduler. Bổ sung v349 cho agent và danh mục Automation.`,
    status_key: key, flatform_type: 'all', component_type: 'campaign_detail', is_default: false,
    is_terminal: terminal, can_set_manually: false, is_active: true, is_delete: false, sort_order: 40 + i * 10
  }))
  for (const row of desired) assert(!before.statuses.rows.some(x => x.row.code === row.code || (x.row.component_type === 'campaign_detail' && x.row.name.toLowerCase() === row.name.toLowerCase())), 'Status already exists')
  const sourceFiles = ['src/renderer/src/components/Automation/automationDisplay.ts', 'src/renderer/src/components/Automation/AutomationFormModal.tsx', 'src/main/data/repositories/automationRepository.ts']
  const inputs = { desired, local_sources: sourceFiles.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) })), mappings_to_update: before.mappings.rows.filter(x => x.row.status_id == null).map(x => x.row.id) }
  save('catalog.json', inputs)
  const sql = makeSQL(before, inputs)
  fs.writeFileSync(migrationPath, sql.migration)
  fs.writeFileSync(path.join(directory, 'rollback-template.sql'), transactionStart + sql.rollback + '\nCOMMIT;\n')
  save('prepared-manifest.json', { prepared_at: new Date().toISOString(), migration_sha256: hash(sql.migration), catalog_sha256: hash(fs.readFileSync(path.join(directory, 'catalog.json'))), new_statuses: desired.length, mapped_rows: inputs.mappings_to_update.length })
  console.log(JSON.stringify({ prepared: name, statuses: desired.length, mappings: inputs.mappings_to_update.length }))
}
// Locks only the two small catalogs, not campaign details. SHARE ROW EXCLUSIVE
// permits ordinary reads; lock_timeout refuses prolonged contention.
const transactionStart = `BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';\nLOCK TABLE ${mapping} IN SHARE ROW EXCLUSIVE MODE;\nLOCK TABLE ${status} IN SHARE ROW EXCLUSIVE MODE;\n`
function makeSQL(before, inputs) {
  const desired = inputs.desired
  const literal = jsonSQL(desired, 'desired')
  const types = 'code text,name text,description text,status_key text,flatform_type text,component_type text,is_default boolean,is_terminal boolean,can_set_manually boolean,is_active boolean,is_delete boolean,sort_order integer'
  const fields = desired.length ? Object.keys(desired[0]).join(',') : ''
  const oldBusiness = before.mappings.rows.map(x => { const r = { ...x.row }; delete r.updated_at; return r })
  const schemaGuard = `IF md5((${statusSchema})::text)<>'${before.statuses.schema_md5}' OR md5((${previous.schemaSQL})::text)<>'${before.mappings.schema_md5}' THEN RAISE EXCEPTION 'v349 guard: schema changed'; END IF;`
  const runtimeGuard = `IF ${runtimeSQL} IS DISTINCT FROM ${jsonSQL(before.runtime_checksums, 'functions')} THEN RAISE EXCEPTION 'v349 guard: runtime changed'; END IF;`
  const preflight = `DO $preflight$ BEGIN
 ${schemaGuard}
 ${runtimeGuard}
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name ~ '^migration_v349(_|$)') THEN RAISE EXCEPTION 'v349 guard: version used'; END IF;
 IF (SELECT md5(string_agg(to_jsonb(s)::text,'|' ORDER BY id)) FROM ${status} s)<>'${before.statuses.table_md5}' THEN RAISE EXCEPTION 'v349 guard: status rows changed'; END IF;
 IF (SELECT count(*) FROM ${mapping})<>${before.mappings.row_count} OR EXISTS(SELECT 1 FROM jsonb_array_elements(${jsonSQL(oldBusiness, 'old_mappings')}) b LEFT JOIN ${mapping} m ON m.id=(b->>'id')::bigint WHERE m.id IS NULL OR to_jsonb(m)-'updated_at' IS DISTINCT FROM b) THEN RAISE EXCEPTION 'v349 guard: mapping business fields changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${literal}) AS d(${types}) JOIN ${status} s ON s.code=d.code OR (s.component_type='campaign_detail' AND lower(s.name)=lower(d.name))) THEN RAISE EXCEPTION 'v349 guard: duplicate code/name'; END IF;
 IF (SELECT CASE WHEN is_called THEN last_value+1 ELSE last_value END FROM public.auto_status_id_seq)<=(SELECT max(id) FROM ${status}) THEN RAISE EXCEPTION 'v349 guard: status sequence behind rows'; END IF;
END $preflight$;`
  const capture = which => `SELECT set_config('aka.v349_${which}',(SELECT to_jsonb(s)::text FROM (${snapshotSQL}) s),true);`
  const insert = `INSERT INTO ${status} (${fields}) SELECT ${fields} FROM jsonb_to_recordset(${literal}) AS d(${types});`
  const update = `UPDATE ${mapping} m SET status_id=s.id,
 description=replace(m.description,'status_id=NULL: chưa gắn nhóm ngữ nghĩa auto_status; không tự điền ID theo suy đoán.','Nhóm ngữ nghĩa auto_status.id='||s.id::text||'; không thay thế điều kiện status_value/action_code. Bổ sung liên kết v349.')
 FROM ${status} s JOIN jsonb_to_recordset(${literal}) AS d(${types}) ON s.code=d.code
 WHERE m.status_id IS NULL AND lower(m.status_value)=lower(s.name);`
  const receipt = `SELECT set_config('aka.v349_receipt',jsonb_build_object(
 'statuses',(SELECT jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'md5',md5(to_jsonb(s)::text)) ORDER BY s.id) FROM ${status} s JOIN jsonb_to_recordset(${literal}) AS d(${types}) ON s.code=d.code),
 'mappings',(SELECT jsonb_agg(jsonb_build_object('id',m.id,'md5',md5(to_jsonb(m)::text),'before',b->'row') ORDER BY m.id) FROM ${mapping} m JOIN jsonb_array_elements(current_setting('aka.v349_before')::jsonb->'mappings'->'rows') b ON m.id=(b->'row'->>'id')::bigint WHERE b->'row'->>'status_id' IS NULL AND m.status_id IS NOT NULL),
 'conditions',${previous.referencesSQL})::text,true);`
  // Compare equivalence relations, not raw key strings: changing NULL to an ID
  // must neither merge different status groups nor split an existing group.
  const groupingGuard = `IF EXISTS(
 WITH pairs AS (SELECT (x->'row'->>'id')::bigint AS id,coalesce('semantic:'||(x->'row'->>'status_id'),'status:'||lower(btrim(x->'row'->>'status_value'))) AS old_key,
 coalesce('semantic:'||m.status_id::text,'status:'||lower(btrim(m.status_value))) AS new_key,
 x->'row' AS old_row,to_jsonb(m) AS new_row FROM jsonb_array_elements(current_setting('aka.v349_before')::jsonb->'mappings'->'rows') x JOIN ${mapping} m ON m.id=(x->'row'->>'id')::bigint)
 SELECT 1 FROM pairs a CROSS JOIN pairs b WHERE (a.old_key=b.old_key) IS DISTINCT FROM (a.new_key=b.new_key)
 OR (lower(a.old_row->>'status_value')=lower(b.old_row->>'status_value') OR (a.old_row->>'status_id' IS NOT NULL AND b.old_row->>'status_id' IS NOT NULL AND a.old_row->>'status_id'=b.old_row->>'status_id')) IS DISTINCT FROM
 (lower(a.new_row->>'status_value')=lower(b.new_row->>'status_value') OR (a.new_row->>'status_id' IS NOT NULL AND b.new_row->>'status_id' IS NOT NULL AND a.new_row->>'status_id'=b.new_row->>'status_id'))) THEN RAISE EXCEPTION 'v349 guard: semantic grouping changed'; END IF;`
  const postflight = `DO $postflight$ BEGIN
 ${schemaGuard}
 ${runtimeGuard}
 ${groupingGuard}
 IF (SELECT count(*) FROM ${status})<>${before.statuses.row_count + desired.length} OR (SELECT count(*) FROM ${mapping})<>${before.mappings.row_count} THEN RAISE EXCEPTION 'v349 guard: row count differs'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('aka.v349_before')::jsonb->'statuses'->'rows') b LEFT JOIN ${status} s ON s.id=(b->'row'->>'id')::bigint WHERE s.id IS NULL OR md5(to_jsonb(s)::text)<>b->>'md5') THEN RAISE EXCEPTION 'v349 guard: old status changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(current_setting('aka.v349_before')::jsonb->'mappings'->'rows') b LEFT JOIN ${mapping} m ON m.id=(b->'row'->>'id')::bigint WHERE m.id IS NULL OR to_jsonb(m)-'status_id'-'description' IS DISTINCT FROM (b->'row')-'status_id'-'description' OR (b->'row'->>'status_id' IS NOT NULL AND to_jsonb(m) IS DISTINCT FROM b->'row')) THEN RAISE EXCEPTION 'v349 guard: unrelated mapping value changed'; END IF;
 IF EXISTS(SELECT 1 FROM ${mapping} m LEFT JOIN ${status} s ON s.id=m.status_id WHERE m.status_id IS NULL OR s.component_type<>'campaign_detail' OR lower(s.name)<>lower(m.status_value)) THEN RAISE EXCEPTION 'v349 guard: missing or wrong link'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(${literal}) d LEFT JOIN ${status} s ON s.code=d->>'code' WHERE s.id IS NULL OR to_jsonb(s)-'id'-'created_at'-'updated_at' IS DISTINCT FROM d) THEN RAISE EXCEPTION 'v349 guard: inserted status payload differs'; END IF;
 IF ${previous.referencesSQL} IS DISTINCT FROM current_setting('aka.v349_before')::jsonb->'automation_conditions' THEN RAISE EXCEPTION 'v349 guard: Automation conditions changed'; END IF;
END $postflight$;`
  const rollback = `DO $rollback$
DECLARE receipt jsonb := '__V349_RECEIPT__'::jsonb;
BEGIN
 ${schemaGuard}
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'statuses') r LEFT JOIN ${status} s ON s.id=(r->>'id')::bigint WHERE s.id IS NULL OR s.code<>r->>'code' OR md5(to_jsonb(s)::text)<>r->>'md5') THEN RAISE EXCEPTION 'v349 rollback: status changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r LEFT JOIN ${mapping} m ON m.id=(r->>'id')::bigint WHERE m.id IS NULL OR md5(to_jsonb(m)::text)<>r->>'md5') THEN RAISE EXCEPTION 'v349 rollback: mapping changed or used'; END IF;
 IF EXISTS(SELECT 1 FROM ${mapping} m JOIN jsonb_array_elements(receipt->'statuses') s ON m.status_id=(s->>'id')::bigint WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r WHERE m.id=(r->>'id')::bigint)) THEN RAISE EXCEPTION 'v349 rollback: independent status reference'; END IF;
 IF (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.auto_automation_trigger_statuses t WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r WHERE t.status_mapping_id=(r->>'id')::bigint)) IS DISTINCT FROM
 (SELECT coalesce(jsonb_agg(t ORDER BY (t->>'id')::bigint),'[]'::jsonb) FROM jsonb_array_elements(receipt->'conditions') t WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'mappings') r WHERE (t->>'status_mapping_id')::bigint=(r->>'id')::bigint)) THEN RAISE EXCEPTION 'v349 rollback: Automation references changed'; END IF;
 UPDATE ${mapping} m SET status_id=(r->'before'->>'status_id')::bigint,description=r->'before'->>'description' FROM jsonb_array_elements(receipt->'mappings') r WHERE m.id=(r->>'id')::bigint;
 IF EXISTS(SELECT 1 FROM ${mapping} m JOIN jsonb_array_elements(receipt->'statuses') s ON m.status_id=(s->>'id')::bigint) THEN RAISE EXCEPTION 'v349 rollback: references remain'; END IF;
 DELETE FROM ${status} s USING jsonb_array_elements(receipt->'statuses') r WHERE s.id=(r->>'id')::bigint;
END $rollback$;`
  const body = [preflight,capture('before'),insert,update,postflight,receipt,capture('after')].join('\n')
  const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements,rollback) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}',ARRAY[${dollar(body, 'body')},'-- v349_before '||current_setting('aka.v349_before'),'-- v349_after '||current_setting('aka.v349_after'),'-- v349_receipt '||current_setting('aka.v349_receipt')],ARRAY[replace(${dollar(rollback, 'undo')},'__V349_RECEIPT__',replace(current_setting('aka.v349_receipt'),chr(39),chr(39)||chr(39)))]);`
  const migration = '-- v349 data only: separate canonical status for each existing value; preserve Automation equivalence.\n' + transactionStart + body + '\n' + history + '\nCOMMIT;\n'
  return { migration, preflight, capture, insert, update, postflight, receipt, rollback, fields }
}

function verifyEquivalence(before, after) {
  const rows = before.mappings.rows.map(x => x.row)
  const current = new Map(after.mappings.rows.map(x => [x.row.id, x.row]))
  const semantic = row => Number.isSafeInteger(row.status_id) && row.status_id > 0 ? 'semantic:' + row.status_id : 'status:' + row.status_value.trim().toLocaleLowerCase('vi-VN')
  const prune = (a,b) => a.status_value.toLowerCase() === b.status_value.toLowerCase() || (a.status_id != null && b.status_id != null && a.status_id === b.status_id)
  let pairs = 0
  for (const a of rows) for (const b of rows) {
    assert.equal(semantic(a) === semantic(b), semantic(current.get(a.id)) === semantic(current.get(b.id)), 'UI groups changed')
    assert.equal(prune(a,b), prune(current.get(a.id),current.get(b.id)), 'RPC wildcard pruning changed')
    pairs++
  }
  return pairs
}
function recover(before) {
  const history = query(`SELECT version,statements[2] AS before,statements[3] AS after,statements[4] AS receipt,rollback[1] AS rollback FROM supabase_migrations.schema_migrations WHERE name='${name}'`)
  assert.equal(history.length,1,'Missing or ambiguous history; do not retry apply blindly')
  const h = history[0]
  const b = JSON.parse(h.before.replace(/^-- v349_before /,'')), a = JSON.parse(h.after.replace(/^-- v349_after /,''))
  validate(b); validate(a)
  const receipt = JSON.parse(h.receipt.replace(/^-- v349_receipt /,''))
  const pairs = verifyEquivalence(b,a)
  assert.deepEqual(b.automation_conditions,a.automation_conditions)
  assert.deepEqual(b.runtime_checksums,a.runtime_checksums)
  for (const key of ['statuses','mappings']) assert.equal(b[key].schema_md5,a[key].schema_md5)
  const byId = new Map(a.mappings.rows.map(x => [x.row.id,x.row]))
  for (const old of b.mappings.rows) {
    const r = {...byId.get(old.row.id)}, expected = {...old.row}
    delete r.status_id; delete r.description; delete expected.status_id; delete expected.description
    assert.deepEqual(r,expected)
  }
  for (const old of b.statuses.rows) assert.equal(a.statuses.rows.find(x=>x.row.id===old.row.id)?.md5,old.md5)
  for (const [file,s] of [['apply-before.json',b],['after.json',a]]) if(!fs.existsSync(path.join(directory,file)))save(file,s,true)
  // Keep the reference comparison stable until restore commits. Restoring an ID
  // does not delete the mapping, so FK enforcement alone cannot prevent a new
  // Automation condition racing the reference guard.
  const rollback = transactionStart + 'LOCK TABLE public.auto_automation_trigger_statuses IN SHARE MODE;\n' + h.rollback + `\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}_rollback',ARRAY[${dollar(h.rollback,'rollback_audit')}]);\nCOMMIT;\n`
  fs.writeFileSync(rollbackPath,rollback)
  const live = snapshot(); validate(live)
  assert.deepEqual(live.runtime_checksums,a.runtime_checksums)
  for (const old of a.mappings.rows) {
    const r={...live.mappings.rows.find(x=>x.row.id===old.row.id)?.row}, e={...old.row};delete r.updated_at;delete e.updated_at;assert.deepEqual(r,e)
  }
  save('latest-verification.json',live)
  save('applied-manifest.json',{project_ref:ref,version:h.version,name,verified_at:new Date().toISOString(),inserted_statuses:receipt.statuses,updated_mapping_ids:receipt.mappings.map(x=>x.id),
    semantic_pairs_verified:pairs,automation_conditions_unchanged:true,runtime_unchanged:true,schema_unchanged:true,
    before_sha256:hash(fs.readFileSync(path.join(directory,'before.json'))),apply_before_sha256:hash(fs.readFileSync(path.join(directory,'apply-before.json'))),after_sha256:hash(fs.readFileSync(path.join(directory,'after.json'))),
    migration_sha256:hash(fs.readFileSync(migrationPath)),rollback_sha256:hash(rollback)})
  return {version:h.version,new_statuses:receipt.statuses.length,updated_mappings:receipt.mappings.length,remaining_nulls:live.mappings.rows.filter(x=>x.row.status_id==null).length,semantic_pairs:pairs}
}
function main() {
  fs.mkdirSync(directory,{recursive:true})
  const mode=process.argv[2]
  if(mode==='capture') {
    const before=snapshot();validate(before);save('before.json',before,true);validate(load('before.json'))
    save('backup-manifest.json',{project_ref:ref,captured_at:before.captured_at,before_sha256:hash(fs.readFileSync(path.join(directory,'before.json'))),tables:Object.fromEntries(['statuses','mappings'].map(k=>[k,{count:before[k].row_count,table_md5:before[k].table_md5,schema_md5:before[k].schema_md5,row_checksums:before[k].rows.map(x=>({id:x.row.id,md5:x.md5}))}]))},true)
    save('runtime-evidence.json',query(`SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,md5(pg_get_functiondef(p.oid)) AS md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND (strpos(p.prosrc,'auto_status')>0 OR strpos(p.prosrc,'auto_campaign_action_detail_statuses')>0 OR strpos(p.prosrc,'semantic_status_id')>0) ORDER BY signature;`),true)
    console.log(JSON.stringify({captured_statuses:before.statuses.row_count,captured_mappings:before.mappings.row_count}))
    return
  }
  const before=checkedBefore()
  if(mode==='build'){build(before);return}
  const inputs=load('catalog.json'),sql=makeSQL(before,inputs),prepared=load('prepared-manifest.json')
  assert.equal(hash(sql.migration),prepared.migration_sha256)
  assert.equal(hash(fs.readFileSync(migrationPath)),prepared.migration_sha256)
  assert.equal(hash(fs.readFileSync(path.join(directory,'catalog.json'))),prepared.catalog_sha256)
  if(mode==='smoke') {
    const fixture=sql.insert.replace(`INSERT INTO ${status} (`,`INSERT INTO ${status} (id,`).replace('SELECT '+sql.fields,'SELECT 1000000000+row_number() OVER (),'+sql.fields)
    const rollback=sql.rollback.replace("'__V349_RECEIPT__'::jsonb","current_setting('aka.v349_receipt')::jsonb")
    const reject=(statement,expected,tag)=>`DO $${tag}$ BEGIN BEGIN EXECUTE ${dollar(statement,tag+'_sql')}; RAISE EXCEPTION 'TEST: rejection missing'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>${quote(expected)} THEN RAISE; END IF; END; END $${tag}$;`
    const badStatus=reject(rollback.replace("current_setting('aka.v349_receipt')::jsonb","jsonb_set(current_setting('aka.v349_receipt')::jsonb,'{statuses,0,md5}','\"bad\"'::jsonb)"),'v349 rollback: status changed','status_drift')
    const badMapping=reject(rollback.replace("current_setting('aka.v349_receipt')::jsonb","jsonb_set(current_setting('aka.v349_receipt')::jsonb,'{mappings,0,md5}','\"bad\"'::jsonb)"),'v349 rollback: mapping changed or used','mapping_drift')
    const unaffected=before.mappings.rows.find(x=>x.row.status_id!=null).row.id
    const independentRef=reject(`UPDATE ${mapping} SET status_id=(current_setting('aka.v349_receipt')::jsonb->'statuses'->0->>'id')::bigint WHERE id=${unaffected};\n`+rollback,'v349 rollback: independent status reference','independent_ref')
    const badConditions=reject(rollback.replace("current_setting('aka.v349_receipt')::jsonb",`jsonb_set(current_setting('aka.v349_receipt')::jsonb,'{conditions}',(current_setting('aka.v349_receipt')::jsonb->'conditions')||jsonb_build_array(jsonb_build_object('id',-349,'status_mapping_id',${inputs.mappings_to_update[0]})))`),'v349 rollback: Automation references changed','condition_drift')
    const wrongGroup=reject(`UPDATE ${mapping} SET status_id=20 WHERE id=${inputs.mappings_to_update[0]};\n`+sql.postflight,'v349 guard: semantic grouping changed','wrong_group')
    const result=query(transactionStart+sql.preflight+'\n'+sql.capture('before')+'\n'+fixture+'\n'+sql.update+'\n'+sql.postflight+'\n'+sql.receipt+'\n'+badStatus+'\n'+badMapping+'\n'+independentRef+'\n'+badConditions+'\n'+wrongGroup+'\n'+rollback+`
DO $restored$ DECLARE v349_restored_snapshot jsonb; BEGIN SELECT to_jsonb(x) INTO v349_restored_snapshot FROM (${snapshotSQL}) x;
 IF v349_restored_snapshot->'statuses'->>'table_md5'<>current_setting('aka.v349_before')::jsonb->'statuses'->>'table_md5' OR v349_restored_snapshot->'mappings'->>'table_md5'<>current_setting('aka.v349_before')::jsonb->'mappings'->>'table_md5' THEN RAISE EXCEPTION 'TEST: tables not restored'; END IF;
 IF v349_restored_snapshot->'statuses'->'sequence_state' IS DISTINCT FROM current_setting('aka.v349_before')::jsonb->'statuses'->'sequence_state' OR v349_restored_snapshot->'mappings'->'sequence_state' IS DISTINCT FROM current_setting('aka.v349_before')::jsonb->'mappings'->'sequence_state' THEN RAISE EXCEPTION 'TEST: sequence consumed'; END IF;
END $restored$;
ROLLBACK; SELECT 'passed: separate groups, unchanged rules, exact rollback, unchanged sequences and checksum guards' AS result;`)
    const simulated=JSON.parse(JSON.stringify(before))
    for(const x of simulated.mappings.rows)if(x.row.status_id==null)x.row.status_id=1000000001+inputs.desired.findIndex(d=>d.name.toLowerCase()===x.row.status_value.toLowerCase())
    const pairs=verifyEquivalence(before,simulated)
    const live=snapshot();validate(live)
    assert.equal(live.statuses.table_md5,before.statuses.table_md5)
    for(const old of before.mappings.rows){const r={...live.mappings.rows.find(x=>x.row.id===old.row.id)?.row},e={...old.row};delete r.updated_at;delete e.updated_at;assert.deepEqual(r,e)}
    save('smoke.json',{checked_at:new Date().toISOString(),result,migration_sha256:prepared.migration_sha256,catalog_sha256:prepared.catalog_sha256,semantic_pairs:pairs,tables_restored:true,sequences_unchanged_inside_transaction:true,drift_guards_passed:true})
    console.log(JSON.stringify({smoke:'passed',pairs,statuses:inputs.desired.length,mappings:inputs.mappings_to_update.length}))
  } else if(mode==='apply') {
    const smoke=load('smoke.json');assert.equal(smoke.migration_sha256,prepared.migration_sha256);assert.equal(smoke.catalog_sha256,prepared.catalog_sha256)
    for(const s of inputs.local_sources)assert.equal(hash(fs.readFileSync(path.join(root,s.file))),s.sha256)
    query(sql.migration+`SELECT version FROM supabase_migrations.schema_migrations WHERE name='${name}';`)
    console.log(JSON.stringify(recover(before)))
  } else if(mode==='verify'||mode==='recover')console.log(JSON.stringify(recover(before)))
  else if(mode==='rollback'){
    const a=load('applied-manifest.json');assert.equal(hash(fs.readFileSync(rollbackPath)),a.rollback_sha256)
    query(fs.readFileSync(rollbackPath,'utf8')+'SELECT clock_timestamp() AS reverted_at;')
    const after=snapshot();validate(after);save('reverted.json',after,true);console.log(JSON.stringify({reverted:true,mappings_preserved:after.mappings.row_count}))
  } else throw Error('Usage: capture|build|smoke|apply|verify|recover|rollback')
}
module.exports={snapshot,validate,query,directory,load,save}
if(require.main===module)main()
