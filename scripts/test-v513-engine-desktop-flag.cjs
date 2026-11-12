// Kiểm V513 (Desktop đọc cờ engine v2 use_new_zalo_runtime của tổ chức mình) trên PostgreSQL 17 cục bộ.
// Dựng bảng của fixture V497, thêm hai hàm phiên Desktop nguyên văn bản live
// (scripts/fixtures/zalo-server-flag-route/desktop-scope-functions-20261111.json), rồi apply V513. Không chạm DB thật.
// Chạy: node scripts/test-v513-engine-desktop-flag.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v497 = require('./test-v497-zalo-server-flag-route.cjs')

const ROOT = path.resolve(__dirname, '..')
const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v513_engine_desktop_flag.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v513_engine_desktop_flag.sql'), 'utf8')
const SCOPE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/zalo-server-flag-route/desktop-scope-functions-20261111.json'), 'utf8'))
const FN = 'public.aka_agent_engine_desktop_enabled_v1()'
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

// Nhân viên Desktop: 100 thuộc tổ chức 10 (không cờ), 200 thuộc 20 (bật cờ), 230 thuộc 23 (không cờ), 240 thuộc 24 (bật cờ).
const USERS = { 100: '00000000-0000-0000-0000-000000000100', 200: '00000000-0000-0000-0000-000000000200',
  230: '00000000-0000-0000-0000-000000000230', 240: '00000000-0000-0000-0000-000000000240' }

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V513_TEST_PORT || 55513), label: 'aka-v513-' })
  const db = await connect()
  const q = (text, args = []) => db.query(text, args)
  const val = async (text, args = []) => Object.values((await q(text, args)).rows[0] || {})[0]
  // Gọi như PostgREST với JWT Desktop: SET ROLE aka_agent_desktop + request.jwt.claims (role, sub).
  const asDesktop = async (staffId, sub = USERS[staffId]) => {
    await q('BEGIN')
    try {
      await q(`SET LOCAL ROLE aka_agent_desktop`)
      await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'aka_agent_desktop', sub })])
      return (await q(`SELECT ${FN} AS enabled`)).rows[0].enabled
    } finally { await q('ROLLBACK') }
  }
  const asRole = async role => {
    await q('BEGIN')
    try {
      await q(`SET LOCAL ROLE ${role}`)
      return (await q(`SELECT ${FN} AS enabled`)).rows[0].enabled
    } finally { await q('ROLLBACK') }
  }
  const rejected = async (text, pattern) => {
    await assert.rejects(q(text), pattern)
    await q('ROLLBACK').catch(() => {})
  }
  try {
    await q(v497.FIXTURE)
    await q(`
      INSERT INTO public.org_organization (id, name, use_new_zalo_runtime) VALUES
        (10, 'Không cờ', false), (20, 'Bật cờ', true), (23, 'Không cờ 2', false), (24, 'Bật cờ 2', true);
      ALTER TABLE public.org_staff ADD COLUMN is_admin_akabiz boolean NOT NULL DEFAULT false,
        ADD COLUMN is_active boolean NOT NULL DEFAULT true, ADD COLUMN deleted_at timestamptz;
      INSERT INTO public.org_staff (id, organization_id) VALUES (100, 10), (200, 20), (230, 23), (240, 24);
      CREATE TABLE private.aka_agent_desktop_users (auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);
      INSERT INTO private.aka_agent_desktop_users VALUES
        ('${USERS[100]}', 100), ('${USERS[200]}', 200), ('${USERS[230]}', 230), ('${USERS[240]}', 240);
    `)
    // Hàm SQL kiểm thân lúc tạo: tạo hàm phạm vi nhân viên trước hàm ngữ cảnh gọi nó.
    for (const sig of ['private.aka_agent_staff_scope_for_request()', 'private.aka_agent_desktop_data_context()']) {
      const fn = SCOPE.functions[sig]
      await q(fn.definition.trimEnd() + ';')
      await q(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${sig} TO aka_agent_desktop`)
      assert.equal(await val(`SELECT md5(pg_get_functiondef('${sig}'::regprocedure))`), fn.md5)
    }
    pass('fixture: bảng tổ chức có cờ, hai hàm phiên Desktop nguyên văn bản live (md5 khớp production)')

    await q(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261112000000', 'migration_v513_engine_desktop_flag')`)
    await rejected(APPLY, /V513 đã có trong sổ migration/)
    await q(`DELETE FROM supabase_migrations.schema_migrations WHERE name = 'migration_v513_engine_desktop_flag'`)
    await q(`ALTER TABLE public.org_organization RENAME COLUMN use_new_zalo_runtime TO use_new_zalo_runtime_x`)
    await rejected(APPLY, /thiếu cột boolean public.org_organization.use_new_zalo_runtime/)
    await q(`ALTER TABLE public.org_organization RENAME COLUMN use_new_zalo_runtime_x TO use_new_zalo_runtime`)
    pass('preflight: sổ đã có V513 hoặc thiếu cột cờ thì không chạy')

    await q(APPLY.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await val(`SELECT to_regprocedure('${FN}') IS NULL`), true)
    await q(APPLY)
    const perms = (await q(`SELECT
      has_function_privilege('aka_agent_desktop', '${FN}', 'EXECUTE') AS desktop,
      has_function_privilege('anon', '${FN}', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', '${FN}', 'EXECUTE') AS authenticated,
      has_function_privilege('service_role', '${FN}', 'EXECUTE') AS service,
      has_function_privilege('aka_agent_chat_api', '${FN}', 'EXECUTE') AS chat`)).rows[0]
    assert.deepEqual(perms, { desktop: true, anon: false, authenticated: false, service: false, chat: false })
    await assert.rejects(asRole('anon'), /permission denied/)
    await assert.rejects(asRole('service_role'), /permission denied/)
    pass('apply trong giao dịch rồi ROLLBACK không để lại gì; quyền: chỉ aka_agent_desktop gọi được hàm')

    assert.equal(await asDesktop(200), true, 'tổ chức 20 bật cờ')
    assert.equal(await asDesktop(240), true, 'tổ chức 24 bật cờ')
    assert.equal(await asDesktop(100), false, 'tổ chức 10 không cờ')
    assert.equal(await asDesktop(230), false, 'tổ chức 23 không cờ')
    pass('trả đúng cờ của tổ chức trong phiên Desktop')

    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = false WHERE id = 20`)
    assert.equal(await asDesktop(200), false)
    assert.equal(await asDesktop(240), true, 'tổ chức khác không đổi')
    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 20`)
    assert.equal(await asDesktop(200), true)
    await q(`ALTER TABLE public.org_organization ALTER COLUMN use_new_zalo_runtime DROP NOT NULL`)
    await q(`UPDATE public.org_organization SET use_new_zalo_runtime = NULL WHERE id = 24`)
    assert.equal(await asDesktop(240), false, 'cờ NULL coi như tắt')
    pass('đọc cờ hiện tại mỗi lần gọi (tắt / bật lại có hiệu lực ở lần đọc sau); cờ NULL là tắt')

    assert.equal(await asDesktop(200, '00000000-0000-0000-0000-000000000999'), false, 'JWT không ánh xạ nhân viên')
    assert.equal(await val(`SELECT ${FN}`), false, 'không có phiên Desktop (role khác) thì false')
    pass('không có phiên Desktop hoặc JWT lạ: false; không nhận tham số tổ chức nên không hỏi được tổ chức khác')

    await rejected(APPLY, /V513: public.aka_agent_engine_desktop_enabled_v1\(\) đã có/)
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
