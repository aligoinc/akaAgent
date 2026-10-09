// v347 maintenance only. Uses the existing linked Supabase Management API.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const ref = 'cgjbsmqtfhqvttudyjzq'
const name = 'migration_v347_campaign_status_agent_descriptions'
const table = 'public.auto_campaign_action_detail_statuses'
const directory = path.join(root, 'migrations/snapshots/campaign-status-catalog-v347')
const migrationPath = path.join(root, 'migrations', name + '.sql')
const rollbackPath = path.join(root, 'migrations/tests', name + '_rollback.sql')
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex')
const quote = value => "'" + String(value).replaceAll("'", "''") + "'"
const dollar = (value, tag) => {
  assert(!value.includes('$' + tag + '$'))
  return '$' + tag + '$' + value + '$' + tag + '$'
}
const jsonSQL = (value, tag) => dollar(JSON.stringify(value), tag) + '::jsonb'
const save = (file, value, exclusive = false) => fs.writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + '\n', { flag: exclusive ? 'wx' : 'w' })
const load = file => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
function query(sql) {
  assert.equal(fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(), ref)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-status-v347-'))
  try {
    const file = path.join(temp, 'query.sql')
    fs.writeFileSync(file, sql)
    const out = execFileSync('supabase', ['db', 'query', '--linked', '--file', file], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe']
    })
    const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
    assert(Array.isArray(parsed.rows))
    return parsed.rows
  } catch (error) {
    if (error.stderr) console.error(String(error.stderr))
    throw error
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}
const schemaSQL = `jsonb_build_object(
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'comment',col_description(a.attrelid,a.attnum)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='${table}'::regclass AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid='${table}'::regclass),
 'incoming_foreign_keys',(SELECT jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE confrelid='${table}'::regclass),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='auto_campaign_action_detail_statuses'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid='${table}'::regclass AND NOT tgisinternal),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='auto_campaign_action_detail_statuses'),
 'access',(SELECT jsonb_build_object('owner',pg_get_userbyid(relowner),'acl',relacl,'rls',relrowsecurity,'force_rls',relforcerowsecurity) FROM pg_class WHERE oid='${table}'::regclass),
 'sequence_definition',(SELECT to_jsonb(s)-'last_value' FROM pg_sequences s WHERE schemaname='public' AND sequencename='auto_campaign_action_detail_statuses_id_seq'))`
