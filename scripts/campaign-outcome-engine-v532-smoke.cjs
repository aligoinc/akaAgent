// V532: hai lỗi engine v2 tìm ra khi kiểm sức khoẻ 14/11/2026 13:35 VN.
// PostgreSQL 17 cục bộ có đủ chuỗi V495 → … → V507 → V515 → V517 → V527 như production 14/11/2026 (pg_cron giả cho V517).
//   1. File = bản sinh; thân / định nghĩa report_v1 và claim_target_v1 trên cụm thử đúng md5 production.
//   2. Trước V532 (tái hiện): lỗi NET01 / lỗi code ở bước phụ gắn tag / đổi tên tạm dừng chiến dịch ngay; câu chọn data của claim theo
//      kế hoạch riêng quét khoá chính khi data của chiến dịch nằm cuối bảng.
//   3. Preflight fail-closed (sổ đã có, thân lạ từng hàm, định nghĩa lạ, quyền rộng ở hậu kiểm); apply thử rồi ROLLBACK không đổi gì;
//      apply thật qua file bọc sổ migration; chạy lại bị chặn.
//   4. Sau V532: lỗi có ngưỡng ở bước phụ không tạm dừng chiến dịch (vẫn khoá thao tác, dừng lượt, không cộng chuỗi); 4 data liền lỗi
//      code ở bước chính vẫn tạm dừng đúng ngưỡng; mã không ngưỡng (Z223) vẫn tạm dừng ngay; claim không còn quét khoá chính, vẫn lấy
//      data id nhỏ nhất đến hạn, bỏ data hẹn sau và data đang bị khoá.
//   5. Gỡ V532 trả hai thân cũ (lại tạm dừng ngay); gỡ lần hai bị chặn; apply lại được sau khi bỏ dòng sổ.
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v532-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v504 = require('./build-v504-sql.cjs')
const v505 = require('./build-v505-sql.cjs')
const v506 = require('./build-v506-sql.cjs')
const v507 = require('./build-v507-sql.cjs')
const v515 = require('./build-v515-sql.cjs')
const v517 = require('./build-v517-sql.cjs')
const v527 = require('./build-v527-sql.cjs')
const v532 = require('./build-v532-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V532_TEST_PORT || 55532)
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v532-' })
  const db = await connect()
  const db2 = await connect()
  try {
    const migrationFile = fs.readFileSync(path.join(ROOT, `migrations/${v532.NAME}.sql`), 'utf8')
    assert.equal(migrationFile, v532.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v532.ROLLBACK_NAME}.sql`), 'utf8'), v532.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507, v515]) await db.query(m.migration)
    // pg_cron giả như smoke V517 / V527 để chuỗi có V517 như production.
    await db.query(`CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
        ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
      CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;`)
    await db.query(v517.migration)
    await db.query(v527.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const fn = async sig => (await db.query(`SELECT md5(p.prosrc) AS src, md5(pg_get_functiondef(p.oid)) AS def, p.proacl::text AS acl,
      pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef, p.provolatile AS vol, p.proconfig AS config
      FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig])).rows[0]
    const both = async () => ({ report: await fn(v532.SIG.report), claim: await fn(v532.SIG.claim) })
    const rejects = async (sql, pattern, label) => {
      await assert.rejects(db.query(sql), pattern, label)
      await db.query('ROLLBACK')
    }

    // ---- 1. Hai hàm trên cụm thử đúng bản production ----------------------------------------------------------------------------
    const before = await both()
    assert.deepEqual([before.report.src, before.report.def], [v532.LIVE.report, v532.LIVE.reportDef], 'report_v1 = V517 như production')
    assert.deepEqual([before.claim.src, before.claim.def], [v532.LIVE.claim, v532.LIVE.claimDef], 'claim_target_v1 = V527 như production')
    for (const f of [before.report, before.claim]) {
      assert.deepEqual([f.owner, f.secdef, f.vol, f.config], ['postgres', true, 'v', ['search_path=""']])
    }
    for (const sig of Object.values(v532.SIG)) {
      for (const role of ['anon', 'authenticated']) {
        assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, sig]), false, `${role} ${sig}`)
      }
      for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) {
        assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, sig]), true, `${role} ${sig}`)
      }
    }
    pass('cụm thử có thân và định nghĩa report_v1 / claim_target_v1 đúng md5 production, chủ sở hữu / thuộc tính / quyền như production')

    // ---- Dựng tổ chức, tài khoản, chiến dịch, bộ gọi RPC -------------------------------------------------------------------------
    let nextId = 953200
    const STAFF = 9532, ORG = 532
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org V532', true)`, [ORG])
    const EXTRA = JSON.stringify({ enableMessage: true,
      actionLimits: { byActionCode: { zalo_message_stranger: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } })
    const account = async (server = true) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo V532', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, $4, false)`,
        [id, STAFF, ORG, server])
      return id
    }
    const campaign = async (acc, targets = 1, server = true) => {
      const id = ++nextId, ids = []
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
          extra_settings, images)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'V532', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4,
          'Chào #{FULL_NAME}', $5::jsonb, '[]'::jsonb)`, [id, acc, STAFF, ORG, EXTRA])
      for (let i = 0; i < targets; i++) {
        const d = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [d, id, `0909${String(d).slice(-6)}`])
        ids.push(d)
      }
      return { acc, id, ids, runtime: server ? 'fly' : 'desktop', lease: null }
    }
    const claim = async c => {
      const res = await rpc(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`, [JSON.stringify({
        staffId: STAFF, accountId: c.acc, campaignId: c.id, runnerId: `${c.runtime}:v532`, runtimeTarget: c.runtime, leaseToken: c.lease,
        actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] })])
      if (res.leaseToken) c.lease = res.leaseToken
      return res
    }
    let rkSeq = 0
    const out = (actionCode, extra = {}) => ({ resultKey: `v532:${++rkSeq}:${actionCode}`, actionCode, ok: true, phase: 'after_send', ...extra })
    const report = (cl, outcomes, final = false) => rpc(`SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r`,
      [cl.targetRunId, cl.leaseToken, JSON.stringify(outcomes), final])
    const mark = (cl, action) => rpc(`SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r`, [cl.targetRunId, cl.leaseToken, action, action])
    const campaignRow = id => db.query(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [id]).then(r => r.rows[0])
    const streakOf = async id => Number(await val(`SELECT count_consecutive_bad_targets FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [id]) ?? 0)
    // Một data: tra số OK, nhắn tin OK (đã giao), rồi bước phụ (gắn tag / đổi tên) lỗi.
    const NET01 = { errorCode: 'err_network_offline' }
    const CODE_BUG = { kind: 'exception', message: 'TypeError: x is undefined' }
    const auxFailure = async ({ action = 'zalo_tag_contact', signal = NET01, phase = 'before_send', server = true } = {}) => {
      const c = await campaign(await account(server), 2, server)
      const cl = await claim(c)
      assert.equal(cl.status, 'claimed', JSON.stringify(cl))
      assert.equal((await report(cl, [out('zalo_find_phone_user')])).next, 'next_step')
      assert.equal((await mark(cl, 'zalo_message_stranger')).ok, true)
      assert.equal((await report(cl, [out('zalo_message_stranger')])).next, 'next_step')
      const r = await report(cl, [out(action, { ok: false, phase, signal })], true)
      return { r, c, cl, camp: await campaignRow(c.id), streak: await streakOf(c.id) }
    }
    // Lỗi mã không ngưỡng: Z223 (danh sách lời mời kết bạn đầy) tạm dừng chiến dịch ngay ở bước kết bạn.
    const z223 = async () => {
      const c = await campaign(await account(), 2)
      const cl = await claim(c)
      await report(cl, [out('zalo_find_phone_user')])
      const r = await report(cl, [out('zalo_add_friend', { ok: false, signal: { errorCode: 'err_zalo_223_add_friend_pause' } })], true)
      return { r, camp: await campaignRow(c.id) }
    }

    // Data của một chiến dịch nằm cuối bảng, sau 150.000 dòng "chờ xử lý" của chiến dịch khác (chiến dịch đó tạm dừng, không ai nhận).
    // Planner coi data chờ của chiến dịch rải đều theo id nên kế hoạch riêng của câu chọn data cũ quét khoá chính từ đầu bảng, như
    // chiến dịch 34061 trên production 14/11 (lọc 12,26 triệu dòng).
    const filler = await campaign(await account(), 0)
    await db.query(`UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = $1`, [filler.id])
    const late = await campaign(await account(), 0)
    await db.query(`INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, status, is_delete)
      SELECT $1, 'Lấp', '0908' || lpad(g::text, 6, '0'), 'chờ xử lý', false FROM generate_series(1, 150000) g`, [filler.id])
    await db.query(`INSERT INTO public.auto_campaign_input_data(campaign_id, name, phone, status, is_delete)
      SELECT $1, 'Cuối bảng', '0907' || lpad(g::text, 6, '0'), 'chờ xử lý', false FROM generate_series(1, 4000) g`, [late.id])
    await db.query('ANALYZE public.auto_campaign_input_data')
    // Câu chọn data đúng như trong thân hàm đang cài (biến PL/pgSQL thành tham số như kế hoạch riêng của PL/pgSQL).
    const pickPlan = async (mode, campaignId) => {
      const src = await val(`SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [v532.SIG.claim])
      const m = /SELECT d\.\* INTO t FROM public\.auto_campaign_input_data d[\s\S]*?FOR UPDATE SKIP LOCKED;/.exec(src)
      assert.ok(m, 'thấy câu chọn data trong thân claim')
      const sql = m[0].replace('INTO t ', '').replace(/;$/, '')
        .replaceAll('v_campaign_id', '$1').replaceAll('v_now', '$2').replaceAll('v_token', '$3').replaceAll('v_cd_skip', '$4')
      await db.query('BEGIN')
      try {
        await db.query(`SET LOCAL plan_cache_mode = ${mode}`)
        await db.query(`PREPARE v532_pick(bigint, timestamptz, uuid, bigint[]) AS ${sql}`)
        const plan = (await db.query(`EXPLAIN (FORMAT JSON) EXECUTE v532_pick(${Number(campaignId)}, now(), gen_random_uuid(), '{}')`)).rows[0]['QUERY PLAN']
        return JSON.stringify(plan)
      } finally {
        await db.query('ROLLBACK')
        await db.query('DEALLOCATE ALL')
      }
    }
    const usesPkey = plan => plan.includes('auto_campaign_input_data_pkey')

    // ---- 2. Trước V532: tái hiện hai lỗi ---------------------------------------------------------------------------------------
    {
      const a = await auxFailure()
      assert.equal(a.r.next, 'stop_campaign', JSON.stringify(a.r))
      assert.equal(a.r.campaign.effect, 'pause')
      assert.equal(a.camp.status, 'tạm dừng')
      assert.match(a.camp.note, /\(NET01\)/)
      assert.equal(a.streak, 0, 'bước phụ không cộng chuỗi')
      const b = await auxFailure({ action: 'zalo_change_alias', phase: 'in_flight' })
      assert.equal(b.camp.status, 'tạm dừng')
      const u = await auxFailure({ signal: CODE_BUG, phase: 'after_send' })
      assert.equal(u.camp.status, 'tạm dừng')
      // Kế hoạch chung trên cụm thử cũng quét khoá chính vì cụm chỉ có vài chục chiến dịch (production ~56 nghìn nên kế hoạch chung
      // đi chỉ mục theo chiến dịch); chỉ khẳng định kế hoạch riêng như sự cố.
      assert.ok(usesPkey(await pickPlan('force_custom_plan', late.id)), 'câu chọn data cũ, kế hoạch riêng: quét khoá chính')
    }
    pass('trước V532 (thân V517 / V527): một lỗi NET01 hoặc lỗi code ở bước gắn tag / đổi tên tạm dừng chiến dịch ngay dù bước phụ không '
      + 'cộng chuỗi; câu chọn data theo kế hoạch riêng quét khoá chính khi data của chiến dịch nằm cuối bảng (tái hiện 14/11)')

    // ---- 3. Preflight, apply thử, apply thật -----------------------------------------------------------------------------------
    await db.query(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)`)
    await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20991231000000', $1)`, [v532.NAME])
    await rejects(v532.migration, /V532 đã có trong sổ migration/, 'sổ đã có V532')
    await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20991231000000'`)
    // Thân lạ ở từng hàm (một bản vá chỉ có trên DB): dừng, không ghi đè.
    const foreign = block => block.replace('DECLARE\n', 'DECLARE\n  -- bản vá chỉ có trên DB\n')
    await db.query(foreign(v532.blocks.report.old))
    await rejects(v532.migration, /V532: thân report_v1 khác bản đang chạy production/, 'thân report lạ')
    await db.query(v532.blocks.report.old)
    await db.query(foreign(v532.blocks.claim.old))
    await rejects(v532.migration, /V532: thân claim_target_v1 khác bản đang chạy production/, 'thân claim lạ')
    await db.query(v532.blocks.claim.old)
    // Thân đúng mà thuộc tính lạ (định nghĩa khác): dừng.
    await db.query(`ALTER FUNCTION ${v532.SIG.report} SET statement_timeout = '5s'`)
    await rejects(v532.migration, /định nghĩa report_v1 khác bản nguồn/, 'định nghĩa report lạ')
    await db.query(`ALTER FUNCTION ${v532.SIG.report} RESET statement_timeout`)
    // Quyền đã rộng hơn production: hậu kiểm từ chối, cả giao dịch huỷ.
    await db.query(`GRANT EXECUTE ON FUNCTION ${v532.SIG.claim} TO anon`)
    await rejects(v532.migration, /V532 postflight: quyền claim_target_v1 quá rộng/, 'quyền rộng')
    await db.query(`REVOKE EXECUTE ON FUNCTION ${v532.SIG.claim} FROM anon`)
    assert.deepEqual(await both(), before, 'trả lại đúng hai hàm như production sau các ca từ chối')
    await db.query(v532.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await both(), before, 'apply thử rồi ROLLBACK không đổi gì')
    pass('preflight fail-closed: sổ đã có V532, thân lạ ở từng hàm, định nghĩa lạ, quyền rộng (hậu kiểm); apply thử rồi ROLLBACK không đổi gì')

    // Apply thật đúng cách sẽ làm trên production: file bọc dòng sổ migration trong cùng giao dịch.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v532-ledger-'))
    try {
      const wrapped = path.join(tmp, 'apply.sql')
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/make-migration-ledger-apply.cjs'),
        path.join(ROOT, `migrations/${v532.NAME}.sql`), v532.NAME, wrapped], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      assert.equal(JSON.parse(r.stdout).file_md5, md5(migrationFile))
      await db.query(fs.readFileSync(wrapped, 'utf8'))
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    assert.equal(await val(`SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name = $1`, [v532.NAME]), md5(migrationFile))
    const after = await both()
    assert.deepEqual([after.report.src, after.report.def], [v532.NEW.report, v532.NEW.reportDef], 'report_v1 mới')
    assert.deepEqual([after.claim.src, after.claim.def], [v532.NEW.claim, v532.NEW.claimDef], 'claim_target_v1 mới')
    for (const k of ['report', 'claim']) {
      assert.deepEqual([after[k].acl, after[k].owner, after[k].secdef, after[k].vol, after[k].config],
        [before[k].acl, before[k].owner, before[k].secdef, before[k].vol, before[k].config], `${k}: giữ quyền, chủ sở hữu, thuộc tính`)
    }
    await rejects(v532.migration, /V532 đã có trong sổ migration/, 'chạy lại khi sổ đã có')
    await db.query(`UPDATE supabase_migrations.schema_migrations SET name = 'tạm_đổi_tên' WHERE name = $1`, [v532.NAME])
    await rejects(v532.migration, /V532 đã chạy: thân report_v1 đã là bản V532/, 'chạy lại khi thân đã mới')
    await db.query(`UPDATE supabase_migrations.schema_migrations SET name = $1 WHERE name = 'tạm_đổi_tên'`, [v532.NAME])
    pass(`apply qua file bọc sổ migration: md5 sổ = file, report_v1 ${v532.NEW.report.slice(0, 8)}… / claim_target_v1 `
      + `${v532.NEW.claim.slice(0, 8)}…, quyền / thuộc tính giữ nguyên; chạy lại bị chặn`)

    // ---- 4. Sau V532 ------------------------------------------------------------------------------------------------------------
    {
      for (const [label, spec] of [['NET01 gắn tag (Fly)', {}], ['NET01 đổi tên, không rõ kết quả (Fly)', { action: 'zalo_change_alias', phase: 'in_flight' }],
        ['NET01 đổi tên (Desktop)', { action: 'zalo_change_alias', server: false }], ['lỗi code ở gắn tag', { signal: CODE_BUG, phase: 'after_send' }]]) {
        const a = await auxFailure(spec)
        assert.equal(a.r.campaign.effect, 'none', `${label}: ${JSON.stringify(a.r)}`)
        assert.notEqual(a.camp.status, 'tạm dừng', label)
        assert.equal(a.r.next, spec.signal === CODE_BUG ? 'next_target' : 'end_unit', `${label}: dừng lượt theo chính sách của mã`)
        assert.equal(a.r.target.status, 'hoàn thành', `${label}: đã giao tin nên data hoàn thành, không gửi lại`)
        assert.equal(a.streak, 0, `${label}: không cộng chuỗi`)
        if (spec.signal !== CODE_BUG) {
          assert.ok(a.r.outcomes[0].lockUntil, `${label}: vẫn khoá thao tác theo chính sách NET01`)
          assert.equal(await val(`SELECT count(*) FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable AND date_enable > now()`,
            [a.c.acc]) > 0, true, `${label}: dòng khoá thao tác`)
        }
      }
      const z = await z223()
      assert.equal(z.r.campaign.effect, 'pause', 'Z223 không có ngưỡng: vẫn tạm dừng ngay')
      assert.equal(z.camp.status, 'tạm dừng')
      // Bước chính lỗi code: tăng chuỗi, đủ 4 data liền mới tạm dừng.
      const c = await campaign(await account(), 5)
      for (let i = 1; i <= 4; i++) {
        const cl = await claim(c)
        assert.equal(cl.status, 'claimed', `data ${i}: ${JSON.stringify(cl)}`)
        await report(cl, [out('zalo_find_phone_user')])
        await mark(cl, 'zalo_message_stranger')
        const r = await report(cl, [out('zalo_message_stranger', { ok: false, signal: CODE_BUG })], true)
        assert.equal(r.streak.count, i, `data ${i}: chuỗi`)
        assert.equal(r.campaign.effect, i < 4 ? 'none' : 'pause', `data ${i}`)
      }
      const row = await campaignRow(c.id)
      assert.equal(row.status, 'tạm dừng')
      assert.match(row.note, /^Dừng sau 4 data lỗi\/thất bại liên tiếp \(ngưỡng 4\)/)
    }
    pass('sau V532: NET01 / lỗi code ở gắn tag / đổi tên (Fly, Desktop, mọi pha) không tạm dừng chiến dịch, vẫn khoá thao tác, dừng lượt theo '
      + 'mã, data hoàn thành, không cộng chuỗi; Z223 (không ngưỡng) vẫn tạm dừng ngay; lỗi code ở bước chính vẫn tạm dừng đúng ở data thứ 4')

    {
      assert.ok(!usesPkey(await pickPlan('force_custom_plan', late.id)), 'câu mới, kế hoạch riêng: không quét khoá chính')
      assert.ok(!usesPkey(await pickPlan('force_generic_plan', late.id)), 'câu mới, kế hoạch chung: không quét khoá chính')
      const firstLate = await val(`SELECT min(id) FROM public.auto_campaign_input_data WHERE campaign_id = $1`, [late.id])
      const cl = await claim(late)
      assert.equal(cl.status, 'claimed')
      assert.equal(Number(cl.target.id), Number(firstLate), 'chiến dịch cuối bảng: lấy data id nhỏ nhất')
      // Data hẹn sau bị bỏ qua; data đang bị phiên khác khoá bị bỏ qua (SKIP LOCKED); còn lại lấy theo id tăng dần.
      const c = await campaign(await account(false), 4, false)
      await db.query(`UPDATE public.auto_campaign_input_data SET schedule = now() + interval '1 hour' WHERE id = $1`, [c.ids[0]])
      await db2.query('BEGIN')
      await db2.query(`SELECT id FROM public.auto_campaign_input_data WHERE id = $1 FOR UPDATE`, [c.ids[1]])
      const picked = await claim(c)
      await db2.query('ROLLBACK')
      assert.equal(picked.status, 'claimed', JSON.stringify(picked))
      assert.equal(Number(picked.target.id), c.ids[2], 'bỏ data hẹn sau và data đang bị khoá, lấy data đến hạn id nhỏ nhất kế tiếp')
    }
    pass('sau V532: câu chọn data không còn quét khoá chính (kế hoạch riêng lẫn chung); vẫn lấy data đến hạn id nhỏ nhất, bỏ data hẹn sau '
      + 'và data đang bị phiên khác khoá')

    // ---- 5. Gỡ, apply lại ---------------------------------------------------------------------------------------------------
    await db.query(v532.rollback.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal((await fn(v532.SIG.report)).src, v532.NEW.report, 'gỡ thử rồi ROLLBACK không đổi gì')
    await db.query(v532.rollback)
    assert.deepEqual(await both(), before, 'gỡ trả đúng hai hàm như production (thân, định nghĩa, quyền, thuộc tính)')
    assert.equal((await auxFailure()).camp.status, 'tạm dừng', 'sau gỡ: lỗi ở bước phụ lại tạm dừng ngay')
    await rejects(v532.rollback, /Gỡ V532: thân report_v1 đã là bản trước V532/, 'gỡ lần hai')
    await rejects(v532.migration, /V532 đã có trong sổ migration/, 'apply lại khi sổ còn dòng V532')
    await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE name = $1`, [v532.NAME])
    await db.query(v532.migration)
    assert.deepEqual([(await fn(v532.SIG.report)).src, (await fn(v532.SIG.claim)).src], [v532.NEW.report, v532.NEW.claim])
    assert.notEqual((await auxFailure()).camp.status, 'tạm dừng', 'apply lại: bước phụ không tạm dừng')
    pass('gỡ V532 trả thân V517 / V527 (lại tạm dừng ngay), gỡ thử / gỡ lần hai bị chặn; apply lại được sau khi bỏ dòng sổ')

    console.log(`OK V532: ${checks} nhóm kiểm`)
  } finally {
    await db2.end().catch(() => {})
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
