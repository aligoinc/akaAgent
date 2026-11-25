#!/usr/bin/env node
// Kiểm V654 (loại trừ gửi theo nhiều Zalo, Nhóm data, chiến dịch đã gửi) trên PostgreSQL cục bộ dùng một lần.
// Dựng đúng trạng thái production đọc 25/11/2026: bảng V330 (fixture schema + migration v330), thân hàm production lấy từ
// bản gỡ V654 (bài kiểm so md5 prosrc với giá trị đọc trên production), V573. Không chạm DB thật.
// Chạy: node scripts/send-exclusion-v654-smoke.cjs
//   PG_BIN=<thư mục initdb/pg_ctl> (mặc định /usr/lib/postgresql/16/bin, rồi /opt/homebrew/opt/postgresql@17/bin)
//   PG_MODULE_DIR=<thư mục có node_modules/pg> nếu repo chưa cài pg.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
function requirePg() {
  const dirs = [process.env.PG_MODULE_DIR, process.env.CHAT_REPO, ROOT, path.resolve(ROOT, '../akaAgentChatApi')].filter(Boolean)
  for (const dir of dirs) { try { return require(require.resolve('pg', { paths: [dir] })) } catch { /* tiếp */ } }
  throw new Error('Không tìm thấy module pg: đặt PG_MODULE_DIR')
}
const { Client } = requirePg()
const BIN = process.env.PG_BIN || ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'].find(d => fs.existsSync(path.join(d, 'initdb')))
const EXPECTED = {
  'public.aka_agent_internal_send_exclusion_group(bigint)': 'c73d260df8ba115c2ec059b7c3c138d8',
  'public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)': 'af9913da69c3a16e921369744524f8cd',
  'public.auto_validate_campaign_send_exclusion()': '31518a224d65996ee64ccafa2bd4b008',
  'public.aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)': '0aaf3c6bc86bcdec10c94ed9ce21426a',
  'public.aka_agent_engine_send_exclusion_v1(bigint,uuid,text,jsonb)': '521414d40664c567b8f89f4dee5add9c',
  'public.aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)': '43c3bb89ce08fcb59ab2e0b9fda68ee5',
}
let passed = 0
const ok = name => { passed += 1; console.log(`  ✓ ${name}`) }

