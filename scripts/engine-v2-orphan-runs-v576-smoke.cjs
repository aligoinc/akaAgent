#!/usr/bin/env node
// V576 (số tạm): engine v2 đóng lượt data bị bỏ dở cho đúng (docs/ENGINE_V2_ORPHAN_RUNS_V576.md). PostgreSQL 17 cục bộ, DB engine như production
// (bootstrap của bộ kịch bản + engine Facebook + V571), thân close_stale / report_v1 / hàm reset Desktop đúng bản production đọc 18/11.
// Mỗi phần chạy trên bản cũ trước (phải thấy lỗi của lượt 175931 / 179149) rồi trên V576 (hết lỗi):
//   B: lượt mồ côi (mất câu trả lời của claim, cùng lease chạy tiếp) → cũ: treo tới khi lease hết hạn; mới: về hàng đợi khi cùng lease đã có lượt
//      sau ≥ 3 giây đã chốt. Không đụng lượt cùng lần nhận cả lô (< 3 giây), lượt đã ghi dấu, lượt mới nhận < 2 phút.
//   D1: lượt đã ghi dấu, mọi dấu đã có kết quả, lease hết hạn → cũ: SYS02 "Bị ngắt khi đang gửi"; mới: chốt theo kết quả (thành công), chuỗi
//      data lỗi giữ nguyên. Dấu còn 'pending' hoặc chiến dịch có token bộ cũ → như cũ.
//   A: hàm reset của Desktop (đăng nhập / đăng xuất / thoát) → cũ: data engine chưa ghi dấu bị đánh "hoàn thành – Dừng đột ngột…"; mới: về hàng
//      đợi, đã ghi dấu → SYS02; data không có lượt engine giữ cách cũ; lượt của nhân viên khác không đụng.
// Kèm: apply / chạy lại bị chặn / gỡ trả đúng thân cũ / apply lại; quyền gọi hai hàm mới. Không mạng, không dữ liệu khách.
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-orphan-runs-v576-smoke.cjs
'use strict'
process.env.SCENARIO_FACEBOOK_MIGRATIONS = '1'
process.env.SCENARIO_TARGET_CHECK = '1'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture } = require('./engine-v2-facebook/fixture.cjs')
const V = require('./build-v576-sql.cjs')
const { prepareV576 } = require('./fixtures/engine-v2-orphan-runs-v576/setup.cjs')

const PORT = Number(process.env.V576_TEST_PORT || 55576)
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

