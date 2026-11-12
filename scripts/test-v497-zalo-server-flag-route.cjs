// Kiểm V497 (định tuyến tài khoản Zalo Server theo cờ use_new_zalo_runtime) trên PostgreSQL 17 cục bộ.
// Hai hàm V497 sửa được dựng bằng NGUYÊN VĂN bản live (fixture chỉ đọc 11/11/2026) nên preflight md5 phải qua y như
// production. Không chạm DB thật.
// Chạy: node scripts/test-v497-zalo-server-flag-route.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const ROOT = path.resolve(__dirname, '..')
const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v497_zalo_server_flag_route.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v497_zalo_server_flag_route.sql'), 'utf8')
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/zalo-server-flag-route/live-functions-20261111.json'), 'utf8'))
const MD5 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/zalo-server-flag-route/v497-md5.json'), 'utf8'))
const CHAT_ORGS = 'public.aka_agent_app_access_chat_organizations(bigint[])'
const RECOVER = 'public.recover_server_zalo_running_state(bigint,text,boolean)'
const def = sig => LIVE.functions[sig].definition.trimEnd() + ';'
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

// Tổ chức thử: 10 có Chat; 20 bật cờ, có Server; 21 bật cờ, không quyền Server; 22 bật cờ, gói hết hạn;
// 23 không bật cờ, có Server; 24 bật cờ, có Server (dùng cho mốc VPS). Nhân viên 200 thuộc 20, 240 thuộc 24.
const FIXTURE = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE ROLE aka_agent_chat_api NOLOGIN BYPASSRLS; CREATE ROLE aka_agent_desktop NOLOGIN;
  CREATE SCHEMA private;
  GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role, aka_agent_chat_api, aka_agent_desktop;
  CREATE SCHEMA supabase_migrations;
  CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text);
  -- Như Supabase: hàm mới trong public mặc định cấp cho anon/authenticated/service_role.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.org_organization (id bigint PRIMARY KEY, name text, use_new_zalo_runtime boolean NOT NULL DEFAULT false);
  CREATE TABLE public.org_organization_product (id bigserial PRIMARY KEY, organization_id bigint NOT NULL, product_id bigint,
    is_deleted boolean NOT NULL DEFAULT false, is_chat_sync boolean NOT NULL DEFAULT false, expiration_date timestamptz);
  CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL);
  CREATE TABLE public.aka_agent_staff_runtime_profile (id bigint PRIMARY KEY, organization_id bigint NOT NULL);
  CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, flatform_type text,
    is_zalo_show_web boolean, is_zalo_server boolean, is_delete boolean NOT NULL DEFAULT false, status text,
    runtime_operation_claim_token uuid, updated_at timestamptz);
  CREATE TABLE public.auto_campaigns (id bigint PRIMARY KEY, staff_id bigint, account_id bigint, secondary_account_id bigint,
    is_delete boolean NOT NULL DEFAULT false, status text, runtime_claim_token uuid, runtime_unit_token uuid, updated_at timestamptz);
  CREATE TABLE public.auto_campaign_inputs (id bigint PRIMARY KEY, campaign_id bigint, status text, note text, is_delete boolean NOT NULL DEFAULT false);
  CREATE TABLE public.auto_campaign_input_data (id bigint PRIMARY KEY, campaign_id bigint, status text, note text, is_delete boolean NOT NULL DEFAULT false);
  CREATE TABLE public.test_caps (organization_id bigint PRIMARY KEY, qr boolean NOT NULL, server boolean NOT NULL);
  GRANT SELECT, UPDATE ON public.auto_accounts, public.auto_campaigns, public.auto_campaign_inputs, public.auto_campaign_input_data
    TO service_role, aka_agent_chat_api, aka_agent_desktop;
  GRANT SELECT ON public.org_organization, public.org_organization_product, public.org_staff, public.aka_agent_staff_runtime_profile,
    public.test_caps TO service_role, aka_agent_chat_api, aka_agent_desktop;
  CREATE FUNCTION private.app_access_policy_enabled() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION private.app_access_packages(p_org bigint, p_app text) RETURNS TABLE(id bigint) LANGUAGE sql STABLE
    AS $$ SELECT NULL::bigint WHERE false $$;
  CREATE FUNCTION public.resolve_organization_zalo_account_capabilities(p_organization_id bigint)
    RETURNS TABLE(entitlement_id bigint, product_id bigint, product_name text, package_name text, package_type text,
      expiration_date timestamp with time zone, max_sends_per_day integer, max_accounts integer, created_at timestamp with time zone,
      qr_enabled boolean, web_enabled boolean, server_enabled boolean, capability_revision text)
    LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN c.organization_id IS NOT NULL THEN p_organization_id END, NULL::bigint, NULL::text, NULL::text, NULL::text,
        NULL::timestamptz, NULL::integer, NULL::integer,
        NULL::timestamptz, coalesce(c.qr, false), false, coalesce(c.server, false), 'rev:' || p_organization_id
      FROM (SELECT p_organization_id AS org) AS x LEFT JOIN public.test_caps c ON c.organization_id = x.org $$;
  CREATE FUNCTION public.aka_agent_staff_runtime_scope(p_staff_id bigint, p_mode text)
    RETURNS SETOF public.aka_agent_staff_runtime_profile LANGUAGE sql STABLE
    AS $$ SELECT * FROM public.aka_agent_staff_runtime_profile WHERE id = p_staff_id $$;
  CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  GRANT EXECUTE ON FUNCTION public.aka_agent_staff_runtime_scope(bigint, text), public.aka_agent_lock_campaign_input_serialization(bigint)
    TO service_role, aka_agent_chat_api, aka_agent_desktop;
