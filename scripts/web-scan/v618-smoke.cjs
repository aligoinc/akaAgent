#!/usr/bin/env node
// Kiểm V618 (quét data website chạy bằng engine v2) trên PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/web-scan/v618-smoke.cjs
// DB engine như production (bootstrap + V556–V564 của bài kiểm Facebook), rồi nạp nguyên văn thân hàm engine production đọc 21/11/2026
// (scripts/fixtures/web-scan/live-20261121) để migration vá đúng bản đang chạy. Apply p1 → p3, chạy claim / report / RPC thật với tài khoản
// Website, so hạn mức, khoá, data về hàng đợi; gỡ p3 → p2 → p1 trả về đúng md5 production; apply lại bị từ chối.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('../engine-v2-facebook/fixture.cjs')
const V = require('../build-v618-sql.cjs')

const PORT = Number(process.env.WEB_SCAN_V618_PORT || 55614)
const LIVE_DIR = path.join(__dirname, '../fixtures/web-scan/live-20261121')
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
async function insertRows(db, table, rows) {
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows
    .map(r => r.column_name)
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
  const list = keys.map(k => `"${k}"`).join(', ')
  await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
    [JSON.stringify(rows)])
}
const asDesktop = async (db, staffId, fn) => {
  await db.query('BEGIN')
  try {
    await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [staffId == null ? '' : String(staffId)])
    await db.query('SET LOCAL ROLE aka_agent_desktop')
    const out = await fn()
    await db.query('COMMIT')
    return out
  } catch (error) { await db.query('ROLLBACK'); throw error }
}
async function rejects(db, sql, pattern) {
  try { await db.query(sql) } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    assert.match(String(error.message), pattern)
    return
  }
  assert.fail('câu lệnh phải bị từ chối')
}
const md5Of = async (db, sig) => (await one(db, `SELECT md5(pg_get_functiondef($1::regprocedure)) AS m`, [sig])).m

const STAFF = 9101
const OTHER_STAFF = 9102
const ACCOUNT = 96101
const CAMPAIGN = 96201
const CODE = V.ACTION_CODES.nhatot

async function loadLive(db) {
  // Thân hàm production: nạp đè bản của DB thử (không kiểm thân lúc tạo, như production đã có đủ đối tượng).
  await db.query(`SET check_function_bodies = off`)
  for (const file of fs.readdirSync(LIVE_DIR).filter(f => f.endsWith('.sql')).sort()) {
    await db.query(fs.readFileSync(path.join(LIVE_DIR, file), 'utf8'))
  }
  // Bảng production mà DB thử chưa có (cột như production đọc 21/11/2026).
  await db.query(`CREATE TABLE IF NOT EXISTS public.auto_elements (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, xpath text NOT NULL, description text,
    category text, is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`)
  // Hàm production mà thân aka_agent_app_access_account_allowed (nạp ở trên) gọi: tổ chức không tách quyền app.
  await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_app_access_separate(p_org bigint) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$`)
  // Thân thật đọc cột org_staff mà DB thử không có; tổ chức không tách quyền app thì thân thật luôn trả true.
  await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_app_access_account_allowed(p_account bigint, p_app text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$`)
  // Thân hàm SQL của production (snapshot tài khoản, gói quyền) tham chiếu đối tượng mà DB thử không có: giữ tắt kiểm thân cho cả phiên.
}

