// V602: bộ kiểm lỗi chiến dịch Facebook phân loại lượt bị bỏ dở theo đường đóng lượt (sự kiện interrupted, data.via của V576).
// PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/engine-v2-facebook/error-watch-v602-smoke.cjs
// DB engine như production + V574 + V588 + V593 + V594 + V599 + bản giả nền Hỏi đáp AI; kiểm bản V599 (thấy lỗi của câu 571) trước, rồi V602.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
const { AI_STUBS } = require('./error-watch-fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_WATCH_V602_PORT || 55602)
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, ADMIN = 4, CUSTOMER_ORG = 701
const CODE = 'err_engine_interrupted_before_send'
const KEY = `stale|facebook_group_post|${CODE}`
const KEY_ORPHAN = `${KEY}|orphan`
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function main() {
  const { NEW_BODY_MD5: V599_NEW_MD5 } = require('../build-v599-sql.cjs')
  const { V599_BODY_MD5, NEW_BODY_MD5, TREO, ORPHAN } = require('../build-v602-sql.cjs')
  assert.equal(V599_BODY_MD5, V599_NEW_MD5, 'thân V599 trong build-v602 phải trùng bản build-v599 sinh ra')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-watch-v602-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const all = async (sql, args = []) => (await db.query(sql, args)).rows
  const tick = async () => (await one('SELECT public.aka_agent_engine_error_watch_tick_v1() AS r')).r
  const setCfg = patch => db.query(`UPDATE public.auto_system_settings SET value = (value::jsonb || $1::jsonb)::text WHERE key = 'engine.error_watch'`, [JSON.stringify(patch)])
  const bodyMd5 = async () => (await one(`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure`)).m
  const caseOf = key => one(`SELECT * FROM private.auto_engine_error_cases WHERE case_key = $1`, [key])
  const itemsOf = runs => all(`SELECT target_run_id, case_key, message FROM private.auto_engine_error_items WHERE target_run_id = ANY ($1) ORDER BY target_run_id`, [runs])
  /** Bước 3 của tick xét lượt bắt đầu trong (stale_cursor_at, now - 30 phút]: mỗi đợt kiểm đặt lại con trỏ ngay trước lượt của đợt đó. */
  const cursor = ago => db.query(`UPDATE private.auto_engine_error_watch_state SET stale_cursor_at = clock_timestamp() - $1::interval`, [ago])
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
  const online = staff => db.query(`INSERT INTO public.auto_staff_device_presence (staff_id, last_seen_at) VALUES ($1, now())`, [staff])

  /**
   * Một lượt đóng stale như V576 ghi: lượt bắt đầu `startedAgo` trước, đóng 14 phút sau; `events` là các sự kiện interrupted theo thứ tự
   * (mỗi phần tử là data của sự kiện; null = không có sự kiện nào).
   */
  const staleRun = async (who, { startedAgo, events = [{ via: 'stale', marked: false }], code = CODE }) => {
    const data = ++nextId
    await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
      VALUES ($1, $2, 'nhóm', 'g', 'chờ xử lý', false)`, [data, who.campaign])
    const run = await one(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id,
        runtime_target, started_at, completed_at, close_reason, final_error_code, final_response)
      VALUES ($1, $2, $3, $4, $5, $6, 'desktop:test', 'desktop', clock_timestamp() - $7::interval, clock_timestamp() - $7::interval + interval '14 minutes',
        'stale', $8, '{}') RETURNING id`, [data, who.campaign, who.account, who.staff, CUSTOMER_ORG, crypto.randomUUID(), startedAgo, code])
    for (const ev of events) {
      await db.query(`INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
        VALUES ($1, $2, $3, 'interrupted', $4, 'Lượt bị ngắt', $5)`, [data, who.campaign, run.id, code, JSON.stringify(ev)])
    }
    return Number(run.id)
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
      'migration_v594_engine_error_watch_hourly_skip.sql', 'migration_v599_engine_error_watch_multi_images.sql']) await db.query(readMigration(f))
    await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
    // Chỉ kiểm phần gom ca: không chèn câu hỏi.
    await setCfg({ enabled: true, enqueue: false, staffId: ADMIN, imageRequests: false })
    const migration = readMigration('migration_v602_engine_error_watch_stale_via.sql')
    const rollback = readMigration('rollback_v602_engine_error_watch_stale_via.sql')
    const who = await customer()
    const gone = await customer() // máy đã tắt: không có presence
    await online(who.staff)

    let old = {}
    await check('V599 (trước bản sửa, tái hiện câu 571): lượt app khởi động lại và lượt mồ côi cùng vào ca "treo quá lâu"', async () => {
      assert.equal(await bodyMd5(), V599_BODY_MD5)
      await cursor('80 minutes')
      old.reset = await staleRun(who, { startedAgo: '70 minutes', events: [{ via: 'desktop_reset', marked: false }] })
      old.orphan = await staleRun(who, { startedAgo: '70 minutes', events: [{ via: 'orphan', marked: false }] })
      old.stale = await staleRun(who, { startedAgo: '70 minutes' })
      const r = await tick()
      assert.equal(r.stale, 1, JSON.stringify(r))
      const k = await caseOf(KEY)
      assert.equal(Number(k.hits), 3, 'bản cũ đếm cả lượt app khởi động lại và lượt mồ côi')
      assert.equal(k.pattern, TREO)
      assert.equal(await caseOf(KEY_ORPHAN), undefined)
      const items = await itemsOf(Object.values(old))
      assert.equal(items.length, 3)
      assert.ok(items.every(i => i.case_key === KEY && i.message === TREO))
    })

    await check('apply V602: thân tick đúng md5; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
      const comment = (await one(`SELECT obj_description('public.aka_agent_engine_error_watch_tick_v1()'::regprocedure, 'pg_proc') AS c`)).c
      assert.match(comment, /^V574 \+ V588 \+ V593 \+ V594 \+ V599 \+ V602:/)
      assert.match(comment, /V602: lượt bị bỏ dở phân loại theo đường đóng lượt/)
      await assert.rejects(db.query(migration), /V602: (sổ migration đã có V602|thân hàm tick đang chạy có md5)/)
      await db.query('ROLLBACK')
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })

    const runs = {}
    await check('V602: app khởi động lại bỏ qua; mồ côi thành ca riêng; treo / không có sự kiện / chốt theo kết quả giữ ca cũ', async () => {
      await cursor('55 minutes')
      runs.reset1 = await staleRun(who, { startedAgo: '45 minutes', events: [{ via: 'desktop_reset', marked: false }] })
      runs.reset2 = await staleRun(who, { startedAgo: '45 minutes', events: [{ via: 'desktop_reset', marked: true }] })
      runs.orphan = await staleRun(who, { startedAgo: '45 minutes', events: [{ via: 'orphan', marked: false }] })
      // Lần báo "đã dừng" tới muộn sau khi lượt mồ côi bị đóng: sự kiện không có via, không đổi đường đóng.
      runs.orphanLate = await staleRun(who, { startedAgo: '45 minutes', events: [{ via: 'orphan', marked: false }, { note: 'stopped' }] })
      runs.stale = await staleRun(who, { startedAgo: '45 minutes' })
      runs.outcomes = await staleRun(who, { startedAgo: '45 minutes', events: [{ via: 'stale', marked: true, final: 'outcomes' }] })
      runs.noEvent = await staleRun(who, { startedAgo: '45 minutes', events: [] })
      runs.goneOrphan = await staleRun(gone, { startedAgo: '45 minutes', events: [{ via: 'orphan', marked: false }] })
      const r = await tick()
      assert.equal(r.stale, 2, JSON.stringify(r))
      const k = await caseOf(KEY)
      assert.equal(Number(k.hits), 3 + 3, 'ca cũ cộng thêm đúng 3 lượt treo')
      assert.equal(k.pattern, TREO)
      const o = await caseOf(KEY_ORPHAN)
      assert.ok(o, 'có ca mồ côi')
      assert.equal(o.kind, 'luot_bo_do')
      assert.equal(o.pattern, ORPHAN)
      assert.equal(o.error_code, CODE)
      assert.equal(o.action_code, 'facebook_group_post')
      assert.equal(Number(o.hits), 2)
      assert.deepEqual(o.sample_runs.map(Number).sort(), [runs.orphan, runs.orphanLate].sort())
      const items = await itemsOf(Object.values(runs))
      const byRun = Object.fromEntries(items.map(i => [Number(i.target_run_id), i]))
      assert.equal(byRun[runs.reset1], undefined, 'app khởi động lại không thành lượt lỗi')
      assert.equal(byRun[runs.reset2], undefined, 'app khởi động lại (đã ghi dấu) không thành lượt lỗi')
      assert.equal(byRun[runs.goneOrphan], undefined, 'máy đã tắt: như cũ, không xét')
      for (const id of [runs.orphan, runs.orphanLate]) {
        assert.equal(byRun[id].case_key, KEY_ORPHAN)
        assert.equal(byRun[id].message, ORPHAN)
      }
      for (const id of [runs.stale, runs.outcomes, runs.noEvent]) {
        assert.equal(byRun[id].case_key, KEY)
        assert.equal(byRun[id].message, TREO)
      }
      assert.equal(items.length, 5)
    })

    await check('V602: mỗi lượt chỉ xét một lần; lượt chưa đủ 30 phút chưa xét', async () => {
      const young = await staleRun(who, { startedAgo: '20 minutes', events: [{ via: 'orphan', marked: false }] })
      const r = await tick()
      assert.equal(r.stale, 0, JSON.stringify(r))
      assert.equal(Number((await caseOf(KEY)).hits), 6)
      assert.equal(Number((await caseOf(KEY_ORPHAN)).hits), 2)
      assert.equal((await itemsOf([young])).length, 0)
    })

    await check('V602: ca và lượt lỗi ghi trước V602 giữ nguyên', async () => {
      const items = await itemsOf(Object.values(old))
      assert.equal(items.length, 3)
      assert.ok(items.every(i => i.case_key === KEY && i.message === TREO))
    })

    await check('V602: tra sự kiện theo chỉ mục (input_data_id, id)', async () => {
      await db.query('SET enable_seqscan = off')
      const plan = (await all(`EXPLAIN SELECT e.data ->> 'via' FROM public.auto_engine_target_events e
        WHERE e.input_data_id = $1 AND e.target_run_id = $2 AND e.kind = 'interrupted' AND e.data ? 'via' ORDER BY e.id LIMIT 1`, [1, 1]))
        .map(x => x['QUERY PLAN']).join('\n')
      await db.query('RESET enable_seqscan')
      assert.match(plan, /auto_engine_target_events_input_v495/, plan)
    })

    await check('bản gỡ: trả thân V599 (lượt app khởi động lại lại vào ca treo); gỡ lần hai bị từ chối; apply lại được', async () => {
      await db.query(rollback)
      assert.equal(await bodyMd5(), V599_BODY_MD5)
      const comment = (await one(`SELECT obj_description('public.aka_agent_engine_error_watch_tick_v1()'::regprocedure, 'pg_proc') AS c`)).c
      assert.match(comment, /^V574 \+ V588 \+ V593 \+ V594 \+ V599:/)
      await assert.rejects(db.query(rollback), /Gỡ V602: thân hàm tick đang chạy/)
      await db.query('ROLLBACK')
      await cursor('40 minutes')
      const reset = await staleRun(who, { startedAgo: '35 minutes', events: [{ via: 'desktop_reset', marked: false }] })
      await tick()
      assert.equal((await itemsOf([reset]))[0]?.case_key, KEY, 'bản V599 lại đếm lượt app khởi động lại')
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
  }
  console.log(failed ? `\n${passed} đạt, ${failed} lỗi` : `\n${passed} nhóm kiểm tra đạt`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