`

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V497_TEST_PORT || 55497), label: 'aka-v497-' })
  const db = await connect()
  const q = (text, args = []) => db.query(text, args)
  const val = async (text, args = []) => Object.values((await q(text, args)).rows[0] || {})[0]
  const chatOrgs = async () => (await q(`SELECT array_agg(x ORDER BY x)::bigint[] AS ids
    FROM public.aka_agent_app_access_chat_organizations(ARRAY(SELECT id FROM public.org_organization)) AS x`)).rows[0].ids?.map(Number) ?? []
  const asRole = async (role, text, args = []) => {
    await q(`SET ROLE ${role}`)
    try { return await q(text, args) } finally { await q('RESET ROLE') }
  }
  const rejected = async (text, pattern) => {
    await assert.rejects(q(text), pattern)
    await q('ROLLBACK').catch(() => {})
  }
  try {
    await q(FIXTURE)
    await q('SET check_function_bodies = off')
    for (const sig of ['public.aka_agent_app_access_separate(bigint)', 'public.aka_agent_app_access_chat_runtime(bigint,boolean)', CHAT_ORGS, RECOVER]) {
      await q(def(sig))
    }
    await q('RESET check_function_bodies')
    await q(`REVOKE ALL ON FUNCTION ${CHAT_ORGS} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ${CHAT_ORGS} TO service_role;
      GRANT EXECUTE ON FUNCTION ${RECOVER} TO service_role, aka_agent_chat_api, aka_agent_desktop;`)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${CHAT_ORGS}'::regprocedure))`), MD5.chat_orgs_old)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${RECOVER}'::regprocedure))`), MD5.recover_old)
    await q(`
      INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES
        (10, 'Có Chat', false), (20, 'Cờ + Server', false), (21, 'Cờ, không Server', false), (22, 'Cờ, hết hạn', false),
        (23, 'Không cờ', false), (24, 'Cờ + Server, mốc', false);
      INSERT INTO public.org_organization_product (organization_id, product_id, is_chat_sync, expiration_date) VALUES
        (10, 16, true, now() + interval '30 days'), (20, 16, false, now() + interval '30 days'), (21, 18, false, now() + interval '30 days'),
        (22, 16, false, now() - interval '3 days'), (23, 16, false, now() + interval '30 days'), (24, 16, false, now() + interval '30 days');
      INSERT INTO public.test_caps VALUES (10, true, true), (20, true, true), (21, true, false), (22, true, true), (23, true, true), (24, true, true);
      INSERT INTO public.org_staff VALUES (100, 10), (200, 20), (240, 24);
      INSERT INTO public.aka_agent_staff_runtime_profile VALUES (100, 10), (200, 20), (240, 24);
      INSERT INTO public.auto_accounts (id, staff_id, organization_id, flatform_type, is_zalo_show_web, is_zalo_server, status) VALUES
        (2000, 200, 20, 'zalo', false, true, 'đang chạy'), (2400, 240, 24, 'zalo', false, true, 'chờ xử lý');
      INSERT INTO public.auto_campaigns (id, staff_id, account_id, status) VALUES (9000, 200, 2000, 'đang chạy');
      INSERT INTO public.auto_campaign_input_data (id, campaign_id, status) VALUES (90000, 9000, 'đang chạy');
    `)
    const beforeOrgs = await chatOrgs()
    assert.deepEqual(beforeOrgs, [10])
    pass('dựng đúng hai hàm live (md5 khớp production); trước V497 VPS chỉ thả tổ chức có Chat')

    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 20`)
    await q(APPLY)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${CHAT_ORGS}'::regprocedure))`), MD5.chat_orgs_new)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${RECOVER}'::regprocedure))`), MD5.recover_new)
    assert.deepEqual(await chatOrgs(), beforeOrgs, 'apply không đổi danh sách App Server, kể cả khi đang có tổ chức bật cờ')
    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = 20`)
    pass('apply V497 (kể cả khi đang có tổ chức bật cờ): hàm App Server dùng trả y như cũ')

    const perms = (await q(`SELECT
      has_function_privilege('anon', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE') AS anon_route,
      has_function_privilege('authenticated', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE') AS auth_route,
      has_function_privilege('aka_agent_desktop', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE') AS desktop_route,
      has_function_privilege('aka_agent_chat_api', 'public.aka_agent_zalo_server_flag_route(bigint)', 'EXECUTE') AS chat_route,
      has_function_privilege('anon', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE') AS anon_mark,
      has_function_privilege('aka_agent_chat_api', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE') AS chat_mark,
      has_function_privilege('service_role', 'private.aka_agent_zalo_server_mark_vps_released(bigint)', 'EXECUTE') AS service_mark,
      has_table_privilege('anon', 'private.auto_zalo_server_session_handoff', 'SELECT') AS anon_table,
      has_table_privilege('service_role', 'private.auto_zalo_server_session_handoff', 'SELECT') AS service_table,
      has_table_privilege('aka_agent_chat_api', 'private.auto_zalo_server_session_handoff', 'SELECT, INSERT, UPDATE, DELETE') AS chat_table,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.auto_zalo_server_session_handoff'::regclass) AS rls,
      (SELECT proacl::text FROM pg_proc WHERE oid = '${CHAT_ORGS}'::regprocedure) AS chat_orgs_acl`)).rows[0]
    assert.deepEqual({ ...perms, chat_orgs_acl: undefined }, { anon_route: false, auth_route: false, desktop_route: false, chat_route: true,
      anon_mark: false, chat_mark: false, service_mark: true, anon_table: false, service_table: false, chat_table: true, rls: true,
      chat_orgs_acl: undefined })
    assert.equal(perms.chat_orgs_acl, '{postgres=X/postgres,service_role=X/postgres}')
    pass('quyền: chỉ ChatApi/service_role gọi hàm luật cờ, chỉ service_role ghi mốc, chỉ ChatApi đọc ghi bảng handoff; quyền hàm cũ giữ nguyên')

    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id IN (20, 21, 22, 24)`)
    const route = (await q(`SELECT o.id, public.aka_agent_zalo_server_flag_route(o.id) AS on_fly FROM public.org_organization o ORDER BY o.id`))
      .rows.map(r => [Number(r.id), r.on_fly])
    assert.deepEqual(route, [[10, false], [20, true], [21, false], [22, false], [23, false], [24, true]])
    assert.deepEqual(await chatOrgs(), [10], 'chỉ bật cờ thì App Server chưa thả: chờ ChatApi nhận tổ chức')
    pass('luật cờ: chỉ tổ chức bật cờ có gói 16/18 còn hạn và quyền QR + Server; bật cờ một mình chưa đổi App Server')

    await q(`INSERT INTO private.auto_zalo_server_session_handoff (account_id, organization_id, staff_id, direction)
      VALUES (2000, 20, 200, 'to_fly')`)
    assert.deepEqual(await chatOrgs(), [10, 20], 'ChatApi đã nhận (dòng to_fly đang chờ) thì App Server thả')
    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id IN (20, 21, 22, 24)`)
    await q(`UPDATE private.auto_zalo_server_session_handoff SET completed_at = now() WHERE account_id = 2000`)
    assert.deepEqual(await chatOrgs(), [10, 20], 'Fly còn giữ phiên thì App Server chưa nhận lại dù đã tắt cờ')
    await q(`UPDATE private.auto_zalo_server_session_handoff SET direction = 'to_vps' WHERE account_id = 2000`)
    assert.deepEqual(await chatOrgs(), [10])
    await q(`DELETE FROM private.auto_zalo_server_session_handoff`)
    pass('App Server thả tổ chức khi ChatApi đã nhận, nhận lại khi ChatApi đã trả phiên (dòng thành to_vps)')

    // Mốc "VPS đã thả": chỉ lời gọi của App Server (service_role) lúc dừng runtime.
    await q(`INSERT INTO private.auto_zalo_server_session_handoff (account_id, organization_id, staff_id, direction)
      VALUES (2000, 20, 200, 'to_fly'), (2400, 24, 240, 'to_fly')`)
    const markOf = async id => (await q(`SELECT vps_released_at FROM private.auto_zalo_server_session_handoff WHERE account_id = $1`, [id])).rows[0].vps_released_at
    const fly = await asRole('aka_agent_chat_api', `SELECT public.recover_server_zalo_running_state(200) AS r`)
    assert.equal(fly.rows[0].r.campaign_input_data_completed, 1, 'Fly vẫn dọn như cũ')
    assert.equal(await markOf(2000), null, 'Fly (lúc lên leader) không ghi mốc')
    await asRole('service_role', `SELECT public.recover_server_zalo_running_state(200, 'rev:20', true) AS r`)
    assert.equal(await markOf(2000), null, 'VPS khởi động (p_require_server_mode true) không ghi mốc')
    await q(`UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = 90000`)
    const vps =await asRole('service_role', `SELECT public.recover_server_zalo_running_state(200) AS r`)
    assert.deepEqual(vps.rows[0].r, { staff_id: 200, accounts_reset: 0, campaigns_reset: 0, campaign_inputs_completed: 0,
      campaign_input_data_completed: 1 }, 'kết quả dọn giữ nguyên dạng cũ')
    assert.notEqual(await markOf(2000), null, 'VPS dừng runtime thì ghi mốc')
    assert.equal(await markOf(2400), null, 'chỉ dòng của đúng nhân viên')
    const first = await markOf(2000)
    await asRole('service_role', `SELECT public.recover_server_zalo_running_state(200)`)
    assert.deepEqual(await markOf(2000), first, 'gọi lại không đè mốc')
    await asRole('aka_agent_desktop', `SELECT public.recover_server_zalo_running_state(240)`)
    assert.equal(await markOf(2400), null, 'Desktop không ghi mốc')
    await q(`UPDATE private.auto_zalo_server_session_handoff SET completed_at = now() WHERE account_id = 2400`)
    await asRole('service_role', `SELECT public.recover_server_zalo_running_state(240)`)
    assert.equal(await markOf(2400), null, 'dòng đã xong không bị ghi mốc')
    pass('mốc VPS đã thả: chỉ service_role + p_require_server_mode false + dòng to_fly đang chờ; Fly/Desktop/lúc khởi động không ghi')

    await q(`REVOKE EXECUTE ON FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint) FROM service_role`)
    await q(`UPDATE private.auto_zalo_server_session_handoff SET vps_released_at = NULL WHERE account_id = 2000`)
    const failing = await asRole('service_role', `SELECT public.recover_server_zalo_running_state(200) AS r`)
    assert.equal(failing.rows[0].r.staff_id, 200, 'ghi mốc lỗi thì VPS vẫn dọn xong')
    assert.equal(await markOf(2000), null)
    await q(`GRANT EXECUTE ON FUNCTION private.aka_agent_zalo_server_mark_vps_released(bigint) TO service_role`)
    pass('ghi mốc lỗi không làm hỏng việc dọn của VPS (chỉ cảnh báo)')

    await q(`INSERT INTO supabase_migrations.schema_migrations VALUES ('20261111170000', 'migration_v497_zalo_server_flag_route')`)
    await rejected(APPLY, /đã có trong sổ migration/)
    await q(`DELETE FROM supabase_migrations.schema_migrations`)
    await rejected(APPLY, /đối tượng mới đã tồn tại/)
    pass('apply lần hai bị chặn')

    await rejected(ROLLBACK, /còn tài khoản đang ở Fly theo cờ/)
    await q(`DELETE FROM private.auto_zalo_server_session_handoff`)
    await q(ROLLBACK)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${CHAT_ORGS}'::regprocedure))`), MD5.chat_orgs_old)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${RECOVER}'::regprocedure))`), MD5.recover_old)
    assert.equal(await val(`SELECT to_regclass('private.auto_zalo_server_session_handoff') IS NULL
      AND to_regprocedure('public.aka_agent_zalo_server_flag_route(bigint)') IS NULL
      AND to_regprocedure('private.aka_agent_zalo_server_mark_vps_released(bigint)') IS NULL`), true)
    assert.deepEqual(await chatOrgs(), beforeOrgs)
    pass('gỡ: chặn khi còn dòng to_fly; sau đó hai hàm về đúng bản live và xoá đối tượng mới')

    await q(APPLY)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${CHAT_ORGS}'::regprocedure))`), MD5.chat_orgs_new)
    pass('apply lại sau khi gỡ')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

// V498 dựng lại đúng fixture này (cùng hàm live, apply V497) rồi thêm phiên Desktop.
module.exports = { FIXTURE, LIVE, MD5, APPLY, CHAT_ORGS, RECOVER, def }

if (require.main === module) main().catch(err => { console.error(err); process.exit(1) })