const runtimeSQL = `(SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND (strpos(p.prosrc,'auto_campaign_action_detail_statuses')>0 OR p.proname IN ('aka_agent_apply_voice_call_event','aka_agent_commit_voice_call_dial','aka_agent_record_sms_message_status')))`
const referencesSQL = `(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) FROM public.auto_automation_trigger_statuses r)`
const snapshotSelect = `WITH meta AS (SELECT ${schemaSQL} AS data)
SELECT '${ref}' AS project_ref,clock_timestamp() AS captured_at,
 (SELECT count(*) FROM ${table}) AS row_count,
 (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) FROM ${table} t) AS table_md5,
 (SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(t),'canonical',to_jsonb(t)::text,'md5',md5(to_jsonb(t)::text)) ORDER BY id) FROM ${table} t) AS rows,
 meta.data AS schema,meta.data::text AS schema_canonical,md5(meta.data::text) AS schema_md5,
 (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_campaign_action_detail_statuses_id_seq) AS sequence_state,
 ${runtimeSQL} AS runtime_checksums,${referencesSQL} AS automation_conditions,
 (SELECT md5(string_agg(to_jsonb(e)::text,'|' ORDER BY id)) FROM public.auto_error e) AS auto_error_md5
FROM meta`
function snapshot() { return query(snapshotSelect + ';')[0] }
function validate(value) {
  assert.equal(value.project_ref, ref)
  assert.equal(value.row_count, value.rows.length)
  assert.equal(new Set(value.rows.map(x => x.row.id)).size, value.row_count)
  for (const item of value.rows) {
    assert.deepEqual(JSON.parse(item.canonical), item.row)
    assert.equal(hash(item.canonical, 'md5'), item.md5)
    assert.equal(Object.keys(item.row).length, value.schema.columns.length)
  }
  assert.equal(hash(value.rows.map(x => x.canonical).join('|'), 'md5'), value.table_md5)
  assert.deepEqual(JSON.parse(value.schema_canonical), value.schema)
  assert.equal(hash(value.schema_canonical, 'md5'), value.schema_md5)
}
function checkedBefore() {
  const before = load('before.json')
  validate(before)
  assert.equal(hash(fs.readFileSync(path.join(directory, 'before.json'))), load('backup-manifest.json').before_sha256)
  return before
}
const fallback = 'Danh mục trạng thái chi tiết chiến dịch, không phải policy lỗi hay lịch sử một lần chạy. Đọc campaign_action_id để biết loại chiến dịch; action_code NULL nghĩa là mọi hành động trong loại đó, có giá trị nghĩa là chỉ hành động đó. status_value được so khớp không phân biệt hoa/thường; label chỉ để hiển thị. status_id NULL nghĩa là chưa gắn nhóm ngữ nghĩa auto_status, không phải dữ liệu hỏng. Không suy ra thành công, retry, khóa tài khoản hoặc kết quả gửi/nhận từ việc có dòng danh mục; đối chiếu detail/log và runtime. Dòng có thể được seed, lưu từ Automation hoặc tự sinh khi runtime ghi detail. Mô tả chỉ phục vụ agent, không tham gia điều kiện chạy.'
const columnComment = 'Agent-readable documentation only. Not executed or used for Automation matching. New auto-generated rows inherit a generic explanation; curated rows have contextual descriptions. NULL action_code is a wildcard, NULL status_id means no semantic group.'
const meanings = {
 'thành công': 'Runtime ghi nhận hành động hoàn tất thành công theo hợp đồng của hành động; không tự suy ra người nhận đã đọc, email đã vào inbox hoặc lời mời đã được chấp nhận.',
 'thất bại': 'Runtime ghi nhận hành động không hoàn tất thành công; nguyên nhân nằm trong detail/log/error_code. Không tự suy ra có thể retry.',
 'lỗi': 'Runtime ghi nhận lỗi khi xử lý hành động; đây là trạng thái detail, không phải mã err_* hay chỉ thị retry/khóa tài khoản.',
 'không tồn tại': 'Runtime không tìm thấy đối tượng đích theo phép kiểm tra của hành động. Không khẳng định đối tượng không tồn tại trên toàn nền tảng.',
 'đã là bạn bè': 'Runtime hoặc dữ liệu lịch sử ghi nhận quan hệ bạn bè đã tồn tại; không có nghĩa vừa gửi thêm lời mời kết bạn.',
 'đã gửi lời mời': 'Đã có hoặc đã ghi nhận lời mời theo hành động; với mời vào group Facebook thường là lời mời đã gửi trước đó, chưa chứng minh người nhận đã tham gia.',
 'đã gửi lời mời kết bạn': 'Chuỗi trạng thái kết bạn trong danh mục hiện có; không đồng nhất tự động với thành công hay đã là bạn bè.',
 'đã là thành viên': 'Đối tượng đã là thành viên group trước thao tác; không chứng minh vừa thêm thành viên mới.',
 'đã tham gia': 'Runtime nhận diện tài khoản đã tham gia group; có thể là bỏ qua thao tác vì đã tham gia từ trước.',
 'tag không tồn tại': 'Không tìm thấy tag Zalo cần gắn. Dù helper có thể kết thúc bình thường, trạng thái này không có nghĩa đã gắn tag thành công.',
 'tham số không hợp lệ': 'Với zalo_change_alias: tên mới sau render template bị rỗng. Helper không đổi tên và có thể trả ok=true; không diễn giải trạng thái này là thành công.',
 'đang gọi': 'Cuộc gọi đã bắt đầu quay số; trạng thái trung gian, chưa xác nhận hoàn tất hay thành công. Sự kiện cuộc gọi sau đó cập nhật cùng detail.',
 'đã xem': 'Email tracking nhận sự kiện mở/xem; tín hiệu tracking, không chứng minh chắc chắn người thật đã đọc nội dung.',
 'đã click': 'Email tracking nhận sự kiện click liên kết; không suy ra chuyển đổi hoặc danh tính người click.',
 'đã gửi': 'SMS có tín hiệu đã gửi từ hệ thống gửi; chưa đồng nghĩa thiết bị đích đã nhận hoặc người nhận đã đọc.',
 'đã nhận': 'SMS có tín hiệu nhận/phát theo tích hợp; không suy ra người nhận đã đọc.',
 'đã gửi tin nhắn': 'Chuỗi trạng thái nhắn tin trong danh mục hiện có; không tự đổi thành thành công hay đồng nhất với đã nhận/đã xem.',
 'đã đổi tên': 'Chuỗi trạng thái đổi tên trong danh mục hiện có; giữ nguyên khi so khớp, không tự coi là alias của thành công.',
 'đã gắn tag': 'Chuỗi trạng thái gắn tag trong danh mục hiện có; giữ nguyên khi so khớp, không tự coi là alias của thành công.'
}
function description(row, source) {
  return `Loại chiến dịch: ${row.campaign_action_id}. Phạm vi: ${row.action_code ? 'chỉ hành động ' + row.action_code : 'mọi hành động của loại chiến dịch (action_code=NULL)'}. Trạng thái: ${row.status_value}. ${meanings[row.status_value.toLowerCase()] || 'Trạng thái đặc thù; đối chiếu producer và detail/log trước khi diễn giải.'} ${row.status_id == null ? 'status_id=NULL: chưa gắn nhóm ngữ nghĩa auto_status; không tự điền ID theo suy đoán.' : 'Nhóm ngữ nghĩa auto_status.id=' + row.status_id + '; không thay thế điều kiện status_value/action_code.'} Đây là danh mục lựa chọn Automation, không chứng minh đã có lượt chạy phát ra trạng thái. So khớp status_value không phân biệt hoa/thường; action_code NULL là wildcard. ${source} Mô tả cho agent, không điều khiển runtime.`
}
const key = row => [row.campaign_action_id, row.action_code || '', row.status_value.toLowerCase()].join('|')