const LEGACY_NOTE = 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại'
const SYS01 = 'Bị ngắt trước khi gửi (SYS01)'
const SYS02 = 'Bị ngắt khi đang gửi, không rõ kết quả; không gửi lại để tránh trùng (SYS02)'

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v576-', timeoutMs: 900_000 })
  const db = await connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
  const fnMd5 = sig => val(`SELECT md5(pg_get_functiondef(to_regprocedure($1)))`, [`public.${sig}`])
  const asStaff = async (staffId, sql, args = []) => {
    await db.query('BEGIN')
    try {
      await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(staffId)])
      const out = (await db.query(sql, args)).rows[0]
      await db.query('COMMIT')
      return out
    } catch (error) { await db.query('ROLLBACK'); throw error }
  }
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${V.NAME}.sql`), 'utf8'), V.migration, 'file migration = bản sinh (chạy lại build-v576-sql.cjs)')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${V.ROLLBACK_NAME}.sql`), 'utf8'), V.rollback, 'file rollback = bản sinh')
    const notes = []
    await buildFacebookFixture(db, notes)
    await prepareV576(db, notes)
    console.log('Ghi chú dựng DB:', notes.join(' | ') || '-')

    await check('DB thử: close_stale / report_v1 / hàm reset Desktop = bản production 18/11', async () => {
      assert.equal(await fnMd5(V.SIG.closeStale), V.OLD.closeStale)
      assert.equal(await fnMd5(V.SIG.report), V.OLD.report)
      assert.equal(await fnMd5(V.SIG.wrapper), V.OLD.wrapper)
    })

    // ---- Dữ liệu chung --------------------------------------------------------------------------------------------------------------
    await db.query(`INSERT INTO public.org_organization (id, name) OVERRIDING SYSTEM VALUE VALUES (761, 'V576 thử') ON CONFLICT DO NOTHING`)
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) OVERRIDING SYSTEM VALUE VALUES (7601, 761, 's1', 'p'), (7602, 761, 's2', 'p')`)
    let seq = 0
    const uuid = () => crypto.randomUUID()
    /** Một tài khoản + chiến dịch + data; trả id. platform: facebook | zalo. */
    const world = async ({ staff = 7601, platform = 'facebook', action = 'facebook_group_post', data = 4, campaignStatus = 'đang chạy', legacy = false } = {}) => {
      seq++
      const acc = 760000 + seq
      const camp = 770000 + seq
      await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
          is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, 'đã đăng nhập', 'đang chạy', true, false, $4, 761, false, false)`, [acc, `TK ${seq}`, platform, staff])
      await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, is_delete, staff_id, organization_id, schedule, schedule_type,
          extra_settings, runtime_claim_token) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, false, $6, 761, now() - interval '1 hour', 'daily', '{}', $7)`,
      [camp, `CD ${seq}`, action, acc, campaignStatus, staff, legacy ? uuid() : null])
      const ids = []
      for (let i = 0; i < data; i++) {
        const r = await one(`INSERT INTO public.auto_campaign_input_data (campaign_id, status, uid, name, is_delete) VALUES ($1, 'chờ xử lý', $2, $3, false) RETURNING id`,
          [camp, `u${seq}_${i}`, `Data ${seq}.${i}`])
        ids.push(Number(r.id))
      }
      return { acc, camp, data: ids, staff }
    }
    const lease = async (w, { alive = true } = {}) => {
      const token = uuid()
      await db.query(`INSERT INTO public.auto_engine_leases (account_id, lease_token, runner_id, runtime_target, campaign_id, acquired_at, heartbeat_at, expires_at)
        VALUES ($1, $2, 'desktop:smoke', 'desktop', $3, now() - interval '30 minutes', now(), now() + CASE WHEN $4 THEN interval '3 minutes' ELSE interval '-11 minutes' END)
        ON CONFLICT (account_id) DO UPDATE SET lease_token = EXCLUDED.lease_token, expires_at = EXCLUDED.expires_at`, [w.acc, token, w.camp, alive])
      return token
    }
    /** Lượt data; ageSec: bắt đầu cách đây bao nhiêu giây; closed: chốt 'reported'. Data chuyển "đang chạy" như claim. */
    const run = async (w, token, dataId, ageSec, { closed = false } = {}) => {
      const r = await one(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id,
          runtime_target, started_at, completed_at, final_target_status, close_reason) VALUES ($1, $2, $3, $4, 761, $5, 'desktop:smoke', 'desktop',
          now() - make_interval(secs => $6), CASE WHEN $7 THEN now() - make_interval(secs => greatest($6 - 20, 1)) END,
          CASE WHEN $7 THEN 'hoàn thành' END, CASE WHEN $7 THEN 'reported' END) RETURNING id`,
      [dataId, w.camp, w.acc, w.staff, token, ageSec, closed])
      await db.query(`UPDATE public.auto_campaign_input_data SET status = $2 WHERE id = $1`, [dataId, closed ? 'hoàn thành' : 'đang chạy'])
      return Number(r.id)
    }
    const runRow = id => one(`SELECT completed_at IS NOT NULL AS closed, close_reason, final_target_status, final_error_code FROM public.auto_engine_target_runs WHERE id = $1`, [id])
    const dataRow = id => one(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const closeStale = () => val(`SELECT public.aka_agent_engine_close_stale_v1(200)`)
    const mark = (w, runId, token, step = 'post') => asStaff(w.staff, `SELECT public.aka_agent_engine_mark_sending_v1($1, $2, 'fb_post_group', $3) AS r`, [runId, token, step]).then(r => r.r)
    const reportOk = (w, runId, token, step = 'post') => asStaff(w.staff, `SELECT public.aka_agent_engine_report_v1($1, $2, $3, false, false) AS r`, [runId, token,
      JSON.stringify([{ resultKey: `v2:${runId}:${step}`, actionCode: 'fb_post_group', stepKey: step, ok: true, phase: 'after_send', statusCode: 'campaign_detail_success',
        data: { runId: '1' } }])]).then(r => r.r)

    // ---- Kịch bản (dựng mới cho mỗi lần chạy: trước và sau V576) ---------------------------------------------------------------------
    const scenarios = async () => {
      const s = {}
      // B: tài khoản 1. Lượt mồ côi O (5 phút trước), lượt gọi lại Q (1 giây sau O, đã chốt), lượt kế N (4 phút sau O, đã chốt). Lease còn hạn.
      s.b = await world()
      s.b.token = await lease(s.b)
      s.b.orphan = await run(s.b, s.b.token, s.b.data[0], 300)
      s.b.retry = await run(s.b, s.b.token, s.b.data[1], 299, { closed: true })
      // B, chỉ có lượt gọi lại < 3 giây (giống lần nhận cả lô): không phải mồ côi chắc chắn.
      s.b2 = await world()
      s.b2.token = await lease(s.b2)
      s.b2.first = await run(s.b2, s.b2.token, s.b2.data[0], 300)
      s.b2.batchSibling = await run(s.b2, s.b2.token, s.b2.data[1], 299, { closed: true })
      // B, lượt đã ghi dấu / lượt mới nhận < 2 phút: không đụng.
      s.b3 = await world()
      s.b3.token = await lease(s.b3)
      s.b3.marked = await run(s.b3, s.b3.token, s.b3.data[0], 300)
      assert.equal((await mark(s.b3, s.b3.marked, s.b3.token)).ok, true)
      s.b3.young = await run(s.b3, s.b3.token, s.b3.data[1], 60)
      s.b3.after = await run(s.b3, s.b3.token, s.b3.data[2], 40, { closed: true })
      // D1: lượt đã gửi thành công (dấu 'delivered'), lease hết hạn > 10 phút. Chuỗi data lỗi đang là 2.
      s.d = await world()
      s.d.token = await lease(s.d)
      s.d.run = await run(s.d, s.d.token, s.d.data[0], 900)
      assert.equal((await mark(s.d, s.d.run, s.d.token)).ok, true)
      const rep = await reportOk(s.d, s.d.run, s.d.token)
      assert.equal(rep.ok, true, JSON.stringify(rep)); assert.equal(rep.next, 'next_step')
      await db.query(`INSERT INTO public.auto_campaign_error_state (campaign_id, count_consecutive_bad_targets, last_reason) VALUES ($1, 2, 'trước')
        ON CONFLICT (campaign_id) DO UPDATE SET count_consecutive_bad_targets = 2, last_reason = 'trước'`, [s.d.camp])
      // D1 không áp: dấu còn 'pending'.
      s.dp = await world()
      s.dp.token = await lease(s.dp)
      s.dp.run = await run(s.dp, s.dp.token, s.dp.data[0], 900)
      assert.equal((await mark(s.dp, s.dp.run, s.dp.token)).ok, true)
      // D1 không áp: bộ cũ đã nhận lại chiến dịch (token bộ cũ) → không đụng data.
      s.dl = await world()
      s.dl.token = await lease(s.dl)
      s.dl.run = await run(s.dl, s.dl.token, s.dl.data[0], 900)
      assert.equal((await mark(s.dl, s.dl.run, s.dl.token)).ok, true)
      assert.equal((await reportOk(s.dl, s.dl.run, s.dl.token)).ok, true)
      await db.query(`UPDATE public.auto_campaigns SET runtime_claim_token = $2 WHERE id = $1`, [s.dl.camp, uuid()])
      for (const w of [s.d, s.dp, s.dl]) await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '11 minutes' WHERE account_id = $1`, [w.acc])
      // A: nhân viên 7601. Lượt FB chưa ghi dấu, lượt FB đã ghi dấu, data FB "đang chạy" không có lượt engine, lượt Zalo QR chưa ghi dấu;
      // nhân viên 7602 có lượt FB chưa ghi dấu.
      s.a = await world()
      s.a.token = await lease(s.a)
      s.a.unsent = await run(s.a, s.a.token, s.a.data[0], 30)
      s.a.marked = await run(s.a, s.a.token, s.a.data[1], 20)
      assert.equal((await mark(s.a, s.a.marked, s.a.token)).ok, true)
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'đang chạy' WHERE id = $1`, [s.a.data[2]])
      s.az = await world({ platform: 'zalo', action: 'zalo_message_phone' })
      s.az.token = await lease(s.az)
      s.az.unsent = await run(s.az, s.az.token, s.az.data[0], 30)
      s.ao = await world({ staff: 7602 })
      s.ao.token = await lease(s.ao)
      s.ao.unsent = await run(s.ao, s.ao.token, s.ao.data[0], 30)
      return s
    }
    const resetDesktop = staff => asStaff(staff, `SELECT public.reset_desktop_running_statuses_no_retry($1, false, true) AS r`, [staff]).then(r => r.r)

    // ---- 1. Bản cũ: thấy đủ ba lỗi ------------------------------------------------------------------------------------------------------
    const before = await scenarios()
    await check('cũ B: lượt mồ côi treo khi lease còn hạn (cả khi cùng lease đã chốt lượt sau)', async () => {
      await run(before.b, before.b.token, before.b.data[2], 60, { closed: true })
      await closeStale()
      assert.equal((await runRow(before.b.orphan)).closed, false)
      assert.equal((await dataRow(before.b.data[0])).status, 'đang chạy')
      const rel = await val(`SELECT public.aka_agent_engine_release_v1($1, $2)`, [before.b.acc, before.b.token])
      assert.equal(rel.reason, 'open_target_runs', 'release bị từ chối vì lượt mồ côi')
    })
    await check('cũ D1: lượt đã gửi thành công bị đóng SYS02 "Bị ngắt khi đang gửi"', async () => {
      const r = await runRow(before.d.run)
      assert.equal(r.closed, true); assert.equal(r.close_reason, 'stale'); assert.equal(r.final_error_code, 'err_engine_interrupted_while_sending')
      assert.deepEqual(await dataRow(before.d.data[0]), { status: 'hoàn thành', note: SYS02 })
    })
    await check('cũ A: reset Desktop đánh "hoàn thành – Dừng đột ngột" data engine chưa ghi dấu (FB và Zalo)', async () => {
      await resetDesktop(7601)
      assert.deepEqual(await dataRow(before.a.data[0]), { status: 'hoàn thành', note: LEGACY_NOTE })
      assert.equal((await dataRow(before.az.data[0])).status, 'hoàn thành')
      assert.equal((await runRow(before.a.unsent)).closed, false, 'lượt engine vẫn mở')
    })
    // Dọn lượt còn mở của phần bản cũ để phần bản mới chỉ thấy dữ liệu của nó.
    await db.query(`UPDATE public.auto_engine_target_runs SET completed_at = now(), close_reason = 'reported', final_target_status = 'hoàn thành'
      WHERE completed_at IS NULL`)

    // ---- 2. Apply / chạy lại / gỡ / apply lại ------------------------------------------------------------------------------------------
    await check('apply V576: md5 bốn hàm = bản sinh; chạy lại bị chặn; gỡ trả đúng thân cũ; apply lại', async () => {
      await db.query(V.migration)
      assert.equal(await fnMd5(V.SIG.closeRun), V.NEW.closeRun)
      assert.equal(await fnMd5(V.SIG.closeDesktop), V.NEW.closeDesktop)
      assert.equal(await fnMd5(V.SIG.closeStale), V.NEW.closeStale)
      assert.equal(await fnMd5(V.SIG.wrapper), V.NEW.wrapper)
      await assert.rejects(db.query(V.migration), /hàm đóng lượt mới đã có/)
      await db.query('ROLLBACK').catch(() => {})
      await db.query(V.rollback)
      assert.equal(await fnMd5(V.SIG.closeStale), V.OLD.closeStale)
      assert.equal(await fnMd5(V.SIG.wrapper), V.OLD.wrapper)
      assert.equal(await val(`SELECT to_regprocedure('public.${V.SIG.closeRun}') IS NULL`), true)
      await assert.rejects(db.query(V.rollback), /không phải bản V576/)
      await db.query('ROLLBACK').catch(() => {})
      await db.query(V.migration)
    })
    await check('apply bị chặn khi close_stale / report_v1 khác bản đọc', async () => {
      await db.query(V.rollback)
      await db.query(`BEGIN`)
      await db.query(V.OLD_DEF.closeStale.replace('LIMIT greatest(1, p_limit)', 'LIMIT greatest(2, p_limit)'))
      await assert.rejects(db.query(V.migration.replace(/^BEGIN;\n/m, '')), /close_stale_v1 khác bản đọc/)
      await db.query('ROLLBACK')
      await db.query(V.migration)
    })
    await check('quyền: Desktop gọi được hàm đóng lượt của Desktop, không gọi được close_run; anon / authenticated không gọi được', async () => {
      const priv = (role, sig) => val(`SELECT has_function_privilege($1, to_regprocedure($2), 'EXECUTE')`, [role, `public.${sig}`])
      assert.equal(await priv('aka_agent_desktop', V.SIG.closeDesktop), true)
      assert.equal(await priv('aka_agent_desktop', V.SIG.closeRun), false)
      for (const role of ['anon', 'authenticated', 'aka_agent_chat_api']) {
        assert.equal(await priv(role, V.SIG.closeRun), false, role)
        assert.equal(await priv(role, V.SIG.closeDesktop), false, role)
      }
      assert.equal(await priv('service_role', V.SIG.closeRun), true)
      assert.equal(await priv('aka_agent_desktop', V.SIG.wrapper), true, 'hàm reset giữ quyền cũ')
    })

    // ---- 3. Bản mới --------------------------------------------------------------------------------------------------------------------
    const after = await scenarios()
    await check('B: chỉ có lượt gọi lại < 3 giây sau (như cùng lần nhận cả lô) → chưa đóng', async () => {
      const res = await closeStale()
      assert.equal((await runRow(after.b.orphan)).closed, false)
      assert.equal((await runRow(after.b2.first)).closed, false)
      assert.equal(res.orphanTargets, 0)
    })
    await check('B: cùng lease đã chốt lượt bắt đầu sau ≥ 3 giây → lượt mồ côi về hàng đợi ngay, lease còn hạn, release được', async () => {
      await run(after.b, after.b.token, after.b.data[2], 60, { closed: true })
      const res = await closeStale()
      assert.equal(res.orphanTargets, 1, JSON.stringify(res))
      const r = await runRow(after.b.orphan)
      assert.equal(r.closed, true); assert.equal(r.close_reason, 'stale'); assert.equal(r.final_target_status, 'chờ xử lý')
      assert.equal(r.final_error_code, 'err_engine_interrupted_before_send')
      assert.deepEqual(await dataRow(after.b.data[0]), { status: 'chờ xử lý', note: SYS01 })
      const ev = await one(`SELECT kind, data->>'via' AS via FROM public.auto_engine_target_events WHERE target_run_id = $1`, [after.b.orphan])
      assert.deepEqual(ev, { kind: 'interrupted', via: 'orphan' })
      assert.equal(await val(`SELECT count(*)::int FROM public.auto_engine_leases WHERE account_id = $1 AND lease_token = $2`, [after.b.acc, after.b.token]), 1)
      const rel = await val(`SELECT public.aka_agent_engine_release_v1($1, $2)`, [after.b.acc, after.b.token])
      assert.equal(rel.ok, true, JSON.stringify(rel))
    })
    await check('B: data mồ côi không được nhận lại trong cùng lượt (claim bỏ qua data đã thử với lease này)', async () => {
      const tried = await val(`SELECT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = $1 AND tr.lease_token = $2)`,
        [after.b.data[0], after.b.token])
      assert.equal(tried, true)
    })
    await check('B: không đụng lượt đã ghi dấu, lượt mới nhận < 2 phút', async () => {
      assert.equal((await runRow(after.b3.marked)).closed, false)
      assert.equal((await runRow(after.b3.young)).closed, false)
    })
    await check('D1: lượt đã gửi thành công, lease hết hạn → chốt theo kết quả (thành công), không SYS02, chuỗi data lỗi giữ 2', async () => {
      const r = await runRow(after.d.run)
      assert.equal(r.closed, true); assert.equal(r.close_reason, 'stale'); assert.equal(r.final_target_status, 'hoàn thành')
      assert.equal(r.final_error_code, null)
      assert.deepEqual(await dataRow(after.d.data[0]), { status: 'hoàn thành', note: null })
      const es = await one(`SELECT count_consecutive_bad_targets AS n, last_reason FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [after.d.camp])
      assert.deepEqual(es, { n: 2, last_reason: 'trước' })
      const ev = await one(`SELECT kind, error_code, data->>'via' AS via, data->>'final' AS final FROM public.auto_engine_target_events WHERE target_run_id = $1`, [after.d.run])
      assert.deepEqual(ev, { kind: 'interrupted', error_code: null, via: 'stale', final: 'outcomes' })
      assert.equal(await val(`SELECT count(*)::int FROM public.auto_campaign_details WHERE input_data_id = $1`, [after.d.data[0]]), 1, 'không thêm dòng lịch sử')
    })
    await check('D1 không áp: dấu còn pending → SYS02 như cũ; token bộ cũ → không đụng data', async () => {
      const p = await runRow(after.dp.run)
      assert.equal(p.final_error_code, 'err_engine_interrupted_while_sending')
      assert.deepEqual(await dataRow(after.dp.data[0]), { status: 'hoàn thành', note: SYS02 })
      const l = await runRow(after.dl.run)
      assert.equal(l.closed, true); assert.equal(l.final_error_code, 'err_engine_interrupted_while_sending')
      assert.equal((await dataRow(after.dl.data[0])).status, 'đang chạy', 'bộ cũ giữ data')
    })
    await check('A: reset Desktop → data engine chưa ghi dấu về hàng đợi (FB, Zalo), đã ghi dấu → SYS02, data không có lượt giữ cách cũ', async () => {
      await resetDesktop(7601)
      assert.deepEqual(await dataRow(after.a.data[0]), { status: 'chờ xử lý', note: SYS01 })
      assert.deepEqual(await dataRow(after.a.data[1]), { status: 'hoàn thành', note: SYS02 })
      assert.deepEqual(await dataRow(after.a.data[2]), { status: 'hoàn thành', note: LEGACY_NOTE })
      assert.deepEqual(await dataRow(after.az.data[0]), { status: 'chờ xử lý', note: SYS01 })
      for (const id of [after.a.unsent, after.a.marked, after.az.unsent]) {
        const r = await runRow(id)
        assert.equal(r.closed, true); assert.equal(r.close_reason, 'stale')
        assert.equal(await val(`SELECT data->>'via' FROM public.auto_engine_target_events WHERE target_run_id = $1`, [id]), 'desktop_reset')
      }
      assert.equal((await runRow(after.ao.unsent)).closed, false, 'lượt của nhân viên khác không đụng')
      assert.equal((await dataRow(after.ao.data[0])).status, 'đang chạy')
    })
    await check('A: phiên Desktop của nhân viên khác không đóng được lượt; service_role đóng được', async () => {
      assert.equal(await asStaff(7601, `SELECT public.aka_agent_engine_close_desktop_runs_v1(7602, false) AS r`).then(r => r.r), 0)
      assert.equal((await runRow(after.ao.unsent)).closed, false)
      assert.equal(await val(`SELECT public.aka_agent_engine_close_desktop_runs_v1(7602, false)`), 1)
      assert.deepEqual(await dataRow(after.ao.data[0]), { status: 'chờ xử lý', note: SYS01 })
    })
    await check('A: lượt đang bị khoá ở giao dịch khác (job close_stale đang đóng) thì bỏ qua, không chờ khoá', async () => {
      const w = await world()
      const token = await lease(w)
      const locked = await run(w, token, w.data[0], 30)
      const free = await run(w, token, w.data[1], 20)
      const other = await connect()
      try {
        await other.query('BEGIN')
        await other.query(`SELECT id FROM public.auto_engine_target_runs WHERE id = $1 FOR UPDATE`, [locked])
        await db.query(`SET statement_timeout = '5s'`)
        assert.equal(await val(`SELECT public.aka_agent_engine_close_desktop_runs_v1(7601, false)`), 1)
        await db.query(`SET statement_timeout = 0`)
        assert.equal((await runRow(free)).closed, true)
        await other.query('ROLLBACK')
        assert.equal((await runRow(locked)).closed, false)
      } finally {
        await other.end().catch(() => {})
      }
      assert.equal(await val(`SELECT public.aka_agent_engine_close_desktop_runs_v1(7601, false)`), 1)
    })
    await check('A: bỏ Zalo khi gọi với p_exclude_zalo', async () => {
      const w = await world({ platform: 'zalo', action: 'zalo_message_phone' })
      const token = await lease(w)
      const id = await run(w, token, w.data[0], 30)
      assert.equal(await val(`SELECT public.aka_agent_engine_close_desktop_runs_v1(7601, true)`), 0)
      assert.equal((await runRow(id)).closed, false)
      assert.equal(await val(`SELECT public.aka_agent_engine_close_desktop_runs_v1(7601, false)`), 1)
    })
    await check('B đầu cuối (claim / mark / report / release thật): mất câu trả lời claim → mồ côi → về hàng đợi → lượt sau chạy lại data đó', async () => {
      await db.query(`UPDATE public.auto_system_settings SET value = '{"mode":"all"}', is_active = true WHERE key = 'engine.facebook'`)
      await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
        VALUES (761, 10, 'demo', now() + interval '10 days')`)
      const w = await world({ data: 3, campaignStatus: 'chờ xử lý' })
      await db.query(`UPDATE public.auto_accounts SET status = 'chờ xử lý' WHERE id = $1`, [w.acc])
      const ctx = token => ({ staffId: w.staff, accountId: w.acc, campaignId: w.camp, runnerId: 'desktop:e2e', runtimeTarget: 'desktop',
        actions: [{ code: 'fb_post_group' }], ...(token ? { leaseToken: token } : {}) })
      const claim = token => asStaff(w.staff, `SELECT public.aka_agent_engine_claim_target_v1($1) AS r`, [ctx(token)]).then(r => r.r)
      const finish = async c => {
        assert.equal((await mark(w, c.targetRunId, c.leaseToken)).ok, true)
        const res = await asStaff(w.staff, `SELECT public.aka_agent_engine_report_v1($1, $2, $3, true, false) AS r`, [c.targetRunId, c.leaseToken,
          JSON.stringify([{ resultKey: `v2:${c.targetRunId}:post`, actionCode: 'fb_post_group', stepKey: 'post', ok: true, phase: 'after_send',
            statusCode: 'campaign_detail_success', data: { runId: '1' } }])]).then(r => r.r)
        assert.equal(res.ok, true, JSON.stringify(res)); assert.equal(res.target.done, true)
      }
      const c1 = await claim(null)
      assert.equal(c1.status, 'claimed', JSON.stringify(c1))
      // Câu trả lời của c1 "mất": nơi chạy gọi lại cùng lease, DB đưa data kế.
      const c2 = await claim(c1.leaseToken)
      assert.equal(c2.status, 'claimed'); assert.equal(c2.leaseToken, c1.leaseToken); assert.notEqual(Number(c2.target.id), Number(c1.target.id))
      await finish(c2)
      await db.query(`UPDATE public.auto_engine_target_runs SET started_at = now() - interval '5 minutes' WHERE id = $1`, [c1.targetRunId])
      const res = await closeStale()
      assert.equal(res.orphanTargets, 1, JSON.stringify(res))
      assert.deepEqual(await dataRow(Number(c1.target.id)), { status: 'chờ xử lý', note: SYS01 })
      const c3 = await claim(c1.leaseToken)
      assert.equal(c3.status, 'claimed'); assert.ok(![c1, c2].some(c => Number(c.target.id) === Number(c3.target.id)), 'lượt này không nhận lại data mồ côi')
      await finish(c3)
      const c4 = await claim(c1.leaseToken)
      assert.equal(c4.status, 'no_target'); assert.equal(Number(c4.dueTried), 1)
      const rel = await asStaff(w.staff, `SELECT public.aka_agent_engine_release_v1($1, $2) AS r`, [w.acc, c1.leaseToken]).then(r => r.r)
      assert.equal(rel.ok, true, JSON.stringify(rel))
      const c5 = await claim(null)
      assert.equal(c5.status, 'claimed'); assert.notEqual(c5.leaseToken, c1.leaseToken)
      assert.equal(Number(c5.target.id), Number(c1.target.id), 'lượt sau chạy lại data mồ côi')
      await finish(c5)
    })
    await check('close_stale: lượt chưa ghi dấu, lease hết hạn → về hàng đợi như cũ (requeue_unstarted)', async () => {
      const w = await world()
      const token = await lease(w, { alive: false })
      const id = await run(w, token, w.data[0], 900)
      const res = await closeStale()
      assert.ok(res.closedTargets >= 1)
      assert.equal((await runRow(id)).final_target_status, 'chờ xử lý')
      assert.deepEqual(await dataRow(w.data[0]), { status: 'chờ xử lý', note: SYS01 })
    })
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  if (failed) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
