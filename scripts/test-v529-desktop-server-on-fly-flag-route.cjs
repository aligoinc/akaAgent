// Kiểm V529 (Desktop chọn nơi chạy tài khoản Zalo Server giống Web và ChatApi) trên PostgreSQL 17 cục bộ.
// Dựng fixture như bài kiểm V498 (V497 + hai hàm phiên Desktop nguyên văn bản live), apply V498 từ file, đối chiếu md5 với bản
// live 14/11/2026 rồi mới apply V529. Không chạm DB thật.
// Chạy: node scripts/test-v529-desktop-server-on-fly-flag-route.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v497 = require('./test-v497-zalo-server-flag-route.cjs')

const ROOT = path.resolve(__dirname, '..')
const V498 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v498_zalo_server_on_fly_desktop.sql'), 'utf8')
const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v529_desktop_server_on_fly_flag_route.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v529_desktop_server_on_fly_flag_route.sql'), 'utf8')
const SCOPE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/zalo-server-flag-route/desktop-scope-functions-20261111.json'), 'utf8'))
const FN = 'public.aka_agent_zalo_server_on_fly_v1()'
const ROUTE = 'public.aka_agent_zalo_server_flag_route(bigint)'
// md5(pg_get_functiondef) bản live đọc 14/11/2026 ~08:50 VN.
const LIVE_V498_MD5 = '0e8f19b1cabf61598a08a818dfe20171'
const LIVE_ROUTE_MD5 = '9fc8fdbcfeeb1ccbaccb21e98078d980'
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