function build(before) {
  assert(!fs.existsSync(path.join(directory, 'applied-manifest.json')))
  const catalogs = load('source-catalogs.json')
  const candidates = new Map()
  const scopes = new Map(catalogs.campaigns.map(c => [c.id, new Set(c.limit_check_action_codes || [])]))
  for (const { row } of before.rows) if (row.action_code) scopes.get(row.campaign_action_id)?.add(row.action_code)
  const extras = {
    facebook_group_post: ['fb_like_post'],
    facebook_timeline_post: ['fb_post_my_profile', 'fb_comment', 'fb_like_post'],
    facebook_comment_seeding: ['fb_like_post'], facebook_comment_seeding_post: ['fb_like_post'],
    facebook_newsfeed_interaction: ['fb_comment', 'fb_like_post'],
    zalo_cancel_sent_friend_request: ['zalo_cancel_sent_friend_request']
  }
  for (const [campaign, actions] of Object.entries(extras)) for (const action of actions) scopes.get(campaign).add(action)
  const add = (campaign_action_id, action_code, status_value, evidence) => {
    const status_id = catalogs.statuses.find(s => s.name.toLowerCase() === status_value)?.id ?? null
    const sort_order = ({ 'thành công': 10, 'thất bại': 20, 'lỗi': 30, 'đang gọi': 5 })[status_value] ?? 40
    const row = { campaign_action_id, action_code, status_id, status_value, label: status_value, is_active: true, is_delete: false, sort_order }
    row.description = description(row, 'Bổ sung v347 theo ' + evidence + '.')
    candidates.set(key(row), { row, evidence })
  }
  for (const [campaign, actions] of scopes) {
    if (campaign === 'voice_call' || campaign === 'sms_send') continue
    for (const action of actions) {
      // Like/newsfeed/timeline publishing and group invite do not emit a
      // business-failure detail in the inspected runtime: do not invent one.
      const fbWithoutFailure = action === 'fb_like_post' || campaign === 'facebook_newsfeed_interaction' || action === 'fb_post_my_profile' || campaign === 'facebook_group_invite'
      const statuses = campaign.startsWith('facebook_')
        ? (fbWithoutFailure ? ['thành công', 'lỗi'] : ['thành công', 'thất bại', 'lỗi'])
        : ['thành công', 'thất bại']
      for (const status of statuses) add(campaign, action, status, 'campaignActionDescriptors.ts; campaignScheduler.ts: hành động hỗ trợ và nhánh ghi detail; auto_error live cho lỗi Zalo')
      if (action === 'zalo_find_phone_user') add(campaign, action, 'không tồn tại', 'helper tìm SĐT và policy err_zalo_219_find_phone_invalid/err_zalo_210_target_unavailable live')
      if (action === 'zalo_add_friend') for (const status of ['đã là bạn bè', 'đã gửi lời mời', 'không tồn tại']) add(campaign, action, status, 'helper kết bạn và policy Zalo live: already_friend/friend_request_sent/target_unavailable')
    }
  }
  for (const workflow of load('auxiliary-workflows.json')) {
    const text = JSON.stringify(workflow.nodes)
    if (text.includes('2772')) {
      for (const status of ['thành công', 'thất bại', 'tag không tồn tại']) add(workflow.campaign_action_id, 'zalo_tag_contact', status, `workflow live ${workflow.workflow_id}, block 2772, campaignScheduler.zaloApplyContactTag`)
    }
    if (text.includes('2773')) {
      for (const status of ['thành công', 'thất bại', 'tham số không hợp lệ']) add(workflow.campaign_action_id, 'zalo_change_alias', status, `workflow live ${workflow.workflow_id}, block 2773, campaignScheduler.zaloChangeContactAlias`)
    }
  }
  for (const status of ['thành công', 'thất bại', 'đang gọi']) add('voice_call', 'voice_call', status, 'RPC live aka_agent_authorize_voice_call và aka_agent_apply_voice_call_event; không lấy trạng thái nội bộ job')
  for (const status of ['thành công', 'thất bại', 'không tồn tại', 'đã gửi', 'đã nhận']) add('sms_send', 'sms_send', status, 'campaignScheduler.EXTERNAL_SMS_STATUS_VALUES và RPC live aka_agent_record_sms_message_status')
  for (const status of ['không tồn tại', 'đã xem', 'đã click']) add('email_send', 'email_send', status, 'campaignScheduler.emailSendMessage và emailTrackingRepository')
  for (const status of ['đã gửi lời mời', 'đã là thành viên', 'không tồn tại']) add('facebook_group_invite', 'fb_group_invite', status, 'campaignScheduler.normalizeFacebookGroupInviteDetailStatus')
  add('facebook_join_group', 'fb_join_group', 'đã tham gia', 'campaignScheduler: already_joined')
  add('facebook_page_to_message', 'fb_message_page_inbox_customer', 'không tồn tại', 'campaignScheduler: isPageInboxTargetNotFound')
  add('zalo_add_group_member', 'zalo_add_group_member', 'đã là thành viên', 'campaignScheduler.zaloAddGroupMember: alreadyMember')
  add('zalo_join_group_link', 'zalo_join_group_link', 'đã tham gia', 'campaignScheduler.zaloJoinGroupLink: alreadyJoined')
  const existing = new Map(before.rows.filter(x => !x.row.is_delete).map(x => [key(x.row), x.row]))
  const desired = [...candidates.values()].filter(x => !existing.has(key(x.row))).sort((a, b) => key(a.row).localeCompare(key(b.row)))
  for (const { row } of desired) {
    assert(catalogs.campaigns.some(x => x.id === row.campaign_action_id))
    assert(catalogs.actions.some(x => x.code === row.action_code))
    assert(!row.status_value.startsWith('err_'))
  }
  const descriptions = before.rows.map(({ row }) => ({ id: row.id, description: description(row, 'Dòng có sẵn trước v347, giữ nguyên ID/điều kiện/trạng thái. Không giả định chuỗi lịch sử còn được mọi phiên bản runtime phát ra.') }))
  const files = ['src/main/services/campaignScheduler.ts', 'src/main/domain/campaigns/campaignActionDescriptors.ts', 'src/main/data/repositories/emailTrackingRepository.ts']
  const localSources = files.map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) }))
  save('catalog.json', { desired, descriptions, skipped_existing: [...candidates.values()].filter(x => existing.has(key(x.row))).map(x => key(x.row)), localSources, fallback })
  const sql = makeSQL(before, load('catalog.json'))
  fs.writeFileSync(migrationPath, sql.migration)
  fs.writeFileSync(path.join(directory, 'rollback-template.sql'), '-- Template: actual IDs/checksums are recorded atomically in migration history on apply.\n' + transactionStart + sql.rollback + '\nCOMMIT;\n')
  save('prepared-manifest.json', { project_ref: ref, prepared_at: new Date().toISOString(), before_sha256: hash(fs.readFileSync(path.join(directory, 'before.json'))),
    catalog_sha256: hash(fs.readFileSync(path.join(directory, 'catalog.json'))), migration_sha256: hash(sql.migration), new_rows: desired.length, descriptions: descriptions.length })
  console.log(JSON.stringify({ new_rows: desired.length, described_existing_rows: descriptions.length, by_campaign: Object.fromEntries([...new Set(desired.map(x => x.row.campaign_action_id))].map(c => [c, desired.filter(x => x.row.campaign_action_id === c).length])) }))
}