async function seed(db) {
  await db.query(`INSERT INTO public.org_organization (id, name) VALUES (1, 'akaBiz'), (2, 'Khác') ON CONFLICT DO NOTHING`)
  await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, 1, 'web1', 'pw'), ($2, 2, 'web2', 'pw')`, [STAFF, OTHER_STAFF])
  await insertRows(db, 'auto_accounts', [
    { id: ACCOUNT, name: 'Website 1', flatform_type: 'web', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
      staff_id: STAFF, organization_id: 1, is_zalo_server: false, is_zalo_show_web: false },
    { id: ACCOUNT + 1, name: 'Website khác', flatform_type: 'web', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
      staff_id: OTHER_STAFF, organization_id: 2, is_zalo_server: false, is_zalo_show_web: false }])
  const sched = new Date(Date.now() - 60_000).toISOString()
  await insertRows(db, 'auto_campaigns', [
    { id: CAMPAIGN, name: 'Môi giới Q7', action_id: V.ACTION_IDS.nhatot, account_id: ACCOUNT, status: 'chờ xử lý', is_delete: false, staff_id: STAFF,
      organization_id: 1, schedule: sched, schedule_type: 'daily', extra_settings: { webScan: { site: 'nhatot' } } },
    { id: CAMPAIGN + 1, name: 'Tổ chức khác', action_id: V.ACTION_IDS.nhatot, account_id: ACCOUNT + 1, status: 'chờ xử lý', is_delete: false,
      staff_id: OTHER_STAFF, organization_id: 2, schedule: sched, schedule_type: 'daily', extra_settings: {} }])
  await insertRows(db, 'auto_campaign_input_data', [
    { id: 97101, campaign_id: CAMPAIGN, status: 'chờ xử lý', name: 'nhà quận 7', uid: 'nhà quận 7', is_delete: false },
    { id: 97102, campaign_id: CAMPAIGN, status: 'chờ xử lý', name: 'Vinhomes Grand Park', uid: 'Vinhomes Grand Park', is_delete: false },
    { id: 97103, campaign_id: CAMPAIGN, status: 'chờ xử lý', name: 'căn hộ Thủ Đức', uid: 'căn hộ Thủ Đức', is_delete: false },
    { id: 97111, campaign_id: CAMPAIGN + 1, status: 'chờ xử lý', name: 'quận 1', uid: 'quận 1', is_delete: false }])
}

const ctx = (extra = {}) => ({ staffId: STAFF, accountId: ACCOUNT, campaignId: CAMPAIGN, runnerId: 'desktop:web-smoke', runtimeTarget: 'desktop',
  actions: [{ code: CODE }], ...extra })
const claim = (db, c, staff = STAFF) => asDesktop(db, staff, () => one(db, 'SELECT public.aka_agent_engine_claim_target_v1($1) AS r', [c]).then(r => r.r))
const report = (db, runId, lease, outcomes, final) => asDesktop(db, STAFF, () => one(db,
  'SELECT public.aka_agent_engine_report_v1($1, $2, $3, $4, false) AS r', [runId, lease, JSON.stringify(outcomes), final]).then(r => r.r))
const release = (db, lease) => asDesktop(db, STAFF, () => one(db, 'SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [ACCOUNT, lease]).then(r => r.r))
const reveal = (runId, n) => ({ resultKey: `v2:${runId}:reveal:${n}`, actionCode: CODE, actionName: V.ACTION_NAMES.nhatot, ok: true, phase: 'after_send',
  log: `📞 Hiện SĐT tin ${n}: 090900000${n}`, data: { listingKey: `L${n}` } })
const findData = (runId, records = 1) => ({ resultKey: `v2:${runId}:find-data`, actionCode: '', actionName: 'Tìm data', ok: true, phase: 'after_send',
  log: `Tìm được ${records} data`, data: { webRecords: [] } })
const failure = (runId, key, errorCode, phase = 'before_send') => ({ resultKey: `v2:${runId}:${key}`, actionCode: '', actionName: 'Tìm data', ok: false, phase,
  signal: { kind: 'engine', code: key, errorCode } })

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-web-v618-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await loadLive(db)
    const liveMd5 = {}
    for (const [key, item] of Object.entries(V.LIVE)) liveMd5[key] = await md5Of(db, item.sig)

    await check('DB thử nạp đúng thân hàm production đã đọc (md5 = bộ sinh)', async () => {
      assert.deepEqual(liveMd5, V.LIVE_MD5)
    })
    await check('p2 / p3 từ chối khi chưa có phần trước', async () => {
      await rejects(db, V.sql.p2, /chưa apply p1/)
      await rejects(db, V.sql.p3, /chưa apply p2/)
    })
    await check('apply p1 → p3; chạy lại từng phần bị từ chối', async () => {
      await db.query(V.sql.p1)
      await db.query(V.sql.p2)
      await db.query(V.sql.p3)
      await rejects(db, V.sql.p1, /đã có bảng/)
      await rejects(db, V.sql.p2, /p2 đã chạy/)
      await rejects(db, V.sql.p3, /đã có dữ liệu/)
      for (const [key, item] of Object.entries(V.LIVE)) assert.equal(await md5Of(db, item.sig), V.NEXT_MD5[key], key)
      const acts = (await db.query(`SELECT id, is_active, limit_check_action_codes FROM public.auto_campaign_actions WHERE id LIKE 'web\\_%' ORDER BY id`)).rows
      assert.deepEqual(acts.map(a => [a.id, a.is_active]), [[V.ACTION_IDS.batdongsan, false], [V.ACTION_IDS.nhatot, false], [V.ACTION_IDS.yellowpages, false]])
      assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.auto_blocks WHERE name LIKE '[engine] web\\_%'`)).n, V.BLOCKS.length)
    })

    await seed(db)

    let lease = null
    let runId = null
    await check('claim tài khoản Website: chỉ Desktop, tổ chức bật; trả số lượt còn lại (mặc định 100 / ngày, giờ = ngày)', async () => {
      await db.query(`UPDATE public.org_organization SET use_new_zalo_runtime = true WHERE id = 1`).catch(() => undefined)
      const fly = await claim(db, ctx({ runtimeTarget: 'fly' }), null)
      assert.ok(['runtime_not_owner', 'not_enabled'].includes(fly.status), JSON.stringify(fly))
      await db.query(`UPDATE public.auto_system_settings SET value = '{"organizationIds":[2]}' WHERE key = $1`, [V.SETTING_KEY])
      assert.equal((await claim(db, ctx())).status, 'not_enabled')
      await db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [V.SETTING_KEY, V.SETTING_VALUE])
      const r = await claim(db, ctx())
      assert.equal(r.status, 'claimed', JSON.stringify(r))
      assert.equal(Number(r.actions[CODE].remainingDaily), 100)
      assert.equal(Number(r.actions[CODE].remainingWindow), 100)
      lease = r.leaseToken
      runId = r.targetRunId
    })
    await check('report: 3 lần hiện SĐT tính 3 lượt + dòng "Tìm data" không mã thao tác (chiến dịch web) → data hoàn thành', async () => {
      const r = await report(db, runId, lease, [reveal(runId, 1), reveal(runId, 2), reveal(runId, 3), findData(runId, 3)], true)
      assert.equal(r.ok, true, JSON.stringify(r))
      assert.equal(r.target.status, 'hoàn thành')
      const used = await one(db, `SELECT count_action_in_day::int AS n FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, CODE])
      assert.equal(used.n, 3)
      const rows = (await db.query(`SELECT action_code, action_name, status, counts_toward_limit FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [CAMPAIGN])).rows
      assert.equal(rows.length, 4)
      assert.deepEqual(rows.slice(0, 3).map(x => [x.action_code, x.status, x.counts_toward_limit]), Array(3).fill([CODE, 'thành công', true]))
      assert.deepEqual([rows[3].action_code, rows[3].action_name, rows[3].status], [null, 'Tìm data', 'thành công'])
    })
    await check('claim kế tiếp (cùng lease): còn 97 lượt trong ngày và trong giờ', async () => {
      const r = await claim(db, ctx({ leaseToken: lease }))
      assert.equal(r.status, 'claimed', JSON.stringify(r))
      assert.equal(Number(r.actions[CODE].remainingDaily), 97)
      assert.equal(Number(r.actions[CODE].remainingWindow), 97)
      runId = r.targetRunId
    })
    await check('hết lượt giữa từ khoá (WB03): từ khoá về hàng đợi, kết quả đã có vẫn ghi', async () => {
      const r = await report(db, runId, lease, [reveal(runId, 1), findData(runId, 1), failure(runId, 'quota', 'err_web_scan_quota_reached')], true)
      assert.equal(r.ok, true, JSON.stringify(r))
      assert.equal(r.target.status, 'chờ xử lý')
      assert.equal(r.next, 'end_unit')
      await release(db, lease)
    })
    await check('trang đòi xác minh (WB01): tạm dừng chiến dịch, từ khoá về hàng đợi, không tính lượt', async () => {
      const c = await claim(db, ctx())
      assert.equal(c.status, 'claimed', JSON.stringify(c))
      const r = await report(db, c.targetRunId, c.leaseToken, [failure(c.targetRunId, 'challenge', 'err_web_scan_challenge')], true)
      assert.equal(r.target.status, 'chờ xử lý')
      assert.equal(r.campaign.effect, 'pause')
      const camp = await one(db, `SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [CAMPAIGN])
      assert.equal(camp.status, 'tạm dừng')
      assert.match(camp.note, /WB01/)
      await release(db, c.leaseToken)
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL WHERE id = $1`, [CAMPAIGN])
    })
    await check('chưa đăng nhập batdongsan (WB02): khoá riêng "Hiện số batdongsan" 30 phút, claim chờ khoá đó', async () => {
      const c = await claim(db, ctx())
      const r = await report(db, c.targetRunId, c.leaseToken, [failure(c.targetRunId, 'login', 'err_web_scan_batdongsan_login')], true)
      assert.equal(r.target.status, 'chờ xử lý')
      await release(db, c.leaseToken)
      const lock = await one(db, `SELECT is_disable, date_enable FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = $2`,
        [ACCOUNT, V.ACTION_CODES.batdongsan])
      assert.equal(lock.is_disable, true)
      const minutes = (new Date(lock.date_enable).getTime() - Date.now()) / 60_000
      assert.ok(minutes > 28 && minutes <= 31, `khoá ${minutes} phút`)
      const w = await claim(db, ctx({ actions: [{ code: V.ACTION_CODES.batdongsan }] }))
      assert.equal(w.status, 'wait', JSON.stringify(w))
      assert.equal(w.wait.gate, 'action_lock')
      await release(db, w.leaseToken).catch(() => undefined)
      await db.query(`UPDATE public.auto_account_action_status SET is_disable = false WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, V.ACTION_CODES.batdongsan])
    })
    await check('không đọc được danh sách (WB04): ghi "thất bại", cộng chuỗi; 3 từ khoá liền thì tạm dừng', async () => {
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', date_action = NULL WHERE campaign_id = $1`, [CAMPAIGN])
      let last = null
      for (let i = 0; i < 3; i++) {
        const c = await claim(db, ctx())
        assert.equal(c.status, 'claimed', JSON.stringify(c))
        last = await report(db, c.targetRunId, c.leaseToken, [failure(c.targetRunId, 'layout', 'err_web_scan_layout_changed', 'after_send')], true)
        assert.equal(last.target.status, 'hoàn thành')
        await release(db, c.leaseToken)
        if (last.campaign.effect === 'pause') break
      }
      assert.equal(last.campaign.effect, 'pause', JSON.stringify(last))
      assert.equal(last.streak.count, 3)
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL WHERE id = $1`, [CAMPAIGN])
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý' WHERE campaign_id = $1`, [CAMPAIGN])
      await db.query(`UPDATE public.auto_campaign_error_state SET count_consecutive_bad_targets = 0 WHERE campaign_id = $1`, [CAMPAIGN])
    })
    await check('bỏ dở giữa từ khoá (app chết ngang / máy ngủ): dọn lượt trả từ khoá web về hàng đợi dù đã có kết quả; loại khác giữ cách cũ', async () => {
      await db.query(`INSERT INTO public.auto_system_settings (key, value, is_active) VALUES ('engine.stale_unsent_target_action', 'requeue_unstarted', true)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_active = true`).catch(async () => {
        await db.query(`UPDATE public.auto_system_settings SET value = 'requeue_unstarted', is_active = true WHERE key = 'engine.stale_unsent_target_action'`)
      })
      const leave = async () => {
        const c = await claim(db, ctx())
        assert.equal(c.status, 'claimed', JSON.stringify(c))
        // Một lần hiện số đã báo (lượt có kết quả), rồi app chết: không báo chốt, không nhả lease.
        const r = await report(db, c.targetRunId, c.leaseToken, [reveal(c.targetRunId, 9)], false)
        assert.equal(r.ok, true, JSON.stringify(r))
        return c
      }
      const usedBefore = (await one(db, `SELECT count_action_in_day::int AS n FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, CODE])).n
      // Đối chứng: cùng lượt nhưng loại chiến dịch không phải web → giữ cách cũ (lượt đã có kết quả thì đóng "hoàn thành").
      const control = await leave()
      await db.query(`UPDATE public.auto_campaign_actions SET flatform_type = 'facebook' WHERE id = $1`, [V.ACTION_IDS.nhatot])
      try {
        assert.equal(await asDesktop(db, STAFF, () => one(db, 'SELECT public.aka_agent_engine_close_desktop_runs_v1($1) AS n', [STAFF]).then(r => r.n)), 1)
      } finally {
        await db.query(`UPDATE public.auto_campaign_actions SET flatform_type = 'web' WHERE id = $1`, [V.ACTION_IDS.nhatot])
      }
      const controlRow = await one(db, `SELECT status FROM public.auto_campaign_input_data WHERE id = (SELECT input_data_id FROM public.auto_engine_target_runs WHERE id = $1)`, [control.targetRunId])
      assert.equal(controlRow.status, 'hoàn thành')
      await release(db, control.leaseToken).catch(() => undefined)
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = NULL WHERE campaign_id = $1`, [CAMPAIGN])
      // Chiến dịch web: từ khoá về hàng đợi, lần hiện số đã báo vẫn tính lượt, sổ lượt ghi bị bỏ dở.
      const c = await leave()
      assert.equal(await asDesktop(db, STAFF, () => one(db, 'SELECT public.aka_agent_engine_close_desktop_runs_v1($1) AS n', [STAFF]).then(r => r.n)), 1)
      const run = await one(db, `SELECT final_target_status, final_error_code, input_data_id FROM public.auto_engine_target_runs WHERE id = $1`, [c.targetRunId])
      assert.deepEqual([run.final_target_status, run.final_error_code], ['chờ xử lý', 'err_engine_interrupted_before_send'])
      const row = await one(db, `SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [run.input_data_id])
      assert.equal(row.status, 'chờ xử lý')
      assert.match(String(row.note), /SYS01/)
      const usedAfter = (await one(db, `SELECT count_action_in_day::int AS n FROM public.auto_account_action_status WHERE account_id = $1 AND action_code = $2`, [ACCOUNT, CODE])).n
      assert.equal(usedAfter - usedBefore, 2, 'hai lần hiện số đã báo (đối chứng + lượt này) vẫn tính lượt')
      await release(db, c.leaseToken).catch(() => undefined)
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = NULL WHERE campaign_id = $1`, [CAMPAIGN])
    })
    await check('hạn mức mã web: không đặt = 100 / ngày (giờ = ngày, 60 phút); đặt quá 500 thì kẹt 500; mã Zalo / FB không đổi', async () => {
      const lim = async () => (await one(db, `SELECT public.aka_agent_engine_action_limit($1, $2, $3) AS r`, [CAMPAIGN, ACCOUNT, CODE])).r
      assert.deepEqual(await lim(), { daily: 100, windowCount: 100, windowMinutes: 60 })
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = jsonb_set(extra_settings, '{actionLimits}', $2::jsonb) WHERE id = $1`,
        [CAMPAIGN, JSON.stringify({ byActionCode: { [CODE]: { dailyLimit: 800, rateLimitCount: 900, rateLimitMinutes: 30 } } })])
      assert.deepEqual(await lim(), { daily: 500, windowCount: 500, windowMinutes: 30 })
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = jsonb_set(extra_settings, '{actionLimits}', $2::jsonb) WHERE id = $1`,
        [CAMPAIGN, JSON.stringify({ byActionCode: { [CODE]: { dailyLimit: 120 } } })])
      assert.deepEqual(await lim(), { daily: 120, windowCount: 120, windowMinutes: 60 })
      const fb = (await one(db, `SELECT public.aka_agent_engine_action_limit($1, $2, 'fb_comment') AS r`, [CAMPAIGN, ACCOUNT])).r
      assert.deepEqual(fb, { daily: 30, windowCount: 9, windowMinutes: 65 })
    })
    await check('RPC tin đã quét: ghi / đọc theo chiến dịch, số đã hiện dùng chung trong tổ chức, không chéo tổ chức', async () => {
      const rec = await asDesktop(db, STAFF, () => one(db, `SELECT public.aka_agent_web_scan_record_v1($1, 'nhatot', $2) AS r`, [CAMPAIGN,
        JSON.stringify([{ key: 'L1', phone: '0909000001', name: 'An', data: { title: 'Nhà Q7' } }, { key: 'L2' }, { key: 'L3', phone: '12345' }])]).then(x => x.r))
      assert.deepEqual(rec, { ok: true, seen: 3, cached: 1 })
      const seen = await asDesktop(db, STAFF, () => one(db, `SELECT public.aka_agent_web_scan_seen_v1($1, 'nhatot', $2) AS r`, [CAMPAIGN, ['L1', 'L2', 'L9']]).then(x => x.r))
      assert.deepEqual(seen.seen, ['L1', 'L2'])
      assert.deepEqual(Object.keys(seen.cached), ['L1'])
      assert.equal(seen.cached.L1.phone, '0909000001')
      const otherOff = await asDesktop(db, OTHER_STAFF, () => one(db, `SELECT public.aka_agent_web_scan_seen_v1($1, 'nhatot', $2) AS r`, [CAMPAIGN + 1, ['L1']]).then(x => x.r))
      assert.equal(otherOff.reason, 'not_enabled')
      await db.query(`UPDATE public.auto_system_settings SET value = '{"organizationIds":[1,2]}' WHERE key = $1`, [V.SETTING_KEY])
      const other = await asDesktop(db, OTHER_STAFF, () => one(db, `SELECT public.aka_agent_web_scan_seen_v1($1, 'nhatot', $2) AS r`, [CAMPAIGN + 1, ['L1']]).then(x => x.r))
      assert.deepEqual(other, { ok: true, seen: [], cached: {} })
      await db.query(`UPDATE public.auto_system_settings SET value = $2 WHERE key = $1`, [V.SETTING_KEY, V.SETTING_VALUE])
      const stolen = await asDesktop(db, OTHER_STAFF, () => one(db, `SELECT public.aka_agent_web_scan_seen_v1($1, 'nhatot', $2) AS r`, [CAMPAIGN, ['L1']]).then(x => x.r))
      assert.equal(stolen.reason, 'not_found')
      const bad = await asDesktop(db, STAFF, () => one(db, `SELECT public.aka_agent_web_scan_seen_v1($1, 'facebook', $2) AS r`, [CAMPAIGN, ['L1']]).then(x => x.r))
      assert.equal(bad.reason, 'invalid_site')
      await db.query(`UPDATE private.auto_web_scan_listings SET revealed_at = now() - interval '31 days'`)
      const old = await asDesktop(db, STAFF, () => one(db, `SELECT public.aka_agent_web_scan_seen_v1($1, 'nhatot', $2) AS r`, [CAMPAIGN, ['L1']]).then(x => x.r))
      assert.deepEqual(old.cached, {})
      const ret = (await one(db, `SELECT public.aka_agent_web_scan_retention_v1() AS r`)).r
      assert.deepEqual(ret, { seen: 0, listings: 1 })
    })
    await check('snapshot tài khoản Desktop: tài khoản web theo khoá webScan, không theo khoá Zalo Web', async () => {
      const def = (await one(db, `SELECT pg_get_functiondef('${V.LIVE.snapshot.sig}'::regprocedure) AS d`)).d
      assert.match(def, /WHEN a\.flatform_type='web' THEN 'webScan'/)
    })

    await check('gỡ p3 → p2 → p1: trả đúng md5 production, xoá hết dữ liệu / bảng (dữ liệu thử của chiến dịch web xoá trước)', async () => {
      await rejects(db, fs.readFileSync(path.join(__dirname, '../../migrations', `${V.NAMES.r3}.sql`), 'utf8'), /còn chiến dịch web/)
      await db.query(`DELETE FROM public.auto_campaign_details WHERE campaign_id IN ($1, $2)`, [CAMPAIGN, CAMPAIGN + 1])
      await db.query(`DELETE FROM public.auto_engine_outcomes WHERE campaign_id IN ($1, $2)`, [CAMPAIGN, CAMPAIGN + 1])
      await db.query(`DELETE FROM public.auto_engine_target_runs WHERE campaign_id IN ($1, $2)`, [CAMPAIGN, CAMPAIGN + 1])
      await db.query(`DELETE FROM public.auto_engine_leases WHERE account_id IN ($1, $2)`, [ACCOUNT, ACCOUNT + 1])
      await db.query(`DELETE FROM public.auto_campaign_error_state WHERE campaign_id IN ($1, $2)`, [CAMPAIGN, CAMPAIGN + 1])
      await db.query(`DELETE FROM public.auto_campaign_input_data WHERE campaign_id IN ($1, $2)`, [CAMPAIGN, CAMPAIGN + 1])
      await db.query(`DELETE FROM public.auto_campaigns WHERE id IN ($1, $2)`, [CAMPAIGN, CAMPAIGN + 1])
      await rejects(db, V.sql.r1, /gỡ p2 trước/)
      await rejects(db, V.sql.r2, /gỡ p3 trước/)
      await db.query(V.sql.r3)
      await db.query(V.sql.r2)
      await db.query(V.sql.r1)
      for (const [key, item] of Object.entries(V.LIVE)) assert.equal(await md5Of(db, item.sig), V.LIVE_MD5[key], key)
      assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.auto_system_settings WHERE key = $1`, [V.SETTING_KEY])).n, 0)
      assert.equal((await one(db, `SELECT to_regclass('private.auto_web_scan_seen') AS t`)).t, null)
      assert.equal((await one(db, `SELECT to_regprocedure('public.aka_agent_web_scan_seen_v1(bigint,text,text[])') AS f`)).f, null)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main().catch(error => { console.error(error); process.exit(1) })