function startCluster(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v654-'))
  const run = (cmd, args) => {
    const r = spawnSync(path.join(BIN, cmd), args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
    if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`)
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1
  const asRoot = uid === 0
  if (asRoot) {
    fs.chmodSync(dir, 0o777)
    const su = (cmd, args) => {
      const r = spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', [path.join(BIN, cmd), ...args].map(a => `'${a}'`).join(' ')], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
      if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr || r.stdout}`)
    }
    su('initdb', ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'])
    su('pg_ctl', ['-D', path.join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c fsync=off`, '-l', path.join(dir, 'log'), '-w', 'start'])
    return { dir, stop: () => su('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']) }
  }
  run('initdb', ['-D', path.join(dir, 'data'), '-U', 'postgres', '-A', 'trust', '--no-sync'])
  run('pg_ctl', ['-D', path.join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c fsync=off`, '-l', path.join(dir, 'log'), '-w', 'start'])
  return { dir, stop: () => run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']) }
}

/** Các khối CREATE [OR REPLACE] FUNCTION ... $function$; trong một tệp. */
function functionBlocks(sql) {
  return [...sql.matchAll(/^CREATE OR REPLACE FUNCTION (?:public|private)\.[\s\S]*?AS \$function\$[\s\S]*?\$function\$;?/gm)].map(m => m[0].endsWith(';') ? m[0] : m[0] + ';')
}

async function main() {
  assert.ok(BIN, 'không tìm thấy PostgreSQL (đặt PG_BIN)')
  const port = 55000 + Math.floor(Math.random() * 900)
  const cluster = startCluster(port)
  const db = new Client({ host: cluster.dir, port, user: 'postgres', database: 'postgres' })
  await db.connect()
  const q = async (sql, params) => (await db.query(sql, params)).rows
  const one = async (sql, params) => (await q(sql, params))[0]
  const fails = async (sql, params, code) => {
    await db.query('BEGIN')
    try { await db.query(sql, params); assert.fail(`cần lỗi ${code}`) } catch (e) {
      if (e.code === 'ERR_ASSERTION') throw e
      assert.match(e.message, new RegExp(code))
    } finally { await db.query('ROLLBACK') }
  }
  try {
    console.log('Dựng trạng thái production')
    await db.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE ROLE aka_agent_chat_api NOLOGIN; CREATE ROLE aka_agent_desktop NOLOGIN; CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      CREATE TABLE org_organization(id bigint PRIMARY KEY);
      CREATE TABLE private.aka_agent_desktop_users(auth_user_id uuid PRIMARY KEY, staff_id bigint);`)
    await db.query(read('scripts/fixtures/send-exclusion-schema.sql'))
    for (const fn of require('./fixtures/send-exclusion-normalizers.json')) await db.query(fn.definition)
    for (const fn of require('./fixtures/send-exclusion-live-baseline.json')) {
      await db.query(fn.definition)
      await db.query(`REVOKE ALL ON FUNCTION public.${fn.signature} FROM PUBLIC`)
      for (const grant of (fn.proacl || '{}').slice(1, -1).split(',')) {
        const role = grant.split('=')[0]
        if (role && role !== 'postgres') await db.query(`GRANT EXECUTE ON FUNCTION public.${fn.signature} TO ${role}`)
      }
    }
    await db.query(read('migrations/migration_v330_campaign_send_exclusions.sql'))
    // Cột / bảng production mà V330 fixture không có (đọc information_schema 25/11/2026).
    await db.query(`ALTER TABLE auto_account_contact_groups ADD COLUMN sharing_scope text NOT NULL DEFAULT 'private', ADD COLUMN sharing_revision bigint NOT NULL DEFAULT 1;
      ALTER TABLE auto_campaign_details ADD COLUMN policy_snapshot jsonb;
      CREATE TABLE auto_data_group_recipients(group_id bigint, staff_id bigint, PRIMARY KEY(group_id, staff_id));
      CREATE TABLE zalo_accounts(id bigint PRIMARY KEY, zalo_uid text);
      CREATE TABLE auto_campaign_detail_zalo_engagement(campaign_detail_id bigint PRIMARY KEY, organization_id bigint, staff_id bigint, account_id bigint,
        account_zalo_uid text, target_zalo_uid text, action_type text, sent_at timestamptz, tracking_until timestamptz, friended_at timestamptz, rejected_at timestamptz);
      CREATE TABLE auto_system_settings(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, key text UNIQUE, value text, description text, is_secret boolean DEFAULT false,
        is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE auto_engine_target_runs(id bigint PRIMARY KEY, input_data_id bigint, campaign_id bigint, account_id bigint, staff_id bigint, organization_id bigint,
        lease_token uuid, runner_id text, runtime_target text, marks jsonb, started_at timestamptz, first_marked_at timestamptz, completed_at timestamptz,
        final_target_status text, final_error_code text, close_reason text, outcome_count integer, final_response jsonb, slot_at timestamptz);
      CREATE TABLE auto_engine_leases(account_id bigint PRIMARY KEY, lease_token uuid, runner_id text, runtime_target text, campaign_id bigint,
        acquired_at timestamptz, heartbeat_at timestamptz, expires_at timestamptz, campaign_schedule timestamptz);
      CREATE FUNCTION public.aka_agent_engine_desktop_staff() RETURNS bigint LANGUAGE sql AS $$ SELECT NULL::bigint $$;
      CREATE FUNCTION public.aka_agent_engine_scope_ok(p_staff bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
        AS $$ SELECT CASE WHEN s.v IS NULL THEN true ELSE s.v = p_staff END FROM (SELECT public.aka_agent_engine_desktop_staff() AS v) s $$;
      CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog' AS $f$
       DECLARE v_claims jsonb; v_user uuid; v_staff bigint;
       BEGIN
        IF current_setting('role',true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
        BEGIN v_claims := NULLIF(current_setting('request.jwt.claims',true),'')::jsonb;
          IF v_claims->>'role' IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN 0; END IF;
          v_user := NULLIF(v_claims->>'sub','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN 0; END;
        SELECT staff_id INTO v_staff FROM private.aka_agent_desktop_users WHERE auth_user_id=v_user; RETURN COALESCE(v_staff,0);
       END $f$;
      CREATE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint DEFAULT NULL, p_account_id bigint DEFAULT NULL, p_campaign_id bigint DEFAULT NULL)
       RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $f$
       DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
       BEGIN
        IF v_staff IS NULL THEN RETURN true; END IF;
        IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied'; END IF;
        IF p_account_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_accounts WHERE id=p_account_id AND staff_id IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_account_scope_denied'; END IF;
        IF p_campaign_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.auto_campaigns WHERE id=p_campaign_id AND staff_id IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_campaign_scope_denied'; END IF;
        RETURN true;
       END $f$;
      -- Rút gọn của private.group_access (production: chủ nhóm / chia sẻ cả tổ chức / chia sẻ cho từng người).
      CREATE FUNCTION private.group_access(p_kind text, p_group_id bigint, p_staff_id bigint, p_organization_id bigint) RETURNS jsonb LANGUAGE sql STABLE AS $f$
        SELECT jsonb_build_object('role',CASE WHEN g.staff_id=p_staff_id THEN 'owner' ELSE 'shared' END) FROM public.auto_account_contact_groups g
        WHERE p_kind='data' AND g.id=p_group_id AND g.purpose='data_group' AND NOT g.is_delete AND g.organization_id=p_organization_id
          AND (g.staff_id=p_staff_id OR g.sharing_scope='organization' OR (g.sharing_scope='selected' AND EXISTS(SELECT 1 FROM public.auto_data_group_recipients r WHERE r.group_id=g.id AND r.staff_id=p_staff_id))) $f$;`)
    // Thân hàm production: 6 hàm V654 thay lấy từ bản gỡ (khớp md5 production), validate_rules từ V573.
    const rollback = read('migrations/rollback_v654_send_exclusion_multi_zalo.sql')
    for (const block of functionBlocks(rollback)) await db.query(block)
    for (const block of functionBlocks(read('migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql'))) await db.query(block)
    for (const [sig, md5] of Object.entries(EXPECTED)) {
      const row = await one('SELECT md5(prosrc) m FROM pg_proc WHERE oid=to_regprocedure($1)', [sig])
      assert.equal(row?.m, md5, `${sig} trong bản gỡ phải khớp production`)
    }
    ok('thân 6 hàm trong bản gỡ khớp md5 production')

    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    await db.query(`INSERT INTO org_organization VALUES(10),(20);
      INSERT INTO org_staff(id,organization_id,name,username,password,is_active) VALUES(1,10,'Một','one','secret',true),(2,10,'Hai','two','secret',true),(3,20,'Ba','three','secret',true);
      INSERT INTO zalo_accounts VALUES (900,'acc100'),(901,'acc101');
      INSERT INTO auto_accounts(id,name,staff_id,organization_id,flatform_type,is_delete,zalo_account_id) VALUES
        (100,'Zalo Hà Anh',1,10,'zalo',false,900),(101,'Zalo Minh Thư',1,10,'zalo',false,901),(102,'Zalo Cũ',1,10,'zalo',true,NULL),
        (103,'Zalo Sale 2',1,10,'zalo',false,NULL),(200,'Zalo người khác',2,10,'zalo',false,NULL),(300,'Tổ chức khác',3,20,'zalo',false,NULL);
      INSERT INTO category_type(id,namespace,code) VALUES(1,'common','zalo_friend_status'),(2,'common','data_type');
      INSERT INTO category_item(id,category_type_id,code,name,is_active) VALUES(1,1,'friend','Bạn bè',true),(2,1,'request_sent','Gửi lời mời kết bạn',true),
        (3,1,'request_received','Nhận kết bạn',true),(4,1,'stranger','Người lạ',true),(50,2,'phone','Số điện thoại',true),(51,2,'zalo_person','Zalo User theo UID',true),(52,2,'facebook_uid','FB',true);
      -- Tag Zalo của 100 (T1) và 101 (T9 có khách g-A ở 101 tên u101a).
      INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete,extra_data) VALUES
        (1,100,1,10,'zalo_tag','T1','VIP',false,'{"conversations":["u100a"]}'),
        (2,101,1,10,'zalo_tag','T9','Spam',false,'{"conversations":["u101a"]}');
      INSERT INTO auto_contact_tags(id,name,is_delete,staff_id,organization_id,auto_account_id) VALUES (500,'akaVIP',false,1,10,NULL);`)
    const ids = Object.fromEntries((await q('SELECT code,id FROM auto_filter_fields')).map(r => [r.code, Number(r.id)]))
    const op = Object.fromEntries((await q('SELECT code,id FROM auto_filter_operators')).map(r => [r.code, Number(r.id)]))
    const rule = (code, operator, value, isEnabled = true, sortOrder = 0) => ({ fieldId: ids[code], operatorId: op[operator], value, isEnabled, sortOrder })
    const oldCall = async (operation, payload, account = 100) => (await one('SELECT aka_agent_send_exclusion_groups(1,10,$1,$2,$3,NULL,NULL) d', [account, operation, JSON.stringify(payload)])).d
    // Nhóm cũ (trước V654): một Zalo.
    const oldGroup = await oldCall('save', { requestId: crypto.randomUUID(), name: 'Khách VIP', matchMode: 'and', revision: 0,
      rules: [rule('zalo_tag', 'contains', ['T1'], true, 10), rule('zalo_friend_status', 'equals', 'friend', false, 20)] })
    const listBefore = await oldCall('list', {})
    await db.query(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,runtime_claim_token,is_delete)
      VALUES (700,'Chiến dịch cũ','zalo_message_phone',100,1,10,'chờ xử lý',$1,'11111111-1111-1111-1111-111111111111',false)`,
      [JSON.stringify({ zaloSendExclusionsByAccountId: { 100: { groupId: Number(oldGroup.id), blocklistIds: [] } } })])
    const snapCall = async (campaign, account, payload = {}) => (await one(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,1,'11111111-1111-1111-1111-111111111111','snapshot',$3) d`,
      [campaign, account, JSON.stringify(payload)])).d
    const snapBefore = await snapCall(700, 100)
    ok('nhóm và chiến dịch cũ tạo bằng hàm production')

    console.log('Apply V654')
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p1.sql'))
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_index.sql'))
    await db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p2.sql'))
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    assert.equal((await one(`SELECT value FROM auto_system_settings WHERE key='campaign.send_exclusion_multi_zalo'`)).value, '{"audience":"off"}')
    ok('p1 + chỉ mục + p2 chạy được, công tắc mặc định off')
    await assert.rejects(db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p1.sql')), /đã có/)
    await db.query('ROLLBACK').catch(() => {})
    await assert.rejects(db.query(read('migrations/migration_v654_send_exclusion_multi_zalo_p2.sql')), /đã có/)
    await db.query('ROLLBACK').catch(() => {})
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    ok('chạy lại p1/p2 bị từ chối')

    assert.deepEqual(await oldCall('list', {}), listBefore)
    assert.deepEqual(await snapCall(700, 100), snapBefore)
    const snapV2Old = await snapCall(700, 100, { clientVersion: 2 })
    assert.equal(snapV2Old.version, 2)
    assert.equal(snapV2Old.remote, null)
    assert.deepEqual(snapV2Old.group.rules, snapBefore.group.rules)
    assert.equal(snapV2Old.group.matchMode, 'and')
    ok('nhóm cũ: form cũ và bộ chạy cũ thấy y như trước; bộ chạy mới thấy cùng điều kiện, không có phần tra DB')

    await db.query('BEGIN')
    const savedOld = await oldCall('save', { id: Number(oldGroup.id), name: 'Khách VIP 2', matchMode: 'or', revision: Number(oldGroup.revision),
      rules: [rule('zalo_tag', 'contains', ['T1'], true, 10)] })
    assert.equal(savedOld.matchMode, 'or')
    assert.equal((await one('SELECT match_mode FROM auto_campaign_send_exclusion_group_accounts WHERE group_id=$1', [oldGroup.id])).match_mode, 'or')
    assert.equal((await one('SELECT count(*)::int n FROM auto_campaign_send_exclusion_rules WHERE group_id=$1 AND group_account_id IS NOT NULL', [oldGroup.id])).n, 1)
    await db.query('ROLLBACK')
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    ok('form cũ vẫn sửa được nhóm một Zalo; khối theo đúng cách kết hợp mới')

    console.log('Nhóm nhiều Zalo')
    const v2 = async (operation, payload = {}) => (await one('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL) d', [operation, JSON.stringify(payload)])).d
    const requestId = crypto.randomUUID()
    const groupPayload = { requestId, name: 'Khách đã chăm sóc', revision: 0, blocks: [
      { accountId: 100, matchMode: 'or', rules: [rule('zalo_friend_status', 'equals', 'friend', true, 10)] },
      { accountId: 101, matchMode: 'or', rules: [rule('zalo_friend_status', 'equals', 'friend', true, 10), rule('zalo_tag', 'contains', ['T9'], true, 20)] },
      { accountId: 103, matchMode: 'and', rules: [rule('zalo_friend_status', 'equals', 'friend', true, 10)] },
    ] }
    const multi = await v2('save', groupPayload)
    assert.equal(multi.version, 2)
    assert.equal(multi.blocks.length, 3)
    assert.deepEqual(multi.blocks.map(b => b.accountId).map(Number), [100, 101, 103])
    assert.deepEqual(await v2('save', groupPayload), multi)
    await fails('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)', ['save', JSON.stringify({ ...groupPayload, name: 'Khác' })], 'revision_conflict')
    await fails('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)', ['save', JSON.stringify({ ...groupPayload, requestId: crypto.randomUUID(),
      blocks: [groupPayload.blocks[0], groupPayload.blocks[0]] })], 'blocks_invalid')
    await fails('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)', ['save', JSON.stringify({ ...groupPayload, requestId: crypto.randomUUID(),
      blocks: [{ ...groupPayload.blocks[0], accountId: 200 }] })], 'account_not_found')
    await fails('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)', ['save', JSON.stringify({ ...groupPayload, requestId: crypto.randomUUID(),
      blocks: [{ accountId: 101, matchMode: 'and', rules: [rule('zalo_tag', 'contains', ['T1'])] }] })], 'option_unavailable')
    ok('lưu nhóm nhiều Zalo: gửi lại cùng requestId trả nhóm cũ, chặn trùng Zalo, Zalo người khác, tag của Zalo khác')
    assert.ok(!(await oldCall('list', {})).groups.some(g => Number(g.id) === Number(multi.id)))
    await fails('SELECT aka_agent_send_exclusion_groups(1,10,100,$1,$2,NULL,NULL)', ['save', JSON.stringify({ id: Number(multi.id), name: 'x', matchMode: 'and',
      revision: Number(multi.revision), rules: [rule('zalo_tag', 'contains', ['T1'])] })], 'requires_update')
    ok('form cũ không thấy và không sửa được nhóm nhiều Zalo')
    const page = await v2('page')
    assert.deepEqual(page.accounts.map(a => Number(a.id)).sort(), [100, 101, 103])
    assert.equal(page.groups.length, 2)
    const options101 = await v2('options', { accountId: 101 })
    assert.ok(options101.options.some(o => o.value === 'T9') && !options101.options.some(o => o.value === 'T1'))
    await fails('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)', ['options', JSON.stringify({ accountId: 200 })], 'account_not_found')
    const updated = await v2('save', { id: Number(multi.id), name: 'Khách đã chăm sóc', revision: Number(multi.revision), blocks: groupPayload.blocks.slice(0, 2) })
    assert.equal(updated.blocks.length, 2)
    await fails('SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)', ['save', JSON.stringify({ id: Number(multi.id), name: 'x', revision: Number(multi.revision), blocks: groupPayload.blocks })], 'revision_conflict')
    ok('trang Zalo/nhóm/lựa chọn theo Zalo; sửa nhóm theo revision')

    console.log('Danh sách: Nhóm data, chiến dịch đã gửi, danh sách Zalo khác')
    // Khách A: global gA; ở 100 là u100a, ở 101 là u101a (bạn bè, tag T9); SĐT 0912345678.
    await db.query(`INSERT INTO zalo_users(id,account_id,zalo_uid,global_id,is_fr,phone_number,updated_at) VALUES
        (1,100,'u100a','gA',0,NULL,now()),(2,101,'u101a','gA',1,NULL,now()),(3,100,'u100b','gB',0,NULL,now()),(4,101,'u101b','gB',0,NULL,now());
      INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete,phone) VALUES
        (10,101,1,10,'person','u101b','B ở 101',false,NULL),
        (11,NULL,2,10,'phone',aka_agent_internal_normalize_phone('0987000111'),'SĐT C',false,'0987000111'),
        (12,101,1,10,'person','u101a','A ở 101',false,NULL);
      INSERT INTO auto_account_contact_groups(id,account_id,staff_id,organization_id,name,purpose,contact_type,data_type_category_item_id,sharing_scope,is_delete) VALUES
        (40,101,1,10,'Đã chặn ở Thư','zalo_friend_blocklist','person',NULL,'private',false),
        (41,NULL,2,10,'Khách hội chợ','data_group','phone',50,'selected',false),
        (42,NULL,1,10,'Thành viên Sỉ','data_group','person',51,'private',false),
        (43,NULL,2,10,'Nhóm riêng người khác','data_group','phone',50,'private',false),
        (44,NULL,1,10,'Nhóm Facebook','data_group','person',52,'private',false),
        (45,NULL,1,10,'Nhóm đã xoá','data_group','phone',50,'private',true);
      INSERT INTO auto_data_group_recipients VALUES (41,1);
      INSERT INTO auto_account_contact_group_members(id,group_id,contact_id,is_delete) VALUES (100,40,10,false),(101,41,11,false),(102,42,12,false);`)
    await db.query(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES
        (800,'Khuyến mãi tháng 11','zalo_message_friend',101,1,10,'hoàn thành','{}',false),
        (801,'Đăng nhóm','facebook_group_post',101,1,10,'hoàn thành','{}',false),
        (802,'Chiến dịch người khác','zalo_message_friend',200,2,10,'hoàn thành','{}',false);
      INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status,is_delete) VALUES (9001,800,'u101a',NULL,'hoàn thành',false),(9002,800,NULL,'0977 888 999','hoàn thành',false);
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_name,action_code,status,is_delete,created_at) VALUES
        (1,9001,800,101,'Nhắn tin','zalo_message_friend','thành công',false,'2026-11-18 03:00+00'),
        (2,9002,800,101,'Nhắn tin','zalo_message_stranger','thất bại',false,'2026-11-18 03:00+00');`)
    const config = (entry) => JSON.stringify({ zaloSendExclusionsByAccountId: { 100: { groupId: null, blocklistIds: [], ...entry } } })
    const setCampaign = (entry) => db.query(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,runtime_claim_token,is_delete)
      VALUES (710,'Mới','zalo_message_phone',100,1,10,'chờ xử lý',$1,'11111111-1111-1111-1111-111111111111',false)
      ON CONFLICT (id) DO UPDATE SET extra_settings=EXCLUDED.extra_settings`, [config(entry)])
    await fails(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES (711,'x','zalo_message_phone',100,1,10,'chờ xử lý',$1,false)`,
      [config({ dataGroupIds: [43] })], 'data_group_not_found')
    await fails(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES (711,'x','zalo_message_phone',100,1,10,'chờ xử lý',$1,false)`,
      [config({ dataGroupIds: [44] })], 'data_group_not_found')
    await fails(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES (711,'x','zalo_message_phone',100,1,10,'chờ xử lý',$1,false)`,
      [config({ sentCampaignIds: [801] })], 'campaign_not_found')
    await fails(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES (711,'x','zalo_message_phone',100,1,10,'chờ xử lý',$1,false)`,
      [config({ sentCampaignIds: [802] })], 'campaign_not_found')
    await fails(`UPDATE auto_campaigns SET extra_settings=$1 WHERE id=700`, [config({ sentCampaignIds: [700] })], 'campaign_self')
    await fails(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES (711,'x','zalo_message_phone',100,1,10,'chờ xử lý',$1,false)`,
      [config({ sentCampaignIds: Array.from({ length: 21 }, (_, i) => 800 + i) })], 'lists_invalid')
    await fails(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES (711,'x','zalo_message_phone',100,1,10,'chờ xử lý',$1,false)`,
      [JSON.stringify({ zaloSendExclusionsByAccountId: { 100: { groupId: null, blocklistIds: [41] } } })], 'blocklist_not_found')
    ok('lưu chiến dịch chặn Nhóm data không dùng được / sai loại, chiến dịch không phải nhắn tin Zalo của mình, chính nó, quá 20')
    await setCampaign({ groupId: Number(updated.id), blocklistIds: [40], dataGroupIds: [41, 42, 45], sentCampaignIds: [800] })
    await fails(`SELECT aka_agent_campaign_send_exclusion_runtime(710,100,1,'11111111-1111-1111-1111-111111111111','snapshot','{}')`, [], 'client_outdated')
    const snap = await snapCall(710, 100, { clientVersion: 2 })
    assert.equal(snap.group.accountId, 100)
    assert.equal(snap.group.matchMode, 'or')
    assert.deepEqual(snap.blocklistUids, [])
    assert.deepEqual(snap.remote.blocks.map(b => Number(b.accountId)), [101])
    assert.deepEqual(snap.remote.blocklistIds.map(Number), [40])
    assert.deepEqual(snap.remote.dataGroups.map(g => Number(g.id)), [41, 42])
    assert.deepEqual(snap.remote.campaigns.map(c => Number(c.id)), [800])
    ok('cấu hình mới: bản cũ bị từ chối (client_outdated), bản mới nhận khối Zalo đang gửi + phần tra DB; Nhóm data đã xoá bị bỏ')
    await db.query(`INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status,is_delete) VALUES
        (9101,710,'u100a',NULL,'chờ xử lý',false),(9102,710,'u100b',NULL,'chờ xử lý',false),(9103,710,NULL,'0987000111','chờ xử lý',false),
        (9104,710,NULL,'0977888999','chờ xử lý',false),(9105,710,'u100z',NULL,'chờ xử lý',false)`)
    const remote = async (input, payload = {}) => (await one(`SELECT aka_agent_campaign_send_exclusion_runtime(710,100,1,'11111111-1111-1111-1111-111111111111','remote',$1) d`,
      [JSON.stringify({ inputId: input, ...payload })])).d
    const rB = await remote(9102)
    assert.equal(rB.match.kind, 'blocklist')
    assert.match(rB.match.note, /Đã chặn ở Thư/)
    const rC = await remote(9103)
    assert.equal(rC.match.kind, 'data_group')
    assert.match(rC.match.note, /Khách hội chợ/)
    const rA = await remote(9101)
    assert.equal(rA.match.kind, 'data_group')
    assert.match(rA.match.note, /Thành viên Sỉ/)
    await db.query('UPDATE auto_account_contact_group_members SET is_delete=true WHERE id=102')
    const rA2 = await remote(9101)
    assert.equal(rA2.match.kind, 'campaign')
    assert.equal(rA2.match.note, 'Đã được gửi ở chiến dịch “Khuyến mãi tháng 11” ngày 18/11.')
    const rD = await remote(9104)
    assert.equal(rD.match, null)
    ok('Zalo ID chung khớp danh sách của Zalo khác, Nhóm data SĐT (được chia sẻ), Nhóm data UID, chiến dịch đã gửi thành công; gửi lỗi không tính')
    await db.query(`UPDATE auto_campaigns SET extra_settings=$1 WHERE id=710`, [config({ groupId: Number(updated.id), blocklistIds: [] })])
    const fA = await remote(9101)
    assert.equal(fA.match, null)
    assert.deepEqual(fA.blocks, [{ accountId: 101, state: 'ok', facts: { zalo_friendship: { status: 'friend' }, zalo_labels: { ids: ['T9'], availableValues: ['T9'] } } }])
    const fB = await remote(9102)
    assert.equal(fB.blocks[0].facts.zalo_friendship.status, 'stranger')
    assert.deepEqual(fB.blocks[0].facts.zalo_labels.ids, [])
    const fZ = await remote(9105)
    assert.equal(fZ.blocks[0].state, 'unknown')
    const fZg = await remote(9105, { globalId: 'gNone' })
    assert.equal(fZg.blocks[0].facts.zalo_friendship.status, 'stranger')
    await db.query(`INSERT INTO auto_campaign_detail_zalo_engagement VALUES (77,10,1,101,'acc101','u101b','friend_request',now()-interval '1 day',now()+interval '1 day',NULL,NULL)`)
    assert.equal((await remote(9102)).blocks[0].facts.zalo_friendship.status, 'request_sent')
    ok('khối Zalo khác: bạn bè / người lạ / đã gửi lời mời theo DB, tag Zalo đã đồng bộ, không xác định được khách thì unknown')
    const sale2 = await v2('save', { requestId: crypto.randomUUID(), name: 'Bạn bè Sale 2', revision: 0,
      blocks: [{ accountId: 103, matchMode: 'and', rules: [rule('zalo_friend_status', 'equals', 'friend')] }] })
    await db.query(`UPDATE auto_campaigns SET extra_settings=$1 WHERE id=710`, [config({ groupId: Number(sale2.id), blocklistIds: [] })])
    assert.equal((await remote(9101)).blocks[0].state, 'not_synced')
    const snapSale = await snapCall(710, 100, { clientVersion: 2 })
    assert.equal(snapSale.group, null)
    assert.equal(snapSale.remote.blocks.length, 1)
    await db.query(`UPDATE auto_accounts SET is_delete=true WHERE id=103`)
    assert.deepEqual((await snapCall(710, 100, { clientVersion: 2 })).remote, null)
    assert.deepEqual((await remote(9101)).blocks, [])
    await db.query(`UPDATE auto_accounts SET is_delete=false WHERE id=103`)
    ok('Zalo chưa đồng bộ lần nào bỏ qua khối; nhóm không có Zalo đang gửi; Zalo đã xoá không còn được xét');
    await db.query(`UPDATE auto_campaigns SET extra_settings=$1 WHERE id=710`, [config({ groupId: Number(updated.id), blocklistIds: [], sentCampaignIds: [800] })])
    await db.query(`UPDATE zalo_users SET global_id=NULL WHERE id=2`)
    await db.query(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_name,action_code,status,is_delete,created_at,policy_snapshot) VALUES
      (3,9002,800,101,'Nhắn tin','zalo_message_stranger','lỗi',false,'2026-11-19 03:00+00','{"operationState":"committed"}')`)
    assert.equal((await remote(9104)).match.note, 'Đã được gửi ở chiến dịch “Khuyến mãi tháng 11” ngày 19/11.')
    await db.query(`UPDATE zalo_users SET global_id='gA' WHERE id=2`)
    ok('chiến dịch đã gửi khớp theo SĐT, kể cả kết quả có trạng thái giao thành công (committed)')

    console.log('lists')
    const lists = await v2('lists', { excludeCampaignId: 710, sentCampaignIds: [800], dataGroupIds: [45] })
    assert.deepEqual(lists.dataGroups.map(g => Number(g.id)).sort(), [41, 42, 45])
    assert.equal(lists.dataGroups.find(g => Number(g.id) === 41).shared, true)
    assert.equal(lists.dataGroups.find(g => Number(g.id) === 45).deleted, true)
    const camp800 = lists.campaigns.find(c => Number(c.id) === 800)
    assert.equal(Number(camp800.sentCount), 1)
    assert.ok(!lists.campaigns.some(c => [710, 801, 802].includes(Number(c.id))))
    assert.deepEqual((await v2('lists', { kind: 'campaigns', query: 'khuyến' })).campaigns.map(c => Number(c.id)), [800])
    assert.equal((await v2('lists', { kind: 'campaigns' })).dataGroups, null)
    ok('lists: Nhóm data dùng được (cả nhóm được chia sẻ, nhóm đã chọn dù đã xoá), chiến dịch nhắn tin Zalo + số đã gửi, tìm theo tên')

    console.log('Engine v2')
    await db.query(`INSERT INTO auto_engine_leases VALUES (100,'22222222-2222-2222-2222-222222222222','r','desktop',710,now(),now(),now()+interval '5 min',now());
      INSERT INTO auto_engine_target_runs(id,input_data_id,campaign_id,account_id,staff_id,organization_id,lease_token,started_at) VALUES (5001,9101,710,100,1,10,'22222222-2222-2222-2222-222222222222',now())`)
    const eng = async (operation, payload = {}) => (await one(`SELECT aka_agent_engine_send_exclusion_v1(5001,'22222222-2222-2222-2222-222222222222',$1,$2) d`, [operation, JSON.stringify(payload)])).d
    const engOld = await eng('snapshot')
    assert.equal(engOld.ok, false)
    assert.equal(engOld.message, 'Cập nhật akaAgent để chạy loại trừ theo nhiều Zalo.')
    const engNew = await eng('snapshot', { clientVersion: 2 })
    assert.equal(engNew.ok, true)
    assert.equal(engNew.snapshot.remote.blocks.length, 1)
    const engRemote = await eng('remote', {})
    assert.equal(engRemote.ok, true)
    assert.equal(engRemote.remote.match.kind, 'campaign')
    assert.equal((await eng('remote', { inputId: 1 })).remote.match.kind, 'campaign', 'engine dùng data của lượt, không nhận id data từ ngoài')
    ok('engine: bản cũ nhận config_invalid kèm câu cập nhật app, bản mới chạy snapshot + remote theo lượt data')

    console.log('Gỡ')
    await db.query(rollback)
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    assert.deepEqual(await snapCall(700, 100), snapBefore)
    const listAfter = await oldCall('list', {})
    assert.ok(listAfter.groups.some(g => Number(g.id) === Number(oldGroup.id)))
    assert.equal(await one(`SELECT to_regclass('auto_campaign_send_exclusion_group_accounts') t`).then(r => r.t), null)
    ok('bản gỡ trả đúng thân hàm production, nhóm và chiến dịch cũ chạy như trước')
    console.log(`\n${passed} nhóm kiểm đạt`)
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
