// V661: bộ canh "tăng bất thường" của bộ kiểm lỗi chiến dịch Facebook đếm số lượt data, không đếm số dòng kết quả (anh chọn "Đếm theo data, mọi
// mã" 26/11/2026, câu 6279; câu 3300 / 6279 báo nhầm vì một data đăng nhóm có 20 comment bị bỏ qua thành 20 lượt FB45).
// PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/engine-v2-facebook/error-watch-v661-smoke.cjs
// DB engine như production + V574 + V588 + V593 + V594 + V599 + V602 + bản giả nền Hỏi đáp AI; chạy cùng bộ kết quả giả trên bản V602 (tái hiện:
// đếm theo dòng, báo tăng bất thường nhầm) rồi trên bản V661.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
const { AI_STUBS } = require('./error-watch-fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_WATCH_V661_PORT || 55661)
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, ADMIN = 4, CUSTOMER_ORG = 701
const FB45 = 'err_engine_fb_no_history'
const RUN01 = 'err_engine_cancelled'
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
/** Dòng thử lùi tới 4 phút và tick so theo giờ hiện tại: tránh phút đầu / cuối giờ để mọi dòng của một ca nằm cùng một giờ. */
async function awayFromHourEdge() {
  for (;;) {
    const minute = new Date().getUTCMinutes()
    if (minute >= 6 && minute <= 57) return
    console.log(`(chờ qua phút ${minute} để dòng thử không vắt qua hai giờ)`)
    await sleep(20_000)
  }
}

async function main() {
  const { NEW_BODY_MD5: V602_NEW_MD5 } = require('../build-v602-sql.cjs')
  const { V602_BODY_MD5, NEW_BODY_MD5 } = require('../build-v661-sql.cjs')
  assert.equal(V602_BODY_MD5, V602_NEW_MD5, 'thân V602 trong build-v661 phải trùng bản build-v602 sinh ra')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-watch-v661-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const all = async (sql, args = []) => (await db.query(sql, args)).rows
  const tick = async () => (await one('SELECT public.aka_agent_engine_error_watch_tick_v1() AS r')).r
  const setCfg = patch => db.query(`UPDATE public.auto_system_settings SET value = (value::jsonb || $1::jsonb)::text WHERE key = 'engine.error_watch'`, [JSON.stringify(patch)])
  const bodyMd5 = async () => (await one(`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure`)).m
  let nextId = 990000

  const customer = async () => {
    const staff = ++nextId, account = ++nextId, campaign = ++nextId
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_admin_akabiz) VALUES ($1, $2, $3, 'pw', false)`, [staff, CUSTOMER_ORG, `khach${staff}`])
    await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server,
        is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB thử', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`, [account, staff, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
        extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'Đăng nhóm thử', 'facebook_group_post', $2, 'chờ xử lý', now(), false, $3, $4, 'daily', '{}')`,
      [campaign, account, staff, CUSTOMER_ORG])
    return { staff, account, campaign }
  }
  /** Một lượt data (target run) đã đóng. */
  const targetRun = async who => {
    const data = ++nextId
    await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, 'nhóm', 'g', 'hoàn thành', false)`, [data, who.campaign])
    const run = await one(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id,
        runtime_target, started_at, completed_at, close_reason, final_error_code, final_response)
      VALUES ($1, $2, $3, $4, $5, $6, 'desktop:test', 'desktop', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '19 minutes',
        'done', NULL, '{}') RETURNING id`, [data, who.campaign, who.account, who.staff, CUSTOMER_ORG, crypto.randomUUID()])
    return { id: Number(run.id), data, who }
  }
  /** `n` dòng kết quả của một lượt data, `ago` trước (ví dụ 20 comment bị bỏ qua của một data đăng nhóm). */
  const outcomes = async (run, { n = 1, code = FB45, action = 'fb_comment', ago = '3 minutes', ok = false, step = 'comment' } = {}) => {
    for (let i = 0; i < n; i++) {
      await db.query(`INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
          error_code, delivery_state, decision, signal, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'before_send', $7, $8, 'not_delivered', '{}'::jsonb, '{"kind":"engine","code":"no_history"}'::jsonb,
          clock_timestamp() - $9::interval)`,
      [`v2:${run.id}:${step}#${i}:${crypto.randomUUID().slice(0, 8)}`, run.id, run.data, run.who.campaign, run.who.account, action, ok,
        ok ? null : code, ago])
    }
  }
  const resetWatch = async () => {
    await db.query(`DELETE FROM private.auto_engine_error_hourly`)
    await db.query(`DELETE FROM private.auto_engine_error_cases`)
    await db.query(`DELETE FROM public.auto_engine_outcomes`)
    await db.query(`UPDATE private.auto_engine_error_watch_state SET cursor_at = clock_timestamp() - interval '10 minutes'`)
  }
  const hourly = async () => all(`SELECT error_code, action_code, hour_at, n::int AS n FROM private.auto_engine_error_hourly ORDER BY error_code, action_code, hour_at`)
  /** Số mong đợi theo giờ từ chính các dòng kết quả: theo dòng (V602) hoặc theo lượt data khác nhau (V661). */
  const expected = async mode => all(`SELECT error_code, coalesce(action_code, '') AS action_code, date_trunc('hour', created_at) AS hour_at,
      (${mode === 'rows' ? 'count(*)' : 'count(DISTINCT target_run_id)'})::int AS n
    FROM public.auto_engine_outcomes WHERE NOT ok AND error_code IS NOT NULL GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)
  const spikeCase = async code => one(`SELECT case_key, hits::int AS hits, pattern FROM private.auto_engine_error_cases WHERE kind = 'tang_bat_thuong' AND error_code = $1`, [code])
  /** Mức nền: 7 ngày trước cùng giờ, mỗi giờ 2 lượt (đủ >= 3 ngày dữ liệu cho bước 4). */
  const baseline = async code => {
    for (let d = 1; d <= 7; d++) {
      await db.query(`INSERT INTO private.auto_engine_error_hourly (platform, error_code, action_code, hour_at, n)
        VALUES ('facebook', $1, 'fb_comment', date_trunc('hour', clock_timestamp()) - make_interval(days => $2), 2)`, [code, d])
    }
  }

  /**
   * Cùng một bộ kết quả cho cả hai bản: hai lần tick trong cùng khoảng giờ (dòng của một data rơi vào hai lần tick).
   *   A: 1 data, 20 dòng FB45 (đăng nhóm có bài chờ duyệt, 20 comment bị bỏ qua);  B, C, D: mỗi data 1 dòng FB45;
   *   E: 1 data có 3 dòng FB45 ở tick 1 và thêm 2 dòng ở tick 2;  F: 1 data có 1 dòng FB45 + 1 dòng RUN01;  G: dòng ok (không tính).
   *   Tick 2: thêm data H (1 dòng FB45).
   */
  const scenario = async who => {
    await awayFromHourEdge()
    const runs = {}
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) runs[k] = await targetRun(who)
    await outcomes(runs.A, { n: 20, ago: '4 minutes' })
    for (const k of ['B', 'C', 'D']) await outcomes(runs[k], { ago: '4 minutes' })
    await outcomes(runs.E, { n: 3, ago: '4 minutes', step: 'comment_a' })
    await outcomes(runs.F, { ago: '4 minutes' })
    await outcomes(runs.F, { code: RUN01, ago: '4 minutes', step: 'stop' })
    await outcomes(runs.G, { ok: true, ago: '4 minutes' })
    const first = await tick()
    assert.equal(first.ok, true, JSON.stringify(first))
    // Dòng của tick 2: sau mốc của tick 1 (= lúc tick 1 trừ 15 giây) và trước lúc tick 2 trừ 15 giây.
    await outcomes(runs.E, { n: 2, ago: '10 seconds', step: 'comment_b' })
    await outcomes(runs.H, { ago: '10 seconds' })
    await sleep(6_000)
    const second = await tick()
    assert.equal(second.ok, true, JSON.stringify(second))
    return runs
  }

  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(AI_STUBS)
    await db.query(`ALTER TABLE public.auto_staff_device_presence ADD COLUMN ended_at timestamptz`)
    await db.query(`ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean NOT NULL DEFAULT false`)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'akaBiz'), ($2, 'Khách thử') ON CONFLICT DO NOTHING`, [ORG, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_admin_akabiz) VALUES ($1, $2, 'nhutlq', 'pw', true)`, [ADMIN, ORG])
    for (const f of ['migration_v574_engine_error_watch.sql', 'migration_v588_engine_error_review.sql', 'migration_v593_engine_error_watch_order_images.sql',
      'migration_v594_engine_error_watch_hourly_skip.sql', 'migration_v599_engine_error_watch_multi_images.sql',
      'migration_v602_engine_error_watch_stale_via.sql']) await db.query(readMigration(f))
    await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
    // Chỉ kiểm phần đếm / gom ca: không chèn câu hỏi.
    await setCfg({ enabled: true, enqueue: false, staffId: ADMIN, imageRequests: false })
    const migration = readMigration('migration_v661_engine_error_watch_spike_per_data.sql')
    const rollback = readMigration('rollback_v661_engine_error_watch_spike_per_data.sql')
    const who = await customer()

    await check('V602 (trước bản sửa, tái hiện câu 3300 / 6279): số theo giờ đếm số dòng kết quả', async () => {
      assert.equal(await bodyMd5(), V602_BODY_MD5)
      await resetWatch()
      await scenario(who)
      assert.deepEqual(await hourly(), await expected('rows'))
      const fb45 = (await hourly()).filter(h => h.error_code === FB45).reduce((s, h) => s + h.n, 0)
      assert.equal(fb45, 20 + 3 + 3 + 2 + 1 + 1, 'A tính 20, E tính 5')
    })

    await check('V602: 1 data có 25 comment bị bỏ qua đủ thành "tăng bất thường" (báo nhầm)', async () => {
      await awayFromHourEdge()
      await resetWatch()
      await baseline(FB45)
      const run = await targetRun(who)
      await outcomes(run, { n: 25, ago: '2 minutes' })
      await tick()
      const spike = await spikeCase(FB45)
      assert.ok(spike, 'bản cũ mở ca tăng bất thường từ một data')
      assert.equal(spike.hits, 25)
    })

    await check('apply V661: thân tick đúng md5, chú thích ghi V661; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
      const comment = (await one(`SELECT obj_description('public.aka_agent_engine_error_watch_tick_v1()'::regprocedure, 'pg_proc') AS c`)).c
      assert.match(comment, /^V574 \+ V588 \+ V593 \+ V594 \+ V599 \+ V602 \+ V661:/)
      assert.match(comment, /V661: số theo giờ của bộ canh tăng bất thường đếm số lượt data khác nhau/)
      await assert.rejects(db.query(migration), /V661: (sổ migration đã có V661|thân hàm tick đang chạy có md5)/)
      await db.query('ROLLBACK')
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })

    await check('V661: cùng bộ kết quả, số theo giờ = số lượt data khác nhau (A tính 1, E có dòng ở hai lần tick tính 1, mỗi mã riêng, dòng ok không tính)', async () => {
      await resetWatch()
      await scenario(who)
      assert.deepEqual(await hourly(), await expected('data'))
      const byCode = Object.fromEntries((await hourly()).map(h => [`${h.error_code}|${h.action_code}`, 0]))
      for (const h of await hourly()) byCode[`${h.error_code}|${h.action_code}`] += h.n
      assert.equal(byCode[`${FB45}|fb_comment`], 7, 'A, B, C, D, E, F, H')
      assert.equal(byCode[`${RUN01}|fb_comment`], 1, 'F')
    })

    await check('V661: 1 data có 25 comment bị bỏ qua không còn thành "tăng bất thường"; 25 data mỗi data 1 dòng vẫn mở ca', async () => {
      await awayFromHourEdge()
      await resetWatch()
      await baseline(FB45)
      const run = await targetRun(who)
      await outcomes(run, { n: 25, ago: '2 minutes' })
      await tick()
      assert.equal(await spikeCase(FB45), undefined, 'một data không phải đợt tăng')
      for (let i = 0; i < 25; i++) await outcomes(await targetRun(who), { ago: '1 minute' })
      await sleep(1_000)
      await db.query(`UPDATE private.auto_engine_error_watch_state SET cursor_at = clock_timestamp() - interval '70 seconds'`)
      await tick()
      const spike = await spikeCase(FB45)
      assert.ok(spike, '25 data mở ca tăng bất thường')
      assert.equal(spike.hits, 26, 'hits = số lượt data trong giờ (1 + 25)')
      assert.match(spike.pattern, /có 26 lượt, trung bình cùng giờ 7 ngày trước là 2/)
    })

    await check('gỡ V661: về thân V602 (đếm theo dòng); gỡ lại bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await bodyMd5(), V602_BODY_MD5)
      await assert.rejects(db.query(rollback), /Gỡ V661: thân hàm tick đang chạy/)
      await db.query('ROLLBACK')
      await resetWatch()
      const run = await targetRun(who)
      await outcomes(run, { n: 4, ago: '2 minutes' })
      await tick()
      assert.deepEqual(await hourly(), await expected('rows'))
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${passed} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
