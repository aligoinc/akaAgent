// Kiểm V498 (Desktop biết tài khoản Zalo Server của tổ chức mình đang chạy trên Fly) trên PostgreSQL 17 cục bộ.
// Dựng đúng fixture của V497 (hàm live nguyên văn, apply V497), thêm hai hàm phiên Desktop nguyên văn bản live
// (scripts/fixtures/zalo-server-flag-route/desktop-scope-functions-20261111.json), rồi apply V498. Không chạm DB thật.
// Chạy: node scripts/test-v498-zalo-server-on-fly-desktop.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v497 = require('./test-v497-zalo-server-flag-route.cjs')

const ROOT = path.resolve(__dirname, '..')
const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v498_zalo_server_on_fly_desktop.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v498_zalo_server_on_fly_desktop.sql'), 'utf8')
const SCOPE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/zalo-server-flag-route/desktop-scope-functions-20261111.json'), 'utf8'))
const FN = 'public.aka_agent_zalo_server_on_fly_v1()'
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

// Nhân viên Desktop: 100 thuộc tổ chức 10 (có Chat), 200 thuộc 20 (cờ + Server), 240 thuộc 24 (cờ + Server), 230 thuộc 23 (không cờ).
const USERS = { 100: '00000000-0000-0000-0000-000000000100', 200: '00000000-0000-0000-0000-000000000200',
  230: '00000000-0000-0000-0000-000000000230', 240: '00000000-0000-0000-0000-000000000240' }

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V498_TEST_PORT || 55498), label: 'aka-v498-' })
  const db = await connect()
  const q = (text, args = []) => db.query(text, args)
  const val = async (text, args = []) => Object.values((await q(text, args)).rows[0] || {})[0]
  // Gọi như PostgREST với JWT Desktop: SET ROLE aka_agent_desktop + request.jwt.claims (role, sub).
  const asDesktop = async (staffId, sub = USERS[staffId]) => {
    await q('BEGIN')
    try {
      await q(`SET LOCAL ROLE aka_agent_desktop`)
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'aka_agent_desktop', sub })])
      return (await q(`SELECT ${FN} AS on_fly`)).rows[0].on_fly
    } finally { await q('ROLLBACK') }
  }
  const asRole = async role => {
    await q('BEGIN')
    try {
      await q(`SET LOCAL ROLE ${role}`)
      return (await q(`SELECT ${FN} AS on_fly`)).rows[0].on_fly
    } finally { await q('ROLLBACK') }
  }
  const rejected = async (text, pattern) => {
    await assert.rejects(q(text), pattern)
    await q('ROLLBACK').catch(() => {})
  }
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
        (10, 'Có Chat', false), (20, 'Cờ + Server', true), (23, 'Không cờ', false), (24, 'Cờ + Server, chưa nhận', true);
      INSERT INTO public.org_organization_product (organization_id, product_id, is_chat_sync, expiration_date) VALUES
        (10, 16, true, now() + interval '30 days'), (20, 16, false, now() + interval '30 days'),
        (23, 16, false, now() + interval '30 days'), (24, 16, false, now() + interval '30 days');
      INSERT INTO public.test_caps VALUES (10, true, true), (20, true, true), (23, true, true), (24, true, true);
    `)
    await q(v497.APPLY)
    // Phiên Desktop như production: bảng ánh xạ auth user → nhân viên, hai hàm private nguyên văn bản live.
    await q(`
      ALTER TABLE public.org_staff ADD COLUMN is_admin_akabiz boolean NOT NULL DEFAULT false,
        ADD COLUMN is_active boolean NOT NULL DEFAULT true, ADD COLUMN deleted_at timestamptz;
      INSERT INTO public.org_staff (id, organization_id) VALUES (100, 10), (200, 20), (230, 23), (240, 24);
      CREATE TABLE private.aka_agent_desktop_users (auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);
      INSERT INTO private.aka_agent_desktop_users VALUES
        ('${USERS[100]}', 100), ('${USERS[200]}', 200), ('${USERS[230]}', 230), ('${USERS[240]}', 240);
    `)
    // Hàm SQL kiểm thân lúc tạo: tạo hàm phạm vi nhân viên trước hàm ngữ cảnh gọi nó.
    const scopeOrder = ['private.aka_agent_staff_scope_for_request()', 'private.aka_agent_desktop_data_context()']
    for (const [sig, fn] of scopeOrder.map(sig => [sig, SCOPE.functions[sig]])) {
      await q(fn.definition.trimEnd() + ';')
      await q(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${sig} TO aka_agent_desktop`)
      assert.equal(await val(`SELECT md5(pg_get_functiondef('${sig}'::regprocedure))`), fn.md5)
    }
    pass('fixture V497 + hai hàm phiên Desktop nguyên văn bản live (md5 khớp production)')

    await q(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261111000000', 'migration_v498_zalo_server_on_fly_desktop')`)
    await rejected(APPLY, /V498 đã có trong sổ migration/)
    await q(`DELETE FROM supabase_migrations.schema_migrations WHERE name = 'migration_v498_zalo_server_on_fly_desktop'`)
    pass('preflight: sổ migration đã có V498 thì không chạy')

    await q(APPLY)
    const perms = (await q(`SELECT
      has_function_privilege('aka_agent_desktop', '${FN}', 'EXECUTE') AS desktop,
      has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', '${FN}', 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', '${FN}', 'EXECUTE') AS service,
      has_function_privilege('aka_agent_chat_api', '${FN}', 'EXECUTE') AS chat`)).rows[0]
    assert.deepEqual(perms, { desktop: true, anon: false, authenticated: false, service: false, chat: false })
    pass('quyền: chỉ aka_agent_desktop gọi được hàm mới')

    assert.equal(await asDesktop(100), true, 'tổ chức có Chat chạy Server trên Fly')
    assert.equal(await asDesktop(200), false, 'bật cờ nhưng ChatApi chưa nhận (chưa có dòng to_fly)')
    assert.equal(await asDesktop(230), false, 'không cờ, không Chat')
    pass('trước khi ChatApi nhận: chỉ tổ chức có Chat là đang chạy trên Fly')

    await q(`INSERT INTO private.auto_zalo_server_session_handoff (account_id, organization_id, staff_id, direction)
      VALUES (2000, 20, 200, 'to_fly')`)
    assert.equal(await asDesktop(200), true, 'ChatApi đã nhận tổ chức 20 (dòng to_fly)')
    assert.equal(await asDesktop(240), false, 'tổ chức 24 bật cờ nhưng chưa có dòng to_fly')
    assert.equal(await asDesktop(230), false)
    pass('sau khi ChatApi nhận: đúng tổ chức có dòng to_fly, tổ chức khác không đổi')

    await q(`UPDATE private.auto_zalo_server_session_handoff SET direction = 'to_vps' WHERE account_id = 2000`)
    assert.equal(await asDesktop(200), false)
    pass('tắt cờ (ChatApi trả phiên, dòng thành to_vps): hàm trả false')

    assert.equal(await asDesktop(200, '00000000-0000-0000-0000-000000000999'), false, 'JWT không ánh xạ nhân viên')
    await q(`INSERT INTO private.auto_zalo_server_session_handoff (account_id, organization_id, staff_id, direction)
      VALUES (2001, 20, 200, 'to_fly') ON CONFLICT (account_id) DO NOTHING`)
    await q(`UPDATE public.org_staff SET is_active = false WHERE id = 200`)
    assert.equal(await asDesktop(200), true, 'hàm theo tổ chức của phiên, như các hàm Desktop khác (ngữ cảnh không lọc is_active)')
    await q(`UPDATE public.org_staff SET is_active = true WHERE id = 200`)
    assert.equal(await val(`SELECT ${FN}`), false, 'không có phiên Desktop (role khác) thì false')
    pass('không có phiên Desktop hoặc JWT lạ: false; không nhận tham số tổ chức nên không hỏi được tổ chức khác')

    await rejected(APPLY, /V498 đã có|đã có/)
    pass('apply lần hai bị chặn')

    await q(ROLLBACK)
    assert.equal(await val(`SELECT to_regprocedure('${FN}') IS NULL`), true)
    await q(APPLY)
    assert.equal(await asDesktop(200), true)
    pass('gỡ rồi apply lại')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