const transactionStart = `BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '30s';\nLOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE;\n`
function makeSQL(before, catalog) {
  const desired = catalog.desired.map(x => x.row)
  const literal = jsonSQL(desired, 'desired')
  const descriptions = jsonSQL(catalog.descriptions, 'descriptions')
  const types = 'campaign_action_id text,action_code text,status_id bigint,status_value text,label text,is_active boolean,is_delete boolean,sort_order integer,description text'
  const fields = 'campaign_action_id,action_code,status_id,status_value,label,is_active,is_delete,sort_order,description'
  // Runtime updates updated_at on every matching detail event. Only that field may
  // drift since the local backup. Capture and verify all fields again under lock.
  const businessBaseline = before.rows.map(x => { const row = { ...x.row }; delete row.updated_at; return row })
  const originalGuard = minus => minus
    ? `IF EXISTS (SELECT 1 FROM jsonb_array_elements(current_setting('aka.v347_before')::jsonb->'rows') x LEFT JOIN ${table} t ON t.id=(x->'row'->>'id')::bigint WHERE t.id IS NULL OR md5((to_jsonb(t)-'description')::text)<>x->>'md5') THEN RAISE EXCEPTION 'v347 guard: original row changed during migration'; END IF;`
    : `IF EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonSQL(businessBaseline, 'old_business_rows')}) x LEFT JOIN ${table} t ON t.id=(x->>'id')::bigint WHERE t.id IS NULL OR to_jsonb(t)-'updated_at' IS DISTINCT FROM x) THEN RAISE EXCEPTION 'v347 guard: original row changed'; END IF;`
  const producerEvidence = load('producer-evidence.json')
  const producers = [...load('source-catalogs.json').producers, ...producerEvidence.voice].map(x => ({ signature: x.signature, md5: x.md5 }))
  const workflows = load('auxiliary-workflows.json').map(x => ({ id: x.workflow_id, md5: x.md5 }))
  const blocks = producerEvidence.aux.map(x => ({ id: x.id, md5: x.md5 }))
  const invariantGuard = `IF ${runtimeSQL} IS DISTINCT FROM ${jsonSQL(before.runtime_checksums, 'runtime_checksums')} THEN RAISE EXCEPTION 'v347 guard: catalog runtime changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${jsonSQL(producers, 'producer_hashes')}) AS d(signature text,md5 text) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(d.signature) WHERE p.oid IS NULL OR md5(p.prosrc)<>d.md5) THEN RAISE EXCEPTION 'v347 guard: producer changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${jsonSQL(blocks, 'block_hashes')}) AS d(id bigint,md5 text) LEFT JOIN public.auto_blocks b ON b.id=d.id WHERE b.id IS NULL OR md5(to_jsonb(b)::text)<>d.md5) THEN RAISE EXCEPTION 'v347 guard: auxiliary block changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(${jsonSQL(workflows, 'workflow_hashes')}) AS d(id bigint,md5 text) LEFT JOIN public.auto_workflows w ON w.id=d.id WHERE w.id IS NULL OR md5(to_jsonb(w)::text)<>d.md5) THEN RAISE EXCEPTION 'v347 guard: auxiliary workflow changed'; END IF;
 IF (SELECT md5(string_agg(to_jsonb(e)::text,'|' ORDER BY id)) FROM public.auto_error e)<>'${before.auto_error_md5}' THEN RAISE EXCEPTION 'v347 guard: source policies changed'; END IF;`
  const preflight = `DO $preflight$ BEGIN
 ${originalGuard(false)}
 IF (SELECT count(*) FROM ${table})<>${before.row_count} THEN RAISE EXCEPTION 'v347 guard: original row count changed'; END IF;
 IF md5((${schemaSQL})::text)<>'${before.schema_md5}' THEN RAISE EXCEPTION 'v347 guard: schema changed'; END IF;
 ${invariantGuard}
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name ~ '^migration_v347(_|$)') THEN RAISE EXCEPTION 'v347 guard: version already used'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(${literal}) AS d(${types}) LEFT JOIN public.auto_campaign_actions c ON c.id=d.campaign_action_id AND c.is_active AND NOT c.is_delete LEFT JOIN public.auto_account_actions a ON a.code=d.action_code AND a.is_active AND NOT a.is_delete WHERE c.id IS NULL OR a.code IS NULL) THEN RAISE EXCEPTION 'v347 guard: invalid action scope'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(${literal}) AS d(${types}) LEFT JOIN public.auto_status s ON s.id=d.status_id AND s.is_active AND NOT s.is_delete AND s.component_type='campaign_detail' AND lower(s.name)=lower(d.status_value) WHERE d.status_id IS NOT NULL AND s.id IS NULL) THEN RAISE EXCEPTION 'v347 guard: invalid semantic status'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_to_recordset(${literal}) AS d(${types}) JOIN ${table} t ON t.campaign_action_id=d.campaign_action_id AND t.action_code IS NOT DISTINCT FROM d.action_code AND lower(t.status_value)=lower(d.status_value) WHERE NOT t.is_delete) THEN RAISE EXCEPTION 'v347 guard: duplicate status'; END IF;
END $preflight$;`
  const alter = `ALTER TABLE ${table} ADD COLUMN description text NOT NULL DEFAULT ${quote(fallback)};
COMMENT ON COLUMN ${table}.description IS ${quote(columnComment)};
UPDATE ${table} t SET description=d.description FROM jsonb_to_recordset(${descriptions}) AS d(id bigint,description text) WHERE t.id=d.id;`
  const insert = `WITH inserted AS (INSERT INTO ${table} (${fields}) SELECT ${fields} FROM jsonb_to_recordset(${literal}) AS d(${types}) RETURNING *)
SELECT set_config('aka.v347_receipt',jsonb_agg(jsonb_build_object('id',id,'campaign_action_id',campaign_action_id,'action_code',action_code,'status_value',status_value,'md5',md5(to_jsonb(inserted)::text)) ORDER BY id)::text,true) FROM inserted;`
  const postflight = `DO $postflight$ BEGIN
 ${originalGuard(true)}
 ${invariantGuard}
 IF (SELECT count(*) FROM ${table})<>${before.row_count + desired.length} THEN RAISE EXCEPTION 'v347 guard: final count differs'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(${literal}) d LEFT JOIN ${table} t ON t.campaign_action_id=d->>'campaign_action_id' AND t.action_code=d->>'action_code' AND lower(t.status_value)=lower(d->>'status_value') AND NOT t.is_delete WHERE t.id IS NULL OR to_jsonb(t)-'id'-'created_at'-'updated_at' IS DISTINCT FROM d) THEN RAISE EXCEPTION 'v347 guard: inserted payload differs'; END IF;
 IF EXISTS (SELECT 1 FROM ${table} WHERE description IS NULL OR btrim(description)='') THEN RAISE EXCEPTION 'v347 guard: description missing'; END IF;
END $postflight$;`
  const captureBefore = `SELECT set_config('aka.v347_before',(SELECT to_jsonb(s)::text FROM (${snapshotSelect}) s),true);`
  const captureAfter = `SELECT set_config('aka.v347_after',(SELECT to_jsonb(s)::text FROM (${snapshotSelect}) s),true);`
  const normalizedSchema = `jsonb_set(${schemaSQL},'{columns}',(SELECT jsonb_agg(c ORDER BY (c->>'position')::int) FROM jsonb_array_elements((${schemaSQL})->'columns') c WHERE c->>'name'<>'description'))`
  const rollback = `DO $rollback$
DECLARE expected jsonb := '__APPLIED_ROWS_JSON__'::jsonb;
BEGIN
 IF md5((${normalizedSchema})::text)<>'${before.schema_md5}' THEN RAISE EXCEPTION 'v347 rollback: base schema changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='${table}'::regclass AND a.attname='description' AND NOT a.attisdropped AND a.atttypid='text'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)=${quote(quote(fallback) + '::text')} AND col_description(a.attrelid,a.attnum)=${quote(columnComment)}) THEN RAISE EXCEPTION 'v347 rollback: description schema changed'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(expected) e LEFT JOIN ${table} t ON t.id=(e->>'id')::bigint WHERE t.id IS NULL OR md5(to_jsonb(t)::text)<>e->>'md5' OR t.campaign_action_id<>e->>'campaign_action_id' OR t.action_code IS DISTINCT FROM e->>'action_code' OR t.status_value<>e->>'status_value') THEN RAISE EXCEPTION 'v347 rollback: inserted row changed or missing'; END IF;
 IF EXISTS (SELECT 1 FROM public.auto_automation_trigger_statuses r JOIN jsonb_array_elements(expected) e ON r.status_mapping_id=(e->>'id')::bigint) THEN RAISE EXCEPTION 'v347 rollback: inserted row is referenced by Automation'; END IF;
 IF EXISTS (SELECT 1 FROM ${table} t JOIN jsonb_to_recordset(${descriptions}) AS d(id bigint,description text) ON d.id=t.id WHERE t.description IS DISTINCT FROM d.description) THEN RAISE EXCEPTION 'v347 rollback: original description edited'; END IF;
 IF EXISTS (SELECT 1 FROM ${table} t WHERE NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${descriptions}) AS d(id bigint,description text) WHERE d.id=t.id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected) e WHERE (e->>'id')::bigint=t.id) AND t.description IS DISTINCT FROM ${quote(fallback)}) THEN RAISE EXCEPTION 'v347 rollback: independently added description exists'; END IF;
 DELETE FROM ${table} t USING jsonb_array_elements(expected) e WHERE t.id=(e->>'id')::bigint;
END $rollback$;
ALTER TABLE ${table} DROP COLUMN description;`
  const body = preflight + '\n' + captureBefore + '\n' + alter + '\n' + insert + '\n' + postflight + '\n' + captureAfter
  const history = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements,rollback) VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}',ARRAY[${dollar(body, 'migration_history')},'-- v347_before_json '||current_setting('aka.v347_before'),'-- v347_after_json '||current_setting('aka.v347_after')],ARRAY[replace(${dollar(rollback, 'rollback_history')},'__APPLIED_ROWS_JSON__',replace(current_setting('aka.v347_receipt'),chr(39),chr(39)||chr(39)))]);`
  const migration = `-- v347: status catalog additions and agent-only descriptions. Verified immutable snapshot required.
-- Existing DB DDL event trigger reloads PostgREST after this schema change commits.
-- No function/code/workflow edits, no history setup DDL, no connection/pool changes.
${transactionStart}${body}\n${history}\nCOMMIT;\n`
  return { preflight, captureBefore, alter, insert, postflight, rollback, migration, fields }
}

