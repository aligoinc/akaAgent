// V593: bộ kiểm lỗi chiến dịch Facebook chọn ca theo mức ảnh hưởng và chờ ảnh lỗi về trước khi hỏi Claude. PostgreSQL 17 cục bộ, không chạm DB thật:
//   LC_ALL=C node scripts/engine-v2-facebook/error-watch-v593-smoke.cjs
// DB engine như production + V574 + V588 + bản giả nền Hỏi đáp AI, rồi V593. Kiểm: apply (md5 thân hàm), V588 bỏ đói ca gửi lại nặng nhất còn V593
// thì không, xin ảnh cho ca mã chung, chờ ảnh về rồi mới hỏi (câu hỏi ghi ảnh đã về, không hỏi tiếp lần hai), quá hạn chờ thì hỏi không ảnh rồi hỏi
// tiếp khi ảnh về, imageWaitMinutes = 0 hỏi ngay như V588, tắt xin ảnh thì không chờ, bản gỡ.
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')
const { AI_STUBS } = require('./error-watch-fixture.cjs')

const PORT = Number(process.env.ENGINE_FB_ERROR_WATCH_V593_PORT || 55593)
const AGENT = 'kiem-loi-chien-dich-facebook'
const ORG = 1, ADMIN = 4, CUSTOMER_ORG = 701
const V588_BODY_MD5 = 'b4e8c5008ce2b9c50501c14c66b6c5de'
let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function main() {
  const { NEW_BODY_MD5 } = require('../build-v593-sql.cjs')
  const cluster = startCluster({ port: PORT, label: 'aka-fb-error-watch-v593-', timeoutMs: 600_000 })
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
  const answer = id => db.query(`UPDATE public.ai_message SET status = 'hoàn thành', answer = 'bản chữ', answered_at = clock_timestamp(),
      answer_json = '{"tom_tat":"Đã kiểm.","ket_luan":"chua_du_du_lieu","do_chac":"thap","nen_sua_app":false,"de_xuat":["cần ảnh"]}'::jsonb WHERE id = $1`, [id])
    .then(() => db.query(`UPDATE public.ai_message_thread t SET last_message_status = 'hoàn thành' FROM public.ai_message m WHERE m.id = $1 AND t.id = m.thread_id`, [id]))
  /** Trả lời mọi câu còn chờ của agent rồi chạy tick để sổ ca ghi nhận (không còn câu chờ nào chặn câu mở hội thoại mới). */
  const settle = async () => {
    for (const m of await all(`SELECT m.id FROM public.ai_message m WHERE m.status = 'chờ câu trả lời'`)) await answer(m.id)
    await tick()
  }
  const addFile = async request => {
    await db.query(`INSERT INTO public.auto_desktop_diagnostic_files (request_id, image_id, content, sha256) VALUES ($1, gen_random_uuid(), '\\xffd8ffe0'::bytea, repeat('a', 64))`, [request])
    await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = 'done', completed_at = now() WHERE id = $1`, [request])
  }
  let nextId = 990000
  const customers = []

  /** Một khách (nhân viên, tài khoản, chiến dịch Facebook): mỗi khách tối đa một yêu cầu ảnh mỗi ngày nên mỗi ca ảnh dùng một khách. */
  const customer = async () => {
    const staff = ++nextId, account = ++nextId, campaign = ++nextId
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_admin_akabiz) VALUES ($1, $2, $3, 'pw', false)`, [staff, CUSTOMER_ORG, `khach${staff}`])
    await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server,
        is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB thử', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`, [account, staff, CUSTOMER_ORG])
    await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
        extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, 'Đăng nhóm thử', 'facebook_group_post', $2, 'chờ xử lý', now(), false, $3, $4, 'daily', '{}')`,
      [campaign, account, staff, CUSTOMER_ORG])
    const c = { staff, account, campaign }
    customers.push(c)
    return c
  }

  /** n lượt data đã đóng của một mã lỗi (mỗi lượt một kết quả lỗi); screenshot: kết quả có ảnh lỗi trên máy khách. */
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
  /** Ghi các lượt lỗi rồi chạy tick một lần để sổ ca có ca mới (chưa chèn việc). */
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
    await db.query(`UPDATE public.ai_project SET is_active = true WHERE code = $1`, [AGENT])
    await setCfg({ enabled: true, enqueue: true, staffId: ADMIN, maxPerDay: 45, maxPending: 5, imageRequests: false })
    const migration = readMigration('migration_v593_engine_error_watch_order_images.sql')
    const rollback = readMigration('rollback_v593_engine_error_watch_order_images.sql')
    const c1 = await customer()

    await check('V588 (trước bản sửa): ca gửi lại nặng nhất bị xếp sau ca mới nhỏ hơn', async () => {
      assert.equal(await bodyMd5(), V588_BODY_MD5)
      await scan(async () => {
        await outcomes(c1, { code: 'err_engine_fb_action_failed', pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: Form đăng bài chưa đóng sau 60 giây', n: 9 })
        await outcomes(c1, { code: 'err_fb_comment_box_not_found', pub: 'FB41', action: 'fb_comment', step: 'comment', text: 'Không thấy ô bình luận', n: 1 })
      })
      // Ca FB42: câu trước đã hết hạn (như 19/11), ca thành 'failed' và từng làm dừng chiến dịch.
      await db.query(`UPDATE private.auto_engine_error_cases SET status = 'failed', pauses = 8 WHERE error_code = 'err_engine_fb_action_failed'`)
      const r = await tick()
      assert.equal(r.inserted.length, 1, JSON.stringify(r))
      assert.match(r.inserted[0].khoa, /err_fb_comment_box_not_found/, 'V588 chọn ca mới 1 lượt trước ca gửi lại 9 lượt / 8 lần dừng')
      // Trả lời câu đó nhưng chưa chạy tick: ca FB42 vẫn 'failed' để so với V593 ở bước sau (V588 chỉ tới lượt nó khi không còn ca mới nào).
      await answer(r.inserted[0].messageId)
      assert.equal((await caseOf('err_engine_fb_action_failed')).status, 'failed')
    })

    await check('apply V593: thân hàm tick đúng md5; apply lại bị từ chối', async () => {
      await db.query(migration)
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
      await assert.rejects(db.query(migration), /V593: thân hàm tick đang chạy có md5/)
      await db.query('ROLLBACK')
      assert.equal(await bodyMd5(), NEW_BODY_MD5)
    })

    await check('V593: ca gửi lại nặng nhất được chọn trước ca mới nhỏ hơn; trần gửi lại mỗi ngày vẫn giữ', async () => {
      await scan(async () => {
        await outcomes(c1, { code: 'err_fb_group_post_link_missing', pub: 'FB42', action: 'fb_post_group', step: 'get_post_link', text: 'Không lấy được link bài', n: 1 })
      })
      let r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.match(r.inserted[0].khoa, /err_engine_fb_action_failed/, JSON.stringify(r.inserted))
      const fb42 = await caseOf('err_engine_fb_action_failed')
      assert.equal(fb42.status, 'queued')
      assert.match((await message(fb42.last_message_id)).question, /\(gửi lại\)/)
      await settle()
      // Ca mới nhỏ vẫn được hỏi ngay sau đó.
      assert.ok(['queued', 'reported'].includes((await caseOf('err_fb_group_post_link_missing')).status))
      await settle()
    })

    await check('xin ảnh cho ca mã chung (không chỉ ca chưa phân loại), chờ ảnh về rồi mới hỏi; câu hỏi ghi ảnh đã về, không hỏi tiếp lần hai', async () => {
      await setCfg({ imageRequests: true, imageWaitMinutes: 15 })
      const who = await customer()
      await scan(async () => {
        await outcomes(who, { code: 'err_fb_group_form_stuck_test', pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: Form đăng bài chưa đóng sau 60 giây', n: 3, screenshot: true })
      })
      assert.equal((await caseOf('err_fb_group_form_stuck_test')).kind, 'ma_chua_ket_luan')
      let r = await tick()
      assert.equal(r.imageRequests, 1)
      assert.equal(r.imageWaiting, 1)
      assert.equal(r.inserted.length, 0, 'chưa hỏi khi ảnh chưa về')
      const [req] = await requests(who.staff)
      assert.ok(req, 'có yêu cầu ảnh cho máy của khách')
      assert.equal(Number((await caseOf('err_fb_group_form_stuck_test')).image_request_id), Number(req.id))
      r = await tick()
      assert.equal(r.imageRequests, 0, 'không xin ảnh lần hai cho cùng ca')
      assert.equal(r.imageWaiting, 1)
      assert.equal(r.inserted.length, 0)
      await addFile(req.id)
      r = await tick()
      assert.equal(r.imageWaiting, 0)
      assert.equal(r.inserted.length, 1)
      const kase = await caseOf('err_fb_group_form_stuck_test')
      const q = (await message(kase.last_message_id)).question
      assert.match(q, new RegExp(`yeu cau anh: ${req.id}`))
      assert.match(q, new RegExp(`anh da ve: 1 ảnh, xem bằng public\\.aka_agent_desktop_diagnostic_files_v1\\(${req.id}\\)`))
      assert.ok(kase.image_followup_at, 'đã hỏi kèm ảnh thì bước hỏi tiếp vì ảnh không chạy nữa')
      const thread = await one(`SELECT intake_data FROM public.ai_message_thread t JOIN public.ai_message m ON m.thread_id = t.id WHERE m.id = $1`, [kase.last_message_id])
      assert.equal(thread.intake_data.anh_da_ve, true)
      await answer(kase.last_message_id)
      r = await tick()
      assert.equal(r.inserted.length, 0, 'không có câu hỏi tiếp vì ảnh')
      assert.equal((await caseOf('err_fb_group_form_stuck_test')).status, 'reported')
    })

    await check('ảnh chưa về quá imageWaitMinutes: hỏi không ảnh; ảnh về sau thì hỏi tiếp trong hội thoại của ca', async () => {
      const who = await customer()
      await scan(async () => {
        await outcomes(who, { code: 'err_fb_comment_box_timeout_test', pub: 'FB41', action: 'fb_comment', step: 'comment_at_pos', text: 'Không thấy ô bình luận', n: 2, screenshot: true })
      })
      let r = await tick()
      assert.equal(r.imageRequests, 1)
      assert.equal(r.inserted.length, 0)
      const [req] = await requests(who.staff)
      await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET created_at = created_at - interval '16 minutes' WHERE id = $1`, [req.id])
      r = await tick()
      assert.equal(r.imageWaiting, 0)
      assert.equal(r.inserted.length, 1)
      let kase = await caseOf('err_fb_comment_box_timeout_test')
      const first = await message(kase.last_message_id)
      assert.doesNotMatch(first.question, /anh da ve/)
      assert.equal(kase.image_followup_at, null)
      await answer(first.id)
      await tick()
      await addFile(req.id)
      r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.equal(r.inserted[0].anh, true)
      kase = await caseOf('err_fb_comment_box_timeout_test')
      const follow = await message(kase.last_message_id)
      assert.equal(Number(follow.thread_id), Number(first.thread_id))
      assert.match(follow.question, /Đã có 1 ảnh lỗi/)
      await settle()
    })

    await check('máy khách báo không có ảnh: hỏi ngay, không chờ hết hạn', async () => {
      const who = await customer()
      await scan(async () => {
        await outcomes(who, { code: 'err_fb_no_image_test', pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: Không bấm được nút', n: 1, screenshot: true })
      })
      let r = await tick()
      assert.equal(r.inserted.length, 0)
      const [req] = await requests(who.staff)
      await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = 'no_images', completed_at = now() WHERE id = $1`, [req.id])
      r = await tick()
      assert.equal(r.inserted.length, 1)
      assert.doesNotMatch((await message((await caseOf('err_fb_no_image_test')).last_message_id)).question, /anh da ve/)
      await settle()
    })

    await check('imageWaitMinutes = 0: xin ảnh và hỏi ngay như V588', async () => {
      await setCfg({ imageWaitMinutes: 0 })
      const who = await customer()
      await scan(async () => {
        await outcomes(who, { code: 'err_fb_wait_zero_test', pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: Form đăng bài chưa đóng sau 60 giây', n: 1, screenshot: true })
      })
      const r = await tick()
      assert.equal(r.imageRequests, 1)
      assert.equal(r.imageWaiting, 0)
      assert.equal(r.inserted.length, 1)
      await settle()
      await setCfg({ imageWaitMinutes: 15 })
    })

    await check('lượt bị bỏ dở và ca không có ảnh: không xin ảnh, không chờ; tắt xin ảnh thì hỏi ngay', async () => {
      const who = await customer()
      await scan(async () => {
        await outcomes(who, { code: 'err_fb_no_shot_test', pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: lỗi khác', n: 1, screenshot: false })
      })
      let r = await tick()
      assert.equal(r.imageRequests, 0)
      assert.equal(r.inserted.length, 1)
      await settle()
      await setCfg({ imageRequests: false })
      const other = await customer()
      await scan(async () => {
        await outcomes(other, { code: 'err_fb_images_off_test', pub: 'FB42', text: 'Đăng bài thất bại vào Nhóm thử: Form đăng bài chưa đóng sau 60 giây', n: 1, screenshot: true })
      })
      r = await tick()
      assert.equal(r.imageRequests, 0)
      assert.equal(r.imageWaiting, 0)
      assert.equal(r.inserted.length, 1)
      assert.equal((await requests(other.staff)).length, 0)
      await settle()
    })

    await check('bản gỡ: trả thân V588; gỡ lần hai bị từ chối', async () => {
      await db.query(rollback)
      assert.equal(await bodyMd5(), V588_BODY_MD5)
      await assert.rejects(db.query(rollback), /Gỡ V593: thân hàm tick đang chạy/)
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
