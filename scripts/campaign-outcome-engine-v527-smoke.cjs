// V527: claim_target_v1 bỏ qua claim token bộ cũ còn sót trên chiến dịch đã xoá / tạm dừng (sự cố bật cờ engine v2 đêm 13–14/11/2026).
// PostgreSQL 17 cục bộ có đủ chuỗi V495 → … → V507 → V515 → V517 như production 14/11/2026 (pg_cron giả cho V517).
//   1. File = bản sinh; thân / định nghĩa claim trên cụm thử đúng md5 production (e09100fd… / f33e534e…).
//   2. Trước V527: claim treo trên chiến dịch tạm dừng cũ / đã xoá chặn cả tài khoản (tái hiện sự cố).
//   3. Preflight fail-closed: sổ đã có V527, thân lạ, định nghĩa lạ (thuộc tính), quyền quá rộng ở hậu kiểm; apply thử rồi ROLLBACK
//      không đổi gì; apply thật qua file bọc sổ migration: md5 thân / định nghĩa, chủ sở hữu, quyền giữ nguyên; chạy lại bị chặn.
//   4. Sau V527, nhận được khi chiến dịch giữ claim đã xoá / tạm dừng đủ lâu, không unit lease, không data "đang chạy" (Fly và Desktop);
//      token không bị xoá. Vẫn legacy_busy: vừa tạm dừng, claim mới, còn data "đang chạy", unit lease, chiến dịch chờ / đang chạy giữ
//      claim, token thao tác tài khoản, một chiến dịch treo hợp lệ cạnh một chiến dịch còn chặn.
//   5. Thiết lập engine.legacy_stale_claim_minutes: 60, sàn 10 phút, sai định dạng → 30, có khoảng trắng.
//   6. Gỡ V527 trả thân V507 (lại legacy_busy), gỡ lần hai bị chặn; apply lại được sau khi bỏ dòng sổ.
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v527-smoke.cjs
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
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V527_TEST_PORT || 55527)
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v527-' })
  const db = await connect()
  try {
    const migrationFile = fs.readFileSync(path.join(ROOT, `migrations/${v527.NAME}.sql`), 'utf8')
    assert.equal(migrationFile, v527.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v527.ROLLBACK_NAME}.sql`), 'utf8'), v527.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507, v515]) await db.query(m.migration)
    // pg_cron giả như smoke V517 (đủ cron.job + schedule / unschedule) để chuỗi có V517 như production.
    await db.query(`CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
        ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
      CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;`)
    await db.query(v517.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const fn = async () => (await db.query(`SELECT md5(p.prosrc) AS src, md5(pg_get_functiondef(p.oid)) AS def, p.proacl::text AS acl,
      pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef, p.provolatile AS vol, p.proconfig AS config
      FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [v527.SIG])).rows[0]
    const rejects = async (sql, pattern, label) => {
      await assert.rejects(db.query(sql), pattern, label)
      await db.query('ROLLBACK')
    }

    // ---- 1. Hàm trên cụm thử đúng bản production ------------------------------------------------------------------------------
    const before = await fn()
    assert.equal(before.src, v527.LIVE.claim, 'thân claim = V507 (production e09100fd…)')
    assert.equal(before.def, v527.LIVE.def, 'pg_get_functiondef = production (f33e534e…)')
    assert.deepEqual([before.owner, before.secdef, before.vol, before.config], ['postgres', true, 'v', ['search_path=""']])
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, v527.SIG]), false, role)
    }
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) {
      assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, v527.SIG]), true, role)
    }
    pass('cụm thử có thân và định nghĩa claim_target_v1 đúng md5 production, chủ sở hữu / thuộc tính / quyền như production')

    // ---- Dựng tài khoản, chiến dịch -----------------------------------------------------------------------------------------
    let nextId = 952700
    const STAFF = 9527, ORG = 527
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org V527', true)`, [ORG])
    const EXTRA = JSON.stringify({ enableMessage: true,
      actionLimits: { byActionCode: { zalo_message_stranger: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } } })
    // Tài khoản Zalo Server (Fly) hoặc QR (Desktop), đã đăng nhập, "chờ xử lý"; opToken = bộ cũ đang giữ thao tác tài khoản.
    const account = async ({ server = true, opToken = false } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web, runtime_operation_claim_token)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo V527', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, $4, false,
          CASE WHEN $5 THEN gen_random_uuid() END)`, [id, STAFF, ORG, server, opToken])
      return id
    }
    // Chiến dịch bộ cũ giữ token. Thời gian là khoảng lùi so với bây giờ (giá trị cố định của bộ kiểm, không phải dữ liệu ngoài).
    // claimedAgo = null: claim token có mà runtime_claimed_at rỗng (bộ ba claim lệch, bộ cũ không tự tạo ra).
    const legacy = async (accountId, { status = 'tạm dừng', del = false, claim = true, claimedAgo = '3 days', updatedAgo = '2 days',
                                       unit = false, target = 'server', running = null } = {}) => {
      const id = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Bộ cũ', 'zalo_message_phone', $2, $3, now() - interval '3 days', $4, $5, $6)`,
        [id, accountId, status, del, STAFF, ORG])
      const at = claimedAgo === null ? 'NULL' : `now() - interval '${claimedAgo}'`
      await db.query(`UPDATE public.auto_campaigns SET
          runtime_claim_token = ${claim ? 'gen_random_uuid()' : 'NULL'},
          runtime_claim_target = ${claim ? `'${target}'` : 'NULL'},
          runtime_claim_vietnam_date = ${claim ? "(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 3" : 'NULL'},
          runtime_claimed_at = ${claim ? at : 'NULL'},
          runtime_unit_token = ${unit ? 'gen_random_uuid()' : 'NULL'},
          runtime_unit_vietnam_date = ${unit ? "(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 3" : 'NULL'},
          runtime_unit_claimed_at = ${unit ? "now() - interval '3 days'" : 'NULL'},
          runtime_unit_input_data_ids = ${unit ? "'{}'::bigint[]" : 'NULL'},
          updated_at = now() - interval '${updatedAgo}'
        WHERE id = $1`, [id])
      if (running) {
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Đang gửi', '0909000001', 'đang chạy', $3)`, [++nextId, id, running === 'deleted'])
      }
      return id
    }
    // Chiến dịch "Nhắn tin theo SĐT" chờ chạy, một data đến hạn.
    const runnable = async accountId => {
      const id = ++nextId, data = ++nextId
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
          extra_settings, images)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'V527 chạy', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4,
          'Chào #{FULL_NAME}', $5::jsonb, '[]'::jsonb)`, [id, accountId, STAFF, ORG, EXTRA])
      await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [data, id, `0909${String(data).slice(-6)}`])
      return id
    }
    const claim = async (accountId, campaignId, runtime) => (await db.query(`SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r`, [
      JSON.stringify({ staffId: STAFF, accountId, campaignId, runnerId: `${runtime}:v527`, runtimeTarget: runtime, leaseToken: null,
        actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] })])).rows[0].r
    const tokens = async ids => (await db.query(`SELECT id, runtime_claim_token, runtime_claim_target, runtime_claim_vietnam_date, runtime_claimed_at,
      runtime_unit_token, updated_at, status, is_delete FROM public.auto_campaigns WHERE id = ANY($1::bigint[]) ORDER BY id`, [ids])).rows
    // Một tài khoản mới cho mỗi ca: các chiến dịch bộ cũ theo specs, rồi claim chiến dịch chờ chạy (Fly cho Server, Desktop cho QR).
    const scenario = async ({ server = true, opToken = false, specs = [{}] } = {}) => {
      const acc = await account({ server, opToken })
      const ids = []
      for (const s of specs) ids.push(await legacy(acc, s))
      const camp = await runnable(acc)
      const snapshot = await tokens(ids)
      const res = await claim(acc, camp, server ? 'fly' : 'desktop')
      assert.deepEqual(await tokens(ids), snapshot, 'claim không đụng chiến dịch / token của bộ cũ')
      return { acc, camp, ids, res }
    }
    const expectStatus = async (label, spec, status, scope = undefined) => {
      const r = await scenario(spec)
      assert.equal(r.res.status, status, `${label}: ${JSON.stringify(r.res)}`)
      if (scope !== undefined) assert.equal(r.res.scope, scope, label)
      return r
    }

    // ---- 2. Trước V527: claim treo chặn cả tài khoản ---------------------------------------------------------------------------
    await expectStatus('V507: tạm dừng từ 2 ngày, claim 3 ngày', { specs: [{}] }, 'legacy_busy', 'campaign')
    await expectStatus('V507: đã xoá', { specs: [{ del: true }] }, 'legacy_busy', 'campaign')
    pass('trước V527 (thân V507): claim treo trên chiến dịch tạm dừng cũ / đã xoá trả legacy_busy cho cả tài khoản (tái hiện sự cố 14/11)')

    // ---- 3. Preflight, apply thử, apply thật -----------------------------------------------------------------------------------
    await db.query(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)`)
    await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20991231000000', $1)`, [v527.NAME])
    await rejects(v527.migration, /V527 đã có trong sổ migration/, 'sổ đã có V527')
    await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '20991231000000'`)
    // Thân lạ (một bản vá chỉ có trên DB): dừng, không ghi đè.
    await db.query(v527.blocks.old.replace('BEGIN\n  IF v_staff IS NULL', 'BEGIN\n  -- bản vá chỉ có trên DB\n  IF v_staff IS NULL'))
    assert.notEqual((await fn()).src, v527.LIVE.claim)
    await rejects(v527.migration, /thân claim_target_v1 khác V507/, 'thân lạ')
    await db.query(v527.blocks.old)
    // Thân đúng mà thuộc tính lạ (định nghĩa khác): dừng.
    await db.query(`ALTER FUNCTION ${v527.SIG} SET statement_timeout = '5s'`)
    await rejects(v527.migration, /định nghĩa claim_target_v1 khác bản nguồn/, 'định nghĩa lạ')
    await db.query(`ALTER FUNCTION ${v527.SIG} RESET statement_timeout`)
    // Quyền đã rộng hơn production: hậu kiểm từ chối, cả giao dịch huỷ.
    await db.query(`GRANT EXECUTE ON FUNCTION ${v527.SIG} TO anon`)
    await rejects(v527.migration, /V527 postflight: quyền hàm quá rộng/, 'quyền rộng')
    await db.query(`REVOKE EXECUTE ON FUNCTION ${v527.SIG} FROM anon`)
    assert.deepEqual(await fn(), before, 'trả lại đúng hàm như production sau các ca từ chối')
    // Apply trong giao dịch rồi ROLLBACK: chạy hết preflight, thay hàm, hậu kiểm; không đổi gì.
    await db.query(v527.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual(await fn(), before, 'apply thử rồi ROLLBACK không đổi gì')
    pass('preflight fail-closed: sổ đã có V527, thân lạ, định nghĩa lạ, quyền rộng (hậu kiểm); apply thử rồi ROLLBACK không đổi gì')

    // Apply thật đúng cách sẽ làm trên production: file bọc dòng sổ migration trong cùng giao dịch.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-v527-ledger-'))
    try {
      const wrapped = path.join(tmp, 'apply.sql')
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/make-migration-ledger-apply.cjs'),
        path.join(ROOT, `migrations/${v527.NAME}.sql`), v527.NAME, wrapped], { encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      assert.equal(JSON.parse(r.stdout).file_md5, md5(migrationFile))
      await db.query(fs.readFileSync(wrapped, 'utf8'))
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    assert.equal(await val(`SELECT md5(statements[1]) FROM supabase_migrations.schema_migrations WHERE name = $1`, [v527.NAME]), md5(migrationFile))
    const after = await fn()
    assert.equal(after.src, v527.NEW.claim, 'thân mới')
    assert.equal(after.def, v527.NEW.def, 'định nghĩa mới')
    assert.deepEqual([after.acl, after.owner, after.secdef, after.vol, after.config], [before.acl, before.owner, before.secdef, before.vol, before.config],
      'giữ quyền, chủ sở hữu, SECURITY DEFINER, VOLATILE, search_path')
    await rejects(v527.migration, /V527 đã có trong sổ migration/, 'chạy lại khi sổ đã có')
    await db.query(`UPDATE supabase_migrations.schema_migrations SET name = 'tạm_đổi_tên' WHERE name = $1`, [v527.NAME])
    await rejects(v527.migration, /V527 đã chạy: thân claim_target_v1 đã là bản V527/, 'chạy lại khi thân đã mới')
    await db.query(`UPDATE supabase_migrations.schema_migrations SET name = $1 WHERE name = 'tạm_đổi_tên'`, [v527.NAME])
    pass(`apply qua file bọc sổ migration: md5 sổ = file, thân ${v527.NEW.claim.slice(0, 8)}… / định nghĩa ${v527.NEW.def.slice(0, 8)}…, quyền / thuộc tính giữ nguyên; chạy lại bị chặn`)

    // ---- 4. Sau V527 ------------------------------------------------------------------------------------------------------------
    {
      const r1 = await expectStatus('tạm dừng từ 2 ngày', { specs: [{}] }, 'claimed')
      assert.equal(r1.res.campaign.id, r1.camp)
      assert.equal(await val(`SELECT runtime_target FROM public.auto_engine_leases WHERE account_id = $1`, [r1.acc]), 'fly')
      await expectStatus('đã xoá (tạm dừng)', { specs: [{ del: true }] }, 'claimed')
      await expectStatus('đã xoá ở trạng thái "chờ xử lý"', { specs: [{ del: true, status: 'chờ xử lý' }] }, 'claimed')
      await expectStatus('đã xoá ở trạng thái "hoàn thành"', { specs: [{ del: true, status: 'hoàn thành' }] }, 'claimed')
      await expectStatus('data "đang chạy" đã xoá mềm (engine không đếm)', { specs: [{ running: 'deleted' }] }, 'claimed')
      await expectStatus('claim có token mà runtime_claimed_at rỗng, ghi cuối 2 ngày', { specs: [{ claimedAgo: null }] }, 'claimed')
      await expectStatus('hai chiến dịch treo cùng đủ điều kiện', { specs: [{}, { del: true, claimedAgo: '40 days', updatedAgo: '39 days' }] }, 'claimed')
      await expectStatus('claim và ghi cuối 31 phút', { specs: [{ claimedAgo: '31 minutes', updatedAgo: '31 minutes' }] }, 'claimed')
      const rd = await expectStatus('Desktop (QR), chiến dịch đã xoá giữ claim desktop', { server: false, specs: [{ del: true, target: 'desktop' }] }, 'claimed')
      assert.equal(await val(`SELECT runtime_target FROM public.auto_engine_leases WHERE account_id = $1`, [rd.acc]), 'desktop')
      // Chính chiến dịch tạm dừng giữ claim treo được hỏi: như chiến dịch tạm dừng không token (campaign_paused), không legacy_busy.
      const acc = await account()
      const own = await legacy(acc, {})
      assert.equal((await claim(acc, own, 'fly')).status, 'campaign_paused')
      pass('sau V527 nhận được: tạm dừng / đã xoá (mọi trạng thái) đủ lâu, data đang chạy đã xoá mềm, claimed_at rỗng, nhiều chiến dịch treo, '
        + 'Desktop như Fly; chính chiến dịch treo → campaign_paused; token bộ cũ giữ nguyên')
    }
    {
      await expectStatus('vừa tạm dừng (ghi cuối 5 phút) dù claim 3 ngày', { specs: [{ updatedAgo: '5 minutes' }] }, 'legacy_busy', 'campaign')
      await expectStatus('vừa xoá (ghi cuối 29 phút)', { specs: [{ del: true, updatedAgo: '29 minutes' }] }, 'legacy_busy', 'campaign')
      await expectStatus('claim 20 phút, ghi cuối 15 phút', { specs: [{ claimedAgo: '20 minutes', updatedAgo: '15 minutes' }] }, 'legacy_busy', 'campaign')
      await expectStatus('claim mới hơn ghi cuối (ghi cuối cũ, claim 10 phút)', { specs: [{ claimedAgo: '10 minutes', updatedAgo: '2 days' }] }, 'legacy_busy', 'campaign')
      await expectStatus('ghi cuối ở tương lai (đồng hồ máy chạy lệch)', { specs: [{ updatedAgo: '-10 minutes' }] }, 'legacy_busy', 'campaign')
      await expectStatus('còn data "đang chạy"', { specs: [{ running: 'live' }] }, 'legacy_busy', 'campaign')
      await expectStatus('đã xoá, còn data "đang chạy"', { specs: [{ del: true, running: 'live' }] }, 'legacy_busy', 'campaign')
      await expectStatus('tạm dừng giữ cả unit lease', { specs: [{ unit: true }] }, 'legacy_busy', 'campaign')
      await expectStatus('đã xoá chỉ còn unit lease', { specs: [{ del: true, claim: false, unit: true }] }, 'legacy_busy', 'campaign')
      await expectStatus('chiến dịch "chờ xử lý" giữ claim cũ', { specs: [{ status: 'chờ xử lý' }] }, 'legacy_busy', 'campaign')
      await expectStatus('chiến dịch "đang chạy" giữ claim cũ', { specs: [{ status: 'đang chạy' }] }, 'legacy_busy', 'campaign')
      await expectStatus('chiến dịch "hoàn thành" chưa xoá giữ claim cũ', { specs: [{ status: 'hoàn thành' }] }, 'legacy_busy', 'campaign')
      await expectStatus('token thao tác tài khoản', { opToken: true, specs: [{}] }, 'legacy_busy', 'account')
      await expectStatus('một chiến dịch treo hợp lệ + một chiến dịch vừa tạm dừng', { specs: [{}, { updatedAgo: '1 minute' }] }, 'legacy_busy', 'campaign')
      await expectStatus('Desktop: chiến dịch đã xoá còn data "đang chạy"', { server: false, specs: [{ del: true, target: 'desktop', running: 'live' }] },
        'legacy_busy', 'campaign')
      pass('sau V527 vẫn legacy_busy: vừa tạm dừng / vừa xoá, claim mới, ghi cuối ở tương lai, còn data đang chạy, unit lease, chiến dịch '
        + 'chờ / đang chạy / hoàn thành chưa xoá giữ claim, token thao tác tài khoản (scope account), một treo hợp lệ cạnh một còn chặn')
    }

    // ---- 5. Thiết lập ngưỡng ----------------------------------------------------------------------------------------------------
    {
      const set = value => db.query(`INSERT INTO public.auto_system_settings(key, value, description) VALUES ($1, $2, 'V527 smoke')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [v527.SETTING, value])
      const age = minutes => ({ specs: [{ claimedAgo: '3 days', updatedAgo: `${minutes} minutes` }] })
      await set('60')
      await expectStatus('60 phút: ghi cuối 45 phút', age(45), 'legacy_busy', 'campaign')
      await expectStatus('60 phút: ghi cuối 61 phút', age(61), 'claimed')
      await set('5')
      await expectStatus('5 → sàn 10 phút: ghi cuối 7 phút', age(7), 'legacy_busy', 'campaign')
      await expectStatus('5 → sàn 10 phút: ghi cuối 11 phút', age(11), 'claimed')
      await set('abc')
      await expectStatus('sai định dạng → 30: ghi cuối 25 phút', age(25), 'legacy_busy', 'campaign')
      await expectStatus('sai định dạng → 30: ghi cuối 31 phút', age(31), 'claimed')
      await set(' 15 ')
      await expectStatus('" 15 ": ghi cuối 12 phút', age(12), 'legacy_busy', 'campaign')
      await expectStatus('" 15 ": ghi cuối 16 phút', age(16), 'claimed')
      await db.query(`UPDATE public.auto_system_settings SET is_active = false WHERE key = $1`, [v527.SETTING])
      await expectStatus('thiết lập tắt → 30: ghi cuối 25 phút', age(25), 'legacy_busy', 'campaign')
      await db.query(`DELETE FROM public.auto_system_settings WHERE key = $1`, [v527.SETTING])
      await expectStatus('không có thiết lập → 30: ghi cuối 29 phút', age(29), 'legacy_busy', 'campaign')
      pass(`${v527.SETTING}: 60 phút, sàn ${v527.FLOOR_MINUTES} phút, sai định dạng / tắt / không có → ${v527.DEFAULT_MINUTES} phút, bỏ khoảng trắng`)
    }

    // ---- 6. Gỡ, apply lại ---------------------------------------------------------------------------------------------------
    await db.query(v527.rollback.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal((await fn()).src, v527.NEW.claim, 'gỡ thử rồi ROLLBACK không đổi gì')
    await db.query(v527.rollback)
    assert.deepEqual(await fn(), before, 'gỡ trả đúng hàm V507 như production (thân, định nghĩa, quyền, thuộc tính)')
    await expectStatus('sau gỡ: tạm dừng từ 2 ngày', { specs: [{}] }, 'legacy_busy', 'campaign')
    await rejects(v527.rollback, /đã là bản V507/, 'gỡ lần hai')
    await rejects(v527.migration, /V527 đã có trong sổ migration/, 'apply lại khi sổ còn dòng V527')
    await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE name = $1`, [v527.NAME])
    await db.query(v527.migration)
    assert.equal((await fn()).src, v527.NEW.claim)
    await expectStatus('apply lại: tạm dừng từ 2 ngày', { specs: [{}] }, 'claimed')
    pass('gỡ V527 trả thân V507 (lại legacy_busy), gỡ thử / gỡ lần hai bị chặn; apply lại được sau khi bỏ dòng sổ')

    console.log(`OK V527: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