function run(mode, before) {
  const catalog = load('catalog.json')
  const sql = makeSQL(before, catalog)
  const prepared = load('prepared-manifest.json')
  assert.equal(hash(fs.readFileSync(path.join(directory, 'catalog.json'))), prepared.catalog_sha256)
  assert.equal(hash(sql.migration), prepared.migration_sha256)
  assert.equal(hash(fs.readFileSync(migrationPath)), prepared.migration_sha256)
  if (mode === 'smoke') {
    const initial = snapshot()
    checkBusinessRows(before, initial)
    const fixture = sql.insert.replace(`INSERT INTO ${table} (`, `INSERT INTO ${table} (id, `).replace('SELECT ' + sql.fields, 'SELECT -347000-row_number() OVER (), ' + sql.fields)
    const rollback = sql.rollback.replace("'__APPLIED_ROWS_JSON__'::jsonb", "current_setting('aka.v347_receipt')::jsonb")
    const expectedFailure = (statement, message, tag) => `DO $${tag}$ BEGIN BEGIN EXECUTE ${dollar(statement, tag + '_sql')}; RAISE EXCEPTION 'TEST: expected rejection missing'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>${quote(message)} THEN RAISE; END IF; END; END $${tag}$;`
    const badChecksum = expectedFailure(sql.preflight.replace('"label":' + JSON.stringify(before.rows[0].row.label), '"label":"__invalid_backup__"'), 'v347 guard: original row changed', 'stale')
    const badReceipt = expectedFailure(rollback.replace("current_setting('aka.v347_receipt')::jsonb", "jsonb_set(current_setting('aka.v347_receipt')::jsonb,'{0,md5}','\"bad\"'::jsonb)"), 'v347 rollback: inserted row changed or missing', 'drift')
    // Reuse an existing referenced mapping as a read-only synthetic receipt.
    // This proves the reference guard without writing Automation configuration.
    const referenceFixture = `SELECT set_config('aka.v347_reference_fixture',(SELECT jsonb_build_array(jsonb_build_object('id',t.id,'campaign_action_id',t.campaign_action_id,'action_code',t.action_code,'status_value',t.status_value,'md5',md5(to_jsonb(t)::text)))::text FROM ${table} t WHERE EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses r WHERE r.status_mapping_id=t.id) ORDER BY t.id LIMIT 1),true);`
    const referenceTest = expectedFailure(rollback.replace("current_setting('aka.v347_receipt')::jsonb", "current_setting('aka.v347_reference_fixture')::jsonb"), 'v347 rollback: inserted row is referenced by Automation', 'referenced')
    const descriptionTest = expectedFailure(`UPDATE ${table} SET description='changed by smoke' WHERE id=${before.rows[0].row.id};\n` + rollback, 'v347 rollback: original description edited', 'description_drift')
    const defaultTest = `DO $default_test$ DECLARE r ${table}%ROWTYPE; BEGIN
 INSERT INTO ${table}(id,campaign_action_id,action_code,status_value,label) VALUES(-347999,'voice_call','voice_call','__v347_smoke_default__','smoke') RETURNING * INTO r;
 IF r.description<>${quote(fallback)} THEN RAISE EXCEPTION 'TEST: default missing'; END IF;
 DELETE FROM ${table} WHERE id=-347999;
END $default_test$;`
    const result = query(transactionStart + badChecksum + '\n' + sql.preflight + '\n' + sql.captureBefore + '\n' + sql.alter + '\n' + fixture + '\n' + sql.postflight + '\n' + defaultTest + '\n' + badReceipt + '\n' + referenceFixture + '\n' + referenceTest + '\n' + descriptionTest + '\n' + rollback + `
DO $restored$ BEGIN IF (SELECT md5(string_agg(to_jsonb(t)::text,'|' ORDER BY id)) FROM ${table} t)<>current_setting('aka.v347_before')::jsonb->>'table_md5' OR md5((${schemaSQL})::text)<>'${before.schema_md5}' THEN RAISE EXCEPTION 'TEST: rollback differs from snapshot'; END IF;
IF (SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM public.auto_campaign_action_detail_statuses_id_seq) IS DISTINCT FROM current_setting('aka.v347_before')::jsonb->'sequence_state' THEN RAISE EXCEPTION 'TEST: smoke consumed sequence'; END IF;
END $restored$;
ROLLBACK;
SELECT 'passed: add column, descriptions, insert, default, stale/row/description/reference guards, delete/drop rollback; no committed changes' AS result;`)
    const after = snapshot()
    validate(after)
    checkBusinessRows(before, after)
    assert.equal(after.schema_md5, before.schema_md5)
    assert.deepEqual(after.automation_conditions, initial.automation_conditions)
    save('smoke.json', { checked_at: new Date().toISOString(), result, migration_sha256: hash(sql.migration), catalog_sha256: prepared.catalog_sha256, table_restored_inside_transaction: true, schema_restored: true, sequence_unchanged_inside_transaction: true, concurrent_runtime_updated_at_changes: after.rows.filter(x => before.rows.find(y => y.row.id === x.row.id)?.md5 !== x.md5).map(x => x.row.id) })
    console.log(JSON.stringify(result))
  } else if (mode === 'apply') {
    const smoke = load('smoke.json')
    assert.equal(smoke.migration_sha256, hash(sql.migration))
    assert.equal(smoke.catalog_sha256, prepared.catalog_sha256)
    for (const source of catalog.localSources) assert.equal(hash(fs.readFileSync(path.join(root, source.file))), source.sha256)
    query(sql.migration + `SELECT version,name FROM supabase_migrations.schema_migrations WHERE name='${name}';`)
    console.log(JSON.stringify(recover(before, catalog)))
  } else if (mode === 'verify' || mode === 'recover') {
    console.log(JSON.stringify(recover(before, catalog)))
  } else if (mode === 'rollback') {
    // Only for an explicit later user request to revert this migration.
    const applied = load('applied-manifest.json')
    assert.equal(hash(fs.readFileSync(rollbackPath)), applied.rollback_sha256)
    query(fs.readFileSync(rollbackPath, 'utf8') + 'SELECT clock_timestamp() AS reverted_at;')
    const current = snapshot()
    validate(current)
    save('reverted.json', current, true)
    console.log(JSON.stringify({ reverted: applied.inserted_rows.length, matches_before: current.table_md5 === before.table_md5, snapshot: 'reverted.json' }))
  } else throw Error('Usage: capture|build|smoke|apply|verify|recover|rollback')
}

