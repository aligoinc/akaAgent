#!/usr/bin/env node
// Kiểm V682 trên PostgreSQL 17 dùng một lần (không chạm production, không mạng):
//  1. migration chạy được, chạy lại thì dừng; chỉ thân hàm đổi, chủ / quyền / cấu hình / helper giữ nguyên; bản gỡ trả đúng thân cũ;
//  2. bản mới cho cùng kết quả và cùng trạng thái data với bản đang chạy ở mọi loại chiến dịch, cách viết UID / SĐT / email,
//     committed / kiểu cũ, phạm vi tài khoản / nhân viên / tổ chức, ngày biên, lô 500, cả generic / custom plan, quyền Desktop / Chat;
//  3. dữ liệu dạng production (SĐT trùng nhiều dòng data, nhân viên nhiều tài khoản, "tính trên mọi tài khoản"): bản mới đọc ít khối hơn
//     và nhanh, ở cả custom lẫn generic plan.
// Hàm và helper lấy nguyên văn production đọc 28/11/2026 (scripts/fixtures/delivery-cooldown-v682/functions-live-20261128.json).
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/delivery-cooldown-v682-smoke.cjs   (PG17_BIN chọn thư mục PostgreSQL 17)
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v682 = require('./build-v682-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/delivery-cooldown-v682/functions-live-20261128.json'), 'utf8'))
const fnOf = prefix => { const f = LIVE.find(x => x.signature.startsWith(prefix)); assert.ok(f, `fixture thiếu ${prefix}`); return f }
const WRAPPER = fnOf('aka_agent_apply_campaign_delivery_cooldown(')
assert.equal(WRAPPER.md5, v682.OLD_MD5, 'fixture hàm khác bản build đọc')

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const cluster = startCluster({ port: 55682, label: 'aka-v682-', timeoutMs: 600000 })
  const db = await cluster.connect()
  const q = (text, values) => db.query(text, values)
  try {
    await q(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api; CREATE ROLE aka_agent_desktop;
      CREATE SCHEMA private;`)
    await q(fs.readFileSync(path.join(__dirname, 'fixtures/send-exclusion-schema.sql'), 'utf8'))
    await q('ALTER TABLE auto_campaign_details ADD COLUMN policy_snapshot jsonb;')
    // Chỉ mục production của auto_campaign_details / auto_campaign_input_data mà hàm có thể dùng (định nghĩa đọc 28/11/2026).
    await q(`CREATE INDEX idx_campaign_details_input_data_id ON auto_campaign_details(input_data_id);
      CREATE INDEX idx_campaign_details_account_id ON auto_campaign_details(account_id);
      CREATE INDEX auto_detail_committed_delivery_v367 ON auto_campaign_details(account_id,action_code,created_at DESC,input_data_id)
        WHERE policy_snapshot->>'operationState'='committed';
      CREATE INDEX idx_campaign_details_delivery_cooldown ON auto_campaign_details(account_id,action_code,created_at DESC,input_data_id)
        WHERE status IN ('thành công','đã gửi','đã nhận','đã xem','đã click');
      CREATE INDEX idx_auto_campaign_details_action_rate ON auto_campaign_details(account_id,action_code,created_at)
        WHERE is_delete = false AND action_code IS NOT NULL;`)
    await q(fnOf('normalize_phone(').definition)
    await q(`CREATE INDEX idx_campaign_input_cooldown_uid ON auto_campaign_input_data (md5(lower(btrim(uid)))) WHERE uid IS NOT NULL AND btrim(uid) <> '';
      CREATE INDEX idx_campaign_input_cooldown_phone ON auto_campaign_input_data (md5(public.normalize_phone(phone))) WHERE phone IS NOT NULL AND btrim(phone) <> '';`)
    await q(`CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.desktop_staff_id',true),'')::bigint $$;`)
    const grant = async (f, qualified) => {
      const entries = f.proacl.slice(1, -1).split(',').map(g => g.split('=')[0])
      // Hàm cho PUBLIC (normalize_phone): giữ quyền mặc định để thứ tự ACL giống production.
      if (!entries.includes('')) await q(`REVOKE ALL ON FUNCTION ${qualified} FROM PUBLIC;`)
      for (const role of entries) {
        if (role === 'postgres' || role === '') continue
        await q(`GRANT EXECUTE ON FUNCTION ${qualified} TO ${role};`)
      }
    }
    await grant(fnOf('normalize_phone('), 'public.normalize_phone(text)')
    const ownership = fnOf('private.aka_agent_assert_request_ownership(')
    await q(ownership.definition); await grant(ownership, 'private.aka_agent_assert_request_ownership(bigint,bigint,bigint)')
    for (const name of ['aka_agent_internal_normalize_facebook_identity(', 'aka_agent_internal_normalize_phone(',
      'aka_agent_internal_delivery_cooldown_target_keys(', 'aka_agent_apply_campaign_delivery_cooldown(']) {
      const f = fnOf(name); await q(f.definition); await grant(f, 'public.' + f.signature)
    }
    const metadata = async () => (await q(`SELECT p.oid::regprocedure::text AS signature, pg_get_userbyid(proowner) AS owner, prosecdef,
      provolatile, proconfig, proacl::text AS acl, md5(pg_get_functiondef(p.oid)) AS md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public','private') AND p.proname IN ('normalize_phone','aka_agent_assert_request_ownership',
        'aka_agent_internal_normalize_facebook_identity','aka_agent_internal_normalize_phone',
        'aka_agent_internal_delivery_cooldown_target_keys','aka_agent_apply_campaign_delivery_cooldown')
      ORDER BY 1`)).rows
    const before = await metadata()
    for (const f of LIVE) {
      const row = before.find(r => r.signature === f.signature)
      assert.ok(row, `thiếu ${f.signature}`)
      assert.equal(row.md5, f.md5, `md5 ${f.signature} khác production`)
      assert.equal(row.acl, f.proacl, `quyền ${f.signature} khác production`)
    }
    pass('dựng lại đúng hàm / helper / quyền như production 28/11/2026')

    // --- 1. Migration, chạy lại, bản gỡ ---
    await q(v682.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await metadata(), before)
    pass('migration chạy trong giao dịch huỷ không để lại gì')
    await q(v682.migration)
    const after = await metadata()
    const changed = after.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]))
    assert.equal(changed.length, 1, 'chỉ một hàm đổi')
    assert.equal(changed[0].signature, 'aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])')
    assert.equal(changed[0].md5, v682.NEW_MD5)
    const old = before.find(r => r.signature === changed[0].signature)
    assert.deepEqual({ ...changed[0], md5: old.md5 }, old, 'chủ / security definer / volatility / search_path / quyền giữ nguyên')
    pass('chỉ thân hàm chống gửi lặp đổi; chủ, quyền, cấu hình, helper giữ nguyên')
    await assert.rejects(q(v682.migration), /khác bản đã đọc/)
    await q('ROLLBACK;').catch(() => {})
    pass('chạy lại migration bị chặn ở bước kiểm md5')
    await q(v682.rollback.replace(/COMMIT;\s*$/, ''))
    assert.equal((await metadata()).find(r => r.signature === old.signature).md5, v682.OLD_MD5)
    await q('ROLLBACK;')
    assert.deepEqual(await metadata(), after)
    pass('bản gỡ trả đúng thân cũ (thử trong giao dịch rồi huỷ)')
    await q(WRAPPER.definition.replace('public.aka_agent_apply_campaign_delivery_cooldown(', 'public.fixture_original_cooldown('))

    // --- 2. Cùng kết quả với bản đang chạy ---
    await q(`INSERT INTO org_staff(id,organization_id,is_active) VALUES(1,10,true),(2,10,true),(3,20,true);
      INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active) VALUES
        (100,1,10,'zalo',true),(101,1,10,'zalo',true),(200,2,10,'zalo',true),(300,1,20,'zalo',true);
      INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,status) VALUES
        (10,100,1,10,'Current','zalo_message_phone','đang chạy'),
        (20,101,1,10,'Other account','zalo_message_friend','tạm dừng'),
        (21,200,2,10,'Other staff','zalo_message_phone','tạm dừng'),
        (22,300,1,20,'Other org','zalo_message_phone','tạm dừng');
      INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,email,status) VALUES
        (11,10,'target-uid','0901234567','user@example.test','chờ xử lý'),
        (12,10,'target-uid','0901234567','user@example.test','chờ xử lý'),
        (21,20,'target-uid','+84901234567','USER@EXAMPLE.TEST','hoàn thành');`)
    const settings = async (action = 'zalo_message_phone', extra = {}) => q(
      'UPDATE auto_campaigns SET action_id=$1,extra_settings=$2 WHERE id=10',
      [action, JSON.stringify({ enableMessage: true, recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 3, ...extra })])
    const history = async ({ account = 100, campaign = 20, code = 'zalo_message_friend', days = 0, status = 'đã gửi', policy = null } = {}) => {
      await q('DELETE FROM auto_campaign_details;')
      await q(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        VALUES(21,21,$1,$2,$3,$4,$5,(timezone('Asia/Ho_Chi_Minh',now())::date-$6::int)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
        [campaign, account, code, status, policy, days])
    }
    const call = async (fn, ids = [11], role = 'service_role', scope = [10, 100, 1]) => {
      await q('BEGIN;')
      try {
        await q(`SET LOCAL ROLE ${role};`)
        const rows = (await q(`SELECT * FROM public.${fn}($1,$2,$3,$4::bigint[])`, [...scope, ids])).rows
        await q('RESET ROLE;')
        const state = (await q('SELECT id,status,note FROM auto_campaign_input_data WHERE id < 100000 ORDER BY id')).rows
        return { rows, state }
      } finally { await q('ROLLBACK;') }
    }
    const parity = async (label, expected, ids = [11], role = 'service_role') => {
      const original = await call('fixture_original_cooldown', ids, role)
      const candidate = await call('aka_agent_apply_campaign_delivery_cooldown', ids, role)
      assert.deepEqual(candidate, original, label)
      if (expected) assert.deepEqual(candidate.rows.map(r => r.decision), expected, label)
      pass(label)
    }
    for (const [action, code] of [
      ['facebook_group_post', 'fb_post_group'], ['facebook_page_post', 'fb_post_page'],
      ['facebook_message_friend', 'fb_message_friend'], ['facebook_message_uid', 'fb_message_stranger'],
      ['facebook_page_to_message', 'fb_message_page_inbox_customer'],
      ['zalo_message_friend', 'zalo_message_friend'], ['zalo_message_birthday', 'zalo_message_stranger'],
      ['zalo_message_group', 'zalo_message_group'], ['zalo_message_phone', 'zalo_message_stranger'],
      ['zalo_message_group_member', 'zalo_message_friend'], ['zalo_message_group_realtime', 'zalo_message_friend'],
      ['zalo_message_remarketing_customer', 'zalo_message_friend'], ['zalo_message_friend_recommendation', 'zalo_message_friend'],
      ['sms_send', 'sms_send'], ['email_send', 'email_send']
    ]) {
      await settings(action); await history({ code })
      await parity(`loại ${action}`, ['paused_recent_delivery'])
      await history({ code, policy: { operationState: 'committed' }, status: 'custom-result' })
      await parity(`loại ${action}, kết quả committed`, ['paused_recent_delivery'])
    }
    await db.query("UPDATE auto_campaign_input_data SET uid=CASE WHEN id=21 THEN ' Target-UID ' ELSE 'target-uid' END;")
    await settings(); await history()
    await parity('Zalo UID khác hoa thường / khoảng trắng', ['paused_recent_delivery'])
    await q('UPDATE auto_campaign_input_data SET uid=NULL WHERE id=21;')
    await parity('chỉ khớp SĐT, đầu số quốc tế', ['paused_recent_delivery'])
    await history({ policy: { operationState: 'committed' }, status: 'custom-result' })
    await parity('chỉ khớp SĐT, kết quả committed', ['paused_recent_delivery'])
    await q("UPDATE auto_campaign_input_data SET phone='invalid' WHERE id=21;")
    await parity('SĐT sai và không UID thì không khớp', ['allowed'])
    await q("UPDATE auto_campaign_input_data SET uid='',phone='',email='' WHERE id=11;")
    await parity('không nhận ra người nhận', ['paused_unidentifiable'])
    await q("UPDATE auto_campaign_input_data SET uid='target-uid',phone='0901234567',email='user@example.test' WHERE id IN (11,12,21);")
    for (const [policy, status, expected] of [
      [null, 'đã gửi', 'paused_recent_delivery'], [null, 'lỗi', 'allowed'],
      [{ operationState: 'committed' }, 'custom-result', 'paused_recent_delivery'],
      [{ operationState: 'unknown' }, 'đã gửi', 'allowed'], [{ operationState: 'not_started' }, 'đã xem', 'allowed'],
      [{ operationState: null }, 'thành công', 'paused_recent_delivery']
    ]) {
      await history({ policy, status }); await parity(`bằng chứng gửi ${JSON.stringify(policy)} / ${status}`, [expected])
    }
    for (const policy of [null, { operationState: 'committed' }]) {
      const tag = policy ? 'committed' : 'kiểu cũ'
      await history({ account: 101, policy }); await settings()
      await parity(`${tag}: mặc định chỉ tài khoản đang gửi`, ['allowed'])
      await settings('zalo_message_phone', { recentDeliveryCooldownAllAccounts: true })
      await parity(`${tag}: mọi tài khoản cùng nhân viên`, ['paused_recent_delivery'])
      await parity(`${tag}: vai trò Chat`, ['paused_recent_delivery'], [11], 'aka_agent_chat_api')
      await history({ account: 200, campaign: 21, policy }); await parity(`${tag}: nhân viên khác không tính`, ['allowed'])
      await history({ account: 300, campaign: 22, policy }); await parity(`${tag}: tổ chức khác không tính`, ['allowed'])
    }
    await history({ account: 101 })
    await q(`UPDATE auto_accounts SET is_delete=true,is_active=false WHERE id=101; UPDATE auto_campaigns SET is_delete=true WHERE id=20;
      UPDATE auto_campaign_input_data SET is_delete=true WHERE id=21; UPDATE auto_campaign_details SET is_delete=true;`)
    await parity('cờ xoá / ngừng dùng của lịch sử giữ cách tính cũ', ['paused_recent_delivery'])
    await q(`UPDATE auto_accounts SET is_delete=false,is_active=true WHERE id=101; UPDATE auto_campaigns SET is_delete=false WHERE id=20;
      UPDATE auto_campaign_input_data SET is_delete=false WHERE id=21;`)
    for (const [days, expected] of [[2, 'paused_recent_delivery'], [3, 'allowed']]) {
      await history({ days }); await parity(`biên ngày Việt Nam ${days}`, [expected])
      await history({ days, policy: { operationState: 'committed' } }); await parity(`biên ngày Việt Nam ${days}, committed`, [expected])
    }
    await history(); await q("UPDATE auto_campaign_details SET created_at=now()+interval '1 day';")
    await parity('lần gửi trong tương lai không tính', ['allowed'])
    await history(); await settings('zalo_message_phone', { recentDeliveryCooldownEnabled: false })
    await parity('tắt chống gửi lặp', ['allowed'])
    await settings('zalo_message_phone', { enableMessage: false }); await parity('chiến dịch không nhắn tin', ['allowed'])
    await settings('unsupported_action'); await parity('loại chưa hỗ trợ', ['allowed'])
    await settings(); await parity('bỏ id trùng, giữ thứ tự lô', ['paused_recent_delivery', 'deferred_batch_duplicate'], [12, 11, 12])
    await q("UPDATE auto_campaign_input_data SET status='hoàn thành',note='keep' WHERE id=11;")
    await parity('data không còn chờ xử lý, giữ ghi chú', ['not_pending'])
    await q("UPDATE auto_campaign_input_data SET status='chờ xử lý',note=NULL WHERE id=11;")
    for (const [ids, scope, pattern] of [[[], [10, 100, 1], /batch_size/], [[21], [10, 100, 1], /input_scope_mismatch/], [[11], [10, 100, 2], /scope_not_found/]]) {
      await assert.rejects(call('aka_agent_apply_campaign_delivery_cooldown', ids, 'service_role', scope), pattern)
      pass(`chặn ${pattern}`)
    }
    await history(); await q(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
      VALUES(22,21,999,100,'zalo_message_friend','đã gửi',NULL,now()-interval '1 minute'),
        (23,21,20,100,'zalo_message_friend','custom',jsonb_build_object('operationState','committed'),now()-interval '1 minute');`)
    await parity('lần gửi mới nhất, tie-break theo id kết quả', ['paused_recent_delivery'])
    await q(`INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status)
      SELECT 1000+n,10,'batch-'||n,NULL,'chờ xử lý' FROM generate_series(1,500) n;
      INSERT INTO auto_campaign_input_data(id,campaign_id,uid,status)
      SELECT 10000+n,20,CASE WHEN n<=100 THEN 'batch-'||n ELSE 'other-'||n END,'hoàn thành' FROM generate_series(1,3000) n;
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
      SELECT 10000+n,10000+n,20,100,'zalo_message_friend','đã gửi',
        CASE WHEN n%2=0 THEN jsonb_build_object('operationState','committed') END,now()-interval '1 minute' FROM generate_series(1,3000) n;`)
    await parity('lô 500 data với 3.000 lịch sử khớp / không khớp', null, Array.from({ length: 500 }, (_, i) => 1001 + i))
    for (const mode of ['force_generic_plan', 'force_custom_plan', 'auto']) {
      await q(`SET plan_cache_mode=${mode};`)
      await parity(`plan_cache_mode ${mode}`, ['paused_recent_delivery'], [1001])
    }
    await q('RESET plan_cache_mode;')
    await settings('sms_send'); await history({ code: 'sms_send' })
    for (const [requested, historical] of [['0901234567', '0084901234567'], ['0901234567', '901234567'],
      ['0321234567', '01621234567'], ['0901234567', '(+84) 901-234-567']]) {
      await q('UPDATE auto_campaign_input_data SET phone=CASE WHEN id=21 THEN $2 ELSE $1 END WHERE id IN (11,21)', [requested, historical])
      await parity(`chuẩn hoá SĐT ${historical}`, ['paused_recent_delivery'])
    }
    await q("UPDATE auto_campaign_input_data SET phone='0901234567' WHERE id IN (11,21);")
    await q("SET test.desktop_staff_id='2';")
    await assert.rejects(call('aka_agent_apply_campaign_delivery_cooldown', [11], 'aka_agent_desktop'), /desktop_staff_scope_denied/)
    await q("SET test.desktop_staff_id='1';")
    await parity('phiên Desktop đúng nhân viên', null, [11], 'aka_agent_desktop')
    await q('RESET test.desktop_staff_id;')
    await assert.rejects(call('aka_agent_apply_campaign_delivery_cooldown', [11], 'anon'), /permission denied/)
    pass('phiên Desktop nhân viên khác và anon vẫn bị chặn')

    // --- 3. Dạng production: SĐT trùng nhiều dòng data, nhân viên nhiều tài khoản gửi nhiều, tính trên mọi tài khoản ---
    // Thống kê như production: rất nhiều tài khoản mỗi cái gửi ít (planner ước mỗi tài khoản vài lần gửi), còn các tài khoản của nhân viên
    // đang kiểm gửi rất nhiều. Bản đang chạy khi đó lặp chỉ mục (account_id, action_code, created_at, input_data_id) theo từng tài khoản ×
    // từng dòng data trùng SĐT (production 28/11: 1.017 × 54 lần quét, 4,3 giây).
    const ACCOUNTS = 54, DUP = 1000, PER_ACCOUNT = 1000, OTHER_ACCOUNTS = 20000
    await q(`DELETE FROM auto_campaign_details; UPDATE auto_campaign_input_data SET uid=NULL, phone='0907777777', status='chờ xử lý', note=NULL WHERE id=11;`)
    await settings('zalo_message_phone', { recentDeliveryCooldownDays: 90, recentDeliveryCooldownAllAccounts: true })
    await q(`INSERT INTO org_staff(id,organization_id,is_active) SELECT 100+n, 1000+n, true FROM generate_series(1,5000) n;
      INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active)
        SELECT 5000+n,1,10,'zalo',true FROM generate_series(1,${ACCOUNTS}) n;
      INSERT INTO auto_accounts(id,staff_id,organization_id,flatform_type,is_active)
        SELECT 100000+n,100+(n%5000)+1,1000+(n%5000)+1,'zalo',true FROM generate_series(1,${OTHER_ACCOUNTS}) n;
      INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,name,action_id,status)
        SELECT 30000+n,100000+n,100+(n%5000)+1,1000+(n%5000)+1,'Khác '||n,'zalo_message_phone','hoàn thành' FROM generate_series(1,${OTHER_ACCOUNTS}) n;
      -- Cùng SĐT (nhiều cách viết) ở ${DUP} chiến dịch của tổ chức khác, mỗi dòng một lần gửi ở tài khoản của họ.
      INSERT INTO auto_campaign_input_data(id,campaign_id,phone,status)
        SELECT 2000000+n,30000+n,CASE n%3 WHEN 0 THEN '0907777777' WHEN 1 THEN '+84907777777' ELSE '84 907 777 777' END,'hoàn thành'
        FROM generate_series(1,${DUP}) n;
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        SELECT 2000000+n,2000000+n,30000+n,100000+n,'zalo_message_stranger','thành công',jsonb_build_object('operationState','committed'),
          now()-interval '2 days' FROM generate_series(1,${DUP}) n;
      -- Tài khoản tổ chức khác: mỗi cái 3 lần gửi (nền thống kê).
      INSERT INTO auto_campaign_input_data(id,campaign_id,phone,status)
        SELECT 3000000+n,30000+1+(n%${OTHER_ACCOUNTS}),'08'||lpad(n::text,8,'0'),'hoàn thành' FROM generate_series(1,${OTHER_ACCOUNTS * 3}) n;
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        SELECT 3000000+n,3000000+n,30000+1+(n%${OTHER_ACCOUNTS}),100000+1+(n%${OTHER_ACCOUNTS}),'zalo_message_stranger','thành công',
          CASE WHEN n%4=0 THEN NULL ELSE jsonb_build_object('operationState','committed') END,now()-((n%80)||' days')::interval
        FROM generate_series(1,${OTHER_ACCOUNTS * 3}) n;
      -- Mỗi tài khoản của nhân viên 1 có ${PER_ACCOUNT} lần gửi committed trong 90 ngày cho người khác.
      INSERT INTO auto_campaign_input_data(id,campaign_id,phone,status)
        SELECT 4000000+n,20,'09'||lpad(n::text,8,'0'),'hoàn thành' FROM generate_series(1,${ACCOUNTS * PER_ACCOUNT}) n;
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        SELECT 4000000+n,4000000+n,20,5001+(n%${ACCOUNTS}),CASE WHEN n%2=0 THEN 'zalo_message_stranger' ELSE 'zalo_message_friend' END,'thành công',
          jsonb_build_object('operationState','committed'),now()-((n%80)||' days')::interval FROM generate_series(1,${ACCOUNTS * PER_ACCOUNT}) n;
      ANALYZE org_staff; ANALYZE auto_accounts; ANALYZE auto_campaigns; ANALYZE auto_campaign_input_data; ANALYZE auto_campaign_details;`)
    const plan = async fn => {
      // Hàm tạm dừng data khi bị chặn: đo và đọc kết quả ở hai giao dịch riêng, cả hai đều huỷ.
      let p
      await q('BEGIN;')
      try {
        p = (await q(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.${fn}(10,100,1,ARRAY[11]::bigint[])`)).rows[0]['QUERY PLAN'][0]
      } finally { await q('ROLLBACK;') }
      await q('BEGIN;')
      try {
        const rows = (await q(`SELECT decision, note FROM public.${fn}(10,100,1,ARRAY[11]::bigint[])`)).rows
        return { ms: p['Execution Time'], blocks: p.Plan['Shared Hit Blocks'] + p.Plan['Shared Read Blocks'], rows }
      } finally { await q('ROLLBACK;') }
    }
    const bench = async (label, expected) => {
      const results = []
      for (const mode of ['force_custom_plan', 'force_generic_plan']) {
        await q(`SET plan_cache_mode=${mode};`)
        for (const fn of ['fixture_original_cooldown', 'aka_agent_apply_campaign_delivery_cooldown']) {
          await plan(fn) // lần đầu nạp cache / dựng plan
          results.push({ mode, fn, ...(await plan(fn)) })
        }
      }
      await q('RESET plan_cache_mode;')
      for (const r of results) console.log(`  ${label} | ${r.mode} | ${r.fn === 'fixture_original_cooldown' ? 'bản đang chạy' : 'V682'}: ${r.ms.toFixed(1)} ms, ${r.blocks} khối, ${r.rows.map(x => x.decision).join(',')}`)
      for (const mode of ['force_custom_plan', 'force_generic_plan']) {
        const o = results.find(r => r.mode === mode && r.fn === 'fixture_original_cooldown')
        const n = results.find(r => r.mode === mode && r.fn !== 'fixture_original_cooldown')
        assert.deepEqual(n.rows, o.rows, `${label} ${mode}: cùng kết quả`)
        assert.deepEqual(n.rows.map(x => x.decision), [expected], `${label} ${mode}`)
        assert.ok(n.blocks <= o.blocks, `${label} ${mode}: V682 không đọc nhiều khối hơn (${n.blocks} so với ${o.blocks})`)
        assert.ok(n.ms < 500, `${label} ${mode}: V682 dưới 500 ms (${n.ms.toFixed(1)} ms)`)
      }
      return results
    }
    const summary = list => {
      const o = list.find(r => r.mode === 'force_custom_plan' && r.fn === 'fixture_original_cooldown')
      const n = list.find(r => r.mode === 'force_custom_plan' && r.fn !== 'fixture_original_cooldown')
      return `bản đang chạy ${o.ms.toFixed(0)} ms / ${o.blocks} khối, V682 ${n.ms.toFixed(0)} ms / ${n.blocks} khối`
    }
    const natural = await bench('thống kê tự nhiên, không ai của nhân viên từng gửi', 'allowed')
    pass(`dạng production, thống kê tự nhiên: cùng kết quả; ${summary(natural)}`)
    // Thống kê như production 28/11/2026 (pg_stats): 17,9 triệu dòng mà input_data_id ước 795.031 giá trị, tức ~22,5 dòng mỗi data (thật 1–5),
    // nên planner cho rằng tra theo input_data_id đắt và chọn lặp chỉ mục theo tài khoản. Đặt cùng tỉ lệ cho bảng thử.
    const total = Number((await q('SELECT count(*) AS n FROM auto_campaign_details')).rows[0].n)
    await q(`ALTER TABLE auto_campaign_details ALTER COLUMN input_data_id SET (n_distinct = ${Math.max(1, Math.round(total / 22.5))});
      ANALYZE auto_campaign_details;`)
    if (process.env.V682_EXPLAIN === '1') {
      // Ghi plan của các câu bên trong hàm vào pg.log (auto_explain) để xem chỉ mục nào được dùng.
      await q(`LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_nested_statements = on;
        SET auto_explain.log_analyze = on; SET auto_explain.log_buffers = on; SET auto_explain.log_timing = off;`)
      for (const fn of ['fixture_original_cooldown', 'aka_agent_apply_campaign_delivery_cooldown']) {
        await q('BEGIN;'); try { await q(`SELECT * FROM public.${fn}(10,100,1,ARRAY[11]::bigint[])`) } finally { await q('ROLLBACK;') }
      }
      await q('SET auto_explain.log_min_duration = -1;')
      const log = fs.readFileSync(path.join(cluster.temp, 'pg.log'), 'utf8')
      for (const line of log.split('\n')) if (/Index Scan|Bitmap|Seq Scan|Execution Time|Function Scan on fixture|Function Scan on aka_agent_apply/.test(line) && /auto_campaign_details|Execution|Function Scan/.test(line)) console.log('   ', line.trim().slice(0, 220))
    }
    const prodStats = await bench('thống kê như production, không ai của nhân viên từng gửi', 'allowed')
    // Trên cụm thử planner vẫn chọn tra theo input_data_id cho cả bản đang chạy, nên bước này chỉ kiểm V682 cùng kết quả, không chậm hơn;
    // lỗi cũ (lặp chỉ mục theo tài khoản) đo trên production bằng câu chỉ đọc (docs/DELIVERY_COOLDOWN_V682.md).
    pass(`dạng production, thống kê như production: cùng kết quả; ${summary(prodStats)}`)
    // Một tài khoản của nhân viên đã gửi cho chính SĐT này trong 90 ngày (ở chiến dịch khác của nhân viên): phải tạm dừng data.
    await q(`INSERT INTO auto_campaign_input_data(id,campaign_id,phone,status) VALUES (5000001,20,'84907777777','hoàn thành');
      INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_code,status,policy_snapshot,created_at)
        VALUES (5000001,5000001,20,5010,'zalo_message_stranger','thành công',jsonb_build_object('operationState','committed'),now()-interval '5 days');`)
    const matched = await bench('thống kê như production, một tài khoản của nhân viên đã gửi 5 ngày trước', 'paused_recent_delivery')
    pass(`dạng production, có lần gửi khớp: cả hai tạm dừng data như nhau; ${summary(matched)}`)
    console.log(`PASS ${checks} nhóm; md5 ${v682.OLD_MD5} -> ${v682.NEW_MD5}`)
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
