// V674: chiến dịch qua ngày kết thúc thì dừng hẳn, đóng data còn "chờ xử lý". Kiểm trên PostgreSQL 17 cục bộ dùng một lần:
// bảng tối thiểu + đúng thân production 27/11/2026 của 2 hàm kết thúc và các hàm phụ (scripts/fixtures/campaign-end-date/), rồi
// apply / gỡ / apply lại V674. Mỗi ca chạy cả bản cũ lẫn bản mới để thấy khác biệt. Không mạng, không dữ liệu khách.
// Chạy: CHAT_REPO=<thư mục có module pg> LC_ALL=C node scripts/campaign-end-date-v674-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const V674 = require('./build-v674-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/campaign-end-date/v674-live-20261127.json'), 'utf8'))
const PORT = Number(process.env.V674_TEST_PORT || 55674)
const END_NOTE = 'Chiến dịch đã hết ngày kết thúc'
const DESKTOP = V674.FUNCS.find(f => f.key === 'desktop')
const SERVER = V674.FUNCS.find(f => f.key === 'server')

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v674-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const defMd5 = sig => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [sig])
  try {
    await db.query(`
      CREATE ROLE service_role NOLOGIN; CREATE ROLE aka_agent_chat_api NOLOGIN; CREATE ROLE aka_agent_desktop NOLOGIN;
      CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
      -- Không có phiên Desktop (NULL) như khi gọi bằng service_role.
      CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql AS $$ SELECT NULL::bigint $$;
      CREATE TABLE public.org_staff(id bigint PRIMARY KEY, organization_id bigint, is_active boolean, username text, password text);
      CREATE TABLE public.auto_accounts(id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, flatform_type text,
        is_zalo_show_web boolean, is_zalo_server boolean, is_delete boolean DEFAULT false);
      CREATE TABLE public.auto_campaigns(id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, account_id bigint, action_id text,
        status text, note text, completed_at timestamptz, updated_at timestamptz, schedule timestamptz, original_schedule timestamptz,
        schedule_type text, schedule_days text, schedule_week_days text, schedule_end_date timestamptz, data_target_source_mode text,
        is_delete boolean DEFAULT false, runtime_claim_token uuid, runtime_unit_token uuid);
      CREATE TABLE public.auto_engine_target_runs(id bigserial PRIMARY KEY, campaign_id bigint, started_at timestamptz DEFAULT now(), completed_at timestamptz);
      CREATE TABLE public.auto_campaign_input_data(id bigint PRIMARY KEY, campaign_id bigint, status text, note text, is_delete boolean DEFAULT false);
      -- Kiểm quyền Zalo Server runtime: bản thật đọc gói và revision; ca kiểm chỉ cần nó cho qua.
      CREATE FUNCTION public.aka_agent_internal_require_zalo_server_runtime(bigint, bigint, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    `)
    for (const def of Object.values(FIXTURE.helpers)) await db.query(def)
    for (const f of V674.FUNCS) await db.query(f.live)
    await db.query(`
      REVOKE ALL ON FUNCTION ${DESKTOP.sig} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${DESKTOP.sig} TO service_role, aka_agent_desktop;
      REVOKE ALL ON FUNCTION ${SERVER.sig} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${SERVER.sig} TO service_role, aka_agent_chat_api, aka_agent_desktop;
      SET request.jwt.claims = '{"role":"service_role"}';`)
    assert.equal(await defMd5(DESKTOP.sig), DESKTOP.liveMd5, 'fixture desktop = production')
    assert.equal(await defMd5(SERVER.sig), SERVER.liveMd5, 'fixture server = production')
    pass('fixture: pg_get_functiondef cục bộ trùng md5 production cho cả 2 hàm')

    // ---- Dữ liệu ----------------------------------------------------------------------------------------------------------
    let nextId = 674000
    const ORG = 2172, STAFF = 2398
    await db.query(`INSERT INTO public.org_staff VALUES ($1, $2, true, 'u', 'p')`, [STAFF, ORG])
    // Hôm qua / hôm nay theo giờ VN. Lịch tuần mọi ngày (2..8) để ngày chạy kế luôn là hôm nay.
    const vn = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`
    const at = (dayExpr, hm) => `((${dayExpr}) + time '${hm}') AT TIME ZONE 'Asia/Ho_Chi_Minh'`
    const make = async ({ server = false, end = `${at(`${vn} - 1`, '23:59:59')}`, schedule = at(`${vn} - 1`, '08:00:00'),
      status = 'chờ xử lý', mode = 'direct', type = 'weekly', weekDays = '2,3,4,5,6,7,8', inputs = ['chờ xử lý', 'chờ xử lý', 'hoàn thành', 'tạm dừng'], deletedPending = 1 } = {}) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts VALUES ($1, $2, $3, 'zalo', $4, $5, false)`, [account, STAFF, ORG, !server, server])
      await db.query(`INSERT INTO public.auto_campaigns(id, staff_id, organization_id, account_id, action_id, status, note, schedule, original_schedule,
          schedule_type, schedule_week_days, schedule_end_date, data_target_source_mode, is_delete)
        VALUES ($1, $2, $3, $4, 'zalo_message_phone', $5, 'ghi chú cũ', ${schedule}, ${schedule}, $6, $7, ${end ?? 'NULL'}, $8, false)`,
        [campaign, STAFF, ORG, account, status, type, weekDays, mode])
      for (const s of inputs) await db.query(`INSERT INTO public.auto_campaign_input_data VALUES ($1, $2, $3, NULL, false)`, [++nextId, campaign, s])
      for (let i = 0; i < deletedPending; i++) await db.query(`INSERT INTO public.auto_campaign_input_data VALUES ($1, $2, 'chờ xử lý', NULL, true)`, [++nextId, campaign])
      return campaign
    }
    const state = async id => ({
      campaign: (await db.query(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [id])).rows[0],
      inputs: (await db.query(`SELECT status, note, is_delete FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [id])).rows
    })
    const desktop = (id, note, expected) => db.query(`SELECT * FROM public.aka_agent_finalize_campaign($1, $2, $3, $4, $5, $6, NULL, NULL)`,
      [STAFF, ORG, id, note, note !== null, expected]).then(r => r.rows[0])
    const server = id => db.query(`SELECT * FROM public.aka_agent_finalize_zalo_server_maintenance_campaign($1, $2, 'rev', $3, $4, true)`,
      [STAFF, ORG, id, END_NOTE]).then(r => r.rows[0])

    // Mỗi ca: chạy trên bản đang cài (cũ hoặc mới) với dữ liệu mới tạo; trả kết quả + trạng thái.
    const cases = {
      // 1. Bảo trì Desktop: ngày chạy kế quá ngày kết thúc (hôm qua), còn 2 data chờ.
      maintDesktop: async () => { const id = await make(); return { r: await desktop(id, END_NOTE, 'chờ xử lý'), s: await state(id) } },
      // 2. Bảo trì Desktop: ngày kết thúc là hôm nay (rơi vào ngày không chạy), giờ DB chưa qua.
      maintDesktopEndToday: async () => { const id = await make({ end: at(vn, '23:59:59') }); return { r: await desktop(id, END_NOTE, 'chờ xử lý'), s: await state(id) } },
      // 3. Hoàn thành thường của bộ cũ (chưa tới ngày kết thúc), data mới vừa thêm: giữ chặn race như V214.
      normalRace: async () => { const id = await make({ end: at(`${vn} + 3`, '23:59:59'), status: 'đang chạy' }); return { r: await desktop(id, null, 'đang chạy'), s: await state(id) } },
      // 4. Không đặt ngày kết thúc.
      noEnd: async () => { const id = await make({ end: null, status: 'đang chạy' }); return { r: await desktop(id, null, 'đang chạy'), s: await state(id) } },
      // 5. Bộ cũ chạy hết data sau ngày kết thúc (handleCampaignCompletion nhánh "hết ngày kết thúc"), race data mới.
      completionPastEnd: async () => { const id = await make({ status: 'đang chạy' }); return { r: await desktop(id, null, 'đang chạy'), s: await state(id) } },
      // 6. Nhóm data: hàm riêng, không đụng.
      dataGroup: async () => { const id = await make({ mode: 'data_group' }); return { r: await desktop(id, END_NOTE, 'chờ xử lý'), s: await state(id) } },
      // 7. Ghi chú kết thúc nhưng không có ngày kết thúc (không ai gọi vậy; vẫn không đóng).
      noteWithoutEnd: async () => { const id = await make({ end: null }); return { r: await desktop(id, END_NOTE, 'chờ xử lý'), s: await state(id) } },
      // 8. Bảo trì Zalo Server (App Server VPS / Fly): ngày chạy kế quá ngày kết thúc.
      maintServer: async () => { const id = await make({ server: true }); return { r: await server(id), s: await state(id) } },
      // 9. Bảo trì Zalo Server: ngày kết thúc còn xa, không phải ca kết thúc.
      serverNotEnded: async () => { const id = await make({ server: true, end: at(`${vn} + 5`, '23:59:59') }); return { r: await server(id), s: await state(id) } },
      // 10. Bảo trì Zalo Server: chiến dịch đã "hoàn thành" (khách đánh) mà còn data chờ.
      serverCompleted: async () => { const id = await make({ server: true, status: 'hoàn thành' }); return { r: await server(id), s: await state(id) } }
    }
    const run = async () => { const out = {}; for (const [k, fn] of Object.entries(cases)) out[k] = await fn(); return out }

    const before = await run()
    // Bản cũ: tái hiện lỗi (còn data thì chiến dịch giữ "chờ xử lý").
    assert.equal(before.maintDesktop.r.reason, 'pending_input_remaining')
    assert.equal(before.maintDesktop.s.campaign.status, 'chờ xử lý')
    assert.equal(before.maintServer.r.reason, 'pending_input_remaining')
    pass('bản cũ: bảo trì Desktop và Zalo Server đều giữ chiến dịch "chờ xử lý" khi còn data (lỗi tái hiện)')

    // ---- Apply V674 ---------------------------------------------------------------------------------------------------------
    await db.query(V674.migration)
    assert.equal(await defMd5(DESKTOP.sig), DESKTOP.nextMd5)
    assert.equal(await defMd5(SERVER.sig), SERVER.nextMd5)
    pass('apply V674: postflight đạt, md5 hai hàm đúng bản mới')
    await assert.rejects(db.query(V674.migration), /V674 đã chạy/)
    await db.query('ROLLBACK')
    pass('apply lại: preflight từ chối')
    const aclOf = sig => val(`SELECT coalesce(p.proacl::text,'') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text,'') || '|' || p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig])
    assert.match(await aclOf(SERVER.sig), /aka_agent_chat_api=X/)
    assert.doesNotMatch(await aclOf(DESKTOP.sig), /=X\/postgres,=X|^=X/)
    pass('quyền / cấu hình hai hàm giữ nguyên')

    const after = await run()
    const strip = o => JSON.parse(JSON.stringify(o, (k, v) => k === 'campaign_id' ? undefined : v))
    const same = (a, b, label) => assert.deepEqual(strip(a), strip(b), label)
    const closed = inputs => inputs.filter(i => !i.is_delete && i.note === V674.INPUT_NOTE).length
    const pendingLeft = inputs => inputs.filter(i => !i.is_delete && i.status === 'chờ xử lý').length
    const untouched = (s, label) => {
      assert.equal(closed(s.inputs), 0, `${label}: không đóng data`)
      assert.deepEqual(s.inputs.filter(i => i.is_delete).map(i => i.status), ['chờ xử lý'], `${label}: data đã xoá giữ nguyên`)
    }

    // 1
    assert.equal(after.maintDesktop.r.reason, 'completed'); assert.equal(after.maintDesktop.r.completed, true)
    assert.deepEqual(after.maintDesktop.s.campaign, { status: 'hoàn thành', note: END_NOTE })
    assert.equal(closed(after.maintDesktop.s.inputs), 2); assert.equal(pendingLeft(after.maintDesktop.s.inputs), 0)
    assert.deepEqual(after.maintDesktop.s.inputs.map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'tạm dừng', 'chờ xử lý'])
    assert.equal(after.maintDesktop.s.inputs[2].note, null, 'data đã chạy giữ ghi chú cũ')
    pass('1. bảo trì Desktop qua ngày kết thúc: đóng 2 data chờ, giữ data đã chạy / tạm dừng / đã xoá, chiến dịch hoàn thành')
    // 2
    assert.equal(after.maintDesktopEndToday.r.reason, 'completed'); assert.equal(closed(after.maintDesktopEndToday.s.inputs), 2)
    pass('2. bảo trì Desktop, ngày kết thúc rơi vào ngày không chạy (giờ DB chưa qua): vẫn dừng hẳn')
    // 3
    same(after.normalRace, before.normalRace, '3')
    assert.equal(after.normalRace.r.reason, 'pending_input_remaining'); untouched(after.normalRace.s, '3')
    pass('3. hoàn thành thường trước ngày kết thúc: giữ chặn race V214, như bản cũ')
    // 4
    same(after.noEnd, before.noEnd, '4'); untouched(after.noEnd.s, '4')
    pass('4. không có ngày kết thúc: như bản cũ')
    // 5
    assert.equal(before.completionPastEnd.r.reason, 'pending_input_remaining')
    assert.equal(after.completionPastEnd.r.reason, 'completed'); assert.equal(closed(after.completionPastEnd.s.inputs), 2)
    pass('5. bộ cũ chạy hết data sau ngày kết thúc, có data mới chen: đóng và hoàn thành')
    // 6
    same(after.dataGroup, before.dataGroup, '6'); assert.equal(after.dataGroup.r.reason, 'specialized_finalizer_required'); untouched(after.dataGroup.s, '6')
    pass('6. Nhóm data: không đụng, như bản cũ')
    // 7
    same(after.noteWithoutEnd, before.noteWithoutEnd, '7'); untouched(after.noteWithoutEnd.s, '7')
    pass('7. ghi chú kết thúc mà không có ngày kết thúc: không đóng')
    // 8
    assert.equal(after.maintServer.r.reason, 'completed')
    assert.deepEqual(after.maintServer.s.campaign, { status: 'hoàn thành', note: END_NOTE })
    assert.equal(closed(after.maintServer.s.inputs), 2); assert.equal(pendingLeft(after.maintServer.s.inputs), 0)
    pass('8. bảo trì Zalo Server qua ngày kết thúc: đóng data chờ, chiến dịch hoàn thành')
    // 9
    same(after.serverNotEnded, before.serverNotEnded, '9'); assert.equal(after.serverNotEnded.r.reason, 'not_found'); untouched(after.serverNotEnded.s, '9')
    pass('9. Zalo Server chưa tới ngày kết thúc: như bản cũ (không phải ca kết thúc)')
    // 10
    assert.equal(before.serverCompleted.s.campaign.status, 'chờ xử lý', 'bản cũ mở lại chiến dịch đã hoàn thành')
    assert.equal(after.serverCompleted.r.completed, true); assert.equal(after.serverCompleted.s.campaign.status, 'hoàn thành')
    assert.equal(closed(after.serverCompleted.s.inputs), 2)
    pass('10. Zalo Server chiến dịch đã hoàn thành còn data chờ: không mở lại, đóng data')

    // ---- Gỡ rồi apply lại ---------------------------------------------------------------------------------------------------
    await db.query(V674.rollback)
    assert.equal(await defMd5(DESKTOP.sig), DESKTOP.liveMd5); assert.equal(await defMd5(SERVER.sig), SERVER.liveMd5)
    const again = await cases.maintDesktop()
    assert.equal(again.r.reason, 'pending_input_remaining')
    pass('gỡ V674: hai hàm về bản production, hành vi cũ trở lại')
    await assert.rejects(db.query(V674.rollback), /đã là bản trước V674/)
    await db.query('ROLLBACK')
    pass('gỡ lần hai: từ chối')
    await db.query(V674.migration)
    assert.equal(await defMd5(DESKTOP.sig), DESKTOP.nextMd5)
    pass('apply lại sau khi gỡ: đạt')

    // ---- Khoá: hai giao dịch đồng thời (bảo trì Desktop + thêm data kiểu producer) không khoá chéo -------------------------
    const id = await make()
    const db2 = await connect()
    await db2.query(`SET request.jwt.claims = '{"role":"service_role"}'`)
    await db2.query('BEGIN')
    await db2.query(`SELECT public.aka_agent_lock_campaign_input_serialization($1)`, [id])
    await db2.query(`SELECT id FROM public.auto_campaigns WHERE id = $1 FOR UPDATE`, [id])
    const finishing = desktop(id, END_NOTE, 'chờ xử lý')
    await new Promise(r => setTimeout(r, 300))
    await db2.query(`INSERT INTO public.auto_campaign_input_data VALUES ($1, $2, 'chờ xử lý', NULL, false)`, [++nextId, id])
    await db2.query('COMMIT')
    const raced = await finishing
    assert.equal(raced.reason, 'completed')
    assert.equal(pendingLeft((await state(id)).inputs), 0, 'data producer thêm trước đó cũng được đóng')
    await db2.end()
    pass('khoá: producer giữ khoá tuần tự + chiến dịch, hàm kết thúc chờ rồi đóng cả data vừa thêm, không khoá chéo')

    // ---- Dọn chiến dịch đang quá ngày kết thúc (chạy sau V674) -------------------------------------------------------------
    const due = await make()                                   // dọn
    const claimed = await make()                               // còn giữ lượt bộ cũ: bỏ qua
    await db.query(`UPDATE public.auto_campaigns SET runtime_unit_token = gen_random_uuid() WHERE id = $1`, [claimed])
    const engineOpen = await make()                            // có lượt engine đang mở: bỏ qua
    await db.query(`INSERT INTO public.auto_engine_target_runs(campaign_id) VALUES ($1)`, [engineOpen])
    const paused = await make({ status: 'tạm dừng' })           // khách tạm dừng: bỏ qua
    const future = await make({ end: at(`${vn} + 2`, '23:59:59') }) // chưa tới ngày kết thúc: bỏ qua
    const cleanup = fs.readFileSync(path.join(ROOT, 'scripts/campaign-end-date/cleanup-overdue-v674.sql'), 'utf8')
    const results = await db.query(cleanup)
    const receipt = [].concat(results).map(r => r.rows?.[0]?.receipt).find(Boolean)
    assert.ok(receipt, 'có biên nhận')
    assert.ok(receipt.ids.includes(Number(due)), 'chiến dịch quá hạn được dọn')
    for (const skip of [claimed, engineOpen, paused, future]) assert.ok(!receipt.ids.includes(Number(skip)), `bỏ qua ${skip}`)
    assert.equal(receipt.errors, null)
    assert.equal((await state(due)).campaign.status, 'hoàn thành'); assert.equal(pendingLeft((await state(due)).inputs), 0)
    for (const skip of [claimed, engineOpen, paused, future]) assert.equal(pendingLeft((await state(skip)).inputs), 2, `giữ data ${skip}`)
    pass(`dọn chiến dịch quá hạn: ${receipt.completed} chiến dịch hoàn thành, bỏ qua chiến dịch giữ lượt / engine đang mở / tạm dừng / chưa hết hạn`)

    console.log(`\n${checks} PASS`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