function checkBusinessRows(before, after) {
  const current = new Map(after.rows.map(x => [x.row.id, x.row]))
  for (const old of before.rows) {
    const actual = { ...current.get(old.row.id) }, expected = { ...old.row }
    delete actual.description; delete actual.updated_at
    delete expected.description; delete expected.updated_at
    assert.deepEqual(actual, expected, 'Existing business fields changed: ' + old.row.id)
  }
}
function recover(before, catalog) {
  const history = query(`SELECT version,name,statements[2] AS before_snapshot,statements[3] AS after_snapshot,rollback FROM supabase_migrations.schema_migrations WHERE name='${name}'`)
  assert.equal(history.length, 1, 'Missing or ambiguous apply history; do not blindly retry INSERT')
  const body = history[0].rollback?.[0]
  assert(body && !body.includes('__APPLIED_ROWS_JSON__'))
  const receipt = JSON.parse(body.match(/expected jsonb := '([^']+)'::jsonb/)[1])
  assert.equal(receipt.length, catalog.desired.length)
  const atomicBefore = JSON.parse(history[0].before_snapshot.replace(/^-- v347_before_json /, ''))
  const after = JSON.parse(history[0].after_snapshot.replace(/^-- v347_after_json /, ''))
  validate(atomicBefore)
  validate(after)
  checkBusinessRows(before, atomicBefore)
  const current = new Map(after.rows.map(x => [x.row.id, x]))
  for (const old of atomicBefore.rows) {
    const row = { ...current.get(old.row.id)?.row }
    delete row.description
    assert.deepEqual(row, old.row, 'Existing functional fields changed: ' + old.row.id)
  }
  for (const added of receipt) assert.equal(current.get(added.id)?.md5, added.md5)
  for (const item of catalog.descriptions) assert.equal(current.get(item.id)?.row.description, item.description)
  assert.deepEqual(after.runtime_checksums, before.runtime_checksums)
  assert.deepEqual(after.automation_conditions, atomicBefore.automation_conditions)
  assert.equal(after.auto_error_md5, atomicBefore.auto_error_md5)
  assert(after.rows.every(x => x.row.description))
  if (!fs.existsSync(path.join(directory, 'after.json'))) save('after.json', after, true)
  if (!fs.existsSync(path.join(directory, 'apply-before.json'))) save('apply-before.json', atomicBefore, true)
  const currentLive = snapshot()
  validate(currentLive)
  checkBusinessRows(after, currentLive)
  save('latest-verification.json', currentLive)
  const rollbackHistory = `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),'${name}_rollback',ARRAY[${dollar(body, 'rollback_audit')}]);`
  const rollback = transactionStart + body + '\n' + rollbackHistory + '\nCOMMIT;\n'
  fs.writeFileSync(rollbackPath, rollback)
  save('applied-manifest.json', { project_ref: ref, version: history[0].version, name, verified_at: new Date().toISOString(), inserted_rows: receipt,
    original_rows: before.row_count, original_fields_unchanged: true, automation_conditions_unchanged: true, runtime_functions_unchanged: true, auto_error_unchanged: true,
    apply_before_sha256: hash(fs.readFileSync(path.join(directory, 'apply-before.json'))), after_sha256: hash(fs.readFileSync(path.join(directory, 'after.json'))), migration_sha256: hash(fs.readFileSync(migrationPath)), rollback_sha256: hash(rollback), after_table_md5: after.table_md5,
    allowed_preapply_drift: 'updated_at only; every field verified unchanged between locked apply-before and after snapshots',
    live_updated_at_drift_ids: currentLive.rows.filter(x => current.get(x.row.id) && current.get(x.row.id).md5 !== x.md5).map(x => x.row.id) })
  return { history: history[0].version, added: receipt.length, described_existing: before.row_count, total: after.row_count, old_fields_unchanged: true }
}

