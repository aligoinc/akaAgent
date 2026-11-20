// V599: bộ kiểm lỗi chiến dịch Facebook xin ảnh lỗi từ nhiều lượt mỗi ca (mỗi lượt một nhân viên khác nhau). PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/engine-v2-facebook/error-watch-v599-smoke.cjs
// DB engine như production + V574 + V588 + V593 + V594 + bản giả nền Hỏi đáp AI, rồi V599.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
const { AI_STUBS } = require('./error-watch-fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_WATCH_V599_PORT || 55599)
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, ADMIN = 4, CUSTOMER_ORG = 701
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function main() {
  const { V594_BODY_MD5, NEW_BODY_MD5 } = require('../build-v599-sql.cjs')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-watch-v599-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  const all = async (sql, args = []) => (await db.query(sql, args)).rows
  const tick = async () => (await one('SELECT public.aka_agent_engine_error_watch_tick_v1() AS r')).r
  const setCfg = patch => db.query(`UPDATE public.auto_system_settings SET value = (value::jsonb || $1::jsonb)::text WHERE key = 'engine.error_watch'`, [JSON.stringify(patch)])
  const bodyMd5 = async () => (await one(`SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = 'public.aka_agent_engine_error_watch_tick_v1()'::regprocedure`)).m
  let marker = null
  const mark = async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    marker = (await one(`SELECT (clock_timestamp() - interval '30 seconds 20 milliseconds')::text AS t`)).t
  }
  const rewind = () => db.query(`UPDATE private.auto_engine_error_watch_state SET cursor_at = $1::timestamptz`, [marker])
  const caseOf = async code => one(`SELECT * FROM private.auto_engine_error_cases WHERE error_code = $1`, [code])
  const message = id => one(`SELECT * FROM public.ai_message WHERE id = $1`, [id])
  const finish = (id, status) => db.query(`UPDATE public.ai_message SET status = $2, answer = 'bản chữ', answered_at = clock_timestamp(),
      answer_json = CASE WHEN $2 = 'hoàn thành' THEN '{"tom_tat":"Đã kiểm.","ket_luan":"chua_du_du_lieu","do_chac":"thap","nen_sua_app":false,"de_xuat":["cần ảnh"]}'::jsonb END
      WHERE id = $1`, [id, status])
    .then(() => db.query(`UPDATE public.ai_message_thread t SET last_message_status = $2 FROM public.ai_message m WHERE m.id = $1 AND t.id = m.thread_id`, [id, status]))
  const answer = id => finish(id, 'hoàn thành')
  const settle = async () => {
    for (const m of await all(`SELECT m.id FROM public.ai_message m WHERE m.status = 'chờ câu trả lời'`)) await answer(m.id)
    await tick()
  }
  const addFile = async (request, n = 1) => {
    for (let i = 0; i < n; i++) {
      await db.query(`INSERT INTO public.auto_desktop_diagnostic_files (request_id, image_id, content, sha256) VALUES ($1, gen_random_uuid(), '\\xffd8ffe0'::bytea, repeat('a', 64))`, [request])
    }
    await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = 'done', completed_at = now() WHERE id = $1`, [request])
  }
  const setRequest = (request, status) => db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = $2 WHERE id = $1`, [request, status])
  const ageRequests = (ids, minutes) => db.query(`UPDATE public.auto_desktop_diagnostic_requests SET created_at = created_at - make_interval(mins => $2) WHERE id = ANY ($1)`,
    [ids, minutes])
  const online = staff => db.query(`INSERT INTO public.auto_staff_device_presence (staff_id, last_seen_at) VALUES ($1, now())`, [staff])
  const requestsOf = ids => all(`SELECT id, staff_id, filter FROM public.auto_desktop_diagnostic_requests WHERE id = ANY ($1) ORDER BY array_position($1, id)`, [ids])
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

  /** Ghi n lượt lỗi; trả mã lượt data (target run) của từng lượt. */
  const outcomes = async (who, { code, pub = 'FB42', action = 'fb_post_group', step = 'click_post', text, n = 1, screenshot = false }) => {
    const runs = []
    for (let i = 0; i < n; i++) {
      const data = ++nextId, detail = ++nextId
      await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, note, is_delete) OVERRIDING SYSTEM VALUE
        VALUES ($1, $2, 'Nhóm thử', 'g', 'hoàn thành', $3, false)`, [data, who.campaign, text])
      await db.query(`INSERT INTO public.auto_campaign_details (id, input_data_id, campaign_id, account_id, action_name, status, log, data, created_at)
        VALUES ($1, $2, $3, $4, 'Đăng bài', 'lỗi', $5, '{}', clock_timestamp() - interval '30 seconds')`, [detail, data, who.campaign, who.account, text])
      const run = await one(`INSERT INTO public.auto_engine_target_runs (input_data_id, campaign_id, account_id, staff_id, organization_id, lease_token, runner_id,
          runtime_target, started_at, completed_at, close_reason, final_error_code, final_response)
        VALUES ($1, $2, $3, $4, $5, $6, 'desktop:test', 'desktop', clock_timestamp() - interval '50 seconds', clock_timestamp() - interval '30 seconds',
          'reported', $7, '{"ok":true,"campaign":{"effect":"none"}}') RETURNING id`, [data, who.campaign, who.account, who.staff, CUSTOMER_ORG, crypto.randomUUID(), code])
      await db.query(`INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok, error_code,
          delivery_state, detail_id, decision, signal, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'in_flight', false, $7, 'unknown', $8, $9, $10, clock_timestamp() - interval '30 seconds')`,
        [`v2:${run.id}:${step}`, run.id, data, who.campaign, who.account, action, code, detail, JSON.stringify({ result: { publicCode: pub } }),
          JSON.stringify({ kind: 'block', message: text, ...(screenshot ? { screenshotId: crypto.randomUUID() } : {}) })])
      runs.push(Number(run.id))
    }
    return runs
  }
  const scan = async fn => {
    await setCfg({ enqueue: false })
    await mark()
    const out = await fn()
    await rewind()
    await tick()
    await setCfg({ enqueue: true })
    return out
  }
  const TEXT = 'Đăng bài thất bại vào Nhóm thử: Form đăng bài chưa đóng sau 60 giây'

  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(AI_STUBS)
    await db.query(`ALTER TABLE public.auto_staff_device_presence ADD COLUMN ended_at timestamptz`)
    await db.query(`ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean NOT NULL DEFAULT false`)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'akaBiz'), ($2, 'Khách thử') ON CONFLICT DO NOTHING`, [ORG, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_admin_akabiz) VALUES ($1, $2, 'nhutlq', 'pw', true)`, [ADMIN, ORG])
    await db.query(readMigration('migration_v574_engine_error_watch.sql'))
    await db.query(readMigration('migration_v588_engine_error_review.sql'))
    await db.query(readMigration('migration_v593_engine_error_watch_order_images.sql'))
    await db.query(readMigration('migration_v594_engine_error_watch_hourly_skip.sql'))
    await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
    await setCfg({ enabled: true, enqueue: true, staffId: ADMIN, maxPerDay: 45, maxPending: 5, imageRequests: true, imageWaitMinutes: 15 })
    const migration = readMigration('migration_v599_engine_error_watch_multi_images.sql')
    const rollback = readMigration('rollback_v599_engine_error_watch_multi_images.sql')

    // Ca cũ (trước V599): xin đúng 1 ảnh, chưa về.
    const c0 = await customer()
    await check('V594 (trước bản sửa): ca có lượt ảnh của 3 khách chỉ xin ảnh cho 1 lượt', async () => {
      assert.equal(await bodyMd5(), V594_BODY_MD5)
      const extra = [await customer(), await customer()]
      await scan(async () => {
        await outcomes(c0, { code: 'err_fb_old_case', text: TEXT, n: 1, screenshot: true })
        for (const who of extra) await outcomes(who, { code: 'err_fb_old_case', text: TEXT, n: 1, screenshot: true })
      })
      const r = await tick()
      assert.equal(r.imageRequests, 1, JSON.stringify(r))
      assert.equal(r.imageWaiting, 1)
      assert.ok((await caseOf('err_fb_old_case')).image_request_id)
    })

    await check('apply V599: thân tick đúng md5, cột mới chép mã yêu cầu cũ; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
      const old = await caseOf('err_fb_old_case')
      assert.deepEqual(old.image_request_ids.map(Number), [Number(old.image_request_id)])
      assert.deepEqual((await one(`SELECT count(*)::int AS n FROM private.auto_engine_error_cases WHERE image_request_id IS NULL AND image_request_ids <> '{}'`)).n, 0)
      await assert.rejects(db.query(migration), /V599: (sổ migration đã có V599|thân hàm tick đang chạy có md5)/)
      await db.query('ROLLBACK')
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })

    await check('ca cũ chỉ có một yêu cầu vẫn chạy như trước: ảnh về thì hỏi, câu có "yeu cau anh" và "anh da ve: 1 ảnh"', async () => {
      const old = await caseOf('err_fb_old_case')
      await addFile(old.image_request_id)
      const r = await tick()
      assert.equal(r.inserted.length, 1, JSON.stringify(r))
      const q = (await message((await caseOf('err_fb_old_case')).last_message_id)).question
      assert.match(q, new RegExp(`yeu cau anh: ${old.image_request_id}$`, 'm'))
      assert.match(q, /anh da ve: 1 ảnh/)
      await settle()
    })

    await check('ca mới: xin ảnh từ tối đa imageRunsPerCase lượt, mỗi nhân viên một lượt, khách đang mở app trước, bỏ lượt không có ảnh', async () => {
      await setCfg({ imageRunsPerCase: 3 })
      const who = [await customer(), await customer(), await customer(), await customer(), await customer()]
      const runs = await scan(async () => {
        const out = {}
        out.a = await outcomes(who[0], { code: 'err_fb_multi', text: TEXT, n: 2, screenshot: true }) // 2 lượt cùng nhân viên
        out.b = await outcomes(who[1], { code: 'err_fb_multi', text: TEXT, n: 1, screenshot: true })
        out.c = await outcomes(who[2], { code: 'err_fb_multi', text: TEXT, n: 1, screenshot: false }) // không có ảnh
        out.d = await outcomes(who[3], { code: 'err_fb_multi', text: TEXT, n: 1, screenshot: true })
        out.e = await outcomes(who[4], { code: 'err_fb_multi', text: TEXT, n: 1, screenshot: true })
        return out
      })
      await online(who[1].staff)
      const r = await tick()
      assert.equal(r.imageRequests, 3, JSON.stringify(r))
      assert.equal(r.imageWaiting, 1)
      assert.equal(r.inserted.length, 0, 'chờ ảnh về rồi mới hỏi')
      const kase = await caseOf('err_fb_multi')
      const ids = kase.image_request_ids.map(Number)
      assert.equal(ids.length, 3)
      assert.equal(Number(kase.image_request_id), ids[0])
      const reqs = await requestsOf(ids)
      const staffs = reqs.map(q => Number(q.staff_id))
      assert.equal(new Set(staffs).size, 3, 'mỗi nhân viên một yêu cầu')
      assert.equal(staffs[0], who[1].staff, 'nhân viên đang mở app trước')
      assert.ok(!staffs.includes(who[2].staff), 'lượt không có ảnh không xin')
      for (const q of reqs) {
        const mine = Object.values(runs).flat()
        assert.ok(mine.includes(Number(q.filter.targetRunId)))
      }
      if (staffs.includes(who[0].staff)) {
        const qa = reqs.find(q => Number(q.staff_id) === who[0].staff)
        assert.equal(Number(qa.filter.targetRunId), Math.max(...runs.a), 'nhân viên có 2 lượt: lấy lượt mới nhất')
      }
    })

    await check('chờ mọi yêu cầu: 2/3 về thì vẫn chờ; quá imageWaitMinutes thì hỏi với ảnh đã về, câu liệt kê mọi mã', async () => {
      const kase = await caseOf('err_fb_multi')
      const ids = kase.image_request_ids.map(Number)
      await addFile(ids[0], 2)
      await addFile(ids[1], 1)
      let r = await tick()
      assert.equal(r.inserted.length, 0, JSON.stringify(r))
      assert.equal(r.imageWaiting, 1)
      await ageRequests([ids[2]], 20)
      r = await tick()
      assert.equal(r.inserted.length, 1, JSON.stringify(r))
      const after = await caseOf('err_fb_multi')
      const m = await message(after.last_message_id)
      assert.match(m.question, new RegExp(`^yeu cau anh: ${ids.join(', ')}$`, 'm'))
      assert.match(m.question, /anh da ve: 3 ảnh, xem bằng public\.aka_agent_desktop_diagnostic_files_v1\(<mã yêu cầu>\) với từng mã ở dòng yeu cau anh/)
      const intake = (await one(`SELECT intake_data FROM public.ai_message_thread WHERE id = $1`, [m.thread_id])).intake_data
      assert.deepEqual(intake.yeu_cau_anh_ds.map(Number), ids)
      assert.equal(Number(intake.yeu_cau_anh), ids[0])
      assert.ok(after.image_followup_at, 'đã hỏi kèm ảnh thì không hỏi tiếp vì ảnh nữa')
      await settle()
    })

    await check('mỗi nhân viên khách một yêu cầu mỗi ngày: ca thứ hai không xin lại ảnh của nhân viên đã xin hôm nay', async () => {
      const used = (await requestsOf((await caseOf('err_fb_multi')).image_request_ids.map(Number))).map(q => Number(q.staff_id))
      const fresh = await customer()
      await scan(async () => {
        for (const staff of used) {
          const who = await one(`SELECT s.id AS staff, a.id AS account, c.id AS campaign FROM public.org_staff s JOIN public.auto_accounts a ON a.staff_id = s.id
            JOIN public.auto_campaigns c ON c.account_id = a.id WHERE s.id = $1 LIMIT 1`, [staff])
          await outcomes({ staff: Number(who.staff), account: Number(who.account), campaign: Number(who.campaign) },
            { code: 'err_fb_multi_2', text: 'Lỗi thứ hai', n: 1, screenshot: true })
        }
        await outcomes(fresh, { code: 'err_fb_multi_2', text: 'Lỗi thứ hai', n: 1, screenshot: true })
      })
      const r = await tick()
      assert.equal(r.imageRequests, 1, JSON.stringify(r))
      const kase = await caseOf('err_fb_multi_2')
      assert.deepEqual((await requestsOf(kase.image_request_ids.map(Number))).map(q => Number(q.staff_id)), [fresh.staff])
      await addFile(kase.image_request_id)
      await tick()
      await settle()
    })

    await check('hỏi tiếp vì ảnh (ca đã có báo cáo): chờ yêu cầu dưới 60 phút; có ảnh và hết chờ thì hỏi, câu liệt kê mọi mã', async () => {
      await setCfg({ imageWaitMinutes: 0 })
      const who = [await customer(), await customer()]
      await scan(async () => {
        for (const w of who) await outcomes(w, { code: 'err_fb_followup', text: 'Lỗi hỏi tiếp', n: 1, screenshot: true })
      })
      let r = await tick()
      assert.equal(r.inserted.length, 1, 'imageWaitMinutes 0: hỏi ngay, chưa có ảnh')
      let kase = await caseOf('err_fb_followup')
      const ids = kase.image_request_ids.map(Number)
      assert.equal(ids.length, 2)
      assert.equal(kase.image_followup_at, null)
      await answer(kase.last_message_id)
      await tick()
      assert.equal((await caseOf('err_fb_followup')).status, 'reported')
      await addFile(ids[0], 1)
      r = await tick()
      assert.equal(r.inserted.length, 0, 'còn một yêu cầu đang chờ dưới 60 phút')
      await ageRequests([ids[1]], 61)
      r = await tick()
      assert.equal(r.inserted.length, 1, JSON.stringify(r))
      assert.equal(r.inserted[0].anh, true)
      kase = await caseOf('err_fb_followup')
      const q = (await message(kase.last_message_id)).question
      assert.match(q, new RegExp(`yêu cầu ảnh ${ids.join(', ')}\\)`))
      assert.match(q, new RegExp(`^yeu cau anh: ${ids.join(', ')}$`, 'm'))
      await settle()
    })

    await check('hỏi tiếp vì ảnh: mọi yêu cầu kết thúc không có ảnh thì ghi chú "không có ảnh" và không hỏi', async () => {
      const who = [await customer(), await customer()]
      await scan(async () => {
        for (const w of who) await outcomes(w, { code: 'err_fb_noimg', text: 'Lỗi không ảnh', n: 1, screenshot: true })
      })
      await tick()
      let kase = await caseOf('err_fb_noimg')
      await answer(kase.last_message_id)
      await tick()
      const ids = kase.image_request_ids.map(Number)
      await setRequest(ids[0], 'no_images')
      let r = await tick()
      assert.equal(r.inserted.length, 0)
      assert.equal((await caseOf('err_fb_noimg')).image_followup_at, null, 'còn một yêu cầu chưa xong')
      await setRequest(ids[1], 'expired')
      r = await tick()
      assert.equal(r.inserted.length, 0)
      kase = await caseOf('err_fb_noimg')
      assert.ok(kase.image_followup_at)
      assert.equal(kase.note, 'Yêu cầu ảnh kết thúc không có ảnh')
      await setCfg({ imageWaitMinutes: 15 })
    })

    await check('imageRunsPerCase 1: chỉ xin một lượt như V594', async () => {
      await setCfg({ imageRunsPerCase: 1 })
      const who = [await customer(), await customer()]
      await scan(async () => {
        for (const w of who) await outcomes(w, { code: 'err_fb_one', text: 'Lỗi một ảnh', n: 1, screenshot: true })
      })
      const r = await tick()
      assert.equal(r.imageRequests, 1, JSON.stringify(r))
      assert.equal((await caseOf('err_fb_one')).image_request_ids.length, 1)
      await setCfg({ imageRunsPerCase: 5 })
    })

    await check('bản gỡ: trả thân V594, bỏ cột; gỡ lần hai bị từ chối', async () => {
      await db.query(rollback)
      assert.equal(await bodyMd5(), V594_BODY_MD5)
      assert.equal((await one(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'private'
        AND table_name = 'auto_engine_error_cases' AND column_name = 'image_request_ids'`)).n, 0)
      await assert.rejects(db.query(rollback), /Gỡ V599: thân hàm tick đang chạy/)
      await db.query('ROLLBACK')
      await tick()
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
