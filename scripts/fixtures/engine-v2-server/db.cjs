// Dựng PostgreSQL cục bộ dùng một lần ở trạng thái production 26/11/2026 cho V667 (engine v2 cho tài khoản Zalo Server trên VPS):
// fixture của V657 (claim qua V657), V650 (finish), recover_server_zalo_running_state / aka_agent_zalo_server_flag_route bản production
// (scripts/fixtures/engine-v2-server/live-20261126.json), cùng vài hàm / bảng / cột phụ mà fixture chưa có. applyV667 = true thì apply luôn
// p1 → p2 → p3. Không chạm DB thật. Cần CHAT_REPO (hoặc PG_MODULE_DIR) có node_modules/pg; LC_ALL=C trên macOS.
'use strict'
const assert = require('node:assert/strict')
const { buildDb } = require('../../send-exclusion-v657-fixture.cjs')
const V650 = require('../../build-v650-sql.cjs')
const V667 = require('../../build-v667-sql.cjs')

async function buildV667Db({ label = 'aka-v667-', applyV667 = false } = {}) {
  const T = await buildDb({ label })
  const { db, one } = T
  const md5Of = async sig => (await one(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) m`, [sig])).m
  try {
    await T.applyV657()
    await db.query(V650.migration)
    assert.equal(await md5Of(V667.SIG.claim), V667.LIVE_MD5.claim, 'fixture: claim như production (V657)')
    assert.equal(await md5Of(V667.SIG.finish), V667.LIVE_MD5.finish, 'fixture: finish như production (V650)')
    // Hai hàm phụ production mà fixture chưa có (bản rút gọn, cùng chữ ký / cột): quyền gói Zalo theo tổ chức (gói 16 / 18 còn hạn thì có QR,
    // trình duyệt, Server) và phạm vi nhân viên (khoá dòng nhân viên).
    if (!(await one(`SELECT to_regprocedure('public.resolve_organization_zalo_account_capabilities(bigint)') r`)).r) {
      await db.query(`CREATE FUNCTION public.resolve_organization_zalo_account_capabilities(p_organization_id bigint)
        RETURNS TABLE(entitlement_id bigint, product_id bigint, product_name text, package_name text, package_type text, expiration_date timestamptz,
          max_sends_per_day integer, max_accounts integer, created_at timestamptz, qr_enabled boolean, web_enabled boolean, server_enabled boolean, capability_revision text)
        LANGUAGE sql STABLE AS $f$
        WITH e AS (SELECT p.id, p.product_id FROM public.org_organization_product p WHERE p.organization_id = p_organization_id AND p.product_id IN (16, 18)
                    AND p.is_deleted = false AND p.expiration_date > now() ORDER BY p.id LIMIT 1)
        SELECT (SELECT id FROM e), (SELECT product_id::bigint FROM e), NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::int, NULL::int, NULL::timestamptz,
               EXISTS (SELECT 1 FROM e), EXISTS (SELECT 1 FROM e), EXISTS (SELECT 1 FROM e), 'test:' || coalesce(p_organization_id::text, 'null') $f$`)
    }
    if (!(await one(`SELECT to_regprocedure('public.aka_agent_staff_runtime_scope(bigint,text)') r`)).r) {
      await db.query(`CREATE FUNCTION public.aka_agent_staff_runtime_scope(p_staff_id bigint, p_lock text) RETURNS TABLE(id bigint, organization_id bigint)
        LANGUAGE plpgsql AS $f$ BEGIN RETURN QUERY SELECT s.id::bigint, s.organization_id::bigint FROM public.org_staff s WHERE s.id = p_staff_id FOR UPDATE OF s; END $f$`)
    }
    // Bảng production mà hàm khôi phục đọc, fixture chưa có.
    await db.query(`CREATE TABLE IF NOT EXISTS public.auto_campaign_inputs (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, status text, note text,
      is_delete boolean NOT NULL DEFAULT false)`)
    if (await md5Of(V667.SIG.recover) !== V667.LIVE_MD5.recover) {
      await db.query('SET check_function_bodies = off')
      await db.query(V667.texts.live.recover)
      await db.query('SET check_function_bodies = on')
    }
    assert.equal(await md5Of(V667.SIG.recover), V667.LIVE_MD5.recover, 'fixture: recover_server_zalo_running_state như production')
    const live = sig => V667.fixture.functions.find(f => f.signature === sig)
    const closeRun = live('public.aka_agent_engine_close_run_v1(bigint,text)')
    assert.equal(await md5Of(closeRun.signature), closeRun.md5, 'fixture: close_run_v1 như production (V618)')
    const route = live('public.aka_agent_zalo_server_flag_route(bigint)')
    if (await md5Of(route.signature) !== route.md5) await db.query(route.definition)
    assert.equal(await md5Of(route.signature), route.md5, 'fixture: aka_agent_zalo_server_flag_route như production')
    // V513 (Desktop đọc cờ engine v2 lúc đăng nhập, cũng dùng để chọn Fly / App Server cho tài khoản Server). V667 không sửa hàm này;
    // bài kiểm dùng nó để chắc tổ chức trong công tắc mới vẫn được Desktop coi là chạy Server trên App Server. Hàm ngữ cảnh phiên Desktop
    // của fixture là bản rút gọn (đọc test.desktop_staff), đủ cho hàm V513 và hàm Desktop mới của V667.
    const desktopFlag = live('public.aka_agent_engine_desktop_enabled_v1()')
    if (await md5Of(desktopFlag.signature) !== desktopFlag.md5) {
      await db.query(desktopFlag.definition)
      await db.query(`REVOKE ALL ON FUNCTION ${desktopFlag.signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${desktopFlag.signature} TO aka_agent_desktop`)
    }
    assert.equal(await md5Of(desktopFlag.signature), desktopFlag.md5, 'fixture: aka_agent_engine_desktop_enabled_v1 như production (V513)')
    // Cột production của auto_outcome_policies mà fixture chưa có (V558 streak_after_delivery, V571 kiểm người nhận).
    await db.query(`ALTER TABLE public.auto_outcome_policies ADD COLUMN IF NOT EXISTS streak_after_delivery text,
      ADD COLUMN IF NOT EXISTS target_check_enabled boolean, ADD COLUMN IF NOT EXISTS target_check_days integer`)
    // Production: data dở chưa có kết quả về hàng đợi khi lượt bị bỏ dở.
    await db.query(`DELETE FROM public.auto_system_settings WHERE key = 'engine.stale_unsent_target_action'`)
    await db.query(`INSERT INTO public.auto_system_settings (key, value, is_active) VALUES ('engine.stale_unsent_target_action', 'requeue_unstarted', true)`)
    // Chính sách 255 / 256 (tra số không rõ kết quả, Desktop / Fly) mang đúng id production để preflight của p2 nhận ra.
    for (const [want, rt] of [[255, 'desktop'], [256, 'fly']]) {
      const row = await one(`SELECT id FROM public.auto_outcome_policies WHERE error_code = 'err_engine_unknown_delivery' AND action_code = 'zalo_find_phone_user'
        AND runtime_target = $1 AND is_active AND NOT is_delete`, [rt])
      assert.ok(row, `fixture: chưa có chính sách tra số không rõ kết quả cho ${rt}`)
      if (Number(row.id) !== want) {
        await db.query(`UPDATE public.auto_outcome_policies SET id = id + 9000000 WHERE id = $1`, [want])
        await db.query(`UPDATE public.auto_outcome_policies SET id = $1 WHERE id = $2`, [want, row.id])
      }
    }
    if (applyV667) {
      await db.query(V667.sql.p1)
      await db.query(V667.sql.p2)
      await db.query(V667.sql.p3)
      assert.equal(await md5Of(V667.SIG.claim), V667.NEW_MD5.claim, 'V667 đã apply')
    }
  } catch (e) { await T.stop(); throw e }
  return { ...T, md5Of }
}

module.exports = { buildV667Db }