function main() {
  fs.mkdirSync(directory, { recursive: true })
  const mode = process.argv[2]
  if (mode === 'capture') {
    assert(!fs.existsSync(path.join(directory, 'before.json')), 'Immutable snapshot already exists')
    const before = snapshot()
    validate(before)
    assert(!before.schema.columns.some(x => x.name === 'description'))
    save('before.json', before, true)
    validate(load('before.json'))
    save('backup-manifest.json', { project_ref: ref, captured_at: before.captured_at, row_count: before.row_count,
      table_md5: before.table_md5, schema_md5: before.schema_md5, before_sha256: hash(fs.readFileSync(path.join(directory, 'before.json'))),
      row_checksums: before.rows.map(x => ({ id: x.row.id, md5: x.md5 })) }, true)
    const catalogs = query(`SELECT
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.auto_campaign_actions x WHERE is_active AND NOT is_delete) AS campaigns,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY code) FROM public.auto_account_actions x WHERE is_active AND NOT is_delete) AS actions,
      (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.auto_status x WHERE component_type='campaign_detail' AND is_active AND NOT is_delete) AS statuses,
      (SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(p.prosrc),'body',p.prosrc) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname IN ('aka_agent_apply_voice_call_event','aka_agent_commit_voice_call_dial','aka_agent_record_sms_message_status')) AS producers,
      (SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'md5',md5(to_jsonb(b)::text),'uses_alias',strpos(b.code,'changeContactAlias')>0,'uses_tag',strpos(b.code,'applyContactTag')>0) ORDER BY id) FROM public.auto_blocks b WHERE b.code ~ '(changeContactAlias|applyContactTag)') AS auxiliary_blocks;`)[0]
    save('source-catalogs.json', catalogs, true)
    console.log(JSON.stringify({ captured: before.row_count, md5: before.table_md5, semantic_statuses: catalogs.statuses.map(x => ({ id: x.id, name: x.name })) }))
  } else if (mode === 'build') {
    build(checkedBefore())
  } else {
    run(mode, checkedBefore())
  }
}

module.exports = { query, snapshot, validate, checkedBefore, save, load, hash, root, directory, schemaSQL, runtimeSQL, referencesSQL, fallback, description, key }
if (require.main === module) main()
