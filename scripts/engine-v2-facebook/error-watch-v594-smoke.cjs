// V594: bộ kiểm lỗi chiến dịch Facebook — trần câu mỗi giờ, ca "bỏ qua" tự mở lại khi đủ lượt trong 24 giờ, bước hỏi tiếp vì ảnh chỉ nhận ca đã có
// báo cáo. PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/engine-v2-facebook/error-watch-v594-smoke.cjs
// DB engine như production + V574 + V588 + V593 + bản giả nền Hỏi đáp AI, rồi V594.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
const { AI_STUBS } = require('./error-watch-fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_WATCH_V594_PORT || 55594)
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, ADMIN = 4, CUSTOMER_ORG = 701
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function main() {
  const { V593_BODY_MD5, NEW_BODY_MD5 } = require('../build-v594-sql.cjs')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-watch-v594-', timeoutMs: 600_000 })
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
  const requests = staff => all(`SELECT * FROM public.auto_desktop_diagnostic_requests WHERE requested_by = 'error-watch' AND staff_id = $1 ORDER BY id`, [staff])
  const finish = (id, status) => db.query(`UPDATE public.ai_message SET status = $2, answer = 'bản chữ', answered_at = clock_timestamp(),
      answer_json = CASE WHEN $2 = 'hoàn thành' THEN '{"tom_tat":"Đã kiểm.","ket_luan":"chua_du_du_lieu","do_chac":"thap","nen_sua_app":false,"de_xuat":["cần ảnh"]}'::jsonb END
      WHERE id = $1`, [id, status])
    .then(() => db.query(`UPDATE public.ai_message_thread t SET last_message_status = $2 FROM public.ai_message m WHERE m.id = $1 AND t.id = m.thread_id`, [id, status]))
  const answer = id => finish(id, 'hoàn thành')
  /** Trả lời mọi câu còn chờ của agent rồi chạy tick để sổ ca ghi nhận. */
  const settle = async () => {
    for (const m of await all(`SELECT m.id FROM public.ai_message m WHERE m.status = 'chờ câu trả lời'`)) await answer(m.id)
    await tick()
  }
  /** Câu hỏi cũ không tính vào trần giờ hiện tại. */
  const ageMessages = () => db.query(`UPDATE public.ai_message SET created_at = created_at - interval '2 hours'`)
  const addFile = async request => {
    await db.query(`INSERT INTO public.auto_desktop_diagnostic_files (request_id, image_id, content, sha256) VALUES ($1, gen_random_uuid(), '\\xffd8ffe0'::bytea, repeat('a', 64))`, [request])
    await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = 'done', completed_at = now() WHERE id = $1`, [request])
  }
  /** Ca câu trước hỏng (như FB42 ngày 19/11): đã có hội thoại, chưa có báo cáo, chưa xin ảnh. Rồi bật xin ảnh: tick xin ảnh và chờ; ảnh về. */
  const failedCaseWithImage = async code => {
    const who = await customer()
    await scan(async () => {
      await outcomes(who, { code, pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: Form đăng bài chưa đóng sau 60 giây', n: 2, screenshot: true })
    })
    let r = await tick()
    assert.equal(r.inserted.length, 1)
    await finish((await caseOf(code)).last_message_id, 'lỗi')
    await db.query(`UPDATE private.auto_engine_error_cases SET status = 'failed' WHERE error_code = $1`, [code])
    await setCfg({ imageRequests: true, imageWaitMinutes: 15 })
    r = await tick()
    assert.equal(r.imageRequests, 1, JSON.stringify(r))
    assert.equal(r.imageWaiting, 1)
    assert.equal(r.inserted.length, 0)
    const kase = await caseOf(code)
    assert.equal(kase.status, 'failed')
    assert.equal(kase.report_at, null)
    await addFile(kase.image_request_id)
    return tick()
  }
  const skip = async (messageId, on = true) => (await one('SELECT private.aka_agent_engine_error_case_skip_v1($1, $2) AS r', [messageId, on])).r
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

  const outcomes = async (who, { code, pub, action = 'fb_post_group', step = 'click_post', text, n = 1, screenshot = false }) => {
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
    }
  }
  /** Ghi các lượt lỗi rồi chạy tick (enqueue tắt) để sổ ca ghi nhận. */
  const scan = async fn => {
    await setCfg({ enqueue: false })
    await mark()
    await fn()
    await rewind()
    await tick()
    await setCfg({ enqueue: true })
  }

  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await db.query(AI_STUBS)
    await db.query(`ALTER TABLE public.org_staff ADD COLUMN IF NOT EXISTS is_admin_akabiz boolean NOT NULL DEFAULT false`)
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'akaBiz'), ($2, 'Khách thử') ON CONFLICT DO NOTHING`, [ORG, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_admin_akabiz) VALUES ($1, $2, 'nhutlq', 'pw', true)`, [ADMIN, ORG])
    await db.query(readMigration('migration_v574_engine_error_watch.sql'))
    await db.query(readMigration('migration_v588_engine_error_review.sql'))
    await db.query(readMigration('migration_v593_engine_error_watch_order_images.sql'))
    await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
    await setCfg({ enabled: true, enqueue: true, staffId: ADMIN, maxPerDay: 45, maxPending: 5, imageRequests: false, imageWaitMinutes: 15 })
    const migration = readMigration('migration_v594_engine_error_watch_hourly_skip.sql')
    const rollback = readMigration('rollback_v594_engine_error_watch_hourly_skip.sql')
    const c1 = await customer()

    await check('V593 (trước bản sửa): ca câu trước hỏng mà ảnh về được hỏi bằng câu ngắn của bước hỏi tiếp', async () => {
      assert.equal(await bodyMd5(), V593_BODY_MD5)
      const r = await failedCaseWithImage('err_fb_v593_6a_test')
      assert.equal(r.inserted.length, 1)
      assert.equal(r.inserted[0].anh, true, 'V593: bước 6a nhận ca failed')
      assert.match((await message((await caseOf('err_fb_v593_6a_test')).last_message_id)).question, /Đã có 1 ảnh lỗi/)
      await settle()
      await setCfg({ imageRequests: false, imageWaitMinutes: 15 })
    })

    await check('apply V594: thân hàm tick đúng md5, có hàm bỏ qua ca, không cấp quyền cho app; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
      const grants = await one(`SELECT has_function_privilege('anon', 'private.aka_agent_engine_error_case_skip_v1(bigint,boolean)', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'private.aka_agent_engine_error_case_skip_v1(bigint,boolean)', 'EXECUTE') AS auth`)
      assert.deepEqual(grants, { anon: false, auth: false })
      await assert.rejects(db.query(migration), /V594: thân hàm tick đang chạy có md5/)
      await db.query('ROLLBACK')
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })

    await check('maxPerHour 2: giờ này đã có 2 câu thì ca thứ ba chờ; bỏ trần thì hỏi tiếp', async () => {
      await settle()
      await ageMessages()
      await setCfg({ maxPerHour: 2 })
      await scan(async () => {
        await outcomes(c1, { code: 'err_fb_hour_a', pub: 'FB42', text: 'Lỗi giờ A', n: 3 })
        await outcomes(c1, { code: 'err_fb_hour_b', pub: 'FB42', text: 'Lỗi giờ B', n: 2 })
        await outcomes(c1, { code: 'err_fb_hour_c', pub: 'FB42', text: 'Lỗi giờ C', n: 1 })
      })
      let r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.equal(r.tasksHour, 0)
      await answer(r.inserted[0].messageId)
      r = await tick()
      assert.equal(r.inserted.length, 1, JSON.stringify(r))
      assert.equal(r.tasksHour, 1)
      await answer(r.inserted[0].messageId)
      r = await tick()
      assert.equal(r.inserted.length, 0, 'đủ 2 câu trong giờ')
      assert.equal(r.tasksHour, 2)
      assert.equal((await caseOf('err_fb_hour_c')).status, 'new')
      await setCfg({ maxPerHour: 0 })
      r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.match(r.inserted[0].khoa, /err_fb_hour_c/)
      await settle()
    })

    await check('V594: ca câu trước hỏng mà ảnh về được hỏi bằng câu đầy đủ (gửi lại, có số liệu và dòng ảnh đã về)', async () => {
      let r = await failedCaseWithImage('err_fb_v594_6a_test')
      assert.equal(r.inserted.length, 1, JSON.stringify(r))
      assert.notEqual(r.inserted[0].anh, true, 'bước 6a không nhận ca failed')
      const kase = await caseOf('err_fb_v594_6a_test')
      const q = (await message(kase.last_message_id)).question
      assert.match(q, /\(gửi lại\)/)
      assert.match(q, /so luot: 2/)
      assert.match(q, new RegExp(`anh da ve: 1 ảnh`))
      assert.ok(kase.image_followup_at, 'đã hỏi kèm ảnh thì không hỏi tiếp vì ảnh nữa')
      await answer(kase.last_message_id)
      r = await tick()
      assert.equal(r.inserted.length, 0)
      assert.equal((await caseOf('err_fb_v594_6a_test')).status, 'reported')
      await setCfg({ imageRequests: false, imageWaitMinutes: 15 })
    })

    await check('bỏ qua ca: không hỏi lại khi tăng gấp 3; dưới 30 lượt / 24 giờ vẫn bỏ qua; đủ 30 thì mở lại và câu hỏi ghi rõ', async () => {
      await scan(async () => {
        await outcomes(c1, { code: 'err_fb_skip_test', pub: 'FB41', action: 'fb_comment', step: 'comment', text: 'Không thấy ô bình luận', n: 5 })
      })
      let r = await tick()
      assert.equal(r.inserted.length, 1)
      const msgId = r.inserted[0].messageId
      await answer(msgId)
      await tick()
      assert.equal((await caseOf('err_fb_skip_test')).status, 'reported')
      // Lượt cũ hơn 24 giờ không tính.
      await db.query(`UPDATE private.auto_engine_error_items SET occurred_at = occurred_at - interval '25 hours' WHERE error_code = 'err_fb_skip_test'`)
      const s = await skip(msgId)
      assert.equal(s.ok, true, JSON.stringify(s))
      assert.equal(s.status, 'muted')
      assert.equal(s.hits24h, 0)
      assert.equal(s.reopenHits24h, 30)
      assert.equal((await caseOf('err_fb_skip_test')).status, 'muted')
      await scan(async () => {
        await outcomes(c1, { code: 'err_fb_skip_test', pub: 'FB41', action: 'fb_comment', step: 'comment', text: 'Không thấy ô bình luận', n: 29 })
      })
      r = await tick()
      assert.equal(r.reopened, 0)
      assert.equal(r.inserted.length, 0, 'gấp 3 lần nhưng chưa đủ 30 lượt / 24 giờ')
      assert.equal((await caseOf('err_fb_skip_test')).status, 'muted')
      await mark()
      await outcomes(c1, { code: 'err_fb_skip_test', pub: 'FB41', action: 'fb_comment', step: 'comment', text: 'Không thấy ô bình luận', n: 1 })
      await rewind()
      r = await tick()
      assert.equal(r.reopened, 1)
      assert.equal(r.inserted.length, 1)
      const kase = await caseOf('err_fb_skip_test')
      assert.equal(kase.status, 'queued')
      assert.match(kase.note, /^Mở lại sau khi bỏ qua: từ 30 lượt trong 24 giờ/)
      const q = (await message(kase.last_message_id)).question
      assert.match(q, /ghi chu: Mở lại sau khi bỏ qua/)
      assert.equal(Number((await message(kase.last_message_id)).thread_id), Number((await message(msgId)).thread_id), 'hỏi trong hội thoại cũ của ca')
      await settle()
    })

    await check('lệnh bỏ qua: ca đang kiểm bị từ chối; câu không thuộc ca nào bị từ chối; bỏ qua rồi trả lại', async () => {
      await scan(async () => {
        await outcomes(c1, { code: 'err_fb_skip_queued', pub: 'FB42', text: 'Lỗi đang kiểm', n: 1 })
      })
      const r = await tick()
      const msgId = r.inserted[0].messageId
      let s = await skip(msgId)
      assert.equal(s.ok, false)
      assert.equal(s.code, 'status_queued')
      s = await skip(123456789)
      assert.equal(s.code, 'case_not_found')
      await answer(msgId)
      await tick()
      s = await skip(msgId)
      assert.equal(s.ok, true)
      s = await skip(msgId, false)
      assert.equal(s.ok, true)
      assert.equal(s.status, 'reported')
      assert.equal((await caseOf('err_fb_skip_queued')).status, 'reported')
      s = await skip(msgId, false)
      assert.equal(s.code, 'not_muted')
    })

    await check('bản gỡ: trả thân V593, bỏ hàm bỏ qua ca; gỡ lần hai bị từ chối', async () => {
      await db.query(rollback)
      assert.equal(await bodyMd5(), V593_BODY_MD5)
      assert.equal((await one(`SELECT to_regprocedure('private.aka_agent_engine_error_case_skip_v1(bigint,boolean)') AS f`)).f, null)
      await assert.rejects(db.query(rollback), /Gỡ V594: thân hàm tick đang chạy/)
      await db.query('ROLLBACK')
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