// Nhân viên Desktop → tổ chức:
//   100 → 10 có Chat; 200 → 20 cờ + gói Server, ChatApi đã nhận (dòng to_fly); 240 → 24 cờ + gói Server, chưa có dòng to_fly
//   (tổ chức mới chưa có tài khoản Server: ca V529 sửa); 230 → 23 không cờ; 250 → 25 cờ nhưng gói hết hạn;
//   260 → 26 cờ, gói còn hạn nhưng không có quyền Server; 270 → 27 không cờ nhưng còn dòng to_fly (App Server đang thả).
const STAFF = { 100: 10, 200: 20, 230: 23, 240: 24, 250: 25, 260: 26, 270: 27 }
const uid = staffId => `00000000-0000-0000-0000-000000000${String(staffId).padStart(3, '0')}`

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V529_TEST_PORT || 55529), label: 'aka-v529-' })
  const db = await connect()
  const q = (text, args = []) => db.query(text, args)
  const val = async (text, args = []) => Object.values((await q(text, args)).rows[0] || {})[0]
  const asDesktop = async (staffId, sub = uid(staffId)) => {
    await q('BEGIN')
    try {
      await q('SET LOCAL ROLE aka_agent_desktop')
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'aka_agent_desktop', sub })])
      return (await q(`SELECT ${FN} AS on_fly`)).rows[0].on_fly
    } finally { await q('ROLLBACK') }
  }
  const all = async () => {
    const out = {}
    for (const staffId of Object.keys(STAFF)) out[STAFF[staffId]] = await asDesktop(Number(staffId))
    return out
  }
  const rejected = async (text, pattern) => {
    await assert.rejects(q(text), pattern)
    await q('ROLLBACK').catch(() => {})
  }
  const fnMd5 = () => val(`SELECT md5(pg_get_functiondef('${FN}'::regprocedure))`)
  try {
    await q(v497.FIXTURE)
    await q('SET check_function_bodies = off')
    for (const sig of ['public.aka_agent_app_access_separate(bigint)', 'public.aka_agent_app_access_chat_runtime(bigint,boolean)', v497.CHAT_ORGS, v497.RECOVER]) {
      await q(v497.def(sig))
    }
    await q('RESET check_function_bodies')
    await q(`REVOKE ALL ON FUNCTION ${v497.CHAT_ORGS} FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION ${v497.CHAT_ORGS} TO service_role;
      GRANT EXECUTE ON FUNCTION ${v497.RECOVER} TO service_role, aka_agent_chat_api, aka_agent_desktop;`)
    await q(`
      INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES
        (10, 'Có Chat', false), (20, 'Cờ + Server, đã nhận', true), (23, 'Không cờ', false), (24, 'Cờ + Server, chưa có tài khoản', true),
        (25, 'Cờ, gói hết hạn', true), (26, 'Cờ, không quyền Server', true), (27, 'Không cờ, dòng to_fly còn treo', false);
      INSERT INTO public.org_organization_product (organization_id, product_id, is_chat_sync, expiration_date) VALUES
        (10, 16, true, now() + interval '30 days'), (20, 16, false, now() + interval '30 days'),
        (23, 16, false, now() + interval '30 days'), (24, 18, false, now() + interval '30 days'),
        (25, 16, false, now() - interval '3 days'), (26, 16, false, now() + interval '30 days'),
        (27, 16, false, now() + interval '30 days');
      INSERT INTO public.test_caps VALUES (10, true, true), (20, true, true), (23, true, true), (24, true, true),
        (25, true, true), (26, true, false), (27, true, true);
    `)
    await q(v497.APPLY)
    assert.equal(await val(`SELECT md5(pg_get_functiondef('${ROUTE}'::regprocedure))`), LIVE_ROUTE_MD5)
    await q(`
      ALTER TABLE public.org_staff ADD COLUMN is_admin_akabiz boolean NOT NULL DEFAULT false,
        ADD COLUMN is_active boolean NOT NULL DEFAULT true, ADD COLUMN deleted_at timestamptz;
      CREATE TABLE private.aka_agent_desktop_users (auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);
    `)
    for (const [staffId, org] of Object.entries(STAFF)) {
      await q('INSERT INTO public.org_staff (id, organization_id) VALUES ($1, $2)', [Number(staffId), org])
      await q('INSERT INTO private.aka_agent_desktop_users VALUES ($1, $2)', [uid(staffId), Number(staffId)])
    }
    for (const sig of ['private.aka_agent_staff_scope_for_request()', 'private.aka_agent_desktop_data_context()']) {
      const fn = SCOPE.functions[sig]
      await q(fn.definition.trimEnd() + ';')
      await q(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${sig} TO aka_agent_desktop`)
      assert.equal(await val(`SELECT md5(pg_get_functiondef('${sig}'::regprocedure))`), fn.md5)
    }
    await q(V498)
    assert.equal(await fnMd5(), LIVE_V498_MD5)
    await q(`INSERT INTO private.auto_zalo_server_session_handoff (account_id, organization_id, staff_id, direction) VALUES
      (2000, 20, 200, 'to_fly'), (2700, 27, 270, 'to_fly')`)
    pass('fixture: V497 + hai hàm phiên Desktop + V498 từ file; md5 V498 và aka_agent_zalo_server_flag_route khớp bản live')

    assert.deepEqual(await all(), { 10: true, 20: true, 23: false, 24: false, 25: false, 26: false, 27: true })
    pass('trước V529: tổ chức 24 (bật cờ, gói Server, chưa có dòng to_fly) bị Desktop đưa về App Server')

    await q(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261114000000', 'migration_v529_desktop_server_on_fly_flag_route')`)
    await rejected(APPLY, /V529 đã có trong sổ migration/)
    await q(`DELETE FROM supabase_migrations.schema_migrations WHERE name = 'migration_v529_desktop_server_on_fly_flag_route'`)
    pass('preflight: sổ migration đã có V529 thì không chạy')

    const changed = async () => (await q(`
      SELECT array_agg(o.id ORDER BY o.id) AS ids FROM public.org_organization o
       WHERE o.use_new_zalo_runtime AND public.aka_agent_zalo_server_flag_route(o.id)
         AND NOT public.aka_agent_app_access_chat_runtime(o.id, true)
         AND NOT EXISTS (SELECT 1 FROM private.auto_zalo_server_session_handoff h WHERE h.organization_id = o.id AND h.direction = 'to_fly')`)).rows[0].ids
    assert.deepEqual(await changed(), ['24'])
    pass('câu đếm tổ chức đổi kết quả (dùng cho biên nhận) chỉ ra đúng tổ chức 24')

    await q(APPLY)
    const perms = (await q(`SELECT
      has_function_privilege('aka_agent_desktop', '${FN}', 'EXECUTE') AS desktop,
      has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', '${FN}', 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', '${FN}', 'EXECUTE') AS service,
      has_function_privilege('aka_agent_chat_api', '${FN}', 'EXECUTE') AS chat`)).rows[0]
    assert.deepEqual(perms, { desktop: true, anon: false, authenticated: false, service: false, chat: false })
    const attrs = (await q(`SELECT prosecdef, provolatile, proconfig FROM pg_proc WHERE oid = '${FN}'::regprocedure`)).rows[0]
    assert.deepEqual(attrs, { prosecdef: true, provolatile: 's', proconfig: ['search_path=pg_catalog, public, private'] })
    pass('quyền và thuộc tính hàm giữ nguyên (chỉ aka_agent_desktop gọi, SECURITY DEFINER, STABLE, search_path)')

    assert.deepEqual(await all(), { 10: true, 20: true, 23: false, 24: true, 25: false, 26: false, 27: true })
    pass('sau V529: chỉ tổ chức 24 đổi sang Fly; gói hết hạn, thiếu quyền Server, không cờ vẫn App Server')

    await q('UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = 24')
    assert.equal(await asDesktop(240), false, 'tắt cờ, không có dòng to_fly')
    await q('UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 24')
    await q(`UPDATE private.auto_zalo_server_session_handoff SET direction = 'to_vps' WHERE account_id = 2700`)
    assert.equal(await asDesktop(270), false, 'không cờ, dòng đã trả về VPS')
    await q(`UPDATE private.auto_zalo_server_session_handoff SET direction = 'to_fly' WHERE account_id = 2700`)
    assert.equal(await asDesktop(240, '00000000-0000-0000-0000-000000000999'), false, 'JWT không ánh xạ nhân viên')
    assert.equal(await val(`SELECT ${FN}`), false, 'không có phiên Desktop')
    pass('tắt cờ hoặc dòng đã trả về VPS thì về App Server; không có phiên Desktop thì false')

    await rejected(APPLY, /khác bản V498/)
    pass('apply lần hai bị chặn (thân hàm đã khác V498)')

    await q(ROLLBACK)
    assert.equal(await fnMd5(), LIVE_V498_MD5)
    assert.equal(await asDesktop(240), false)
    await q(APPLY)
    assert.equal(await asDesktop(240), true)
    pass('gỡ trả đúng thân V498 (md5 bản live), rồi apply lại')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
